#!/usr/bin/env bash
# PiTunes local HDMI/touchscreen display: Chromium fullscreen on http://127.0.0.1.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

KIOSK_USER="${KIOSK_USER:-pi}"

echo "Installing minimal kiosk stack..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  xserver-xorg x11-xserver-utils xinit openbox chromium lightdm feh accountsservice

if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  echo "Kiosk user does not exist: ${KIOSK_USER}" >&2
  exit 1
fi
for group in video input render autologin nopasswdlogin; do
  getent group "${group}" >/dev/null 2>&1 && usermod -aG "${group}" "${KIOSK_USER}"
done

install -d -m 0755 "/home/${KIOSK_USER}/.config/openbox"
cat >"/home/${KIOSK_USER}/.config/openbox/autostart" <<'EOF'
#!/bin/bash
export DISPLAY="${DISPLAY:-:0}"
xsetroot -solid '#08080f' 2>/dev/null || true
if ! pgrep -f "/opt/pitunes/scripts/pitunes-kiosk-launch.sh" >/dev/null \
   && ! pgrep -x chromium >/dev/null \
   && ! pgrep -x chromium-browser >/dev/null; then
  /opt/pitunes/scripts/pitunes-kiosk-launch.sh &
fi
while true; do sleep 3600; done
EOF
chmod +x "/home/${KIOSK_USER}/.config/openbox/autostart"
chown -R "${KIOSK_USER}:${KIOSK_USER}" "/home/${KIOSK_USER}/.config"

mkdir -p /etc/lightdm/lightdm.conf.d
cat >/etc/lightdm/lightdm.conf.d/50-pitunes-kiosk.conf <<EOF
[Seat:*]
autologin-user=${KIOSK_USER}
autologin-user-timeout=0
user-session=openbox
EOF

systemctl enable lightdm
if systemctl cat pitunes-display.service >/dev/null 2>&1; then
  systemctl disable pitunes-display.service 2>/dev/null || true
fi
systemctl set-default graphical.target 2>/dev/null || true

echo "Kiosk enabled for user ${KIOSK_USER} (graphical target + PiTunes display service)."
