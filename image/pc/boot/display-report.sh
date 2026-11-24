#!/usr/bin/env bash
set -euo pipefail

directory=/boot/efi
report="${directory}/pitunes-display.log"
if ! mountpoint -q "${directory}"; then
  echo 'PiTunes display failed; the USB boot partition is unavailable for diagnostics.'
  exit 0
fi

temporary="$(mktemp "${directory}/.pitunes-display.XXXXXX")"
trap 'rm -f "${temporary}"' EXIT
{
  date -u
  uname -rm
  for field in sys_vendor product_name bios_version; do
    if [[ -r "/sys/class/dmi/id/${field}" ]]; then
      printf '%s: %s\n' "${field}" "$(< "/sys/class/dmi/id/${field}")"
    fi
  done
  printf '\nLightDM journal\n'
  journalctl -b -u lightdm.service -n 80 --no-pager || true
  printf '\nHardware and firmware messages\n'
  journalctl -b -k --no-pager | grep -Ei 'ACPI (BIOS )?Error|drm|fb0|vesa|i915|nouveau|radeon|b43' | tail -n 80 || true
  for log in /var/log/lightdm/{lightdm,x-0}.log{,.old} /var/log/Xorg.0.log{,.old}; do
    if [[ -r "${log}" ]]; then
      printf '\n%s\n' "${log}"
      tail -n 100 "${log}"
    fi
  done
} > "${temporary}"
mv -f "${temporary}" "${report}"
sync -f "${report}"
echo 'PiTunes display failed. Read pitunes-display.log on the PITUNES_EFI USB partition.'
echo 'With Ethernet connected, the web player may still be available at the PC IP address.'
