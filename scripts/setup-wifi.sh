#!/usr/bin/env bash
set -euo pipefail

SSID="${1:-}"
PASSWORD="${2:-}"
COUNTRY="${3:-GB}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./setup-wifi.sh SSID PASSWORD [COUNTRY]"
  exit 1
fi

if [ -z "${SSID}" ] || [ -z "${PASSWORD}" ]; then
  echo "Usage: sudo ./setup-wifi.sh SSID PASSWORD [COUNTRY]"
  exit 1
fi

if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_wifi_country "${COUNTRY}" || true
fi

if command -v nmcli >/dev/null 2>&1; then
  nmcli radio wifi on
  nmcli dev wifi connect "${SSID}" password "${PASSWORD}"
  exit 0
fi

cat >/etc/wpa_supplicant/wpa_supplicant.conf <<EOF
country=${COUNTRY}
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="${SSID}"
    psk="${PASSWORD}"
}
EOF

systemctl restart wpa_supplicant 2>/dev/null || true
systemctl restart networking 2>/dev/null || true
