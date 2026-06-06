#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
THEME_SRC="${PROJECT_ROOT}/config/plymouth/echoflow"
THEME_DST="/usr/share/plymouth/themes/echoflow"
BOOT_DIR="${ECHOFLOW_BOOT_DIR:-}"

install -d -m 0755 "${THEME_DST}"
install -m 0644 "${THEME_SRC}/echoflow.plymouth" "${THEME_DST}/echoflow.plymouth"
install -m 0644 "${THEME_SRC}/echoflow.script" "${THEME_DST}/echoflow.script"
install -m 0644 "${THEME_SRC}/echoflow-logo.png" "${THEME_DST}/echoflow-logo.png"
install -m 0644 "${THEME_SRC}/echoflow-logo.svg" "${THEME_DST}/echoflow-logo.svg"
install -m 0644 "${THEME_SRC}/progress-track.png" "${THEME_DST}/progress-track.png"
install -m 0644 "${THEME_SRC}/progress-fill.png" "${THEME_DST}/progress-fill.png"

if command -v plymouth-set-default-theme >/dev/null 2>&1; then
  plymouth-set-default-theme echoflow >/dev/null 2>&1 || true
  if command -v update-initramfs >/dev/null 2>&1; then
    for module_dir in /lib/modules/*; do
      [ -d "${module_dir}" ] || continue
      kernel_version="${module_dir##*/}"
      if [ -f "/boot/initrd.img-${kernel_version}" ] || [ -f "/boot/firmware/initrd.img-${kernel_version}" ]; then
        update-initramfs -u -k "${kernel_version}" >/dev/null 2>&1 || true
      else
        update-initramfs -c -k "${kernel_version}" >/dev/null 2>&1 || true
      fi
    done
  fi
fi

CMDLINE_FILE=""
CONFIG_FILE=""
if [ -n "${BOOT_DIR}" ]; then
  [ -f "${BOOT_DIR}/cmdline.txt" ] && CMDLINE_FILE="${BOOT_DIR}/cmdline.txt"
  [ -f "${BOOT_DIR}/config.txt" ] && CONFIG_FILE="${BOOT_DIR}/config.txt"
fi
for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
  [ -n "${CMDLINE_FILE}" ] && break
  if [ -f "${candidate}" ]; then
    CMDLINE_FILE="${candidate}"
    break
  fi
done
for candidate in /boot/firmware/config.txt /boot/config.txt; do
  [ -n "${CONFIG_FILE}" ] && break
  if [ -f "${candidate}" ]; then
    CONFIG_FILE="${candidate}"
    break
  fi
done

if [ -n "${CMDLINE_FILE}" ]; then
  current="$(tr '\n' ' ' <"${CMDLINE_FILE}" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  next=""
  for token in ${current}; do
    case "${token}" in
      console=tty1|console=tty3|quiet|splash|loglevel=*|logo.nologo|vt.global_cursor_default=*|plymouth.ignore-serial-consoles|systemd.show_status=*|rd.udev.log_level=*)
        ;;
      *)
        next="${next}${next:+ }${token}"
        ;;
    esac
  done
  next="${next} console=tty3 quiet splash loglevel=0 logo.nologo vt.global_cursor_default=0 plymouth.ignore-serial-consoles systemd.show_status=false rd.udev.log_level=0"
  printf '%s\n' "${next}" >"${CMDLINE_FILE}"
fi

set_config_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -qE "^[#[:space:]]*${key}=" "${file}"; then
    sed -i -E "s|^[#[:space:]]*${key}=.*|${key}=${value}|" "${file}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}

if [ -n "${CONFIG_FILE}" ]; then
  set_config_value "disable_splash" "1" "${CONFIG_FILE}"
  set_config_value "auto_initramfs" "1" "${CONFIG_FILE}"
fi
