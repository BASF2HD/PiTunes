#!/usr/bin/env bash
# Build a persistent Intel PC USB disk image with Debian and PiTunes.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH=amd64
OUTPUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --arch) ARCH="${2:?Missing PC architecture}"; shift 2 ;;
    --output) OUTPUT="${2:?Missing output filename}"; shift 2 ;;
    --help) echo "Usage: sudo $0 [--arch amd64|i386] [--output output.img]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "${ARCH}" in
  amd64)
    SUITE=trixie
    KERNEL=linux-image-amd64
    EFI_TARGET=x86_64-efi
    EFI_PACKAGE=grub-efi-amd64-bin
    EFI_FILE=BOOTX64.EFI
    PC_FIRMWARE=(firmware-intel-graphics firmware-intel-misc firmware-intel-sound)
    ;;
  i386)
    SUITE=bookworm
    KERNEL=linux-image-686-pae
    EFI_TARGET=i386-efi
    EFI_PACKAGE=grub-efi-ia32-bin
    EFI_FILE=BOOTIA32.EFI
    PC_FIRMWARE=(firmware-misc-nonfree)
    ;;
  *) echo "Unsupported PC architecture: ${ARCH}" >&2; exit 2 ;;
esac
OUTPUT="${OUTPUT:-${ROOT}/image/out/pitunes-${ARCH}.img}"
[[ "${OUTPUT}" = *.img ]] || { echo "Output filename must end in .img." >&2; exit 2; }
if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ] || [ "$(id -u)" != "0" ]; then
  echo "Run as root on x86_64 Linux (a VM is supported)." >&2
  exit 1
fi
for command in debootstrap losetup sfdisk mkfs.ext4 mkfs.vfat blkid mount mountpoint umount patch rsync udevadm xz sha256sum; do
  command -v "${command}" >/dev/null || { echo "Missing build dependency: ${command}" >&2; exit 1; }
done

mkdir -p "$(dirname "${OUTPUT}")"
OUTPUT="$(cd "$(dirname "${OUTPUT}")" && pwd)/$(basename "${OUTPUT}")"
for path in "${OUTPUT}" "${OUTPUT}.xz" "${OUTPUT}.xz.sha256"; do
  if [ -e "${path}" ] || [ -L "${path}" ]; then
    echo "Output already exists: ${path}" >&2
    exit 1
  fi
done

WORK="$(mktemp -d "$(dirname "${OUTPUT}")/.pitunes-pc.XXXXXX")"
TARGET="${WORK}/root"
DISK="${WORK}/disk.img"
LOOP=""

unmount_image() {
  if mountpoint -q "${TARGET}"; then
    umount -R "${TARGET}" || return 1
  fi
  if [ -n "${LOOP}" ]; then
    losetup -d "${LOOP}" || return 1
    LOOP=""
  fi
}

cleanup() {
  if unmount_image; then
    rm -rf "${WORK}"
  else
    echo "Could not unmount image. Build files are still at ${WORK}." >&2
  fi
}
trap cleanup EXIT

mkdir "${TARGET}"
truncate -s 5G "${DISK}"
LOOP="$(losetup --find --show --partscan "${DISK}")"
sfdisk "${LOOP}" <<'EOF'
label: dos
start=2048, size=262144, type=ef, bootable
type=83
EOF
udevadm settle
ESP="${LOOP}p1"
SYSTEM="${LOOP}p2"
mkfs.vfat -F 32 -n PITUNES_EFI "${ESP}"
mkfs.ext4 -q -L PITUNES_OS "${SYSTEM}"
mount "${SYSTEM}" "${TARGET}"

debootstrap --arch="${ARCH}" --variant=minbase --include=ca-certificates,systemd-sysv \
  --components=main,non-free-firmware "${SUITE}" "${TARGET}" https://deb.debian.org/debian
cat >"${TARGET}/etc/apt/sources.list" <<EOF
deb https://deb.debian.org/debian ${SUITE} main non-free-firmware
deb https://deb.debian.org/debian ${SUITE}-updates main non-free-firmware
deb https://deb.debian.org/debian-security ${SUITE}-security main non-free-firmware
EOF

mkdir -p "${TARGET}/boot/efi"
mount "${ESP}" "${TARGET}/boot/efi"
mount --bind /dev "${TARGET}/dev"
mount --bind /dev/pts "${TARGET}/dev/pts"
mount -t proc proc "${TARGET}/proc"
mount -t sysfs sysfs "${TARGET}/sys"
mount -t tmpfs tmpfs "${TARGET}/run"
cat >"${TARGET}/etc/fstab" <<EOF
UUID=$(blkid -s UUID -o value "${SYSTEM}") / ext4 defaults,noatime 0 1
UUID=$(blkid -s UUID -o value "${ESP}") /boot/efi vfat umask=0077,nofail,x-systemd.device-timeout=5s 0 2
EOF

