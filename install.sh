#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="echoflow"
INSTALL_DIR="/opt/${PROJECT_NAME}"
CONFIG_DIR="/etc/${PROJECT_NAME}"
CACHE_DIR="/var/cache/${PROJECT_NAME}"
SERVICE_USER="echoflow"
HOSTNAME="echoflow"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root: sudo ./install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing packages..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  mpd mpc nginx avahi-daemon python3 python3-pil python3-mutagen alsa-utils \
  dosfstools exfatprogs ntfs-3g

echo "Creating service user and directories..."
echo "Setting hostname to ${HOSTNAME} for mDNS..."
if command -v hostnamectl >/dev/null 2>&1; then
  hostnamectl set-hostname "${HOSTNAME}" || true
else
  echo "${HOSTNAME}" >/etc/hostname
fi
if grep -qE '^127\.0\.1\.1[[:space:]]+' /etc/hosts; then
  sed -i "s/^127\\.0\\.1\\.1.*/127.0.1.1\t${HOSTNAME}/" /etc/hosts
else
  printf '127.0.1.1\t%s\n' "${HOSTNAME}" >>/etc/hosts
fi

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
usermod -aG audio "${SERVICE_USER}" || true
usermod -aG audio mpd || true

install -d -m 0755 "${INSTALL_DIR}"
install -d -m 0755 "${CONFIG_DIR}"
install -d -m 0755 "${CACHE_DIR}/art"
install -d -m 0775 -o mpd -g audio /mnt/music
install -d -m 0755 /var/lib/mpd/playlists

echo "Copying application files..."
cp -a "${SCRIPT_DIR}/backend" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/frontend" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/scripts" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/config" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/docs" "${INSTALL_DIR}/"
install -m 0755 "${SCRIPT_DIR}/configure-mpd.sh" "${INSTALL_DIR}/configure-mpd.sh"
install -m 0644 "${SCRIPT_DIR}/backend/echoflow-api.env" "${CONFIG_DIR}/echoflow-api.env"
if [ ! -f "${CONFIG_DIR}/settings.json" ]; then
  install -m 0644 "${SCRIPT_DIR}/config/settings.json" "${CONFIG_DIR}/settings.json"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_DIR}" "${CACHE_DIR}"
chown -R root:root "${INSTALL_DIR}"
chmod +x "${INSTALL_DIR}/scripts/"*.sh

echo "Configuring MPD..."
"${SCRIPT_DIR}/configure-mpd.sh" "${1:-auto}"

echo "Installing nginx and systemd units..."
install -m 0644 "${SCRIPT_DIR}/nginx/echoflow.conf" /etc/nginx/sites-available/echoflow.conf
ln -sf /etc/nginx/sites-available/echoflow.conf /etc/nginx/sites-enabled/echoflow.conf
rm -f /etc/nginx/sites-enabled/default

install -m 0644 "${SCRIPT_DIR}/systemd/echoflow-api.service" /etc/systemd/system/echoflow-api.service
install -m 0644 "${SCRIPT_DIR}/systemd/echoflow-mount.service" /etc/systemd/system/echoflow-mount.service
install -m 0644 "${SCRIPT_DIR}/systemd/echoflow-startup-scan.service" /etc/systemd/system/echoflow-startup-scan.service

systemctl daemon-reload
systemctl enable avahi-daemon
systemctl enable echoflow-mount.service
systemctl enable mpd
systemctl enable nginx
systemctl enable echoflow-api.service
systemctl enable echoflow-startup-scan.service

echo "Starting services..."
systemctl restart avahi-daemon
systemctl restart echoflow-mount.service || true
systemctl restart mpd
systemctl restart echoflow-api.service
nginx -t
systemctl restart nginx
systemctl start echoflow-startup-scan.service || true

echo
echo "Install complete."
echo "Open http://echoflow.local or the Pi IP address in a browser."
echo "Put music on a USB drive labelled MUSIC, or copy music into /mnt/music."
