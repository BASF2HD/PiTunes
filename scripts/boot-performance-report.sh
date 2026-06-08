#!/usr/bin/env bash
# Collect boot timing data on a running PiTunes appliance.
set -euo pipefail

REPORT_DIR="${1:-/var/log/pitunes}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${REPORT_DIR}/boot-performance-${STAMP}.txt"

mkdir -p "${REPORT_DIR}"

{
  echo "PiTunes boot performance report"
  echo "Generated (UTC): ${STAMP}"
  echo "Hostname: $(hostname -f 2>/dev/null || hostname)"
  echo "Kernel: $(uname -r)"
  echo
  echo "=== systemd-analyze ==="
  systemd-analyze 2>/dev/null || echo "systemd-analyze unavailable"
  echo
  echo "=== systemd-analyze blame (top 40) ==="
  systemd-analyze blame 2>/dev/null | head -40 || true
  echo
  echo "=== systemd-analyze critical-chain ==="
  systemd-analyze critical-chain 2>/dev/null || true
  echo
  echo "=== enabled PiTunes units ==="
  systemctl list-unit-files --type=service --state=enabled 2>/dev/null | grep -E 'pitunes|mpd|nginx|lightdm|plymouth|bluetooth|shairport|avahi|smbd' || true
  echo
  echo "=== active blocking dependencies (display path) ==="
  systemctl show pitunes-display.service -p After -p Wants -p Requires -p ActiveState -p SubState 2>/dev/null || true
  systemctl show pitunes-api.service -p After -p Wants -p Requires -p ActiveState -p SubState 2>/dev/null || true
  systemctl show pitunes-hotspot.service -p After -p Before -p ActiveState -p SubState 2>/dev/null || true
  echo
  echo "=== cmdline.txt ==="
  for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    [ -f "${candidate}" ] || continue
    echo "${candidate}:"
    tr '\n' ' ' <"${candidate}"
    echo
  done
  echo
  echo "=== config.txt (splash-related) ==="
  for candidate in /boot/firmware/config.txt /boot/config.txt; do
    [ -f "${candidate}" ] || continue
    echo "${candidate}:"
    grep -E '^(disable_splash|auto_initramfs|disable_overscan|hdmi_' "${candidate}" 2>/dev/null || true
  done
} | tee "${REPORT}"

echo "Wrote ${REPORT}"
