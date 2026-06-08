#!/usr/bin/env bash
# Fast appliance boot splash: framebuffer only (no Plymouth, no viewers).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL_DIR="${PITUNES_INSTALL_DIR:-/opt/pitunes}"
BOOT_DIR="${PITUNES_BOOT_DIR:-}"

echo "Configuring PiTunes framebuffer boot splash (no Plymouth)..."

# Remove Plymouth theme if a previous image installed it.
if [ -d /usr/share/plymouth/themes/pitunes ]; then
  rm -rf /usr/share/plymouth/themes/pitunes
fi
for unit in \
  plymouth-start.service \
  plymouth-read-write.service \
  plymouth-quit.service \
  plymouth-quit-wait.service \
  plymouth-reboot.service \
  plymouth-halt.service \
  plymouth-poweroff.service; do
  systemctl disable "${unit}" 2>/dev/null || true
  systemctl mask "${unit}" 2>/dev/null || true
done

python3 "${PROJECT_ROOT}/scripts/build-boot-fb-splash.py" --build

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
      console=tty1|console=tty3|quiet|splash|loglevel=*|logo.nologo|vt.global_cursor_default=*|plymouth.*|systemd.show_status=*|rd.udev.log_level=*)
        ;;
      *)
        next="${next}${next:+ }${token}"
        ;;
    esac
  done
  # No "splash" token — that enables Plymouth and slows boot.
  next="${next} console=tty3 quiet loglevel=0 logo.nologo vt.global_cursor_default=0 systemd.show_status=false rd.udev.log_level=0"
  printf '%s\n' "${next}" >"${CMDLINE_FILE}"
  echo "Updated ${CMDLINE_FILE}"
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

remove_config_key() {
  local key="$1"
  local file="$2"
  sed -i -E "/^[#[:space:]]*${key}=/d" "${file}"
}

if [ -n "${CONFIG_FILE}" ]; then
  set_config_value "disable_splash" "1" "${CONFIG_FILE}"
  remove_config_key "auto_initramfs" "${CONFIG_FILE}"
  echo "Updated ${CONFIG_FILE}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable pitunes-fb-splash.service 2>/dev/null || true
fi

echo "Framebuffer splash ready. Plymouth is not used."
