#!/usr/bin/env bash
# Run only in the image chroot, with /boot/efi mounted on the target disk.
set -euo pipefail

disk="${1:?Missing image disk}"
system="${2:?Missing image system partition}"
efi_target="${3:?Missing GRUB EFI platform}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
uuid="$(blkid -s UUID -o value "${system}")"
[[ -f /etc/pitunes-pc-image && -b "${disk}" && "${uuid}" =~ ^[0-9a-f-]+$ ]]
mountpoint -q /boot/efi

install -D -m 0755 "${here}/start-display.sh" /usr/local/libexec/pitunes-pc/start-display
install -D -m 0755 "${here}/display-report.sh" /usr/local/libexec/pitunes-pc/display-report
install -D -m 0644 "${here}/lightdm.conf" /etc/systemd/system/lightdm.service.d/pitunes-pc.conf
install -D -m 0644 "${here}/display-report.service" /etc/systemd/system/pitunes-pc-display-report.service
install -D -m 0644 "${here}/mount-music.service" /etc/systemd/system/pitunes-mount.service

# NAS access is a client operation. Receiving audio and sharing files are opt-in.
systemctl disable pitunes-samba-late.timer nmbd.service smbd.service pitunes-hotspot.service \
  pitunes-bluealsa-aplay.service pitunes-bluetooth-discoverable.service pitunes-bt-agent.service \
  bluealsa.service bluetooth.service shairport-sync.service
if [[ -e /lib/systemd/system/nqptp.service ]]; then
  systemctl disable nqptp.service
fi
rm -f /etc/avahi/services/pitunes-smb.service
if ! grep -q '^   disable netbios = yes$' /etc/samba/smb.conf; then
  sed -i '/^\[global\]$/a\   disable netbios = yes\n   smb ports = 445' /etc/samba/smb.conf
fi
testparm -s /etc/samba/smb.conf >/dev/null

install -d /etc/default/grub.d
cat > /etc/default/grub.d/pitunes.cfg <<'EOF'
GRUB_DISTRIBUTOR=PiTunes
GRUB_TIMEOUT_STYLE=menu
GRUB_TIMEOUT=3
GRUB_DISABLE_OS_PROBER=true
GRUB_CMDLINE_LINUX_DEFAULT="quiet net.ifnames=0"
EOF

grub-install --target=i386-pc --recheck "${disk}"
early="$(mktemp /tmp/pitunes-grub.XXXXXX)"
trap 'rm -f "${early}"' EXIT
cat > "${early}" <<EOF
search.fs_uuid ${uuid} root
set prefix=(\$root)/boot/grub
EOF

# BIOS disk numbers vary across firmware. Locate the USB before loading grub.cfg.
grub-script-check "${early}"
grub-mkimage -O i386-pc -d /usr/lib/grub/i386-pc -o /boot/grub/i386-pc/core.img \
  -p /boot/grub -c "${early}" biosdisk part_msdos ext2 search_fs_uuid normal
/usr/lib/grub/i386-pc/grub-bios-setup -d /boot/grub/i386-pc "${disk}"
grub-install --target="${efi_target}" --efi-directory=/boot/efi --removable --no-nvram

[[ -e /vmlinuz && -e /initrd.img ]]
cat > /boot/grub/custom.cfg <<EOF
menuentry 'PiTunes (compatible graphics)' {
    search --no-floppy --fs-uuid --set=root ${uuid}
    linux /vmlinuz root=UUID=${uuid} ro quiet net.ifnames=0 nomodeset pitunes.safe-graphics=1
    initrd /initrd.img
}
EOF
grub-script-check /boot/grub/custom.cfg
update-grub
grub-script-check /boot/grub/grub.cfg
