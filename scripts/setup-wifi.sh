#!/usr/bin/env bash
# Connect PiTunes to a WiFi station using NetworkManager only.
set -euo pipefail

SSID="${1:-}"
PASSWORD="${2:-}"
COUNTRY="${3:-GB}"
CONNECT_TIMEOUT="${PITUNES_WIFI_CONNECT_TIMEOUT:-60}"
CONFIG_FILE="${PITUNES_WIFI_CONFIG:-/etc/pitunes/wifi-hotspot.conf}"
HOTSPOT_SCRIPT="${PITUNES_INSTALL_DIR:-/opt/pitunes}/scripts/wifi-hotspot.sh"
WLAN_INTERFACE="wlan0"
STATION_CONNECTION="PiTunes-WiFi"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./setup-wifi.sh SSID PASSWORD [COUNTRY]" >&2
  exit 1
fi
if [ -z "${SSID}" ]; then
  echo "Usage: sudo ./setup-wifi.sh SSID [PASSWORD] [COUNTRY]" >&2
  exit 1
fi
if ! command -v nmcli >/dev/null 2>&1; then
  echo "NetworkManager/nmcli is required." >&2
  exit 1
fi

if [ -f "${CONFIG_FILE}" ]; then
  # shellcheck disable=SC1090
  . "${CONFIG_FILE}"
  WLAN_INTERFACE="${WLAN_INTERFACE:-wlan0}"
fi

connection_failed() {
  nmcli connection modify "${STATION_CONNECTION}" connection.autoconnect no >/dev/null 2>&1 || true
}
trap connection_failed ERR

if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_wifi_country "${COUNTRY}" || true
fi

systemctl enable --now NetworkManager.service
rfkill unblock wifi 2>/dev/null || true
nmcli radio wifi on
nmcli device set "${WLAN_INTERFACE}" managed yes

if [ -f "${HOTSPOT_SCRIPT}" ]; then
  "${HOTSPOT_SCRIPT}" stop || true
fi

nmcli connection delete "${STATION_CONNECTION}" >/dev/null 2>&1 || true
nmcli connection add type wifi ifname "${WLAN_INTERFACE}" con-name "${STATION_CONNECTION}" ssid "${SSID}"
nmcli connection modify "${STATION_CONNECTION}" \
  connection.autoconnect no \
  ipv4.method auto \
  ipv6.method auto

if [ -n "${PASSWORD}" ]; then
  nmcli connection modify "${STATION_CONNECTION}" \
    802-11-wireless-security.key-mgmt wpa-psk \
    802-11-wireless-security.psk "${PASSWORD}"
fi

nmcli --wait "${CONNECT_TIMEOUT}" connection up "${STATION_CONNECTION}" ifname "${WLAN_INTERFACE}"

ip_address=""
for _ in $(seq 1 15); do
  ip_address="$(ip -4 -o addr show dev "${WLAN_INTERFACE}" 2>/dev/null | awk '$4 !~ /^169\\.254\\./ {print $4; exit}' | cut -d/ -f1)"
  [ -n "${ip_address}" ] && break
  sleep 1
done
if [ -z "${ip_address}" ]; then
  echo "NetworkManager joined ${SSID} but no IPv4 address was assigned." >&2
  exit 3
fi

nmcli connection modify "${STATION_CONNECTION}" connection.autoconnect yes connection.autoconnect-priority 100
# Credentials live in NetworkManager's root-only profile (Volumio-style system store).
chmod 600 "/etc/NetworkManager/system-connections/${STATION_CONNECTION}.nmconnection" 2>/dev/null || true
chown root:root "/etc/NetworkManager/system-connections/${STATION_CONNECTION}.nmconnection" 2>/dev/null || true

trap - ERR
printf 'Connected to %s at %s\n' "${SSID}" "${ip_address}"
