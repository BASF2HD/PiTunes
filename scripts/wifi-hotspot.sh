#!/usr/bin/env bash
# Moode-style WiFi hotspot: broadcast EchoFlow AP when no Ethernet/WiFi station IP.
set -euo pipefail

CONFIG_FILE="${ECHOFLOW_WIFI_CONFIG:-/etc/echoflow/wifi-hotspot.conf}"
STATE_DIR="/run/echoflow"
STATE_FILE="${STATE_DIR}/wifi-hotspot.state"
HOSTAPD_CONF="/etc/echoflow/hostapd.conf"
DNSMASQ_CONF="/etc/echoflow/dnsmasq-echoflow.conf"
INSTALL_DIR="${ECHOFLOW_INSTALL_DIR:-/opt/echoflow}"

load_config() {
  # shellcheck disable=SC1090
  [ -f "${CONFIG_FILE}" ] && . "${CONFIG_FILE}"
  AP_SSID="${AP_SSID:-EchoFlow}"
  AP_PASSWORD="${AP_PASSWORD:-echoflowaudio}"
  AP_IP="${AP_IP:-172.24.1.1}"
  AP_NETMASK="${AP_NETMASK:-255.255.255.0}"
  AP_DHCP_START="${AP_DHCP_START:-172.24.1.50}"
  AP_DHCP_END="${AP_DHCP_END:-172.24.1.150}"
  AP_CHANNEL="${AP_CHANNEL:-6}"
  COUNTRY_CODE="${COUNTRY_CODE:-GB}"
  WLAN_INTERFACE="${WLAN_INTERFACE:-wlan0}"
  AUTO_HOTSPOT="${AUTO_HOTSPOT:-1}"
  FORCE_HOTSPOT="${FORCE_HOTSPOT:-0}"
}

log() {
  echo "[echoflow-hotspot] $*"
}

iface_exists() {
  ip link show "$1" &>/dev/null
}

has_ipv4() {
  local iface="$1"
  iface_exists "${iface}" || return 1
  ip -4 -o addr show dev "${iface}" 2>/dev/null | awk '{print $4}' | grep -qv '^169\.254\.'
}

has_ethernet() {
  local iface
  for iface in eth0 end0 enp1s0 enp0s31f6; do
    if has_ipv4 "${iface}"; then
      return 0
    fi
  done
  return 1
}

has_wlan_station() {
  has_ipv4 "${WLAN_INTERFACE}"
}

wpa_configured() {
  [ -f /etc/wpa_supplicant/wpa_supplicant.conf ] || return 1
  grep -q 'ssid=' /etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null
}

station_requested() {
  if [ "${FORCE_HOTSPOT}" = "1" ]; then
    return 1
  fi
  if wpa_configured; then
    return 0
  fi
  return 1
}

activate_hotspot_ssid() {
  wpa_configured || return 1
  grep -qE 'ssid="Activate Hotspot"' /etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null
}

should_start_hotspot() {
  load_config
  if [ "${FORCE_HOTSPOT}" = "1" ]; then
    return 0
  fi
  if activate_hotspot_ssid; then
    return 0
  fi
  if [ "${AUTO_HOTSPOT}" != "1" ]; then
    return 1
  fi
  if has_ethernet; then
    return 1
  fi
  if has_wlan_station; then
    return 1
  fi
  # Moode: AP when no station SSID configured, or station failed to get IP.
  return 0
}

write_hostapd_conf() {
  load_config
  install -d -m 0750 /etc/echoflow
  cat >"${HOSTAPD_CONF}" <<EOF
interface=${WLAN_INTERFACE}
driver=nl80211
ssid=${AP_SSID}
hw_mode=g
channel=${AP_CHANNEL}
country_code=${COUNTRY_CODE}
ieee80211n=1
wmm_enabled=1
auth_algs=1
wpa=2
wpa_key_mgmt=WPA-PSK
wpa_passphrase=${AP_PASSWORD}
rsn_pairwise=CCMP
ignore_broadcast_ssid=0
EOF
  chmod 600 "${HOSTAPD_CONF}"
}

write_dnsmasq_conf() {
  load_config
  mkdir -p "${STATE_DIR}"
  cat >"${DNSMASQ_CONF}" <<EOF
interface=${WLAN_INTERFACE}
bind-interfaces
except-interface=lo
pid-file=${STATE_DIR}/dnsmasq.pid
dhcp-range=${AP_DHCP_START},${AP_DHCP_END},${AP_NETMASK},24h
dhcp-option=3,${AP_IP}
dhcp-option=6,${AP_IP}
domain=local
address=/echoflow.local/${AP_IP}
EOF
}

