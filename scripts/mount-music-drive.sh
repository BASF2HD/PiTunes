#!/usr/bin/env bash
set -euo pipefail

MOUNTPOINT="/mnt/music"
INTERNAL_MUSIC="/var/lib/pitunes/music"
SETTINGS="/etc/pitunes/settings.json"
NAS_CONFIG="/etc/pitunes/network-storage.json"
MPD_UID="$(id -u mpd 2>/dev/null || echo 0)"
AUDIO_GID="$(getent group audio 2>/dev/null | cut -d: -f3 || echo 0)"
if ! mountpoint -q "${MOUNTPOINT}"; then
  install -d -m 0775 -o mpd -g audio "${MOUNTPOINT}"
fi
install -d -m 0775 -o mpd -g audio "${INTERNAL_MUSIC}"

notify_scan() {
  curl -fsS -X POST http://127.0.0.1:8080/api/library/rescan >/dev/null 2>&1 || true
}

music_found() {
  find "${MOUNTPOINT}" -type f \( -iname '*.mp3' -o -iname '*.flac' -o -iname '*.m4a' -o -iname '*.aac' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.wav' -o -iname '*.aiff' -o -iname '*.alac' \) -print -quit 2>/dev/null | grep -q .
}

mount_device() {
  local device="$1"
  mount -o rw,nofail,noatime,uid="${MPD_UID}",gid="${AUDIO_GID}",umask=0022 "${device}" "${MOUNTPOINT}" 2>/dev/null \
    || mount -o rw,nofail,noatime "${device}" "${MOUNTPOINT}" 2>/dev/null
}

usb_candidates() {
  if [ -n "${LOCAL_DEVICE:-}" ] && [ -b "${LOCAL_DEVICE}" ]; then
    printf '%s\n' "${LOCAL_DEVICE}"
  fi
  for label in MUSIC Music music; do
    blkid -L "${label}" 2>/dev/null || true
  done
  if command -v lsblk >/dev/null 2>&1; then
    while IFS= read -r usb_disk; do
      [ -n "${usb_disk}" ] || continue
      partitions="$(lsblk -pnro NAME,TYPE "${usb_disk}" 2>/dev/null | awk '$2 == "part" { print $1 }')"
      if [ -n "${partitions}" ]; then
        printf '%s\n' "${partitions}"
      elif [ -n "$(lsblk -no FSTYPE "${usb_disk}" 2>/dev/null | head -n 1)" ]; then
        printf '%s\n' "${usb_disk}"
      fi
    done < <(lsblk -pnro NAME,TYPE,TRAN | awk '$2 == "disk" && $3 == "usb" { print $1 }')
  fi
}

SETTINGS_EXPORT="$(python3 -c '
import json, shlex
try:
    c=json.load(open("'"${SETTINGS}"'"))
except Exception:
    c={}
print("SOURCE="+shlex.quote(str(c.get("storage_source", "local"))))
print("LOCAL_DEVICE="+shlex.quote(str(c.get("local_device", ""))))
' 2>/dev/null || true)"
eval "${SETTINGS_EXPORT:-SOURCE=local}"

if mountpoint -q "${MOUNTPOINT}"; then
  umount "${MOUNTPOINT}" 2>/dev/null || true
fi

if [ "${SOURCE}" = "network" ]; then
  [ -f "${NAS_CONFIG}" ] || exit 0
  eval "$(python3 -c '
import json, shlex
c=json.load(open("'"${NAS_CONFIG}"'"))
for key in ("protocol","server","share","username","password"):
    print(key.upper()+"="+shlex.quote(str(c.get(key,""))))
' 2>/dev/null)"
  if [ "${PROTOCOL:-smb}" = "nfs" ]; then
    mount -t nfs -o ro,nofail,noatime "${SERVER}:/${SHARE#/}" "${MOUNTPOINT}" 2>/dev/null || true
  else
    CREDENTIALS="/etc/pitunes/network-storage.credentials"
    {
      printf 'username=%s\n' "${USERNAME:-guest}"
      printf 'password=%s\n' "${PASSWORD:-}"
    } >"${CREDENTIALS}"
    chmod 600 "${CREDENTIALS}"
    mount -t cifs -o "ro,nofail,noatime,credentials=${CREDENTIALS},uid=mpd,gid=audio,iocharset=utf8" "//${SERVER}/${SHARE}" "${MOUNTPOINT}" 2>/dev/null || true
  fi
  if mountpoint -q "${MOUNTPOINT}" && music_found; then notify_scan; fi
  exit 0
fi

if [ "${SOURCE}" = "internal" ]; then
  mount --bind "${INTERNAL_MUSIC}" "${MOUNTPOINT}" 2>/dev/null || true
  if mountpoint -q "${MOUNTPOINT}" && music_found; then notify_scan; fi
  exit 0
fi

while IFS= read -r DEVICE; do
  [ -n "${DEVICE}" ] || continue
  if mountpoint -q "${MOUNTPOINT}"; then
    umount "${MOUNTPOINT}" 2>/dev/null || true
  fi
  echo "Trying local music device ${DEVICE}..."
  if mount_device "${DEVICE}"; then
    if music_found; then
      echo "Using local music device ${DEVICE}."
      notify_scan
      exit 0
    fi
    echo "No audio files found on ${DEVICE}; trying next USB partition."
    umount "${MOUNTPOINT}" 2>/dev/null || true
  fi
done < <(usb_candidates | awk 'NF && !seen[$0]++')

echo "No USB partition with supported audio files found."
exit 0
