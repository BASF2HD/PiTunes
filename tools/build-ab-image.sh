#!/usr/bin/env bash
# Convert a tested PiTunes image into a staging-only Raspberry Pi tryboot A/B image.
#
# This tool is intentionally separate from the normal image builder. Do not
# publish its output until the hardware test matrix in docs/AB_SYSTEM_UPDATES.md
# passes.
set -Eeuo pipefail

SOURCE_IMAGE=""
OUTPUT_IMAGE=""
PUBLIC_KEY=""
SLOT_SIZE_MIB="${PITUNES_AB_SLOT_SIZE_MIB:-5120}"
DATA_SIZE_MIB="${PITUNES_AB_DATA_SIZE_MIB:-2048}"
BOOT_SIZE_MIB="${PITUNES_AB_BOOT_SIZE_MIB:-512}"
START_MIB=4
WORK_DIR=""
SOURCE_LOOP=""
TARGET_LOOP=""

usage() {
  cat <<EOF
Build a staging PiTunes A/B image from an already tested PiTunes image.

Usage:
  sudo $0 --source image/out/pitunes-arm64.img \\
    --output image/out/pitunes-arm64-ab.img \\
    --public-key /secure/pitunes-system-update-public.pem

Options:
  --source PATH          Tested normal PiTunes .img
  --output PATH          New A/B .img output
  --public-key PATH      System-update public verification key
  --slot-size-mib N      Size of each root slot (default: ${SLOT_SIZE_MIB})
  --data-size-mib N      Shared persistent-data size (default: ${DATA_SIZE_MIB})
  --boot-size-mib N      Size of each boot slot (default: ${BOOT_SIZE_MIB})
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE_IMAGE="$2"; shift 2 ;;
    --output) OUTPUT_IMAGE="$2"; shift 2 ;;
    --public-key) PUBLIC_KEY="$2"; shift 2 ;;
    --slot-size-mib) SLOT_SIZE_MIB="$2"; shift 2 ;;
    --data-size-mib) DATA_SIZE_MIB="$2"; shift 2 ;;
    --boot-size-mib) BOOT_SIZE_MIB="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0" >&2; exit 1; }
[ -f "${SOURCE_IMAGE}" ] || { echo "Source image not found: ${SOURCE_IMAGE}" >&2; exit 1; }
[ -n "${OUTPUT_IMAGE}" ] || { echo "--output is required" >&2; exit 1; }
[ -s "${PUBLIC_KEY}" ] || { echo "Public key not found: ${PUBLIC_KEY}" >&2; exit 1; }
[[ "${SLOT_SIZE_MIB}" =~ ^[0-9]+$ ]] && [ "${SLOT_SIZE_MIB}" -ge 4096 ]
[[ "${DATA_SIZE_MIB}" =~ ^[0-9]+$ ]] && [ "${DATA_SIZE_MIB}" -ge 1024 ]
[[ "${BOOT_SIZE_MIB}" =~ ^[0-9]+$ ]] && [ "${BOOT_SIZE_MIB}" -ge 256 ]

for command in blkid losetup mkfs.ext4 mkfs.vfat mount mountpoint parted partprobe rsync truncate umount xz; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Missing required command: ${command}" >&2
    exit 1
  }
done

partition_path() {
  local loop="$1"
  local number="$2"
  if [ -b "${loop}p${number}" ]; then
    printf '%s\n' "${loop}p${number}"
  else
    printf '%s\n' "${loop}${number}"
  fi
}

partuuid() {
  blkid -s PARTUUID -o value "$1"
}

