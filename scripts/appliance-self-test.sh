#!/usr/bin/env bash
# Validate the real Raspberry Pi appliance services. Run on the Pi as root.
set -u

failures=0

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "${label}"
  else
    printf 'FAIL  %s\n' "${label}"
    failures=$((failures + 1))
  fi
}

service_active() {
  systemctl is-active --quiet "$1"
}

bluetooth_ready() {
  local status
  status="$(bluetoothctl show 2>/dev/null)" || return 1
  grep -q 'Alias: PiTunes' <<<"${status}" &&
    grep -q 'Powered: yes' <<<"${status}" &&
    grep -q 'Pairable: yes' <<<"${status}" &&
    grep -q 'Discoverable: yes' <<<"${status}"
}

airplay_advertised() {
  timeout 8 avahi-browse -rt _raop._tcp 2>/dev/null | grep -q 'PiTunes'
}

printf 'PiTunes appliance self-test\n\n'
check "PiTunes API" curl -fsS http://127.0.0.1/api/health
check "nginx" service_active nginx.service
check "NetworkManager" service_active NetworkManager.service
check "network recovery supervisor" service_active pitunes-hotspot.service
check "SSH service" service_active ssh.service
check "SSH port 22" sh -c "ss -lnt | grep -q ':22 '"
check "Bluetooth service" service_active bluetooth.service
check "BlueALSA receiver" service_active bluealsa.service
check "Bluetooth playback helper" service_active pitunes-bluealsa-aplay.service
check "Bluetooth discoverable as PiTunes" bluetooth_ready
check "AirPlay service" service_active shairport-sync.service
check "Avahi service" service_active avahi-daemon.service
check "AirPlay advertised as PiTunes" airplay_advertised
check "local display" service_active lightdm.service

printf '\nNetwork devices\n'
nmcli -f DEVICE,TYPE,STATE,CONNECTION device status 2>/dev/null || true

if [ "${failures}" -ne 0 ]; then
  printf '\n%s appliance check(s) failed.\n' "${failures}" >&2
  exit 1
fi

printf '\nAll appliance checks passed.\n'
