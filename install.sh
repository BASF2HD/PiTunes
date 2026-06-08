#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="pitunes"
INSTALL_DIR="/opt/${PROJECT_NAME}"
CONFIG_DIR="/etc/${PROJECT_NAME}"
CACHE_DIR="/var/cache/${PROJECT_NAME}"
SERVICE_USER="pitunes"
HOSTNAME="pitunes"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root: sudo ./install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_BUILD="${PITUNES_IMAGE_BUILD:-0}"

echo "Installing packages..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  mpd mpc nginx avahi-daemon openssh-server python3 python3-pil python3-mutagen alsa-utils \
  samba \
  sudo bluetooth bluez shairport-sync avahi-utils \
  dosfstools exfatprogs ntfs-3g cifs-utils nfs-common curl \
  network-manager dnsmasq-base iw rfkill wpasupplicant unclutter
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bluez-alsa-utils bluez-tools pi-bluetooth
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nqptp || true

echo "Creating service user and directories..."
echo "Setting hostname to ${HOSTNAME} for mDNS..."
echo "${HOSTNAME}" >/etc/hostname
if command -v hostnamectl >/dev/null 2>&1; then
  hostnamectl set-hostname "${HOSTNAME}" || true
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
install -d -m 0775 -o mpd -g audio /var/lib/pitunes/music
install -d -m 0755 /var/lib/mpd/playlists

echo "Copying application files..."
cp -a "${SCRIPT_DIR}/backend" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/frontend" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/scripts" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/config" "${INSTALL_DIR}/"
cp -a "${SCRIPT_DIR}/docs" "${INSTALL_DIR}/"
install -m 0755 "${SCRIPT_DIR}/configure-mpd.sh" "${INSTALL_DIR}/configure-mpd.sh"
install -m 0644 "${SCRIPT_DIR}/backend/pitunes-api.env" "${CONFIG_DIR}/pitunes-api.env"
if [ ! -f "${CONFIG_DIR}/settings.json" ]; then
  install -m 0644 "${SCRIPT_DIR}/config/settings.json" "${CONFIG_DIR}/settings.json"
fi
if [ ! -f "${CONFIG_DIR}/wifi-hotspot.conf" ]; then
  install -m 0640 "${SCRIPT_DIR}/config/wifi-hotspot.conf" "${CONFIG_DIR}/wifi-hotspot.conf"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_DIR}" "${CACHE_DIR}"
chown -R root:root "${INSTALL_DIR}"
chmod +x "${INSTALL_DIR}/scripts/"*.sh
install -m 0644 "${SCRIPT_DIR}/config/pitunes-tmpfiles.conf" /usr/lib/tmpfiles.d/pitunes.conf
install -m 0644 "${SCRIPT_DIR}/config/smb.conf" /etc/samba/smb.conf
install -m 0644 "${SCRIPT_DIR}/config/avahi-smb.service" /etc/avahi/services/pitunes-smb.service
systemd-tmpfiles --create /usr/lib/tmpfiles.d/pitunes.conf
testparm -s /etc/samba/smb.conf >/dev/null

echo "Skipping custom boot splash for reliability."
echo "Configuring Bluetooth and AirPlay receiver names..."
"${INSTALL_DIR}/scripts/setup-wireless-audio.sh" all

SYSTEMCTL_BIN="$(command -v systemctl || true)"
if [ -n "${SYSTEMCTL_BIN}" ]; then
  echo "Configuring limited service-control sudo permissions..."
  {
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start ssh.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop ssh.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable ssh.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable ssh.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start ssh.socket"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop ssh.socket"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable ssh.socket"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable ssh.socket"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start bluetooth.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop bluetooth.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable bluetooth.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable bluetooth.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start bluealsa.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop bluealsa.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart bluealsa.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable bluealsa.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable bluealsa.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start hciuart.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop hciuart.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart hciuart.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable hciuart.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable hciuart.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start shairport-sync.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop shairport-sync.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable shairport-sync.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable shairport-sync.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start nqptp.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop nqptp.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart nqptp.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable nqptp.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable nqptp.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start lightdm.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop lightdm.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable lightdm.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable lightdm.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/wifi-hotspot.sh start"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/wifi-hotspot.sh stop"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/wifi-hotspot.sh scan"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/wifi-hotspot.sh restart-station"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/setup-wifi.sh *"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/nmcli -s -g 802-11-wireless-security.psk connection show PiTunes-WiFi"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /usr/bin/nmcli connection up PiTunes-WiFi ifname wlan0"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/mount-music-drive.sh"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/setup-wireless-audio.sh bluetooth"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /bin/bash ${INSTALL_DIR}/scripts/setup-wireless-audio.sh airplay"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart pitunes-mount.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-bluetooth-discoverable.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart pitunes-bluetooth-discoverable.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop pitunes-bluetooth-discoverable.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable pitunes-bluetooth-discoverable.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable pitunes-bluetooth-discoverable.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-bt-agent.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart pitunes-bt-agent.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop pitunes-bt-agent.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable pitunes-bt-agent.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable pitunes-bt-agent.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start pitunes-bluealsa-aplay.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart pitunes-bluealsa-aplay.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} stop pitunes-bluealsa-aplay.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} enable pitunes-bluealsa-aplay.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} disable pitunes-bluealsa-aplay.service"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /sbin/iw dev wlan0 scan"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /sbin/iw dev wlan0 scan ap-force"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /sbin/reboot"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /sbin/poweroff"
    echo "${SERVICE_USER} ALL=(root) NOPASSWD: /sbin/shutdown"
  } >/etc/sudoers.d/pitunes-services
  chmod 0440 /etc/sudoers.d/pitunes-services
