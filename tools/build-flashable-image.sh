#!/usr/bin/env bash
# Build a flashable Raspberry Pi .img with Raspberry Pi OS Lite + PiTunes preinstalled.
# Requires: Debian/Ubuntu Linux (or WSL2 with systemd disabled for loop mounts).
#
# Usage:
#   sudo ./tools/build-flashable-image.sh
#   sudo ./tools/build-flashable-image.sh --arch arm64 --output pitunes-arm64.img
#   sudo ./tools/build-flashable-image.sh --arch armhf --kiosk
#   sudo ./tools/build-flashable-image.sh --base-image /path/to/raspios.img
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=image/build.env
source "${ROOT_DIR}/image/build.env"

ARCH="armhf"
OUTPUT=""
BASE_IMAGE=""
SKIP_DOWNLOAD=0
ENABLE_KIOSK=1
AUDIO_MODE="auto"
EXTRA_SPACE="${PITUNES_IMAGE_EXTRA_SPACE:-4G}"
WORK_DIR="${ROOT_DIR}/image/work"
CACHE_DIR="${ROOT_DIR}/image/cache"

usage() {
  cat <<EOF
Build PiTunes flashable Raspberry Pi image (OS + client).

Usage: sudo $0 [options]

  --arch armhf|arm64   Base OS architecture (default: armhf for Pi 3 / Zero 2 W)
  --output PATH        Output .img path (default: image/out/pitunes-<arch>.img)
  --base-image PATH    Use an existing Raspberry Pi OS .img instead of downloading
  --skip-download      Use cached base image in image/cache/
  --kiosk              Install HDMI kiosk (default)
  --no-kiosk           Build a headless image without the local display
  --audio MODE         Passed to install.sh / configure-mpd (default: auto)
  --extra-space SIZE   Grow working image before install (default: ${EXTRA_SPACE}, use 0 to disable)
  -h, --help           Show this help

Requires Linux with: losetup, partprobe, mount, rsync, chroot, wget, xz, parted, resize2fs.
On Debian/Ubuntu: apt install qemu-user-static binfmt-support kpartx rsync wget xz-utils parted e2fsprogs

After build, flash with Raspberry Pi Imager or:
  xz -dk pitunes.img.xz && sudo dd if=pitunes.img of=/dev/sdX bs=4M status=progress conv=fsync

EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --arch)
      ARCH="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --base-image)
      BASE_IMAGE="$2"
      shift 2
      ;;
    --skip-download)
      SKIP_DOWNLOAD=1
      shift
      ;;
    --kiosk)
      ENABLE_KIOSK=1
      shift
      ;;
    --no-kiosk)
      ENABLE_KIOSK=0
      shift
      ;;
    --audio)
      AUDIO_MODE="$2"
      shift 2
      ;;
    --extra-space)
      EXTRA_SPACE="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (loop mounts and chroot): sudo $0"
  exit 1
fi

case "${ARCH}" in
  armhf)
    BASE_URL="${RPIOS_LITE_ARMHF_URL}"
    BASE_NAME="${RPIOS_LITE_ARMHF_NAME}"
    QEMU_BIN="qemu-arm-static"
    ;;
  arm64)
    BASE_URL="${RPIOS_LITE_ARM64_URL}"
    BASE_NAME="${RPIOS_LITE_ARM64_NAME}"
    QEMU_BIN="qemu-aarch64-static"
    ;;
  *)
    echo "Unsupported arch: ${ARCH} (use armhf or arm64)"
    exit 1
    ;;
esac

if [ -z "${OUTPUT}" ]; then
  mkdir -p "${ROOT_DIR}/image/out"
  OUTPUT="${ROOT_DIR}/image/out/${IMAGE_BASENAME}-${ARCH}.img"
fi

mkdir -p "${CACHE_DIR}" "${WORK_DIR}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd losetup
require_cmd mount
require_cmd umount
require_cmd rsync
require_cmd chroot
require_cmd wget
require_cmd xz
require_cmd partprobe
require_cmd parted
require_cmd resize2fs
require_cmd e2fsck
require_cmd truncate

if ! command -v "${QEMU_BIN}" >/dev/null 2>&1; then
  echo "Missing ${QEMU_BIN}. Install: apt install qemu-user-static binfmt-support"
  exit 1
fi