deny_wlan_dhcpcd() {
  install -d -m 0755 /etc/dhcpcd.conf.d
  echo "denyinterfaces ${WLAN_INTERFACE}" >/etc/dhcpcd.conf.d/echoflow-deny-wlan.conf
  systemctl restart dhcpcd 2>/dev/null || true
}

allow_wlan_dhcpcd() {
  rm -f /etc/dhcpcd.conf.d/echoflow-deny-wlan.conf
  systemctl restart dhcpcd 2>/dev/null || true
}

stop_station_wifi() {
  systemctl stop "wpa_supplicant@${WLAN_INTERFACE}.service" 2>/dev/null || true
  systemctl stop wpa_supplicant 2>/dev/null || true
  pkill -f "wpa_supplicant.*${WLAN_INTERFACE}" 2>/dev/null || true
}

start_hotspot() {
  load_config
  if ! iface_exists "${WLAN_INTERFACE}"; then
    log "No ${WLAN_INTERFACE} — hotspot skipped."
    return 1
  fi

  rfkill unblock wifi 2>/dev/null || true
  deny_wlan_dhcpcd
  stop_station_wifi

  ip link set "${WLAN_INTERFACE}" down 2>/dev/null || true
  ip addr flush dev "${WLAN_INTERFACE}" 2>/dev/null || true
  ip link set "${WLAN_INTERFACE}" up
  ip addr add "${AP_IP}/24" dev "${WLAN_INTERFACE}"

  write_hostapd_conf
  write_dnsmasq_conf

  systemctl stop hostapd 2>/dev/null || true
  systemctl stop dnsmasq 2>/dev/null || true
  pkill hostapd 2>/dev/null || true
  pkill dnsmasq 2>/dev/null || true

  hostapd -B "${HOSTAPD_CONF}"
  dnsmasq -C "${DNSMASQ_CONF}"

  mkdir -p "${STATE_DIR}"
  echo "active" >"${STATE_FILE}"
  log "Hotspot active — SSID: ${AP_SSID}  IP: ${AP_IP}  (password in ${CONFIG_FILE})"
  return 0
}

stop_hotspot() {
  load_config
  pkill -f "hostapd.*${HOSTAPD_CONF}" 2>/dev/null || true
  pkill -f "dnsmasq.*${DNSMASQ_CONF}" 2>/dev/null || true
  systemctl stop hostapd 2>/dev/null || true
  systemctl stop dnsmasq 2>/dev/null || true
  ip addr flush dev "${WLAN_INTERFACE}" 2>/dev/null || true
  allow_wlan_dhcpcd
  rm -f "${STATE_FILE}"
  log "Hotspot stopped."
}

status_hotspot() {
  load_config
  local mode="off"
  local ip=""
  local station_ssid=""
  if [ -f "${STATE_FILE}" ] && pgrep -f "hostapd.*${HOSTAPD_CONF}" >/dev/null 2>&1; then
    mode="hotspot"
    ip="${AP_IP}"
  elif has_wlan_station; then
    mode="station"
    ip="$(ip -4 -o addr show dev "${WLAN_INTERFACE}" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1)"
    station_ssid="$(wpa_cli -i "${WLAN_INTERFACE}" status 2>/dev/null | sed -n 's/^ssid=//p' | head -n1)"
  elif has_ethernet; then
    mode="ethernet"
    ip="$(ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1)"
  fi
  printf 'mode=%s\nip=%s\nssid=%s\nap_ssid=%s\n' "${mode}" "${ip}" "${station_ssid}" "${AP_SSID}"
}

cmd_auto() {
  load_config
  sleep 8
  if should_start_hotspot; then
    start_hotspot || true
  else
    log "Station/Ethernet active — hotspot not needed."
    stop_hotspot 2>/dev/null || true
  fi
}

cmd_start() {
  start_hotspot
}

cmd_stop() {
  stop_hotspot
}

cmd_status() {
  status_hotspot
}

cmd_restart-station() {
  stop_hotspot
  allow_wlan_dhcpcd
  systemctl restart wpa_supplicant 2>/dev/null || true
  systemctl restart "wpa_supplicant@${WLAN_INTERFACE}.service" 2>/dev/null || true
  systemctl restart dhcpcd 2>/dev/null || true
}

usage() {
  cat <<EOF
Usage: $0 {auto|start|stop|status|restart-station}

  auto              Start hotspot if no Ethernet/WiFi (Moode-style, run at boot)
  start             Force hotspot on
  stop              Stop hotspot
  status            Print mode and addresses
  restart-station   Stop AP and restart wpa_supplicant/dhcpcd

Config: ${CONFIG_FILE}
Connect to AP, then open http://${AP_IP:-172.24.1.1} or http://echoflow.local

EOF
}

main() {
  local cmd="${1:-auto}"
  case "${cmd}" in
    auto) cmd_auto ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    restart-station) cmd_restart-station ;;
    -h | --help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
