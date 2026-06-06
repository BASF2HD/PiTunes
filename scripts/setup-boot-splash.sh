#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
THEME_SRC="${PROJECT_ROOT}/config/plymouth/echoflow"
THEME_DST="/usr/share/plymouth/themes/echoflow"

install -d -m 0755 "${THEME_DST}"
install -m 0644 "${THEME_SRC}/echoflow.plymouth" "${THEME_DST}/echoflow.plymouth"
install -m 0644 "${THEME_SRC}/echoflow.script" "${THEME_DST}/echoflow.script"

if command -v plymouth-set-default-theme >/dev/null 2>&1; then
  plymouth-set-default-theme echoflow >/dev/null 2>&1 || true
  if command -v update-initramfs >/dev/null 2>&1; then
    update-initramfs -u >/dev/null 2>&1 || true
  fi
fi

CMDLINE_FILE=""
for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
  if [ -f "${candidate}" ]; then
    CMDLINE_FILE="${candidate}"
    break
  fi
done

if [ -n "${CMDLINE_FILE}" ]; then
  current="$(tr '\n' ' ' <"${CMDLINE_FILE}" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  next=""
  for token in ${current}; do
    case "${token}" in
      console=tty1|quiet|splash|loglevel=*|logo.nologo|vt.global_cursor_default=*|plymouth.ignore-serial-consoles)
        ;;
      *)
        next="${next}${next:+ }${token}"
        ;;
    esac
  done
  next="${next} quiet splash loglevel=0 logo.nologo vt.global_cursor_default=0 plymouth.ignore-serial-consoles"
  printf '%s\n' "${next}" >"${CMDLINE_FILE}"
fi
