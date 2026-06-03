#!/usr/bin/env bash
# Prepare a configured Pi (or chroot) for imaging — removes logs, cache, and unique IDs.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

echo "Stopping services before cleanup..."
for unit in echoflow-api nginx mpd; do
  systemctl stop "${unit}" 2>/dev/null || true
done

echo "Cleaning package and app caches..."
apt-get clean || true
rm -rf /var/cache/apt/archives/* 2>/dev/null || true
rm -rf /var/cache/echoflow/art/* 2>/dev/null || true
rm -f /var/lib/mpd/tag_cache 2>/dev/null || true
truncate -s 0 /var/log/mpd/mpd.log 2>/dev/null || true

echo "Rotating journals..."
if command -v journalctl >/dev/null 2>&1; then
  journalctl --rotate 2>/dev/null || true
  journalctl --vacuum-time=1s 2>/dev/null || true
fi

echo "Removing unique machine identifiers (regenerated on first boot)..."
rm -f /etc/machine-id /var/lib/dbus/machine-id

echo "Removing SSH host keys (regenerated on first boot)..."
rm -f /etc/ssh/ssh_host_* 2>/dev/null || true

echo "Removing wpa_supplicant saved networks (optional generic image)..."
if [ "${ECHOFLOW_KEEP_WIFI:-0}" != "1" ]; then
  sed -i '/^network=/,$d' /etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null || true
  printf 'country=GB\nctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\nupdate_config=1\n' \
    >/etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null || true
fi

rm -rf /tmp/echoflow-src 2>/dev/null || true
history -c 2>/dev/null || true

echo "Golden image cleanup complete."
