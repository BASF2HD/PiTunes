#!/usr/bin/env bash
# Robust PiTunes OTA updater.
#
# This script is intentionally run as root through a narrow sudoers rule. It
# downloads the latest stable GitHub Release source archive, backs up the current appliance files,
# applies the app/service files, verifies the API, and restores the backup if
# the update does not complete cleanly. It intentionally does not upgrade the
# Raspberry Pi OS base during normal OTA.
set -Eeuo pipefail

INSTALL_DIR="${PITUNES_INSTALL_DIR:-/opt/pitunes}"
STATE_DIR="${PITUNES_STATE_DIR:-/var/lib/pitunes}"
BACKUP_DIR="${PITUNES_BACKUP_DIR:-/var/backups/pitunes}"
WORK_ROOT="${PITUNES_UPDATE_WORK_ROOT:-/var/tmp/pitunes-update}"
STATUS_FILE="${STATE_DIR}/update-status.json"
LOG_FILE="${PITUNES_UPDATE_LOG:-/var/log/pitunes-update.log}"
GITHUB_REPOSITORY="${PITUNES_UPDATE_REPOSITORY:-BASF2HD/PiTunes}"
REPO="${PITUNES_UPDATE_REPO:-https://github.com/${GITHUB_REPOSITORY}}"
CHANNEL="stable"
LOCK_DIR="/run/pitunes-update.lock"
SYSTEMCTL_BIN="${PITUNES_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
BACKUP_RETENTION="${PITUNES_UPDATE_BACKUP_RETENTION:-3}"

CURRENT_SHA=""
TARGET_SHA=""
CURRENT_VERSION=""
TARGET_VERSION=""
TARGET_TAG=""
APP_BACKUP=""
SYSTEM_BACKUP=""
WORK_DIR=""
LOCK_HELD=0

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

write_status() {
  local state="$1"
  local ok="$2"
  local message="$3"
  python3 - "$STATUS_FILE" "$state" "$ok" "$message" "${CURRENT_SHA}" "${TARGET_SHA}" \
    "${CURRENT_VERSION}" "${TARGET_VERSION}" "${CHANNEL}" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
state, ok_raw, message, current, target, current_version, latest_version, channel = sys.argv[2:10]
payload = {
    "state": state,
    "applying": state == "running",
    "ok": None if ok_raw == "" else ok_raw == "true",
    "message": message,
    "current": current[:7] if current else "",
    "latest": target[:7] if target else "",
    "currentVersion": current_version,
    "latestVersion": latest_version,
    "channel": channel,
    "updatedAt": int(time.time()),
}
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload), encoding="utf-8")
PY
}

cleanup() {
  [ -n "${WORK_DIR}" ] && rm -rf "${WORK_DIR}" 2>/dev/null || true
  if [ "${LOCK_HELD}" = "1" ]; then
    rm -rf "${LOCK_DIR}" 2>/dev/null || true
  fi
}

restore_backup() {
  log "Restoring previous PiTunes installation."
  if [ -n "${APP_BACKUP}" ] && [ -s "${APP_BACKUP}" ]; then
    rm -rf "${INSTALL_DIR}"
    mkdir -p "$(dirname "${INSTALL_DIR}")"
    tar -C "$(dirname "${INSTALL_DIR}")" -xzf "${APP_BACKUP}"
  fi
  if [ -n "${SYSTEM_BACKUP}" ] && [ -s "${SYSTEM_BACKUP}" ]; then
    tar -C / --overwrite -xzf "${SYSTEM_BACKUP}" || true
    systemctl daemon-reload || true
  fi
  systemctl restart nginx.service pitunes-api.service 2>/dev/null || true
  systemctl try-restart lightdm.service 2>/dev/null || true
}

on_error() {
  local rc=$?
  log "Update failed with exit code ${rc} at line ${BASH_LINENO[0]}: ${BASH_COMMAND}"
  write_status "failed" "false" "Update failed. Restoring previous version."
  restore_backup
  cleanup
  exit "${rc}"
}

read_current_sha() {
  if git -C "${INSTALL_DIR}" rev-parse HEAD >/dev/null 2>&1; then
    git -C "${INSTALL_DIR}" rev-parse HEAD
    return
  fi
  if [ -f "${INSTALL_DIR}/config/.install-commit" ]; then
    tr -d '[:space:]' <"${INSTALL_DIR}/config/.install-commit"
  fi
}

read_version() {
  local base="$1"
  python3 - "${base}/config/version.json" <<'PY'
import json
import sys
from pathlib import Path

try:
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(str(data.get("version") or "").strip())
except Exception:
    print("")
PY
}

remote_release() {
  local release_json commit_json
  release_json="$(curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest")"
  TARGET_TAG="$(printf '%s' "${release_json}" | python3 -c '
import json, sys
data = json.load(sys.stdin)
if data.get("draft") or data.get("prerelease"):
    raise SystemExit(1)