# Keep package post-install scripts from starting services inside the build chroot.
printf '#!/bin/sh\nexit 101\n' >"${TARGET}/usr/sbin/policy-rc.d"
chmod 0755 "${TARGET}/usr/sbin/policy-rc.d"
run() {
  chroot "${TARGET}" env DEBIAN_FRONTEND=noninteractive SYSTEMD_OFFLINE=1 "$@"
}
run apt-get update
run apt-get install -y --no-install-recommends "${KERNEL}" initramfs-tools e2fsprogs zstd \
  grub-pc-bin "${EFI_PACKAGE}" grub2-common iproute2 iputils-ping gawk wireless-regdb \
  "${PC_FIRMWARE[@]}" firmware-sof-signed \
  firmware-iwlwifi firmware-atheros firmware-realtek firmware-brcm80211 firmware-amd-graphics \
  xserver-xorg-video-fbdev xserver-xorg-video-vesa

SOURCE="${TARGET}/tmp/pitunes-src"
mkdir "${SOURCE}"
rsync -a --exclude='__pycache__' "${ROOT}"/{backend,config,frontend,nginx,scripts,systemd,install.sh,configure-mpd.sh} "${SOURCE}/"
for patch_file in runtime.patch render-on-demand.patch kiosk-readiness.patch; do
  patch --batch --forward --fuzz=0 -d "${SOURCE}" -p1 <"${ROOT}/image/pc/${patch_file}"
done
COMMIT="${PITUNES_INSTALL_COMMIT:-$(git -C "${ROOT}" rev-parse HEAD 2>/dev/null || true)}"
run env PITUNES_IMAGE_BUILD=1 PITUNES_INSTALL_COMMIT="${COMMIT}" /tmp/pitunes-src/install.sh

# A local kiosk account can autologin through LightDM and has no shell password or sudo group.
run useradd --create-home --shell /bin/bash --groups audio,netdev kiosk
run sed -i 's/^kiosk:!:/kiosk:*:/' /etc/shadow
run env KIOSK_USER=kiosk /tmp/pitunes-src/scripts/setup-kiosk.sh
run systemctl disable ssh.service
run systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
cat >"${TARGET}/etc/network/interfaces" <<'EOF'
auto lo
iface lo inet loopback
EOF

BOOT_SOURCE="${TARGET}/tmp/pitunes-pc-boot"
install -d "${BOOT_SOURCE}"
rsync -a "${ROOT}/image/pc/boot/" "${BOOT_SOURCE}/"
run bash /tmp/pitunes-pc-boot/configure.sh "${LOOP}" "${SYSTEM}" "${EFI_TARGET}"
rm -rf "${BOOT_SOURCE}"
printf 'PiTunes PC USB\nArchitecture: %s\nSource commit: %s\n' "${ARCH}" "${COMMIT:-unknown}" \
  >"${TARGET}/boot/efi/PITUNES-BUILD.txt"

for unit in nginx.service mpd.service pitunes-api.service lightdm.service NetworkManager.service; do
  run systemctl is-enabled --quiet "${unit}"
done
test -s "${TARGET}/boot/efi/EFI/BOOT/${EFI_FILE}"
test -s "${TARGET}/boot/grub/i386-pc/core.img"
test -s "${TARGET}/boot/grub/i386-pc/normal.mod"
test -s "${TARGET}/boot/grub/grub.cfg"
[ "$(cat "${TARGET}/etc/pitunes-pc-image")" = "${ARCH}" ]
[ "$(readlink "${TARGET}/etc/systemd/system/pitunes-update.service")" = /dev/null ]
run nginx -t
run /opt/pitunes/scripts/golden-image-cleanup.sh
ln -sf /etc/machine-id "${TARGET}/var/lib/dbus/machine-id"
rm -f "${TARGET}/usr/sbin/policy-rc.d"
sync
unmount_image

xz -T2 -3 -c "${DISK}" >"${WORK}/disk.img.xz"
xz -t "${WORK}/disk.img.xz"
mv "${DISK}" "${OUTPUT}"
mv "${WORK}/disk.img.xz" "${OUTPUT}.xz"
(cd "$(dirname "${OUTPUT}")" && sha256sum "$(basename "${OUTPUT}").xz" >"$(basename "${OUTPUT}").xz.sha256")
printf 'PC image: %s\n' "${OUTPUT}.xz"
