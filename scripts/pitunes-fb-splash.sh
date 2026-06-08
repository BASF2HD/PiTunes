#!/usr/bin/env bash
# Paint static PiTunes logo to the Linux framebuffer (no Plymouth, no image viewers).
set -euo pipefail

INSTALL_DIR="${PITUNES_INSTALL_DIR:-/opt/pitunes}"
BOOT_DIR="${INSTALL_DIR}/config/boot"
BUILD_SCRIPT="${INSTALL_DIR}/scripts/build-boot-fb-splash.py"

if [ ! -e /dev/fb0 ]; then
  exit 0
fi

# Keep boot messages off the HDMI framebuffer.
chvt 1 >/dev/null 2>&1 || true

if [ -r /sys/class/graphics/fb0/virtual_size ] && [ -r /sys/class/graphics/fb0/bits_per_pixel ]; then
  width="$(tr -d ' \n' </sys/class/graphics/fb0/virtual_size | cut -d, -f1)"
  height="$(tr -d ' \n' </sys/class/graphics/fb0/virtual_size | cut -d, -f2)"
  bpp="$(tr -d ' \n' </sys/class/graphics/fb0/bits_per_pixel)"
  suffix="32"
  [ "${bpp}" = "16" ] && suffix="16"
  exact="${BOOT_DIR}/splash-${width}x${height}-${suffix}.raw"
  if [ -f "${exact}" ]; then
    cat "${exact}" >/dev/fb0
    exit 0
  fi
fi

if [ -f "${BUILD_SCRIPT}" ]; then
  python3 "${BUILD_SCRIPT}" --paint --boot-dir "${BOOT_DIR}"
fi