print(str(data.get("tag_name") or "").strip())
')"
  test -n "${TARGET_TAG}"
  TARGET_VERSION="${TARGET_TAG#v}"
  commit_json="$(curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/commits/${TARGET_TAG}")"
  TARGET_SHA="$(printf '%s' "${commit_json}" | python3 -c 'import json, sys; print(str(json.load(sys.stdin).get("sha") or "").strip())')"
  test -n "${TARGET_SHA}"
}

version_is_newer() {
  python3 - "$1" "$2" <<'PY'
import re
import sys

def parts(value):
    match = re.fullmatch(r"v?(\d+(?:\.\d+){1,3})", value.strip())
    if not match:
        raise SystemExit(2)
    result = tuple(int(part) for part in match.group(1).split("."))
    return result + (0,) * (4 - len(result))

raise SystemExit(0 if parts(sys.argv[1]) > parts(sys.argv[2]) else 1)
PY
}

validate_source_tree() {
  local source_dir="$1"
  local source_version
  source_version="$(read_version "${source_dir}")"
  if [ "${source_version}" != "${TARGET_VERSION}" ]; then
    log "Release tag ${TARGET_TAG} does not match config/version.json (${source_version:-missing})."
    return 1
  fi
  test -f "${source_dir}/backend/server.py"
  test -f "${source_dir}/frontend/index.html"
  test -f "${source_dir}/systemd/pitunes-update.service"
  test -f "${source_dir}/scripts/pitunes-update.sh"
  while IFS= read -r script; do
    bash -n "${script}"
  done < <(find "${source_dir}/scripts" -maxdepth 1 -type f -name '*.sh' -print)
  PYTHONPYCACHEPREFIX="${WORK_DIR}/pycache" python3 -m compileall -q "${source_dir}/backend"
}

prune_backups() {
  local pattern
  for pattern in pitunes-app pitunes-system; do
    find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${pattern}-*.tar.gz" -print0 |
      xargs -0 -r ls -1t 2>/dev/null |
      tail -n "+$((BACKUP_RETENTION + 1))" |
      xargs -r rm -f
  done
}

mark_lock_held() {
  LOCK_HELD=1
  printf '%s\n' "$$" >"${LOCK_DIR}/pid"
}

acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    mark_lock_held
    return
  fi

  local existing_pid=""
  if [ -f "${LOCK_DIR}/pid" ]; then
    existing_pid="$(tr -dc '0-9' <"${LOCK_DIR}/pid" || true)"
  fi
  if [ -n "${existing_pid}" ]; then
    if kill -0 "${existing_pid}" 2>/dev/null; then
      write_status "failed" "false" "Another update is already running."
      exit 1
    fi
    log "Removing stale update lock for pid ${existing_pid}."
    rm -rf "${LOCK_DIR}"
    mkdir "${LOCK_DIR}"
    mark_lock_held
    return
  fi

  write_status "failed" "false" "Another update is already running."
  exit 1
}

health_check() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 http://127.0.0.1/api/health >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

install_sudoers_rule() {
  local sudoers="/etc/sudoers.d/pitunes-services"
  touch "${sudoers}"
  sed -i '\#pitunes-update.sh#d' "${sudoers}"
  if ! grep -Fxq "pitunes ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-update.service" "${sudoers}"; then
    printf '%s\n' "pitunes ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-update.service" >>"${sudoers}"
  fi
  if ! grep -Fxq "pitunes ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-system-update.service" "${sudoers}"; then
    printf '%s\n' "pitunes ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-system-update.service" >>"${sudoers}"
  fi
  chmod 0440 "${sudoers}"
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf "${sudoers}" >/dev/null
  fi
}

copy_app_tree() {
  local source_dir="$1"
  for name in backend frontend scripts config; do
    rm -rf "${INSTALL_DIR}/${name}"
    cp -a "${source_dir}/${name}" "${INSTALL_DIR}/"
  done
  rm -rf "${INSTALL_DIR}/docs"
  install -m 0755 "${source_dir}/install.sh" "${INSTALL_DIR}/install.sh"
  install -m 0755 "${source_dir}/configure-mpd.sh" "${INSTALL_DIR}/configure-mpd.sh"
  chmod +x "${INSTALL_DIR}/scripts/"*.sh 2>/dev/null || true
  chown -R root:root "${INSTALL_DIR}"
}

install_service_files() {
  local source_dir="$1"
  install -m 0644 "${source_dir}/backend/pitunes-api.env" /etc/pitunes/pitunes-api.env
  install -m 0644 "${source_dir}/nginx/pitunes.conf" /etc/nginx/sites-available/pitunes.conf
  ln -sf /etc/nginx/sites-available/pitunes.conf /etc/nginx/sites-enabled/pitunes.conf
  rm -f /etc/nginx/sites-enabled/default

  for unit in "${source_dir}"/systemd/pitunes-*.service "${source_dir}"/systemd/pitunes-*.timer; do
    [ -f "${unit}" ] || continue
    install -m 0644 "${unit}" "/etc/systemd/system/$(basename "${unit}")"
  done
  install -m 0644 "${source_dir}/config/pitunes-tmpfiles.conf" /usr/lib/tmpfiles.d/pitunes.conf
  systemd-tmpfiles --create /usr/lib/tmpfiles.d/pitunes.conf
  install_sudoers_rule
  systemctl daemon-reload
  nginx -t
}

