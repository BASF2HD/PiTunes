#!/usr/bin/env bash
# Robust PiTunes OTA updater.
#
# This script is intentionally run as root through a narrow sudoers rule. It
# downloads a GitHub source archive, backs up the current appliance files,
# applies the downloaded installer, verifies the API, and restores the backup
# if the update does not complete cleanly.
set -Eeuo pipefail

PROJECT_NAME="pitunes"
INSTALL_DIR="${PITUNES_INSTALL_DIR:-/opt/pitunes}"
STATE_DIR="${PITUNES_STATE_DIR:-/var/lib/pitunes}"
BACKUP_DIR="${PITUNES_BACKUP_DIR:-/var/backups/pitunes}"
WORK_ROOT="${PITUNES_UPDATE_WORK_ROOT:-/var/tmp/pitunes-update}"
STATUS_FILE="${STATE_DIR}/update-status.json"
LOG_FILE="${PITUNES_UPDATE_LOG:-/var/log/pitunes-update.log}"
REPO="${PITUNES_UPDATE_REPO:-https://github.com/BASF2HD/PiTunes}"
BRANCH="${PITUNES_UPDATE_BRANCH:-main}"
LOCK_DIR="/run/pitunes-update.lock"

CURRENT_SHA=""
TARGET_SHA=""
APP_BACKUP=""
SYSTEM_BACKUP=""
WORK_DIR=""
LOCK_HELD=0

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

mkdir -p "${STATE_DIR}" "${BACKUP_DIR}" "$(dirname "${LOG_FILE}")" "${WORK_ROOT}"
touch "${LOG_FILE}"
chmod 0644 "${LOG_FILE}" 2>/dev/null || true

exec >>"${LOG_FILE}" 2>&1

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

write_status() {
  local state="$1"
  local ok="$2"
  local message="$3"
  python3 - "$STATUS_FILE" "$state" "$ok" "$message" "${CURRENT_SHA}" "${TARGET_SHA}" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
state, ok_raw, message, current, target = sys.argv[2:7]
payload = {
    "state": state,
    "applying": state == "running",
    "ok": None if ok_raw == "" else ok_raw == "true",
    "message": message,
    "current": current[:7] if current else "",
    "latest": target[:7] if target else "",
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
    tar -C / --overwrite --unlink-first -xzf "${SYSTEM_BACKUP}" || true
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

trap on_error ERR
trap cleanup EXIT

read_current_sha() {
  if git -C "${INSTALL_DIR}" rev-parse HEAD >/dev/null 2>&1; then
    git -C "${INSTALL_DIR}" rev-parse HEAD
    return
  fi
  if [ -f "${INSTALL_DIR}/config/.install-commit" ]; then
    tr -d '[:space:]' <"${INSTALL_DIR}/config/.install-commit"
  fi
}

remote_head_sha() {
  local api_json
  api_json="$(curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/BASF2HD/PiTunes/commits/${BRANCH}")"
  printf '%s' "${api_json}" | python3 -c 'import json, sys; print(str(json.load(sys.stdin).get("sha") or "").strip())'
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

main() {
  acquire_lock

  CURRENT_SHA="$(read_current_sha || true)"
  TARGET_SHA="$(remote_head_sha)"
  if [ -z "${TARGET_SHA}" ]; then
    write_status "failed" "false" "Could not reach the update server."
    exit 1
  fi
  if [ -n "${CURRENT_SHA}" ] && [ "${CURRENT_SHA}" = "${TARGET_SHA}" ]; then
    write_status "succeeded" "true" "PiTunes is already up to date."
    exit 0
  fi

  log "Starting PiTunes update ${CURRENT_SHA:-unknown} -> ${TARGET_SHA}."
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
  test -x "${source_dir}/install.sh" || chmod +x "${source_dir}/install.sh"
  test -f "${source_dir}/backend/server.py"
  test -f "${source_dir}/frontend/index.html"

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
  PITUNES_INSTALL_COMMIT="${TARGET_SHA}" "${source_dir}/install.sh" auto
  if systemctl is-enabled --quiet lightdm.service 2>/dev/null && [ -x "${INSTALL_DIR}/scripts/setup-kiosk.sh" ]; then
    "${INSTALL_DIR}/scripts/setup-kiosk.sh"
  fi

  printf '%s\n' "${TARGET_SHA}" >"${INSTALL_DIR}/config/.install-commit"
  chmod +x "${INSTALL_DIR}/scripts/"*.sh 2>/dev/null || true
  systemctl daemon-reload
  systemctl restart nginx.service pitunes-api.service
  systemctl try-restart lightdm.service 2>/dev/null || true

  write_status "running" "" "Verifying update..."
  health_check

  log "Update installed successfully at ${TARGET_SHA}."
  write_status "succeeded" "true" "Update installed successfully."
}

main "$@"
