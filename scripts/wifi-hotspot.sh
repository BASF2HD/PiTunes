#!/usr/bin/env bash
# NetworkManager-owned EchoFlow hotspot and station fallback.
set -euo pipefail

CONFIG_FILE="${ECHOFLOW_WIFI_CONFIG:-/etc/echoflow/wifi-hotspot.conf}"
STATION_CONNECTION="${ECHOFLOW_WIFI_STATION_CONNECTION:-EchoFlow-WiFi}"
STATION_BOOT_WAIT_SECONDS="${STATION_BOOT_WAIT_SECONDS:-6}"
STATE_DIR="/run/echoflow"
STATE_FILE="${STATE_DIR}/wifi-hotspot.state"

load_config() {
  # shellcheck disable=SC1090
  [ -f "${CONFIG_FILE}" ] && . "${CONFIG_FILE}"
  AP_SSID="${AP_SSID:-EchoFlow}"
  AP_PASSWORD="${AP_PASSWORD:-echoflowaudio}"
  AP_IP="${AP_IP:-172.24.1.1}"
  AP_CHANNEL="${AP_CHANNEL:-6}"
  COUNTRY_CODE="${COUNTRY_CODE:-GB}"
  WLAN_INTERFACE="${WLAN_INTERFACE:-wlan0}"
  AUTO_HOTSPOT="${AUTO_HOTSPOT:-1}"
  FORCE_HOTSPOT="${FORCE_HOTSPOT:-0}"
  AP_CONNECTION="${AP_CONNECTION:-EchoFlow-Hotspot}"
}

log() {
  echo "[echoflow-network] $*"
}

require_networkmanager() {
  command -v nmcli >/dev/null 2>&1 || {
    log "NetworkManager/nmcli is not installed."
    exit 1
  }
  systemctl is-active --quiet NetworkManager.service || {
    systemctl enable --now NetworkManager.service
  }
}

active_connection() {
  nmcli -g GENERAL.CONNECTION device show "${WLAN_INTERFACE}" 2>/dev/null | head -n1
}

hotspot_active() {
  [ "$(active_connection)" = "${AP_CONNECTION}" ]
}

handoff_active() {
  local state_file="/run/echoflow/wifi-connect.json"
  local modified
  grep -qE '"status"[[:space:]]*:[[:space:]]*"(queued|connecting)"' "${state_file}" 2>/dev/null || return 1
  modified="$(stat -c %Y "${state_file}" 2>/dev/null || echo 0)"
  [ $(( $(date +%s) - modified )) -lt 120 ]
}

has_ipv4() {
  local iface="$1"
  ip -4 -o addr show dev "${iface}" 2>/dev/null |
    awk '$4 !~ /^169\\.254\\./ {found=1} END {exit !found}'
}

has_ethernet() {
  local iface
  for iface in /sys/class/net/eth* /sys/class/net/en*; do
    [ -e "${iface}" ] || continue
    has_ipv4 "${iface##*/}" && return 0
  done
  return 1
}

has_wlan_station() {
  [ "$(active_connection)" != "${AP_CONNECTION}" ] && has_ipv4 "${WLAN_INTERFACE}"
}

saved_station_connection() {
  nmcli -g NAME connection show 2>/dev/null | grep -Fxq "${STATION_CONNECTION}"
}

station_autoconnect_pending() {
  saved_station_connection || return 1
  has_wlan_station && return 1
  nmcli -g connection.autoconnect connection show "${STATION_CONNECTION}" 2>/dev/null | grep -qx yes
}

restore_station() {
  load_config
  has_wlan_station && return 0
  saved_station_connection || return 1
  nmcli connection up "${STATION_CONNECTION}" ifname "${WLAN_INTERFACE}" >/dev/null 2>&1 || true
  for _ in $(seq 1 $((STATION_BOOT_WAIT_SECONDS * 2))); do
    has_wlan_station && return 0
    sleep 0.5
  done
  return 1
}

wait_for_station_boot() {
  load_config
  has_ethernet && return 0
  has_wlan_station && return 0
  saved_station_connection || return 0
  log "Nudging saved WiFi (${STATION_CONNECTION}) during boot."
  restore_station || true
}

configure_hotspot() {
  load_config
  if nmcli -g NAME connection show | grep -Fxq "${AP_CONNECTION}"; then
    nmcli connection modify "${AP_CONNECTION}" \
      connection.interface-name "${WLAN_INTERFACE}" \
      connection.autoconnect no \
      802-11-wireless.ssid "${AP_SSID}" \
      802-11-wireless.mode ap \
      802-11-wireless.band bg \
      802-11-wireless.channel "${AP_CHANNEL}" \
      ipv4.method shared \
      ipv4.addresses "${AP_IP}/24" \
      ipv6.method disabled
  else
    nmcli connection add type wifi ifname "${WLAN_INTERFACE}" con-name "${AP_CONNECTION}" ssid "${AP_SSID}"
    nmcli connection modify "${AP_CONNECTION}" \
      connection.autoconnect no \
      802-11-wireless.mode ap \
      802-11-wireless.band bg \
      802-11-wireless.channel "${AP_CHANNEL}" \
      ipv4.method shared \
      ipv4.addresses "${AP_IP}/24" \
      ipv6.method disabled
  fi

  if [ -n "${AP_PASSWORD}" ]; then
    nmcli connection modify "${AP_CONNECTION}" \
      802-11-wireless-security.key-mgmt wpa-psk \
      802-11-wireless-security.psk "${AP_PASSWORD}"
  else
    nmcli connection modify "${AP_CONNECTION}" 802-11-wireless-security.key-mgmt ""
  fi
}

