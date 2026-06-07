#!/usr/bin/env bash
# Apply EchoFlow audio output route, optional DAC HAT overlay, ALSA device, and MPD mixer.
set -euo pipefail

INSTALL_DIR="${ECHOFLOW_INSTALL_DIR:-/opt/echoflow}"
CONFIGURE_MPD="${INSTALL_DIR}/configure-mpd.sh"
HATS_FILE="${INSTALL_DIR}/config/dac-hats.json"

log() {
  printf 'apply-audio-output: %s\n' "$*"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root" >&2
    exit 1
  fi
}

boot_config_path() {
  if [ -f /boot/firmware/config.txt ]; then
    echo /boot/firmware/config.txt
  else
    echo /boot/config.txt
  fi
}

overlay_for_hat() {
  local hat_id="$1"
  python3 - "${hat_id}" "${HATS_FILE}" <<'PY'
import json, sys
hat_id, path = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path, encoding="utf-8"))
except OSError:
    sys.exit(1)
for hat in data.get("hats", []):
    if hat.get("id") == hat_id:
        print(hat.get("overlay", ""))
        extras = hat.get("config_extra") or []
        for extra in extras:
            print(f"EXTRA:{extra}")
        sys.exit(0)
sys.exit(1)
PY
}

boot_mount_point() {
  local boot="$1"
  if [ "${boot}" = "/boot/firmware/config.txt" ]; then
    echo /boot/firmware
  else
    echo /boot
  fi
}

ensure_boot_rw() {
  local boot mount_point
  boot="$(boot_config_path)"
  mount_point="$(boot_mount_point "${boot}")"
  mount -o remount,rw "${mount_point}" 2>/dev/null || true
}

has_echoflow_boot_audio() {
  local boot="$1"
  [ -f "${boot}" ] && grep -q '^# EchoFlow audio$' "${boot}"
}

write_boot_config() {
  local boot="$1"
  local tmp
  tmp="$(mktemp)"
  cat >"${tmp}"
  ensure_boot_rw
  cp "${tmp}" "${boot}"
  rm -f "${tmp}"
}

remove_echoflow_boot_audio() {
  local boot="$1"
  [ -f "${boot}" ] || return 0
  has_echoflow_boot_audio "${boot}" || return 0
  write_boot_config "${boot}" < <(sed '/^# EchoFlow audio$/,/^# EchoFlow audio end$/d' "${boot}")
}

disable_onboard_audio() {
  local boot="$1"
  [ -f "${boot}" ] || return 0
  write_boot_config "${boot}" < <(
    sed -E \
      -e 's|^[[:space:]]*dtparam=audio=on|#dtparam=audio=on  # disabled by EchoFlow|' \
      -e 's|dtoverlay=vc4-fkms-v3d$|dtoverlay=vc4-fkms-v3d,audio=off|' \
      -e 's|dtoverlay=vc4-kms-v3d$|dtoverlay=vc4-kms-v3d,noaudio|' \
      "${boot}"
  )
}

boot_audio_needs_restore() {
  local boot="$1"
  [ -f "${boot}" ] || return 1
  grep -qE '#dtparam=audio=on  # disabled by EchoFlow|dtoverlay=vc4-kms-v3d,noaudio|dtoverlay=vc4-fkms-v3d,audio=off' "${boot}"
}

restore_onboard_audio() {
  local boot="$1"
  [ -f "${boot}" ] || return 1
  boot_audio_needs_restore "${boot}" || return 1
  ensure_boot_rw
  write_boot_config "${boot}" < <(
    sed -E \
      -e 's|^[[:space:]]*#dtparam=audio=on  # disabled by EchoFlow|dtparam=audio=on|' \
      -e 's|dtoverlay=vc4-fkms-v3d,noaudio|dtoverlay=vc4-kms-v3d|' \
      -e 's|dtoverlay=vc4-fkms-v3d,audio=off|dtoverlay=vc4-fkms-v3d|' \
      "${boot}"
  )
  return 0
}

