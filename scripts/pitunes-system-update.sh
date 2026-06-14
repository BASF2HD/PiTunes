#!/usr/bin/env bash
# Signed A/B system updater for PiTunes images built with Raspberry Pi tryboot.
#
# Legacy two-partition images do not contain the capability file and cannot run
# this updater. The active boot/root slot is never written.
set -Eeuo pipefail

CAPABILITY_FILE="${PITUNES_AB_CONFIG:-/etc/pitunes/system-update.json}"
STATUS_FILE="${PITUNES_UPDATE_STATUS:-/var/lib/pitunes/update-status.json}"
LOG_FILE="${PITUNES_SYSTEM_UPDATE_LOG:-/var/log/pitunes-system-update.log}"
WORK_ROOT="${PITUNES_SYSTEM_UPDATE_WORK_ROOT:-/var/tmp/pitunes-system-update}"
GITHUB_REPOSITORY="${PITUNES_UPDATE_REPOSITORY:-BASF2HD/PiTunes}"
LOCK_DIR="/run/pitunes-update.lock"

WORK_DIR=""
PERSISTENT_MOUNT=""
CONTROL_MOUNT=""
PENDING_FILE=""
PUBLIC_KEY=""
AUTOBOOT_FILE=""
ACTIVE_SLOT=""
INACTIVE_SLOT=""
ACTIVE_BOOT=""
ACTIVE_ROOT=""
INACTIVE_BOOT=""
INACTIVE_ROOT=""
ACTIVE_BOOT_NUMBER=""
INACTIVE_BOOT_NUMBER=""
TARGET_VERSION=""
TARGET_TAG=""
CURRENT_VERSION=""
LOCK_HELD=0

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

json_value() {
  local path="$1"
  python3 - "${CAPABILITY_FILE}" "${path}" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value[part]
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PY
}

write_status() {
  local state="$1"
  local ok="$2"
  local message="$3"
  python3 - "${STATUS_FILE}" "${state}" "${ok}" "${message}" "${TARGET_VERSION}" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
state, ok_raw, message, version = sys.argv[2:6]
payload = {
    "state": state,
    "applying": state == "running",
    "ok": None if ok_raw == "" else ok_raw == "true",
    "message": message,
    "latestVersion": version,
    "updateType": "system",
    "channel": "stable",
    "updatedAt": int(time.time()),
}
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload), encoding="utf-8")
PY
}

cleanup() {
  if mountpoint -q "${WORK_DIR:-/nonexistent}/inactive-root" 2>/dev/null; then
    umount "${WORK_DIR}/inactive-root" || true
  fi
  if mountpoint -q "${WORK_DIR:-/nonexistent}/inactive-boot" 2>/dev/null; then
    umount "${WORK_DIR}/inactive-boot" || true
  fi
  [ -n "${WORK_DIR}" ] && rm -rf "${WORK_DIR}" 2>/dev/null || true
  if [ "${LOCK_HELD}" = "1" ]; then
    rm -rf "${LOCK_DIR}" 2>/dev/null || true
  fi
}

on_error() {
  local rc=$?
  log "System update failed with exit code ${rc} at line ${BASH_LINENO[0]}: ${BASH_COMMAND}"
  write_status "failed" "false" "System update failed before reboot. The current system was not changed."
  cleanup
  exit "${rc}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    log "Required command is missing: $1"
    return 1
  }
}

validate_capability() {
  [ -f "${CAPABILITY_FILE}" ]
  [ "$(json_value schemaVersion)" = "1" ]
  [ "$(json_value product)" = "PiTunes" ]
  [ "$(json_value strategy)" = "rpi-tryboot-ab" ]

  PERSISTENT_MOUNT="$(json_value persistentMount)"
  CONTROL_MOUNT="$(json_value controlMount)"
  PUBLIC_KEY="$(json_value publicKey)"
  AUTOBOOT_FILE="$(json_value autobootFile)"
  [ -d "${PERSISTENT_MOUNT}" ]
  mountpoint -q "${PERSISTENT_MOUNT}"
  mountpoint -q "${CONTROL_MOUNT}"
  [ -s "${PUBLIC_KEY}" ]
  [ -f "${AUTOBOOT_FILE}" ]
  PENDING_FILE="${PERSISTENT_MOUNT}/pending-system-update.json"
  mkdir -p "${PERSISTENT_MOUNT}/logs"
  LOG_FILE="${PERSISTENT_MOUNT}/logs/pitunes-system-update.log"
  touch "${LOG_FILE}"
  exec >>"${LOG_FILE}" 2>&1
}