resolve_base_image() {
  if [ -n "${BASE_IMAGE}" ]; then
    if [ ! -f "${BASE_IMAGE}" ]; then
      echo "Base image not found: ${BASE_IMAGE}" >&2
      exit 1
    fi
    echo "${BASE_IMAGE}"
    return
  fi

  local cached="${CACHE_DIR}/${BASE_NAME}"
  local cached_xz="${cached}.xz"

  if [ -f "${cached}" ]; then
    echo "${cached}"
    return
  fi

  if [ "${SKIP_DOWNLOAD}" = "1" ] && [ ! -f "${cached_xz}" ]; then
    echo "No cached image at ${cached_xz} (use --skip-download only after first download)" >&2
    exit 1
  fi

  if [ ! -f "${cached_xz}" ]; then
    echo "Downloading Raspberry Pi OS Lite (${ARCH})..." >&2
    echo "URL: ${BASE_URL}" >&2
    wget -O "${cached_xz}" "${BASE_URL}"
  fi

  echo "Extracting ${cached_xz}..." >&2
  xz -dk "${cached_xz}"
  echo "${cached}"
}

partition_path() {
  local loop="$1"
  local part_num="$2"
  if [ -b "${loop}p${part_num}" ]; then
    echo "${loop}p${part_num}"
  elif [ -b "${loop}${part_num}" ]; then
    echo "${loop}${part_num}"
  else
    echo ""
  fi
}

cleanup_mounts() {
  umount -lf "${WORK_DIR}/root/dev/pts" 2>/dev/null || true
  umount -lf "${WORK_DIR}/root/dev" 2>/dev/null || true
  umount -lf "${WORK_DIR}/root/proc" 2>/dev/null || true
  umount -lf "${WORK_DIR}/root/sys" 2>/dev/null || true
  if [ -n "${BOOT_BIND_TARGET:-}" ]; then
    umount -lf "${BOOT_BIND_TARGET}" 2>/dev/null || true
  fi
  umount -lf "${WORK_DIR}/root/tmp/pitunes-src" 2>/dev/null || true
  umount -lf "${WORK_DIR}/root" 2>/dev/null || true
  umount -lf "${WORK_DIR}/boot" 2>/dev/null || true
  if [ -n "${LOOP_DEV:-}" ] && losetup "${LOOP_DEV}" >/dev/null 2>&1; then
    losetup -d "${LOOP_DEV}" 2>/dev/null || true
  fi
}

trap cleanup_mounts EXIT

BASE_IMG="$(resolve_base_image)"
WORK_IMG="${WORK_DIR}/build-root.img"

echo "Preparing work image..."
cp --reflink=auto "${BASE_IMG}" "${WORK_IMG}" 2>/dev/null || cp "${BASE_IMG}" "${WORK_IMG}"
if [ "${EXTRA_SPACE}" != "0" ]; then
  echo "Growing work image by ${EXTRA_SPACE} for package installation..."
  truncate -s "+${EXTRA_SPACE}" "${WORK_IMG}"
fi

echo "Attaching loop device..."
LOOP_DEV="$(losetup -Pf --show "${WORK_IMG}")"
partprobe "${LOOP_DEV}" 2>/dev/null || true
sleep 2

BOOT_PART="$(partition_path "${LOOP_DEV}" 1)"
ROOT_PART="$(partition_path "${LOOP_DEV}" 2)"

if [ -z "${BOOT_PART}" ] || [ -z "${ROOT_PART}" ]; then
  echo "Could not find boot/root partitions on ${LOOP_DEV}"
  lsblk "${LOOP_DEV}"
  exit 1
fi

if [ "${EXTRA_SPACE}" != "0" ]; then
  echo "Expanding root partition and filesystem..."
  parted -s "${LOOP_DEV}" resizepart 2 100%
  partprobe "${LOOP_DEV}" 2>/dev/null || true
  losetup -c "${LOOP_DEV}" 2>/dev/null || true
  sleep 2
  ROOT_PART="$(partition_path "${LOOP_DEV}" 2)"
  e2fsck -fy "${ROOT_PART}"
  resize2fs "${ROOT_PART}"
fi

mkdir -p "${WORK_DIR}/boot" "${WORK_DIR}/root"
mount "${BOOT_PART}" "${WORK_DIR}/boot"
mount "${ROOT_PART}" "${WORK_DIR}/root"

echo "Enabling SSH on first boot (boot/ssh)..."
touch "${WORK_DIR}/boot/ssh"

echo "Copying PiTunes source into rootfs..."
mkdir -p "${WORK_DIR}/root/tmp/pitunes-src"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'image/work' \
  --exclude 'image/cache' \
  --exclude 'image/out' \
  "${ROOT_DIR}/" "${WORK_DIR}/root/tmp/pitunes-src/"

echo "Installing qemu for chroot..."
cp -f "/usr/bin/${QEMU_BIN}" "${WORK_DIR}/root/usr/bin/${QEMU_BIN}"
chmod +x "${WORK_DIR}/root/usr/bin/${QEMU_BIN}"

