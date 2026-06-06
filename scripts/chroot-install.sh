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
  if id "${LOGIN_USER}" >/dev/null 2>&1; then
    return
  fi

  local groups=()
  local group
  for group in sudo audio video input render netdev; do
    if getent group "${group}" >/dev/null 2>&1; then
      groups+=("${group}")
    fi
  done

  if [ "${#groups[@]}" -gt 0 ]; then
    useradd -m -s /bin/bash -G "$(IFS=,; echo "${groups[*]}")" "${LOGIN_USER}"
  else
    useradd -m -s /bin/bash "${LOGIN_USER}"
  fi
  printf '%s:%s\n' "${LOGIN_USER}" "${LOGIN_PASSWORD}" | chpasswd
  echo "Created image login user ${LOGIN_USER}; change the default password after first boot."
}

ensure_login_user

echo "Running EchoFlow install in image chroot (${AUDIO_MODE})..."
./install.sh "${AUDIO_MODE}"

if [ "${ECHOFLOW_KIOSK:-0}" = "1" ] && [ -f "${SRC}/scripts/setup-kiosk.sh" ]; then
  echo "Enabling optional kiosk mode..."
  "${SRC}/scripts/setup-kiosk.sh"
fi

if [ -f "${SRC}/scripts/golden-image-cleanup.sh" ]; then
  ECHOFLOW_KEEP_WIFI="${ECHOFLOW_KEEP_WIFI:-0}" "${SRC}/scripts/golden-image-cleanup.sh"
fi

echo "Chroot install finished."
