#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT}/scripts/pitunes-system-boot-check.sh"

TMP="$(mktemp -d /tmp/pitunes-system-boot-check-test.XXXXXX)"
trap 'rm -rf "${TMP}"' EXIT

PERSISTENT="${TMP}/persistent"
CONTROL="${TMP}/control"
CAPABILITY_FILE="${TMP}/system-update.json"
STATUS_FILE="${TMP}/update-status.json"
LOG_FILE="${TMP}/boot-check.log"
REBOOT_MARKER="${TMP}/rebooted"
REBOOT_BIN="${TMP}/reboot"
mkdir -p "${PERSISTENT}" "${CONTROL}"

cat >"${CAPABILITY_FILE}" <<EOF
{
  "persistentMount": "${PERSISTENT}",
  "controlMount": "${CONTROL}",
  "autobootFile": "${CONTROL}/autoboot.txt"
}
EOF

cat >"${REBOOT_BIN}" <<EOF
#!/usr/bin/env bash
touch "${REBOOT_MARKER}"
EOF
chmod +x "${REBOOT_BIN}"

sync() {
  :
}

date() {
  printf '2026-06-14T00:00:00Z\n'
}

tryboot_active() {
  return 0
}

mountpoint() {
  return 1
}

if main; then
  echo "Trial boot must fail when persistent update storage is unavailable." >&2
  exit 1
fi
[ -f "${REBOOT_MARKER}" ]

rm -f "${REBOOT_MARKER}" "${STATUS_FILE}"
mountpoint() {
  return 0
}

if main; then
  echo "Trial boot must fail when pending update metadata is missing." >&2
  exit 1
fi
[ -f "${REBOOT_MARKER}" ]

rm -f "${REBOOT_MARKER}" "${STATUS_FILE}"
printf '{"schemaVersion":' >"${PERSISTENT}/pending-system-update.json"
if main; then
  echo "Trial boot must fail when pending update metadata is malformed." >&2
  exit 1
fi
[ -f "${REBOOT_MARKER}" ]

rm -f "${REBOOT_MARKER}" "${STATUS_FILE}"
cat >"${PERSISTENT}/pending-system-update.json" <<'EOF'
{
  "schemaVersion": 1,
  "version": "1.4.0",
  "previousVersion": "1.3.0",
  "previousSlot": "A",
  "targetSlot": "B",
  "targetBootPartition": 3,
  "previousBootPartition": 2
}
EOF
mountpoint() {
  [ "$2" = "${PERSISTENT}" ]
}

if main; then
  echo "Trial boot must fail when the stable boot-control partition is unavailable." >&2
  exit 1
fi
[ -f "${REBOOT_MARKER}" ]

echo "System boot-check rollback checks passed."