fi

echo "Configuring MPD..."
"${SCRIPT_DIR}/configure-mpd.sh" "${1:-auto}"

echo "Installing nginx and systemd units..."
install -m 0644 "${SCRIPT_DIR}/nginx/pitunes.conf" /etc/nginx/sites-available/pitunes.conf
ln -sf /etc/nginx/sites-available/pitunes.conf /etc/nginx/sites-enabled/pitunes.conf
rm -f /etc/nginx/sites-enabled/default

install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-api.service" /etc/systemd/system/pitunes-api.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-firstboot.service" /etc/systemd/system/pitunes-firstboot.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-mount.service" /etc/systemd/system/pitunes-mount.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-storage-refresh.service" /etc/systemd/system/pitunes-storage-refresh.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-bluetooth-discoverable.service" /etc/systemd/system/pitunes-bluetooth-discoverable.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-bt-agent.service" /etc/systemd/system/pitunes-bt-agent.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-bluealsa-aplay.service" /etc/systemd/system/pitunes-bluealsa-aplay.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-startup-scan.service" /etc/systemd/system/pitunes-startup-scan.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-hotspot.service" /etc/systemd/system/pitunes-hotspot.service
install -m 0644 "${SCRIPT_DIR}/systemd/pitunes-display.service" /etc/systemd/system/pitunes-display.service
install -m 0644 "${SCRIPT_DIR}/config/99-pitunes-music.rules" /etc/udev/rules.d/99-pitunes-music.rules

# NetworkManager exclusively owns Ethernet, WiFi station, and hotspot networking.
systemctl disable --now hostapd 2>/dev/null || true
systemctl disable --now dnsmasq 2>/dev/null || true
systemctl disable --now dhcpcd 2>/dev/null || true
systemctl enable NetworkManager.service

systemctl daemon-reload
udevadm control --reload-rules 2>/dev/null || true

echo "Validating required appliance services..."
for command in nmcli sshd bluetoothctl bt-agent bluealsa bluealsa-aplay shairport-sync avahi-browse smbd; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required appliance command is missing: ${command}" >&2
    exit 1
  fi
done
for unit in \
  NetworkManager.service ssh.service bluetooth.service bluealsa.service \
  shairport-sync.service avahi-daemon.service pitunes-api.service \
  smbd.service pitunes-display.service \
  pitunes-hotspot.service pitunes-firstboot.service \
  pitunes-bt-agent.service pitunes-bluealsa-aplay.service \
  pitunes-bluetooth-discoverable.service; do
  if ! systemctl cat "${unit}" >/dev/null 2>&1; then
    echo "Required appliance unit is missing: ${unit}" >&2
    exit 1
  fi
done

"${INSTALL_DIR}/scripts/setup-wireless-audio.sh" all
systemctl disable ssh.socket 2>/dev/null || true
systemctl unmask ssh.service 2>/dev/null || true
systemctl enable pitunes-firstboot.service
systemctl enable ssh.service
systemctl enable hciuart.service 2>/dev/null || true
systemctl enable bluetooth.service
systemctl disable bluealsa-aplay.service 2>/dev/null || true
systemctl enable bluealsa.service
systemctl enable pitunes-bluetooth-discoverable.service
systemctl enable pitunes-bt-agent.service
systemctl enable pitunes-bluealsa-aplay.service
systemctl enable nqptp.service 2>/dev/null || true
systemctl enable avahi-daemon
systemctl enable smbd.service
systemctl enable nmbd.service 2>/dev/null || true
systemctl enable shairport-sync.service
systemctl enable pitunes-mount.service
systemctl enable mpd
systemctl enable nginx
systemctl enable pitunes-api.service
systemctl enable pitunes-startup-scan.service
systemctl enable pitunes-hotspot.service
systemctl enable pitunes-display.service

if [ "${IMAGE_BUILD}" = "1" ]; then
  echo "Image build mode: services enabled but not started in chroot."
else
  echo "Starting services..."
  systemctl restart avahi-daemon
  testparm -s /etc/samba/smb.conf >/dev/null
  systemctl restart smbd.service
  systemctl restart nmbd.service 2>/dev/null || true
  systemctl restart pitunes-mount.service || true
  systemctl restart mpd
  systemctl restart pitunes-api.service
  nginx -t
  systemctl restart nginx
  systemctl restart pitunes-display.service || true
  systemctl start pitunes-startup-scan.service || true
  systemctl start pitunes-hotspot.service || true
fi

echo
echo "Install complete."
echo "Open http://pitunes.local or the Pi IP address in a browser."
echo "No WiFi yet? Connect to hotspot SSID PiTunes (see /etc/pitunes/wifi-hotspot.conf), then http://172.24.1.1"
echo "Put music on a USB drive labelled MUSIC, or copy music into /mnt/music."
if [ "${IMAGE_BUILD}" = "1" ]; then
  echo "Flash this image, boot the Pi, then open http://pitunes.local"
fi
