#!/usr/bin/env bash
set -euo pipefail

MOUNTPOINT="/mnt/music"
INTERNAL_MUSIC="/var/lib/echoflow/music"
SETTINGS="/etc/echoflow/settings.json"
NAS_CONFIG="/etc/echoflow/network-storage.json"
install -d -m 0775 -o mpd -g audio "${MOUNTPOINT}"
install -d -m 0775 -o mpd -g audio "${INTERNAL_MUSIC}"

notify_scan() {
  curl -fsS -X POST http://127.0.0.1:8080/api/library/rescan >/dev/null 2>&1 || true
}

music_found() {
  find "${MOUNTPOINT}" -type f \( -iname '*.mp3' -o -iname '*.flac' -o -iname '*.m4a' -o -iname '*.aac' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.wav' -o -iname '*.aiff' -o -iname '*.alac' \) -print -quit 2>/dev/null | grep -q .
}

SOURCE="$(python3 -c 'import json; print(json.load(open("'"${SETTINGS}"'")).get("storage_source", "local"))' 2>/dev/null || echo local)"

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
    CREDENTIALS="/etc/echoflow/network-storage.credentials"
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

if mountpoint -q "${MOUNTPOINT}" && music_found; then notify_scan; fi
exit 0