start_hotspot() {
  load_config
  require_networkmanager
  rfkill unblock wifi 2>/dev/null || true
  nmcli radio wifi on
  configure_hotspot
  nmcli connection up "${AP_CONNECTION}" ifname "${WLAN_INTERFACE}"
  install -d -m 0755 "${STATE_DIR}"
  printf 'active\n' >"${STATE_FILE}"
  log "Hotspot active: ${AP_SSID} at ${AP_IP}"
}

stop_hotspot() {
  load_config
  require_networkmanager
  if hotspot_active; then
    nmcli connection down "${AP_CONNECTION}" || true
  fi
  rm -f "${STATE_FILE}"
  log "Hotspot stopped."
}

restart_station() {
  load_config
  require_networkmanager
  stop_hotspot
  nmcli radio wifi on
  nmcli device set "${WLAN_INTERFACE}" managed yes
  nmcli device connect "${WLAN_INTERFACE}" >/dev/null 2>&1 || true
}

status_network() {
  load_config
  require_networkmanager
  local connection
  local ip
  connection="$(active_connection)"
  ip="$(ip -4 -o addr show dev "${WLAN_INTERFACE}" 2>/dev/null | awk '$4 !~ /^169\\.254\\./ {print $4; exit}' | cut -d/ -f1)"
  if [ "${connection}" = "${AP_CONNECTION}" ]; then
    printf 'mode=hotspot\nip=%s\ninterface=%s\nssid=%s\nap_ssid=%s\n' "${ip:-${AP_IP}}" "${WLAN_INTERFACE}" "" "${AP_SSID}"
  elif [ -n "${ip}" ]; then
    printf 'mode=station\nip=%s\ninterface=%s\nssid=%s\nap_ssid=%s\n' "${ip}" "${WLAN_INTERFACE}" "${connection}" "${AP_SSID}"
  elif has_ethernet; then
    printf 'mode=ethernet\nip=\ninterface=\nssid=\nap_ssid=%s\n' "${AP_SSID}"
  else
    printf 'mode=off\nip=\ninterface=%s\nssid=\nap_ssid=%s\n' "${WLAN_INTERFACE}" "${AP_SSID}"
  fi
}

scan_networks() {
  load_config
  require_networkmanager
  if hotspot_active && command -v iw >/dev/null 2>&1; then
    iw dev "${WLAN_INTERFACE}" scan ap-force && return 0
  fi
  if ! nmcli --colors no -m multiline -f SSID,SIGNAL,SECURITY device wifi list ifname "${WLAN_INTERFACE}" --rescan yes; then
    nmcli --colors no -m multiline -f SSID,SIGNAL,SECURITY device wifi list ifname "${WLAN_INTERFACE}" --rescan no
  fi
}

auto_hotspot() {
  load_config
  require_networkmanager
  sleep 20
  if [ "${FORCE_HOTSPOT}" = "1" ]; then
    start_hotspot
  elif [ "${AUTO_HOTSPOT}" != "1" ] || has_ethernet || has_wlan_station; then
    stop_hotspot
    log "Station/Ethernet active; hotspot not needed."
  else
    start_hotspot
  fi
}

watch_network() {
  load_config
  require_networkmanager
  wait_for_station_boot
  while true; do
    if handoff_active; then
      log "WiFi handoff in progress."
    elif [ "${FORCE_HOTSPOT}" = "1" ]; then
      hotspot_active || start_hotspot
    elif station_autoconnect_pending; then
      log "Saved WiFi still joining; deferring hotspot."
      restore_station || true
    elif [ "${AUTO_HOTSPOT}" != "1" ] || has_ethernet || has_wlan_station; then
      hotspot_active && stop_hotspot
    else
      hotspot_active || start_hotspot
    fi
    sleep 15
  done
}

usage() {
  cat <<EOF
Usage: $0 {auto|watch|start|stop|status|scan|restart-station}
EOF
}

case "${1:-auto}" in
  auto) auto_hotspot ;;
  watch) watch_network ;;
  start) start_hotspot ;;
  stop) stop_hotspot ;;
  status) status_network ;;
  scan) scan_networks ;;
  restart-station) restart_station ;;
  -h | --help) usage ;;
  *) usage; exit 1 ;;
esac
