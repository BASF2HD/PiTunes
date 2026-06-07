#!/usr/bin/env bash
# Run inside the mounted Raspberry Pi OS root (build host calls via chroot).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export ECHOFLOW_IMAGE_BUILD=1

SRC="${1:-/tmp/echoflow-src}"
AUDIO_MODE="${2:-auto}"
LOGIN_USER="${ECHOFLOW_LOGIN_USER:-pi}"
LOGIN_PASSWORD="${ECHOFLOW_LOGIN_PASSWORD:-echoflow}"

if [ ! -f "${SRC}/install.sh" ]; then
  echo "EchoFlow source not found at ${SRC}"
  exit 1
fi

cd "${SRC}"
chmod +x install.sh configure-mpd.sh scripts/*.sh 2>/dev/null || true

ensure_login_user() {
  local groups=()
  local group
  for group in sudo audio video input render netdev; do
    if getent group "${group}" >/dev/null 2>&1; then
      groups+=("${group}")
    fi
  done

  if ! id "${LOGIN_USER}" >/dev/null 2>&1; then
    if [ "${#groups[@]}" -gt 0 ]; then
      useradd -m -s /bin/bash -G "$(IFS=,; echo "${groups[*]}")" "${LOGIN_USER}"
    else
      useradd -m -s /bin/bash "${LOGIN_USER}"
    fi
  elif [ "${#groups[@]}" -gt 0 ]; then
    usermod -aG "$(IFS=,; echo "${groups[*]}")" "${LOGIN_USER}"
  fi
  printf '%s:%s\n' "${LOGIN_USER}" "${LOGIN_PASSWORD}" | chpasswd
  passwd -u "${LOGIN_USER}" >/dev/null 2>&1 || true
  echo "Configured image login user ${LOGIN_USER}; change the default password after first boot."
}

ensure_login_user

# Provide Raspberry Pi OS's supported noninteractive userconf input. Its
# service consumes this on first boot instead of opening the console wizard.
FWLOC="/boot"
if [ -x /usr/lib/raspberrypi-sys-mods/get_fw_loc ]; then
  FWLOC="$(/usr/lib/raspberrypi-sys-mods/get_fw_loc 2>/dev/null || echo /boot)"
elif [ -d /boot/firmware ]; then
  FWLOC="/boot/firmware"
fi
[ -n "${FWLOC}" ] || FWLOC="/boot"
install -d -m 0755 "${FWLOC}"
LOGIN_HASH="$(getent shadow "${LOGIN_USER}" | cut -d: -f2)"
if [ -n "${LOGIN_HASH}" ]; then
  printf '%s:%s\n' "${LOGIN_USER}" "${LOGIN_HASH}" >"${FWLOC}/userconf.txt"
  chmod 0600 "${FWLOC}/userconf.txt"
fi
systemctl unmask userconfig.service 2>/dev/null || true
systemctl enable userconfig.service 2>/dev/null || true

install -d -m 0755 /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/20-echoflow.conf <<'EOF'
PasswordAuthentication yes
PermitRootLogin no
UsePAM yes
EOF

echo "Running EchoFlow install in image chroot (${AUDIO_MODE})..."
./install.sh "${AUDIO_MODE}"

if [ "${ECHOFLOW_KIOSK:-0}" = "1" ] && [ -f "${SRC}/scripts/setup-kiosk.sh" ]; then
  echo "Enabling local EchoFlow display..."
  "${SRC}/scripts/setup-kiosk.sh"
  systemctl cat lightdm.service >/dev/null
  [ "$(systemctl get-default)" = "graphical.target" ]
fi

if [ -f "${SRC}/scripts/golden-image-cleanup.sh" ]; then
  ECHOFLOW_KEEP_WIFI="${ECHOFLOW_KEEP_WIFI:-0}" "${SRC}/scripts/golden-image-cleanup.sh"
fi

echo "Chroot install finished."
