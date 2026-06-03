#!/usr/bin/env bash
# Optional HDMI kiosk: Chromium fullscreen on http://127.0.0.1 (EchoFlow via nginx).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

KIOSK_USER="${KIOSK_USER:-pi}"

echo "Installing minimal kiosk stack..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  xserver-xorg x11-xserver-utils xinit openbox chromium lightdm

install -d -m 0755 "/home/${KIOSK_USER}/.config/openbox"
cat >"/home/${KIOSK_USER}/.config/openbox/autostart" <<'EOF'
#!/bin/bash
xset s off
xset -dpms
xset s noblank
while ! curl -sf http://127.0.0.1/api/health >/dev/null 2>&1; do
  sleep 2
done
exec chromium --noerrdialogs --disable-infobars --kiosk http://127.0.0.1/
EOF
chmod +x "/home/${KIOSK_USER}/.config/openbox/autostart"
chown -R "${KIOSK_USER}:${KIOSK_USER}" "/home/${KIOSK_USER}/.config"

mkdir -p /etc/lightdm/lightdm.conf.d
cat >/etc/lightdm/lightdm.conf.d/50-echoflow-kiosk.conf <<EOF
[Seat:*]
autologin-user=${KIOSK_USER}
autologin-user-timeout=0
user-session=openbox
EOF

systemctl enable lightdm
systemctl set-default graphical.target 2>/dev/null || true

echo "Kiosk enabled for user ${KIOSK_USER} (graphical target + Chromium)."