mount --bind /dev "${WORK_DIR}/root/dev"
mount --bind /dev/pts "${WORK_DIR}/root/dev/pts"
mount -t proc proc "${WORK_DIR}/root/proc"
mount -t sysfs sysfs "${WORK_DIR}/root/sys"
if [ -d "${WORK_DIR}/root/boot/firmware" ]; then
  BOOT_BIND_TARGET="${WORK_DIR}/root/boot/firmware"
else
  BOOT_BIND_TARGET="${WORK_DIR}/root/boot"
fi
mkdir -p "${BOOT_BIND_TARGET}"
mount --bind "${WORK_DIR}/boot" "${BOOT_BIND_TARGET}"

export PITUNES_KIOSK="${ENABLE_KIOSK}"
export PITUNES_KEEP_WIFI=0
PITUNES_INSTALL_COMMIT="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || true)"

echo "Running PiTunes install inside chroot..."
chroot "${WORK_DIR}/root" /bin/bash -lc \
  "export PITUNES_IMAGE_BUILD=1 PITUNES_KIOSK=${ENABLE_KIOSK} PITUNES_INSTALL_COMMIT='${PITUNES_INSTALL_COMMIT}'; /tmp/pitunes-src/tools/chroot-install.sh /tmp/pitunes-src ${AUDIO_MODE}"

echo "Validating image appliance wiring..."
for unit in \
  NetworkManager.service ssh.service userconfig.service bluetooth.service \
  bluealsa.service pitunes-bt-agent.service pitunes-bluealsa-aplay.service \
  pitunes-bluetooth-discoverable.service avahi-daemon.service \
  shairport-sync.service nginx.service pitunes-api.service \
  pitunes-firstboot.service pitunes-hotspot.service; do
  chroot "${WORK_DIR}/root" systemctl is-enabled --quiet "${unit}"
done
if [ "${ENABLE_KIOSK}" = "1" ]; then
  chroot "${WORK_DIR}/root" systemctl is-enabled --quiet lightdm.service
  [ "$(chroot "${WORK_DIR}/root" systemctl get-default)" = "graphical.target" ]
fi
[ -s "${BOOT_BIND_TARGET}/userconf.txt" ]
[ -s "${WORK_DIR}/root/etc/ssh/sshd_config.d/20-pitunes.conf" ]
[ -s "${WORK_DIR}/root/usr/lib/tmpfiles.d/pitunes.conf" ]

echo "Recording image metadata..."
cat >"${WORK_DIR}/root/etc/pitunes-image.json" <<EOF
{
  "product": "PiTunes",
  "arch": "${ARCH}",
  "raspios_release": "${RPIOS_RELEASE}",
  "kiosk": ${ENABLE_KIOSK}
}
EOF
rm -f "${WORK_DIR}/root/usr/bin/${QEMU_BIN}"

umount "${WORK_DIR}/root/tmp/pitunes-src" 2>/dev/null || true
umount "${WORK_DIR}/root/dev/pts"
umount "${WORK_DIR}/root/dev"
umount "${WORK_DIR}/root/proc"
umount "${WORK_DIR}/root/sys"
umount "${BOOT_BIND_TARGET}"
umount "${WORK_DIR}/root"
umount "${WORK_DIR}/boot"
losetup -d "${LOOP_DEV}"
LOOP_DEV=""
trap - EXIT

echo "Writing final image to ${OUTPUT}..."
mkdir -p "$(dirname "${OUTPUT}")"
mv -f "${WORK_IMG}" "${OUTPUT}"
sync

if command -v pishrink.sh >/dev/null 2>&1; then
  echo "Shrinking image with PiShrink..."
  pishrink.sh "${OUTPUT}"
fi

if [ -f "${OUTPUT}.xz" ]; then
  rm -f "${OUTPUT}.xz"
fi
IMAGE_SIZE="$(stat -c %s "${OUTPUT}")"
if [ $((IMAGE_SIZE % 512)) -ne 0 ]; then
  echo "Image size ${IMAGE_SIZE} is not a multiple of 512 bytes." >&2
  exit 1
fi
echo "Compressing (this may take several minutes)..."
xz -T0 -9 -k -f "${OUTPUT}"
xz -t "${OUTPUT}.xz"

cat <<EOF

Done.

  Image:      ${OUTPUT}
  Compressed: ${OUTPUT}.xz

Flash with Raspberry Pi Imager (Use custom) or:

  xz -dk $(basename "${OUTPUT}").xz
  sudo dd if=$(basename "${OUTPUT}") of=/dev/sdX bs=4M status=progress conv=fsync

Boot the Pi, then open:

  http://pitunes.local

Publish to GitHub Releases:

  ./tools/publish-image-release.sh v1.3.0 ${OUTPUT}.xz

EOF
