#!/usr/bin/env bash
set -euo pipefail

runtime="${RUNTIME_DIRECTORY:-/run/pitunes-pc-display}"
compat_conf="/etc/lightdm/lightdm.conf.d/90-pitunes-pc-compat.conf"

if [[ ! -e "${runtime}/tried-default" ]] && ! grep -Fqw 'pitunes.safe-graphics=1' /proc/cmdline; then
  touch "${runtime}/tried-default"
  rm -f "${compat_conf}"
  echo 'Starting PiTunes display with Xorg defaults.'
  exec /usr/sbin/lightdm
fi

driver=""
if [[ -c /dev/fb0 ]] && [[ ! -e "${runtime}/tried-fbdev" ]]; then
  touch "${runtime}/tried-fbdev"
  driver=fbdev
elif [[ ! -e "${runtime}/tried-vesa" ]]; then
  touch "${runtime}/tried-vesa"
  driver=vesa
else
  echo 'All PiTunes Xorg display fallbacks failed.' >&2
  exit 1
fi

cat > "${runtime}/xorg.conf" <<EOF
Section "Device"
    Identifier "PiTunes compatible graphics"
    Driver "${driver}"
EndSection
EOF
install -d /etc/lightdm/lightdm.conf.d
cat > "${compat_conf}" <<EOF
[Seat:*]
xserver-command=X -s 0 -dpms -config ${runtime}/xorg.conf
EOF
echo "Starting PiTunes display with the ${driver} compatibility driver."
exec /usr/sbin/lightdm
