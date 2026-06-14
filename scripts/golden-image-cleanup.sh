#!/usr/bin/env bash
# Prepare a configured Pi (or chroot) for imaging — removes logs, cache, and unique IDs.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

echo "Stopping services before cleanup..."
for unit in pitunes-api nginx mpd; do
  systemctl stop "${unit}" 2>/dev/null || true
done

echo "Cleaning package and app caches..."
apt-get clean || true
rm -rf /var/cache/apt/archives/* 2>/dev/null || true
rm -rf /var/cache/pitunes/art/* 2>/dev/null || true
rm -f /var/lib/mpd/tag_cache 2>/dev/null || true
truncate -s 0 /var/log/mpd/mpd.log 2>/dev/null || true

echo "Rotating journals..."
if command -v journalctl >/dev/null 2>&1; then
  journalctl --rotate 2>/dev/null || true
  journalctl --vacuum-time=1s 2>/dev/null || true
fi

echo "Removing unique machine identifiers (regenerated on first boot)..."
rm -f /etc/machine-id /var/lib/dbus/machine-id
rm -f /var/lib/pitunes/firstboot.done

echo "Removing SSH host keys (regenerated on first boot)..."
rm -f /etc/ssh/ssh_host_* 2>/dev/null || true

echo "Removing NetworkManager saved networks (optional generic image)..."
if [ "${PITUNES_KEEP_WIFI:-0}" != "1" ]; then
  rm -f /etc/NetworkManager/system-connections/* 2>/dev/null || true
fi

rm -rf /tmp/pitunes-src 2>/dev/null || true
history -c 2>/dev/null || true

echo "Golden image cleanup complete."
