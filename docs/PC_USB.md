# PiTunes on Intel PCs

Download the images and SHA-256 files from the
[PC USB preview release](https://github.com/BASF2HD/PiTunes/releases/tag/pc-v1.4.4-preview.1).
Use the 64-bit image if the CPU supports it, even if the PC currently runs
a 32-bit OS. These are preview builds pending physical hardware testing.

| CPU | Base | Image | Firmware |
| --- | --- | --- | --- |
| 64-bit Intel or AMD | Debian 13 (`amd64`) | `pitunes-amd64.img.xz` | BIOS or 64-bit UEFI |
| 32-bit Intel or AMD with PAE and SSE3 | Debian 12 LTS (`i386`) | `pitunes-i386.img.xz` | BIOS or 32-bit UEFI |

Both PC images boot directly from the USB drive and save settings and
playlists there. Use legacy BIOS mode or turn off Secure Boot for UEFI.
The Raspberry Pi builds use Raspberry Pi OS and their own ARM images.
The 32-bit PC build uses Debian 12 because Debian 13 supplies its PC kernel
for 64-bit systems. [Debian 12 LTS](https://www.debian.org/releases/bookworm/)
is scheduled through June 2028.

## Boot From USB

1. Use an 8 GB or larger USB drive. An external SSD is a good option for
   regular use. Writing the image erases the selected drive.
2. Verify the image with its matching `.sha256` file, then flash the `.img.xz`
   with an image writer such as Balena Etcher. The image uses the first 5 GiB
   of the drive. You can store a larger library on a separate music drive or NAS.
3. Plug it into the PC and select the USB drive from the firmware boot menu.
   The USB runs as the system disk and your existing OS stays on its own disk.
4. PiTunes opens full-screen on the PC without a login prompt. On the same
   network, you can also open the PC's IP address or `http://pitunes.local`.
   Use the IP address if another PiTunes device is on your network. Ethernet
   is the simplest way to connect for the first boot. Wi-Fi depends on the
   PC's adapter and its Linux firmware.

In PiTunes settings, select the ALSA device for the PC's built-in analog
output, HDMI output, or a class-compliant USB DAC. Raspberry Pi I2S HATs are
not supported on the PC edition. The kiosk account uses local autologin and
the image ships with SSH disabled. Update this edition using a new PC image.
PiTunes App OTA needs its own PC release pipeline to preserve the PC-specific
changes and is disabled for these builds.

## Test Before Deployment

An x86 VM (such as QEMU or UTM on a Mac) can boot the decompressed image as
a virtual disk. On Apple Silicon, choose x86 emulation, not ARM
virtualization. Attach a second disk with music to test source selection and
native playback. Enable networking to try radio, and test settings and
playlist persistence across a reboot. A Mac browser can also use the VM's
forwarded HTTP port, but it does not exercise the guest's kiosk graphics.
The 32-bit test guest reached the kiosk without input on a clean rerun,
but an earlier emulated boot needed `Ctrl+R` to recover from a white
screen. Verify repeatable cold boots on physical hardware before deployment.

Measure startup on the intended PC from power-on to a responsive kiosk.
Also check graphics, networking, and audio output, including the intended
USB DAC. Emulation tests compatibility and behavior, but it cannot predict
startup time or output quality on the target hardware.

## Build

Use a current x86-64 Debian or Ubuntu Linux host or VM:

```bash
sudo apt install debootstrap fdisk dosfstools e2fsprogs patch rsync xz-utils debian-archive-keyring
sudo bash tools/build-pc-image.sh --arch amd64
sudo bash tools/build-pc-image.sh --arch i386
```

The compressed image and checksum are written to `image/out/`. The manual
**Build PC USB image** GitHub Actions workflow produces the same files as a
downloadable artifact per architecture. The builder targets a temporary disk
file and accepts `--output /path/to/output.img`. It applies the patches in
`image/pc/` to a staging copy of PiTunes. Refresh and retest those patches
when changing the shared application files they modify.
