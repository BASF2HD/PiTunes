#!/usr/bin/env bash
set -euo pipefail

DEVICE="${1:-}"
OUTPUT="${2:-echoflow.img}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root on the Linux machine that has the prepared SD card attached."
  echo "Usage: sudo ./scripts/create-image.sh /dev/sdX echoflow.img"
  exit 1
fi

if [ -z "${DEVICE}" ] || [ ! -b "${DEVICE}" ]; then
  echo "Usage: sudo ./scripts/create-image.sh /dev/sdX echoflow.img"
  lsblk
  exit 1
fi

echo "Source device: ${DEVICE}"
echo "Output image:  ${OUTPUT}"
echo "Make sure ${DEVICE} is the prepared Raspberry Pi SD card."
read -r -p "Type IMAGE to continue: " CONFIRM
if [ "${CONFIRM}" != "IMAGE" ]; then
  echo "Cancelled."
  exit 1
fi

sync
dd if="${DEVICE}" of="${OUTPUT}" bs=4M status=progress conv=fsync
sync

if command -v xz >/dev/null 2>&1; then
  xz -T0 -9 -k "${OUTPUT}"
  echo "Created ${OUTPUT} and ${OUTPUT}.xz"
else
  echo "Created ${OUTPUT}"
fi
