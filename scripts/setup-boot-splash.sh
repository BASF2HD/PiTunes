#!/usr/bin/env bash
# Keep Raspberry Pi OS native Plymouth boot (no custom PiTunes splash).
set -euo pipefail

BOOT_DIR="${PITUNES_BOOT_DIR:-}"

echo "Restoring native Raspberry Pi boot splash (Plymouth)..."

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
  systemctl unmask "${unit}" 2>/dev/null || true
  systemctl enable "${unit}" 2>/dev/null || true
done

systemctl disable pitunes-fb-splash.service 2>/dev/null || true
systemctl mask pitunes-fb-splash.service 2>/dev/null || true

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
      logo.nologo|vt.global_cursor_default=*|systemd.show_status=*|rd.udev.log_level=*)
        ;;
      console=tty3)
        next="${next}${next:+ }console=tty1"
        ;;
      *)
        next="${next}${next:+ }${token}"
        ;;
    esac
  done
  case " ${next} " in
    *" splash "*) ;;
    *) next="${next}${next:+ }splash" ;;
  esac
  case " ${next} " in
    *" quiet "*) ;;
    *) next="${next}${next:+ }quiet" ;;
  esac
  printf '%s\n' "${next}" >"${CMDLINE_FILE}"
  echo "Updated ${CMDLINE_FILE}"
fi

if [ -n "${CONFIG_FILE}" ]; then
  if grep -qE '^[#[:space:]]*disable_splash=' "${CONFIG_FILE}"; then
    sed -i -E 's|^[#[:space:]]*disable_splash=.*|disable_splash=0|' "${CONFIG_FILE}"
  else
    printf '\ndisable_splash=0\n' >>"${CONFIG_FILE}"
  fi
  echo "Updated ${CONFIG_FILE}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload 2>/dev/null || true
fi

echo "Native boot splash enabled. Custom framebuffer splash disabled."
