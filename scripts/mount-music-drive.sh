#!/usr/bin/env bash
set -euo pipefail

MOUNTPOINT="/mnt/music"
install -d -m 0775 -o mpd -g audio "${MOUNTPOINT}"

if mountpoint -q "${MOUNTPOINT}"; then
  exit 0
fi

DEVICE=""
for label in MUSIC Music music; do
  if DEVICE="$(blkid -L "${label}" 2>/dev/null)"; then
    [ -n "${DEVICE}" ] && break
  fi
done

if [ -z "${DEVICE}" ] && command -v lsblk >/dev/null 2>&1; then
  DEVICE="$(lsblk -pnro NAME,TRAN,TYPE | awk '$2 == "usb" && $3 == "part" { print $1; exit }')"
fi

if [ -z "${DEVICE}" ]; then
  exit 0
fi

mount -o rw,nofail,noatime,uid=mpd,gid=audio,umask=0022 "${DEVICE}" "${MOUNTPOINT}" 2>/dev/null \
  || mount -o rw,nofail,noatime "${DEVICE}" "${MOUNTPOINT}" 2>/dev/null \
  || true

exit 0