apply_hat_boot_config() {
  local overlay="$1"
  shift
  local boot
  boot="$(boot_config_path)"
  ensure_boot_rw
  remove_echoflow_boot_audio "${boot}"
  disable_onboard_audio "${boot}"
  {
    printf '\n# EchoFlow audio\n'
    printf 'dtoverlay=%s\n' "${overlay}"
    while [ $# -gt 0 ]; do
      printf '%s\n' "$1"
      shift
    done
    printf '# EchoFlow audio end\n'
  } >>"${boot}"
}

clear_hat_boot_config() {
  local boot
  boot="$(boot_config_path)"
  if has_echoflow_boot_audio "${boot}"; then
    remove_echoflow_boot_audio "${boot}"
  fi
  if restore_onboard_audio "${boot}"; then
    return 0
  fi
  return 1
}

detect_usb_card() {
  aplay -l 2>/dev/null | awk '
    /card [0-9]+:/ {
      if (line ~ /usb|dac|audio device|fiio|schiit|topping|smsl|ifi/i && line !~ /bcm2835|Headphones|vc4|HDMI/) {
        match(line, /card ([0-9]+):/, m)
        print m[1]
        exit
      }
      line = $0
    }
    END {
      if (line ~ /usb|dac|audio device|fiio|schiit|topping|smsl|ifi/i && line !~ /bcm2835|Headphones|vc4|HDMI/) {
        match(line, /card ([0-9]+):/, m)
        print m[1]
      }
    }
  '
}

apply_route() {
  local route="$1"
  local hat_id="${2:-}"
  local alsa_device="${3:-default}"
  local mixer="${4:-software}"
  local reboot_required=0
  local overlay=""
  local -a extras=()

  case "${route}" in
    dac-hat)
      if [ -z "${hat_id}" ]; then
        echo "DAC HAT route requires dac_hat selection" >&2
        exit 2
      fi
      mapfile -t overlay_lines < <(overlay_for_hat "${hat_id}" || true)
      overlay="${overlay_lines[0]:-}"
      if [ -z "${overlay}" ]; then
        echo "Unknown DAC HAT id: ${hat_id}" >&2
        exit 2
      fi
      for line in "${overlay_lines[@]:1}"; do
        if [[ "${line}" == EXTRA:* ]]; then
          extras+=("${line#EXTRA:}")
        fi
      done
      apply_hat_boot_config "${overlay}" "${extras[@]}"
      reboot_required=1
      export HAT_OVERLAY="${overlay}"
      export ALSA_CARD="0"
      export ALSA_DEVICE="${alsa_device}"
      export MIXER_TYPE="${mixer}"
      "${CONFIGURE_MPD}" dac-hat
      ;;
    usb-dac)
      if clear_hat_boot_config; then
        reboot_required=1
      fi
      local card
      card="$(detect_usb_card || true)"
      if [ -z "${card}" ] && [[ "${alsa_device}" =~ ^hw:([0-9]+) ]]; then
        card="${BASH_REMATCH[1]}"
      fi
      if [ -z "${card}" ]; then
        card="1"
      fi
      export ALSA_CARD="${card}"
      export ALSA_DEVICE="${alsa_device}"
      export MIXER_TYPE="${mixer}"
      "${CONFIGURE_MPD}" usb-dac
      ;;
    hdmi)
      if clear_hat_boot_config; then
        reboot_required=1
      fi
      export ALSA_DEVICE="${alsa_device}"
      export MIXER_TYPE="${mixer}"
      "${CONFIGURE_MPD}" hdmi
      ;;
    headphones)
      if clear_hat_boot_config; then
        reboot_required=1
      fi
      export ALSA_DEVICE="${alsa_device}"
      export MIXER_TYPE="${mixer}"
      "${CONFIGURE_MPD}" headphones
      ;;
    *)
      echo "Unsupported audio route: ${route}" >&2
      exit 2
      ;;
  esac

  printf '{"ok":true,"route":"%s","reboot_required":%s}\n' "${route}" "${reboot_required}"
}

main() {
  require_root
  if [ ! -x "${CONFIGURE_MPD}" ]; then
    echo "Missing ${CONFIGURE_MPD}" >&2
    exit 1
  fi

  local route="${1:-}"
  local hat_id="${2:-}"
  local alsa_device="${3:-default}"
  local mixer="${4:-software}"

  if [ -z "${route}" ] && [ ! -t 0 ]; then
    eval "$(python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
route = data.get("output") or data.get("audio_output") or ""
hat = data.get("dac_hat") or data.get("hat") or ""
alsa = data.get("alsa") or data.get("alsa_device") or "default"
mixer = data.get("mixer") or "software"
print(f'route={route!r}')
print(f'hat_id={hat!r}')
print(f'alsa_device={alsa!r}')
print(f'mixer={mixer!r}')
PY
)"
  fi

  if [ -z "${route}" ]; then
    echo "Usage: $0 <route> [dac_hat_id] [alsa_device] [mixer]" >&2
    exit 2
  fi

  apply_route "${route}" "${hat_id}" "${alsa_device}" "${mixer}"
}

main "$@"
