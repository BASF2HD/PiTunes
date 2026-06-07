#!/usr/bin/env bash
# EchoFlow local HDMI/touchscreen display: Chromium fullscreen on http://127.0.0.1.
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
xset s off
xset -dpms
xset s noblank
while ! curl -sf http://127.0.0.1/api/health >/dev/null 2>&1; do
  sleep 2
done
PROFILE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/echoflow-kiosk-chromium"
mkdir -p "${PROFILE_DIR}"
rm -f "${PROFILE_DIR}"/Singleton*
CHROMIUM="$(command -v chromium-browser || command -v chromium)"
exec "${CHROMIUM}" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --kiosk http://127.0.0.1/
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
