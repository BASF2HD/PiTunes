#!/usr/bin/env bash
# Kiosk boot: clean dark screen, no firmware colour flash; PiTunes logo only inside Chromium.
set -euo pipefail

BOOT_DIR="${PITUNES_BOOT_DIR:-}"

echo "Configuring kiosk boot (dark screen, single in-app splash)..."

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
      splash|quiet|logo.nologo|vt.global_cursor_default=*|systemd.show_status=*|systemd.log_level=*|loglevel=*)
        ;;
      console=tty1|console=tty2|console=tty3)
        ;;
      *)
        next="${next}${next:+ }${token}"
        ;;
    esac
  done
  next="${next}${next:+ }logo.nologo"
  next="${next}${next:+ }console=tty3"
  next="${next}${next:+ }quiet"
  next="${next}${next:+ }loglevel=3"
  next="${next}${next:+ }systemd.show_status=0"
  next="${next}${next:+ }systemd.log_level=err"
  next="${next}${next:+ }vt.global_cursor_default=0"
  printf '%s\n' "${next}" >"${CMDLINE_FILE}"
  echo "Updated ${CMDLINE_FILE}"
fi

if [ -n "${CONFIG_FILE}" ]; then
  for key in disable_splash boot_delay; do
    if grep -qE "^[#[:space:]]*${key}=" "${CONFIG_FILE}"; then
      case "${key}" in
        disable_splash) sed -i -E 's|^[#[:space:]]*disable_splash=.*|disable_splash=1|' "${CONFIG_FILE}" ;;
        boot_delay) sed -i -E 's|^[#[:space:]]*boot_delay=.*|boot_delay=0|' "${CONFIG_FILE}" ;;
      esac
    else
      case "${key}" in
        disable_splash) printf '\ndisable_splash=1\n' >>"${CONFIG_FILE}" ;;
        boot_delay) printf 'boot_delay=0\n' >>"${CONFIG_FILE}" ;;
      esac
    fi
  done
  if grep -qE '^[#[:space:]]*camera_auto_detect=' "${CONFIG_FILE}"; then
    sed -i -E 's|^[#[:space:]]*camera_auto_detect=.*|camera_auto_detect=0|' "${CONFIG_FILE}"
  else
    printf 'camera_auto_detect=0\n' >>"${CONFIG_FILE}"
  fi
  echo "Updated ${CONFIG_FILE}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl disable getty@tty1.service 2>/dev/null || true
  systemctl mask getty@tty1.service 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
fi

rm -f /etc/issue.d/IP.issue 2>/dev/null || true
printf '\n' >/etc/issue 2>/dev/null || true
printf '\n' >/etc/motd 2>/dev/null || true

mkdir -p /etc/lightdm/lightdm-gtk-greeter.conf.d
cat >/etc/lightdm/lightdm-gtk-greeter.conf.d/pitunes-kiosk.conf <<'EOF'
[greeter]
background=#08080f
user-background=false
hide-user-image=true
EOF

echo "Kiosk boot configured: no firmware colour flash, dark screen until Chromium splash."