device_realpath() {
  readlink -f "$1"
}

active_root_device() {
  findmnt -n -o SOURCE /
}

load_slots() {
  local current_root
  local slot
  local root
  current_root="$(device_realpath "$(active_root_device)")"

  for slot in A B; do
    root="$(device_realpath "$(json_value "slots.${slot}.rootDevice")")"
    if [ "${root}" = "${current_root}" ]; then
      ACTIVE_SLOT="${slot}"
      break
    fi
  done
  [ -n "${ACTIVE_SLOT}" ]

  if [ "${ACTIVE_SLOT}" = "A" ]; then
    INACTIVE_SLOT="B"
  else
    INACTIVE_SLOT="A"
  fi

  ACTIVE_BOOT="$(device_realpath "$(json_value "slots.${ACTIVE_SLOT}.bootDevice")")"
  ACTIVE_ROOT="$(device_realpath "$(json_value "slots.${ACTIVE_SLOT}.rootDevice")")"
  INACTIVE_BOOT="$(device_realpath "$(json_value "slots.${INACTIVE_SLOT}.bootDevice")")"
  INACTIVE_ROOT="$(device_realpath "$(json_value "slots.${INACTIVE_SLOT}.rootDevice")")"
  ACTIVE_BOOT_NUMBER="$(json_value "slots.${ACTIVE_SLOT}.bootPartition")"
  INACTIVE_BOOT_NUMBER="$(json_value "slots.${INACTIVE_SLOT}.bootPartition")"

  [ -b "${ACTIVE_BOOT}" ] && [ -b "${ACTIVE_ROOT}" ]
  [ -b "${INACTIVE_BOOT}" ] && [ -b "${INACTIVE_ROOT}" ]
  [ "${ACTIVE_BOOT}" != "${INACTIVE_BOOT}" ]
  [ "${ACTIVE_ROOT}" != "${INACTIVE_ROOT}" ]
  ! findmnt -rn -S "${INACTIVE_BOOT}" >/dev/null
  ! findmnt -rn -S "${INACTIVE_ROOT}" >/dev/null
}

github_latest_release() {
  curl -fsSL -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest"
}

release_asset_url() {
  local release_json="$1"
  local asset="$2"
  printf '%s' "${release_json}" | python3 -c '
import json, sys
release = json.load(sys.stdin)
name = sys.argv[1]
for asset in release.get("assets", []):
    if asset.get("name") == name:
        print(asset.get("browser_download_url", ""))
        raise SystemExit(0)
raise SystemExit(1)
' "${asset}"
}

