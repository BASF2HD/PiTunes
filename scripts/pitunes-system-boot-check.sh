#!/usr/bin/env bash
# Commit or roll back a pending Raspberry Pi tryboot A/B system update.
set -Eeuo pipefail

CAPABILITY_FILE="${PITUNES_AB_CONFIG:-/etc/pitunes/system-update.json}"
STATUS_FILE="${PITUNES_UPDATE_STATUS:-/var/lib/pitunes/update-status.json}"
LOG_FILE="${PITUNES_SYSTEM_UPDATE_LOG:-/var/log/pitunes-system-update.log}"
REBOOT_BIN="${PITUNES_REBOOT_BIN:-/sbin/reboot}"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "${LOG_FILE}"
}

json_value() {
  local file="$1"
  local path="$2"
  python3 - "${file}" "${path}" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

write_status() {
  local state="$1"
  local ok="$2"
  local message="$3"
  local current_version="$4"
  local latest_version="$5"
  python3 - "${STATUS_FILE}" "${state}" "${ok}" "${message}" "${current_version}" "${latest_version}" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({
    "state": sys.argv[2],
    "applying": False,
    "ok": sys.argv[3] == "true",
    "message": sys.argv[4],
    "currentVersion": sys.argv[5],
    "latestVersion": sys.argv[6],
    "updateType": "system",
    "channel": "stable",
    "updatedAt": int(time.time()),
}), encoding="utf-8")
PY
}

write_autoboot() {
  local path="$1"
  local default_partition="$2"
  local fallback_partition="$3"
  local temporary="${path}.new"
  cat >"${temporary}" <<EOF
[all]
tryboot_a_b=1
boot_partition=${default_partition}
[tryboot]
boot_partition=${fallback_partition}
EOF
  sync "${temporary}"
  mv -f "${temporary}" "${path}"
  sync "${path}"
}

health_check() {
  local attempt
  systemctl is-active --quiet nginx.service
  systemctl is-active --quiet pitunes-api.service
  systemctl is-active --quiet mpd.service
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 http://127.0.0.1/api/health >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

tryboot_active() {
  python3 - <<'PY'
from pathlib import Path

path = Path("/proc/device-tree/chosen/bootloader/tryboot")
try:
    raw = path.read_bytes()
except OSError:
    raise SystemExit(1)
if raw.rstrip(b"\0") == b"1" or int.from_bytes(raw, "big") == 1:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

device_tree_int() {
  python3 - "$1" <<'PY'
import sys
from pathlib import Path

try:
    raw = Path(sys.argv[1]).read_bytes()
except OSError:
    raise SystemExit(1)
if raw.rstrip(b"\0").isdigit():
    print(raw.rstrip(b"\0").decode("ascii"))
else:
    print(int.from_bytes(raw, "big"))
PY
}

pending_valid() {
  python3 - "$1" <<'PY'
import json
import re
import sys

try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    raise SystemExit(1)

version = re.compile(r"^\d+\.\d+\.\d+$")
valid = (
    isinstance(value, dict)
    and value.get("schemaVersion") == 1
    and version.fullmatch(str(value.get("version") or ""))
    and version.fullmatch(str(value.get("previousVersion") or ""))
    and value.get("previousSlot") in {"A", "B"}
    and value.get("targetSlot") in {"A", "B"}
    and value.get("previousSlot") != value.get("targetSlot")
    and isinstance(value.get("previousBootPartition"), int)
    and isinstance(value.get("targetBootPartition"), int)
    and value.get("previousBootPartition") != value.get("targetBootPartition")
)
raise SystemExit(0 if valid else 1)
PY
}

boot_matches_pending() {
  local pending="$1"
  local target_slot target_partition expected_root current_root current_partition
  target_slot="$(json_value "${pending}" targetSlot)"
  target_partition="$(json_value "${pending}" targetBootPartition)"
  expected_root="$(readlink -f "$(json_value "${CAPABILITY_FILE}" "slots.${target_slot}.rootDevice")")"
  current_root="$(readlink -f "$(findmnt -n -o SOURCE /)")"
  current_partition="$(device_tree_int /proc/device-tree/chosen/bootloader/partition)"
  [ "${current_root}" = "${expected_root}" ] && [ "${current_partition}" = "${target_partition}" ]
}

main() {
  [ -f "${CAPABILITY_FILE}" ] || return 0
  local persistent_mount control_mount pending autoboot target_partition previous_partition version previous_version
  persistent_mount="$(json_value "${CAPABILITY_FILE}" persistentMount)"
  control_mount="$(json_value "${CAPABILITY_FILE}" controlMount)"
  pending="${persistent_mount}/pending-system-update.json"
  autoboot="$(json_value "${CAPABILITY_FILE}" autobootFile)"
  if ! mountpoint -q "${persistent_mount}"; then
    if tryboot_active; then
      log "Persistent update storage is unavailable during trial boot; rebooting to the previous default slot."
      write_status "failed" "false" "System update could not access persistent validation state. Rolling back automatically." "" ""
      sync
      "${REBOOT_BIN}"
    fi
    return 1
  fi
  mkdir -p "${persistent_mount}/logs"
  LOG_FILE="${persistent_mount}/logs/pitunes-system-update.log"
  if [ ! -f "${pending}" ]; then
    if tryboot_active; then
      log "Pending update metadata is missing during trial boot; rebooting to the previous default slot."
      write_status "failed" "false" "System update validation state is missing. Rolling back automatically." "" ""
      sync
      "${REBOOT_BIN}"
      return 1
    fi
    return 0
  fi

  if ! pending_valid "${pending}"; then
    log "Pending update metadata is invalid; refusing to commit the trial slot."
    write_status "failed" "false" "System update validation state is invalid. Rolling back automatically." "" ""
    if tryboot_active; then
      sync
      "${REBOOT_BIN}"
      return 1
    fi
    rm -f "${pending}"
    return 0
  fi

  version="$(json_value "${pending}" version)"
  previous_version="$(json_value "${pending}" previousVersion)"
  target_partition="$(json_value "${pending}" targetBootPartition)"
  previous_partition="$(json_value "${pending}" previousBootPartition)"
  if ! tryboot_active; then
    log "Pending system update did not boot in tryboot mode; retaining the previous slot."
    write_status "failed" "false" "System update rolled back to the previous working version." "${previous_version}" "${version}"
    rm -f "${pending}"
    return 0
  fi

  if ! mountpoint -q "${control_mount}"; then
    log "Stable boot-control partition is unavailable during trial boot; rebooting to previous partition ${previous_partition}."
    write_status "failed" "false" "System update could not validate boot control. Rolling back automatically." "${previous_version}" "${version}"
    sync
    "${REBOOT_BIN}"
    return 1
  fi

  if boot_matches_pending "${pending}" && health_check; then
    log "System update ${version} passed health checks; committing boot partition ${target_partition}."
    write_autoboot "${autoboot}" "${target_partition}" "${previous_partition}"
    write_status "succeeded" "true" "System update installed successfully." "${version}" "${version}"
    rm -f "${pending}"
    return 0
  fi

  log "System update ${version} failed health checks; rebooting to previous partition ${previous_partition}."
  write_status "failed" "false" "System update failed validation. Rolling back automatically." "${previous_version}" "${version}"
  sync
  "${REBOOT_BIN}"
  return 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
