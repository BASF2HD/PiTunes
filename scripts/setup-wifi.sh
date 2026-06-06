#!/usr/bin/env bash
set -euo pipefail

SSID="${1:-}"
PASSWORD="${2:-}"
COUNTRY="${3:-GB}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./setup-wifi.sh SSID PASSWORD [COUNTRY]"
  exit 1
fi

if [ -z "${SSID}" ]; then
  echo "Usage: sudo ./setup-wifi.sh SSID [PASSWORD] [COUNTRY]"
  exit 1
fi

HOTSPOT_SCRIPT="${ECHOFLOW_INSTALL_DIR:-/opt/echoflow}/scripts/wifi-hotspot.sh"
if [ -f "${HOTSPOT_SCRIPT}" ]; then
  "${HOTSPOT_SCRIPT}" stop || true
fi

if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_wifi_country "${COUNTRY}" || true
fi

if command -v nmcli >/dev/null 2>&1; then
  nmcli radio wifi on
  if [ -n "${PASSWORD}" ]; then
    nmcli dev wifi connect "${SSID}" password "${PASSWORD}"
  else
    nmcli dev wifi connect "${SSID}"
  fi
  exit 0
fi

escape_wpa_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

SSID_ESCAPED="$(escape_wpa_string "${SSID}")"

cat >/etc/wpa_supplicant/wpa_supplicant.conf <<EOF
country=${COUNTRY}
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
EOF

if [ -z "${PASSWORD}" ]; then
  cat >>/etc/wpa_supplicant/wpa_supplicant.conf <<EOF
network={
    ssid="${SSID_ESCAPED}"
    key_mgmt=NONE
}
EOF
else
  password_len="${#PASSWORD}"
  if [ "${password_len}" -lt 8 ] || [ "${password_len}" -gt 63 ]; then
    echo "WiFi password must be 8-63 characters for WPA/WPA2 networks." >&2
    exit 2
  fi
  if command -v wpa_passphrase >/dev/null 2>&1; then
    wpa_passphrase "${SSID}" "${PASSWORD}" | sed '/^[[:space:]]*#psk=/d' >>/etc/wpa_supplicant/wpa_supplicant.conf
  else
    PASSWORD_ESCAPED="$(escape_wpa_string "${PASSWORD}")"
    cat >>/etc/wpa_supplicant/wpa_supplicant.conf <<EOF
network={
    ssid="${SSID_ESCAPED}"
    psk="${PASSWORD_ESCAPED}"
}
EOF
  fi
fi

chmod 600 /etc/wpa_supplicant/wpa_supplicant.conf

if [ -f "${HOTSPOT_SCRIPT}" ]; then
  "${HOTSPOT_SCRIPT}" restart-station || true
else
  systemctl restart wpa_supplicant 2>/dev/null || true
  systemctl restart networking 2>/dev/null || true
fi