cleanup() {
  local mount
  for mount in target-data target-root-b target-root-a target-boot-b target-boot-a target-control source-root source-boot; do
    if [ -n "${WORK_DIR}" ] && mountpoint -q "${WORK_DIR}/${mount}" 2>/dev/null; then
      umount "${WORK_DIR}/${mount}" || true
    fi
  done
  [ -n "${TARGET_LOOP}" ] && losetup -d "${TARGET_LOOP}" 2>/dev/null || true
  [ -n "${SOURCE_LOOP}" ] && losetup -d "${SOURCE_LOOP}" 2>/dev/null || true
  [ -n "${WORK_DIR}" ] && rm -rf "${WORK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

WORK_DIR="$(mktemp -d /tmp/pitunes-ab-image.XXXXXX)"
mkdir -p "${WORK_DIR}"/{source-boot,source-root,target-control,target-boot-a,target-root-a,target-boot-b,target-root-b,target-data}

SOURCE_LOOP="$(losetup -Pf --show -r "${SOURCE_IMAGE}")"
partprobe "${SOURCE_LOOP}" 2>/dev/null || true
sleep 1
SOURCE_BOOT="$(partition_path "${SOURCE_LOOP}" 1)"
SOURCE_ROOT="$(partition_path "${SOURCE_LOOP}" 2)"
mount -o ro "${SOURCE_BOOT}" "${WORK_DIR}/source-boot"
mount -o ro "${SOURCE_ROOT}" "${WORK_DIR}/source-root"

TOTAL_MIB=$((START_MIB + (BOOT_SIZE_MIB * 3) + (SLOT_SIZE_MIB * 2) + DATA_SIZE_MIB + 64))
CONTROL_START="${START_MIB}"
CONTROL_END=$((CONTROL_START + BOOT_SIZE_MIB))
BOOT_A_END=$((CONTROL_END + BOOT_SIZE_MIB))
BOOT_B_END=$((BOOT_A_END + BOOT_SIZE_MIB))
ROOT_A_START=$((BOOT_B_END + 1))
ROOT_A_END=$((ROOT_A_START + SLOT_SIZE_MIB))
ROOT_B_START=$((ROOT_A_END + 1))
ROOT_B_END=$((ROOT_B_START + SLOT_SIZE_MIB))
DATA_START=$((ROOT_B_END + 1))

mkdir -p "$(dirname "${OUTPUT_IMAGE}")"
rm -f "${OUTPUT_IMAGE}" "${OUTPUT_IMAGE}.xz"
truncate -s "${TOTAL_MIB}MiB" "${OUTPUT_IMAGE}"
parted -s "${OUTPUT_IMAGE}" mklabel msdos
parted -s "${OUTPUT_IMAGE}" mkpart primary fat32 "${CONTROL_START}MiB" "${CONTROL_END}MiB"
parted -s "${OUTPUT_IMAGE}" mkpart primary fat32 "${CONTROL_END}MiB" "${BOOT_A_END}MiB"
parted -s "${OUTPUT_IMAGE}" mkpart primary fat32 "${BOOT_A_END}MiB" "${BOOT_B_END}MiB"
parted -s "${OUTPUT_IMAGE}" mkpart extended "${BOOT_B_END}MiB" 100%
parted -s "${OUTPUT_IMAGE}" mkpart logical ext4 "${ROOT_A_START}MiB" "${ROOT_A_END}MiB"
parted -s "${OUTPUT_IMAGE}" mkpart logical ext4 "${ROOT_B_START}MiB" "${ROOT_B_END}MiB"
parted -s "${OUTPUT_IMAGE}" mkpart logical ext4 "${DATA_START}MiB" 100%
parted -s "${OUTPUT_IMAGE}" set 1 boot on

TARGET_LOOP="$(losetup -Pf --show "${OUTPUT_IMAGE}")"
partprobe "${TARGET_LOOP}"
sleep 2
CONTROL="$(partition_path "${TARGET_LOOP}" 1)"
BOOT_A="$(partition_path "${TARGET_LOOP}" 2)"
BOOT_B="$(partition_path "${TARGET_LOOP}" 3)"
ROOT_A="$(partition_path "${TARGET_LOOP}" 5)"
ROOT_B="$(partition_path "${TARGET_LOOP}" 6)"
DATA="$(partition_path "${TARGET_LOOP}" 7)"

mkfs.vfat -F 32 -n PITUNES_CTL "${CONTROL}"
mkfs.vfat -F 32 -n PITUNES_A "${BOOT_A}"
mkfs.ext4 -F -L pitunes-root-a "${ROOT_A}"
mkfs.vfat -F 32 -n PITUNES_B "${BOOT_B}"
mkfs.ext4 -F -L pitunes-root-b "${ROOT_B}"
mkfs.ext4 -F -L pitunes-data "${DATA}"

mount "${CONTROL}" "${WORK_DIR}/target-control"
mount "${BOOT_A}" "${WORK_DIR}/target-boot-a"
mount "${ROOT_A}" "${WORK_DIR}/target-root-a"
mount "${BOOT_B}" "${WORK_DIR}/target-boot-b"
mount "${ROOT_B}" "${WORK_DIR}/target-root-b"
mount "${DATA}" "${WORK_DIR}/target-data"

echo "Copying tested system into both A/B slots..."
rsync -aHAX --numeric-ids "${WORK_DIR}/source-boot/" "${WORK_DIR}/target-control/"
rsync -aHAX --numeric-ids "${WORK_DIR}/source-boot/" "${WORK_DIR}/target-boot-a/"
rsync -aHAX --numeric-ids "${WORK_DIR}/source-boot/" "${WORK_DIR}/target-boot-b/"
for target in target-root-a target-root-b; do
  rsync -aHAX --numeric-ids \
    --exclude '/boot/firmware/*' \
    --exclude '/etc/pitunes/*' \
    --exclude '/etc/NetworkManager/system-connections/*' \
    --exclude '/var/cache/pitunes/*' \
    --exclude '/var/lib/pitunes/*' \
    --exclude '/var/lib/mpd/playlists/*' \
    "${WORK_DIR}/source-root/" "${WORK_DIR}/${target}/"
done

echo "Creating shared persistent data..."
mkdir -p "${WORK_DIR}/target-data"/{etc/pitunes,etc/NetworkManager/system-connections,var/cache/pitunes,var/lib/pitunes,var/lib/mpd/playlists}
rsync -aHAX --numeric-ids "${WORK_DIR}/source-root/etc/pitunes/" "${WORK_DIR}/target-data/etc/pitunes/"
rsync -aHAX --numeric-ids "${WORK_DIR}/source-root/etc/NetworkManager/system-connections/" \
  "${WORK_DIR}/target-data/etc/NetworkManager/system-connections/" 2>/dev/null || true
rsync -aHAX --numeric-ids "${WORK_DIR}/source-root/var/cache/pitunes/" "${WORK_DIR}/target-data/var/cache/pitunes/" 2>/dev/null || true
rsync -aHAX --numeric-ids "${WORK_DIR}/source-root/var/lib/pitunes/" "${WORK_DIR}/target-data/var/lib/pitunes/" 2>/dev/null || true
rsync -aHAX --numeric-ids "${WORK_DIR}/source-root/var/lib/mpd/playlists/" "${WORK_DIR}/target-data/var/lib/mpd/playlists/" 2>/dev/null || true
install -m 0644 "${PUBLIC_KEY}" "${WORK_DIR}/target-data/etc/pitunes/system-update-public.pem"

CONTROL_UUID="$(partuuid "${CONTROL}")"
BOOT_A_UUID="$(partuuid "${BOOT_A}")"
ROOT_A_UUID="$(partuuid "${ROOT_A}")"
BOOT_B_UUID="$(partuuid "${BOOT_B}")"
ROOT_B_UUID="$(partuuid "${ROOT_B}")"
DATA_UUID="$(partuuid "${DATA}")"

cat >"${WORK_DIR}/target-data/etc/pitunes/system-update.json" <<EOF
{
  "schemaVersion": 1,
  "product": "PiTunes",
  "strategy": "rpi-tryboot-ab",
  "persistentMount": "/var/lib/pitunes-system",
  "controlMount": "/boot/pitunes-control",
  "publicKey": "/etc/pitunes/system-update-public.pem",
  "autobootFile": "/boot/pitunes-control/autoboot.txt",
  "slots": {
    "A": {
      "bootDevice": "/dev/disk/by-partuuid/${BOOT_A_UUID}",
      "rootDevice": "/dev/disk/by-partuuid/${ROOT_A_UUID}",
      "bootPartition": 2
    },
    "B": {
      "bootDevice": "/dev/disk/by-partuuid/${BOOT_B_UUID}",
      "rootDevice": "/dev/disk/by-partuuid/${ROOT_B_UUID}",
      "bootPartition": 3
    }
  }
}
EOF

configure_root() {
  local root="$1"
  local boot_uuid="$2"
  local root_uuid="$3"
  mkdir -p "${root}/boot/firmware" "${root}/boot/pitunes-control" "${root}/var/lib/pitunes-system" \
    "${root}/etc/pitunes" "${root}/etc/NetworkManager/system-connections" \
    "${root}/var/cache/pitunes" "${root}/var/lib/pitunes" "${root}/var/lib/mpd/playlists"
  awk '$2 != "/" && $2 != "/boot/firmware" && $2 != "/boot"' "${WORK_DIR}/source-root/etc/fstab" >"${root}/etc/fstab"
  cat >>"${root}/etc/fstab" <<EOF
PARTUUID=${root_uuid} / ext4 defaults,noatime 0 1
PARTUUID=${boot_uuid} /boot/firmware vfat defaults 0 2
PARTUUID=${CONTROL_UUID} /boot/pitunes-control vfat defaults 0 2
PARTUUID=${DATA_UUID} /var/lib/pitunes-system ext4 defaults,noatime 0 2
/var/lib/pitunes-system/etc/pitunes /etc/pitunes none bind,x-systemd.requires-mounts-for=/var/lib/pitunes-system 0 0
/var/lib/pitunes-system/etc/NetworkManager/system-connections /etc/NetworkManager/system-connections none bind,x-systemd.requires-mounts-for=/var/lib/pitunes-system 0 0
/var/lib/pitunes-system/var/cache/pitunes /var/cache/pitunes none bind,x-systemd.requires-mounts-for=/var/lib/pitunes-system 0 0
/var/lib/pitunes-system/var/lib/pitunes /var/lib/pitunes none bind,x-systemd.requires-mounts-for=/var/lib/pitunes-system 0 0
/var/lib/pitunes-system/var/lib/mpd/playlists /var/lib/mpd/playlists none bind,x-systemd.requires-mounts-for=/var/lib/pitunes-system 0 0
EOF
  mkdir -p "${root}/etc/systemd/system/multi-user.target.wants"
  ln -sfn /etc/systemd/system/pitunes-system-boot-check.service \
    "${root}/etc/systemd/system/multi-user.target.wants/pitunes-system-boot-check.service"
}

configure_boot() {
  local boot="$1"
  local root_uuid="$2"
  sed -i -E "s#root=PARTUUID=[^ ]+#root=PARTUUID=${root_uuid}#" "${boot}/cmdline.txt"
  grep -q "root=PARTUUID=${root_uuid}" "${boot}/cmdline.txt"
  rm -f "${boot}/autoboot.txt"
}

configure_control() {
  sed -i -E "s#root=PARTUUID=[^ ]+#root=PARTUUID=${ROOT_A_UUID}#" "${WORK_DIR}/target-control/cmdline.txt"
  grep -q "root=PARTUUID=${ROOT_A_UUID}" "${WORK_DIR}/target-control/cmdline.txt"
  cat >"${WORK_DIR}/target-control/autoboot.txt" <<EOF
[all]
tryboot_a_b=1
boot_partition=2
[tryboot]
boot_partition=3
EOF
}

configure_root "${WORK_DIR}/target-root-a" "${BOOT_A_UUID}" "${ROOT_A_UUID}"
configure_root "${WORK_DIR}/target-root-b" "${BOOT_B_UUID}" "${ROOT_B_UUID}"
configure_boot "${WORK_DIR}/target-boot-a" "${ROOT_A_UUID}"
configure_boot "${WORK_DIR}/target-boot-b" "${ROOT_B_UUID}"
configure_control

cat >"${WORK_DIR}/target-root-a/etc/pitunes-image.json" <<EOF
{"product":"PiTunes","layout":"rpi-tryboot-ab","slot":"A"}
EOF
cat >"${WORK_DIR}/target-root-b/etc/pitunes-image.json" <<EOF
{"product":"PiTunes","layout":"rpi-tryboot-ab","slot":"B"}
EOF

sync
cleanup
trap - EXIT
xz -T0 -9 -k -f "${OUTPUT_IMAGE}"
xz -t "${OUTPUT_IMAGE}.xz"

cat <<EOF
Staging A/B image created:
  ${OUTPUT_IMAGE}
  ${OUTPUT_IMAGE}.xz

Do not publish it until docs/AB_SYSTEM_UPDATES.md hardware tests pass.
EOF