manifest_value() {
  local manifest="$1"
  local path="$2"
  python3 - "${manifest}" "${path}" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

verify_manifest() {
  local manifest="$1"
  local signature="$2"
  openssl dgst -sha256 -verify "${PUBLIC_KEY}" -signature "${signature}" "${manifest}" >/dev/null || return 1
  [ "$(manifest_value "${manifest}" schemaVersion)" = "1" ] || return 1
  [ "$(manifest_value "${manifest}" product)" = "PiTunes" ] || return 1
  [ "$(manifest_value "${manifest}" strategy)" = "rpi-tryboot-ab" ] || return 1
  [ "$(manifest_value "${manifest}" updateType)" = "system" ] || return 1
  [ "$(manifest_value "${manifest}" architecture)" = "$(uname -m)" ] || return 1
  TARGET_VERSION="$(manifest_value "${manifest}" version)"
  [[ "${TARGET_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  [ "${TARGET_TAG#v}" = "${TARGET_VERSION}" ] || return 1
}

verify_sha256() {
  local path="$1"
  local expected="$2"
  printf '%s  %s\n' "${expected}" "${path}" | sha256sum -c -
}

write_partition_image() {
  local archive="$1"
  local device="$2"
  xz -dc "${archive}" | dd of="${device}" bs=4M conv=fsync status=progress
}

validate_asset() {
  local manifest="$1"
  local name="$2"
  local archive="$3"
  local device="$4"
  local asset sha expected_size actual_size partition_size
  asset="$(manifest_value "${manifest}" "${name}.asset")"
  sha="$(manifest_value "${manifest}" "${name}.sha256")"
  expected_size="$(manifest_value "${manifest}" "${name}.bytes")"
  [[ "${asset}" =~ ^pitunes-system-[A-Za-z0-9._-]+\.img\.xz$ ]] || return 1
  [[ "${sha}" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "${expected_size}" =~ ^[0-9]+$ ]] || return 1
  actual_size="$(wc -c <"${archive}" | tr -d ' ')"
  [ "${actual_size}" = "${expected_size}" ] || return 1
  actual_size="$(xz --robot --list "${archive}" | awk -F '\t' '$1 == "totals" {print $5}')"
  partition_size="$(blockdev --getsize64 "${device}")"
  [ -n "${actual_size}" ] && [ "${actual_size}" -le "${partition_size}" ] || return 1
}

version_is_newer() {
  python3 - "$1" "$2" <<'PY'
import re
import sys

def parts(value):
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value.strip())
    if not match:
        raise SystemExit(2)
    return tuple(int(part) for part in match.groups())

raise SystemExit(0 if parts(sys.argv[1]) > parts(sys.argv[2]) else 1)
PY
}

partition_uuid() {
  blkid -s PARTUUID -o value "$1"
}

write_autoboot() {
  local default_partition="$1"
  local try_partition="$2"
  local temporary="${AUTOBOOT_FILE}.new"
  cat >"${temporary}" <<EOF
[all]
tryboot_a_b=1
boot_partition=${default_partition}
[tryboot]
boot_partition=${try_partition}
EOF
  sync "${temporary}"
  mv -f "${temporary}" "${AUTOBOOT_FILE}"
  sync "${AUTOBOOT_FILE}"
}

prepare_inactive_slot() {
  local active_boot_uuid inactive_boot_uuid active_root_uuid inactive_root_uuid
  active_boot_uuid="$(partition_uuid "${ACTIVE_BOOT}")"
  inactive_boot_uuid="$(partition_uuid "${INACTIVE_BOOT}")"
  active_root_uuid="$(partition_uuid "${ACTIVE_ROOT}")"
  inactive_root_uuid="$(partition_uuid "${INACTIVE_ROOT}")"
  [ -n "${active_boot_uuid}" ] && [ -n "${inactive_boot_uuid}" ]
  [ -n "${active_root_uuid}" ] && [ -n "${inactive_root_uuid}" ]

  e2fsck -pf "${INACTIVE_ROOT}" || [ "$?" -le 1 ]
  resize2fs "${INACTIVE_ROOT}"
  tune2fs -U random "${INACTIVE_ROOT}"

  mkdir -p "${WORK_DIR}/inactive-root" "${WORK_DIR}/inactive-boot"
  mount "${INACTIVE_ROOT}" "${WORK_DIR}/inactive-root"
  mount "${INACTIVE_BOOT}" "${WORK_DIR}/inactive-boot"

  sed \
    -e "s/PARTUUID=${active_boot_uuid}/PARTUUID=${inactive_boot_uuid}/g" \
    -e "s/PARTUUID=${active_root_uuid}/PARTUUID=${inactive_root_uuid}/g" \
    /etc/fstab >"${WORK_DIR}/inactive-root/etc/fstab"

  local cmdline="${WORK_DIR}/inactive-boot/cmdline.txt"
  [ -f "${cmdline}" ]
  sed -i -E "s#root=PARTUUID=[^ ]+#root=PARTUUID=${inactive_root_uuid}#" "${cmdline}"
  grep -q "root=PARTUUID=${inactive_root_uuid}" "${cmdline}"

  install -d -m 0755 "${WORK_DIR}/inactive-root$(dirname "${CAPABILITY_FILE}")"
  install -d -m 0755 "${WORK_DIR}/inactive-root$(dirname "${PUBLIC_KEY}")"
  install -m 0644 "${CAPABILITY_FILE}" "${WORK_DIR}/inactive-root${CAPABILITY_FILE}"
  install -m 0644 "${PUBLIC_KEY}" "${WORK_DIR}/inactive-root${PUBLIC_KEY}"
  if [ -f "${WORK_DIR}/inactive-root/etc/pitunes-image.json" ]; then
    python3 - "${WORK_DIR}/inactive-root/etc/pitunes-image.json" "${INACTIVE_SLOT}" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
data["slot"] = sys.argv[2]
path.write_text(json.dumps(data) + "\n", encoding="utf-8")
PY
  fi
  sync
  umount "${WORK_DIR}/inactive-boot"
  umount "${WORK_DIR}/inactive-root"
}

write_pending() {
  local temporary="${PENDING_FILE}.new"
  python3 - "${temporary}" "${TARGET_VERSION}" "${TARGET_TAG}" "${ACTIVE_SLOT}" "${INACTIVE_SLOT}" \
    "${ACTIVE_BOOT_NUMBER}" "${INACTIVE_BOOT_NUMBER}" "${CURRENT_VERSION}" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
payload = {
    "schemaVersion": 1,
    "version": sys.argv[2],
    "tag": sys.argv[3],
    "previousSlot": sys.argv[4],
    "targetSlot": sys.argv[5],
    "previousBootPartition": int(sys.argv[6]),
    "targetBootPartition": int(sys.argv[7]),
    "previousVersion": sys.argv[8],
    "createdAt": int(time.time()),
}
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload), encoding="utf-8")
PY
  sync "${temporary}"
  mv -f "${temporary}" "${PENDING_FILE}"
  sync "${PENDING_FILE}"
}

acquire_lock() {
  mkdir "${LOCK_DIR}"
  LOCK_HELD=1
  printf '%s\n' "$$" >"${LOCK_DIR}/pid"
}

initialize() {
  [ "$(id -u)" -eq 0 ]
  for command in blkid blockdev curl dd e2fsck findmnt mount mountpoint openssl python3 resize2fs sha256sum tune2fs umount xz; do
    require_command "${command}"
  done
  mkdir -p "$(dirname "${LOG_FILE}")" "${WORK_ROOT}"
  touch "${LOG_FILE}"
  exec >>"${LOG_FILE}" 2>&1
  trap on_error ERR
  trap cleanup EXIT
}

main() {
  initialize
  acquire_lock
  validate_capability
  load_slots

  write_status "running" "" "Downloading signed system update..."
  WORK_DIR="$(mktemp -d "${WORK_ROOT}/run.XXXXXX")"
  local release_json="${WORK_DIR}/release.json"
  github_latest_release >"${release_json}"
  TARGET_TAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag_name"])' "${release_json}")"

  local manifest_asset="pitunes-system-manifest.json"
  local signature_asset="pitunes-system-manifest.sig"
  curl -fL --retry 3 "$(release_asset_url "$(cat "${release_json}")" "${manifest_asset}")" -o "${WORK_DIR}/${manifest_asset}"
  curl -fL --retry 3 "$(release_asset_url "$(cat "${release_json}")" "${signature_asset}")" -o "${WORK_DIR}/${signature_asset}"

  write_status "running" "" "Verifying system update signature..."
  verify_manifest "${WORK_DIR}/${manifest_asset}" "${WORK_DIR}/${signature_asset}"
  CURRENT_VERSION="$(manifest_value /opt/pitunes/config/version.json version)"
  version_is_newer "${TARGET_VERSION}" "${CURRENT_VERSION}"

  local boot_asset root_asset boot_sha root_sha
  boot_asset="$(manifest_value "${WORK_DIR}/${manifest_asset}" boot.asset)"
  root_asset="$(manifest_value "${WORK_DIR}/${manifest_asset}" root.asset)"
  boot_sha="$(manifest_value "${WORK_DIR}/${manifest_asset}" boot.sha256)"
  root_sha="$(manifest_value "${WORK_DIR}/${manifest_asset}" root.sha256)"
  curl -fL --retry 3 "$(release_asset_url "$(cat "${release_json}")" "${boot_asset}")" -o "${WORK_DIR}/${boot_asset}"
  curl -fL --retry 3 "$(release_asset_url "$(cat "${release_json}")" "${root_asset}")" -o "${WORK_DIR}/${root_asset}"
  verify_sha256 "${WORK_DIR}/${boot_asset}" "${boot_sha}"
  verify_sha256 "${WORK_DIR}/${root_asset}" "${root_sha}"
  validate_asset "${WORK_DIR}/${manifest_asset}" boot "${WORK_DIR}/${boot_asset}" "${INACTIVE_BOOT}"
  validate_asset "${WORK_DIR}/${manifest_asset}" root "${WORK_DIR}/${root_asset}" "${INACTIVE_ROOT}"

  write_status "running" "" "Writing inactive system slot. Do not power off."
  write_partition_image "${WORK_DIR}/${root_asset}" "${INACTIVE_ROOT}"
  write_partition_image "${WORK_DIR}/${boot_asset}" "${INACTIVE_BOOT}"
  prepare_inactive_slot
  write_pending
  write_autoboot "${ACTIVE_BOOT_NUMBER}" "${INACTIVE_BOOT_NUMBER}"

  write_status "running" "" "System update staged. Rebooting once for validation."
  sync
  cleanup
  trap - EXIT
  /sbin/reboot "0 tryboot"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