apply_app_update() {
  local source_dir="$1"
  install -d -m 0755 "${INSTALL_DIR}" /etc/pitunes
  copy_app_tree "${source_dir}"
  install_service_files "${source_dir}"
  printf '%s\n' "${TARGET_SHA}" >"${INSTALL_DIR}/config/.install-commit"
}

initialize() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo $0" >&2
    exit 1
  fi
  mkdir -p "${STATE_DIR}" "${BACKUP_DIR}" "$(dirname "${LOG_FILE}")" "${WORK_ROOT}"
  touch "${LOG_FILE}"
  chmod 0644 "${LOG_FILE}" 2>/dev/null || true
  exec >>"${LOG_FILE}" 2>&1
  trap on_error ERR
  trap cleanup EXIT
}

main() {
  initialize
  acquire_lock

  CURRENT_SHA="$(read_current_sha || true)"
  CURRENT_VERSION="$(read_version "${INSTALL_DIR}")"
  if [ -z "${CURRENT_VERSION}" ]; then
    write_status "failed" "false" "The installed PiTunes version is missing."
    exit 1
  fi
  if ! remote_release; then
    write_status "failed" "false" "Could not find a stable PiTunes release."
    exit 1
  fi
  if [ -n "${CURRENT_SHA}" ] && [ "${CURRENT_SHA}" = "${TARGET_SHA}" ]; then
    write_status "succeeded" "true" "PiTunes is already up to date."
    exit 0
  fi
  if ! version_is_newer "${TARGET_VERSION}" "${CURRENT_VERSION}"; then
    write_status "succeeded" "true" "PiTunes is already up to date."
    exit 0
  fi

  log "Starting PiTunes ${CURRENT_VERSION} (${CURRENT_SHA:-unknown}) -> ${TARGET_VERSION} (${TARGET_SHA})."
  write_status "running" "" "Downloading update..."

  WORK_DIR="$(mktemp -d "${WORK_ROOT}/run.XXXXXX")"
  local archive="${WORK_DIR}/source.tar.gz"
  local extract_dir="${WORK_DIR}/extract"
  mkdir -p "${extract_dir}"

  curl -fL --retry 3 --connect-timeout 20 \
    "${REPO}/archive/${TARGET_SHA}.tar.gz" \
    -o "${archive}"
  tar -xzf "${archive}" -C "${extract_dir}"
  local source_dir
  source_dir="$(find "${extract_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  test -n "${source_dir}"
  find "${source_dir}" -type f -name '*.sh' -exec chmod +x {} +

  write_status "running" "" "Validating update..."
  validate_source_tree "${source_dir}"

  write_status "running" "" "Creating rollback backup..."
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  APP_BACKUP="${BACKUP_DIR}/pitunes-app-${stamp}-${CURRENT_SHA:0:7}.tar.gz"
  SYSTEM_BACKUP="${BACKUP_DIR}/pitunes-system-${stamp}-${CURRENT_SHA:0:7}.tar.gz"
  tar -C "$(dirname "${INSTALL_DIR}")" -czf "${APP_BACKUP}" "$(basename "${INSTALL_DIR}")"

  local list_file="${WORK_DIR}/system-backup-list.txt"
  {
    find /etc/systemd/system -maxdepth 1 \( -name 'pitunes-*.service' -o -name 'pitunes-*.timer' \)
    printf '%s\n' \
      /etc/nginx/sites-available/pitunes.conf \
      /etc/nginx/sites-enabled/pitunes.conf \
      /etc/sudoers.d/pitunes-services \
      /usr/lib/tmpfiles.d/pitunes.conf \
      /etc/NetworkManager/conf.d/pitunes-wait-online.conf \
      /etc/udev/rules.d/99-pitunes-music.rules \
      /etc/lightdm/lightdm.conf.d/50-pitunes-kiosk.conf \
      /home/pi/.config/openbox/autostart
  } | while read -r path; do
    if [ -e "${path}" ]; then
      printf '%s\n' "${path#/}"
    fi
  done >"${list_file}"
  tar -C / -czf "${SYSTEM_BACKUP}" -T "${list_file}" 2>/dev/null || true

  write_status "running" "" "Installing update..."
  apply_app_update "${source_dir}"
  systemctl restart nginx.service pitunes-api.service
  systemctl try-restart lightdm.service 2>/dev/null || true

  write_status "running" "" "Verifying update..."
  health_check

  log "Update installed successfully at ${TARGET_SHA}."
  CURRENT_SHA="${TARGET_SHA}"
  CURRENT_VERSION="${TARGET_VERSION}"
  prune_backups
  write_status "succeeded" "true" "Update installed successfully."
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
