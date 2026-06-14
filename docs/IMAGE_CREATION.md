# Image Creation Guide

PiTunes ships as a **flashable Raspberry Pi disk image** (`.img` / `.img.xz`), not an ISO.

Two ways to produce it:

1. **Automated build (recommended)** — download Raspberry Pi OS Lite, inject PiTunes in a chroot, output `pitunes.img.xz`.
2. **Golden SD card** — configure a Pi manually, then `dd` the card to an image file.

---

## Automated build (OS + PiTunes client)

Requires **Debian or Ubuntu** (physical Linux, VM, or WSL2 with loop mounts). Not supported on macOS alone.

### 1. Install build tools

```bash
sudo apt update
sudo apt install -y qemu-user-static binfmt-support kpartx rsync wget xz-utils parted dosfstools
```

Optional smaller downloads after build:

```bash
# https://github.com/Drewsif/PiShrink
sudo apt install pishrink  # or clone pishrink.sh into PATH
```

### 2. Build the image

```bash
cd PiTunes
chmod +x install.sh configure-mpd.sh scripts/*.sh tools/*.sh

# Default: 32-bit image for Pi 3 / Zero 2 W
sudo ./tools/build-flashable-image.sh --arch armhf

# 64-bit image for Pi 4 / Pi 5
sudo ./tools/build-flashable-image.sh --arch arm64

# Headless-only image without the default fullscreen local display
sudo ./tools/build-flashable-image.sh --arch arm64 --no-kiosk
```

Output files (one pair per `--arch`):

```text
image/out/pitunes-armhf.img      # 32-bit Lite
image/out/pitunes-armhf.img.xz
image/out/pitunes-arm64.img      # 64-bit Lite
image/out/pitunes-arm64.img.xz
```

First run downloads the matching **Raspberry Pi OS Lite** base into `image/cache/` (~500 MB per architecture).

### 3. Flash the image

Pick the file that matches your Pi (`armhf` = 32-bit Lite, `arm64` = 64-bit Lite).

**Raspberry Pi Imager:** **Use custom** → select `pitunes-armhf.img.xz` or `pitunes-arm64.img.xz`.

**Command line (64-bit example):**

```bash
xz -dk image/out/pitunes-arm64.img.xz
sudo dd if=image/out/pitunes-arm64.img of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

Replace `/dev/sdX` with your SD card device (whole disk, not a partition).

### 4. First boot

1. Insert SD card and power the Pi.
2. Ethernet or configure Wi‑Fi (Raspberry Pi Imager advanced options before flash, or SSH + `setup-wifi.sh`).
3. Open:

```text
http://pitunes.local
```

The image creates the `pi` kiosk user but does not ship a public SSH password.
Use Raspberry Pi Imager advanced options to set a username/password or SSH key
before first boot. Without those customizations, password-based SSH access is
not available.

Default hostname: **pitunes** (`pitunes.local` via mDNS).

### 5. Publish to GitHub Releases

```bash
./tools/publish-image-release.sh v1.3.0 image/out/pitunes-armhf.img.xz pitunes-armhf.img.xz
./tools/publish-image-release.sh v1.3.0 image/out/pitunes-arm64.img.xz pitunes-arm64.img.xz
```

Public URLs after upload:

```text
https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes-armhf.img.xz
https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes-arm64.img.xz
```

### GitHub Actions

Workflow **Build flashable image** (Actions tab → Run workflow) builds on `ubuntu-latest` and uploads the `.img.xz` as an artifact. Use for releases without a local Linux box.

### Staging A/B system-update image

The normal image above remains the public default. After it passes hardware
tests, it can be converted into a staging-only A/B image with a stable boot
control partition, two boot/root slots, and shared persistent data:

```bash
sudo ./tools/build-ab-image.sh \
  --source image/out/pitunes-arm64.img \
  --output image/out/pitunes-arm64-ab.img \
  --public-key /secure/pitunes-system-update-public.pem
```

Do not publish the A/B image until the complete test matrix in
[AB_SYSTEM_UPDATES.md](AB_SYSTEM_UPDATES.md) passes on supported hardware.

---

## Golden SD card workflow (manual)

Use this when tuning audio on real hardware before baking an image.

### 1. Prepare the Pi

Flash Raspberry Pi OS Lite, boot, copy PiTunes, run:

```bash
cd PiTunes
sudo ./install.sh usb-dac   # or auto, hdmi, dac-hat, etc.
```

Test:

```bash
systemctl status mpd pitunes-api nginx
curl http://127.0.0.1/api/health
sudo /opt/pitunes/scripts/appliance-self-test.sh
```

Do not publish an image until the appliance self-test passes on a real Pi and
WiFi handoff has been tested once with a correct password and once with an
incorrect password to confirm that the PiTunes recovery hotspot returns.

### 2. Clean before imaging

On the Pi:

```bash
sudo /opt/pitunes/scripts/golden-image-cleanup.sh
# or from a source tree:
sudo ./scripts/golden-image-cleanup.sh
sudo shutdown now
```

### 3. Create `.img` from the SD card

On a Linux PC with the card attached:

```bash
sudo ./tools/create-image.sh /dev/sdX pitunes.img
```

### 4. Shrink and compress (optional)

```bash
sudo pishrink.sh pitunes.img
xz -T0 -9 -k pitunes.img
```

---

## Architecture matrix

| Pi model | Recommended image |
|----------|-------------------|
| Pi 3, Pi 3 B+, Pi Zero 2 W | `pitunes-armhf.img.xz` (32-bit OS) |
| Pi 4, Pi 5 | `pitunes-arm64.img.xz` (64-bit OS) |

Both use **Raspberry Pi OS Lite (Bookworm)** as the base and include the fullscreen PiTunes local display by default. Pass `--no-kiosk` only for a headless-only image.

---

## What is preinstalled

- Raspberry Pi OS Lite (Bookworm)
- MPD + ALSA audio (`configure-mpd.sh`)
- PiTunes Python API + nginx UI
- SQLite library scanner (mutagen)
- systemd units: `pitunes-api`, `pitunes-mount`, `pitunes-startup-scan`
- Avahi hostname **pitunes**
- SSH service available; credentials must be set with Raspberry Pi Imager

---

## Troubleshooting builds

| Problem | Fix |
|---------|-----|
| `qemu-arm-static not found` | `sudo apt install qemu-user-static binfmt-support` |
| `mount: wrong fs type` | Run on Linux with root; WSL1 does not work — use WSL2 or native Linux |
| `losetup: failed` | Unmount partitions: `sudo umount image/work/boot image/work/root` |
| Download URL 404 | Update pinned URLs in `image/build.env` from [raspberrypi.com](https://www.raspberrypi.com/software/operating-systems/) |
| Chroot `exec format error` | Install `binfmt-support` and restart: `sudo systemctl restart systemd-binfmt` |

See also [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for runtime issues on the Pi.
