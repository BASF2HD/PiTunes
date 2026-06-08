#!/usr/bin/env bash
set -euo pipefail

DEVICE_NAME="${PITUNES_DEVICE_NAME:-PiTunes}"
ACTION="${1:-all}"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root" >&2
    exit 1
  fi
}

set_or_append_main_conf() {
  local key="$1"
  local value="$2"
  local file="/etc/bluetooth/main.conf"
  install -d -m 0755 /etc/bluetooth
  touch "${file}"
  if ! grep -q '^\[General\]' "${file}"; then
    printf '\n[General]\n' >>"${file}"
  fi
  if grep -qE "^[#[:space:]]*${key}[[:space:]]*=" "${file}"; then
    sed -i -E "s|^[#[:space:]]*${key}[[:space:]]*=.*|${key} = ${value}|" "${file}"
  else
    sed -i "/^\[General\]/a ${key} = ${value}" "${file}"
  fi
}

configure_bluealsa_service() {
  install -d -m 0755 /etc/default
  cat >/etc/default/bluez-alsa <<EOF
OPTIONS="-p a2dp-sink"
EOF

  if [ -x /usr/bin/bluealsa ]; then
    install -d -m 0755 /etc/systemd/system/bluealsa.service.d
    cat >/etc/systemd/system/bluealsa.service.d/pitunes-a2dp-sink.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/bluealsa -S -p a2dp-sink
EOF
  fi
}

configure_bluetooth() {
  set_or_append_main_conf "Name" "${DEVICE_NAME}"
  set_or_append_main_conf "Alias" "${DEVICE_NAME}"
  set_or_append_main_conf "Class" "0x200414"
  set_or_append_main_conf "DiscoverableTimeout" "0"
  set_or_append_main_conf "PairableTimeout" "0"
  set_or_append_main_conf "ControllerMode" "dual"
  set_or_append_main_conf "AutoEnable" "true"
  set_or_append_main_conf "AlwaysPairable" "true"

  if command -v rfkill >/dev/null 2>&1; then
    rfkill unblock bluetooth || true
  fi

  configure_bluealsa_service

  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    if systemctl list-unit-files hciuart.service >/dev/null 2>&1; then
      systemctl enable hciuart.service >/dev/null 2>&1 || true
      systemctl restart hciuart.service >/dev/null 2>&1 || systemctl start hciuart.service >/dev/null 2>&1 || true
    fi
    systemctl enable bluetooth.service >/dev/null 2>&1 || true
    systemctl restart bluetooth.service >/dev/null 2>&1 || systemctl start bluetooth.service >/dev/null 2>&1 || true
    if systemctl list-unit-files pitunes-bt-agent.service >/dev/null 2>&1; then
      systemctl enable pitunes-bt-agent.service >/dev/null 2>&1 || true
      systemctl restart pitunes-bt-agent.service >/dev/null 2>&1 || systemctl start pitunes-bt-agent.service >/dev/null 2>&1 || true
    fi
    systemctl disable --now bluealsa-aplay.service >/dev/null 2>&1 || true
    systemctl enable bluealsa.service >/dev/null 2>&1 || true
    systemctl restart bluealsa.service >/dev/null 2>&1 || systemctl start bluealsa.service >/dev/null 2>&1 || true
    if systemctl list-unit-files pitunes-bluealsa-aplay.service >/dev/null 2>&1; then
      systemctl enable pitunes-bluealsa-aplay.service >/dev/null 2>&1 || true
      systemctl restart pitunes-bluealsa-aplay.service >/dev/null 2>&1 || systemctl start pitunes-bluealsa-aplay.service >/dev/null 2>&1 || true
    fi
  fi

  if command -v bluetoothctl >/dev/null 2>&1; then
    bluetoothctl <<EOF >/dev/null 2>&1 || true
power on
agent NoInputNoOutput
default-agent
system-alias ${DEVICE_NAME}
pairable on
discoverable on
show
EOF
  fi

  if command -v hciconfig >/dev/null 2>&1; then
    hciconfig hci0 up >/dev/null 2>&1 || true
    hciconfig hci0 name "${DEVICE_NAME}" >/dev/null 2>&1 || true
    hciconfig hci0 piscan >/dev/null 2>&1 || true
  fi
}

configure_airplay() {
  install -d -m 0755 /etc
  cat >/etc/shairport-sync.conf <<EOF
general =
{
  name = "${DEVICE_NAME}";
  output_backend = "alsa";
  mdns_backend = "avahi";
  interpolation = "basic";
};

alsa =
{
  output_device = "default";
};

metadata =
{
  enabled = "no";
};
EOF

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files nqptp.service >/dev/null 2>&1; then
      systemctl enable nqptp.service >/dev/null 2>&1 || true
      systemctl restart nqptp.service >/dev/null 2>&1 || systemctl start nqptp.service >/dev/null 2>&1 || true
    fi
    systemctl enable avahi-daemon.service >/dev/null 2>&1 || true
    systemctl restart avahi-daemon.service >/dev/null 2>&1 || systemctl start avahi-daemon.service >/dev/null 2>&1 || true
    systemctl enable shairport-sync.service >/dev/null 2>&1 || true
    if [ "${PITUNES_IMAGE_BUILD:-0}" != "1" ]; then
      systemctl restart shairport-sync.service >/dev/null 2>&1 || systemctl start shairport-sync.service >/dev/null 2>&1 || true
    fi
  fi
}

require_root

case "${ACTION}" in
  bluetooth)
    configure_bluetooth
    ;;
  airplay)
    configure_airplay
    ;;
  all)
    configure_bluetooth
    configure_airplay
    ;;
  *)
    echo "Usage: $0 [bluetooth|airplay|all]" >&2
    exit 2
    ;;
esac
