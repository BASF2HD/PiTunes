# Image Creation Guide

EchoFlow ships as a **flashable Raspberry Pi disk image** (`.img` / `.img.xz`), not an ISO.

Two ways to produce it:

1. **Automated build (recommended)** — download Raspberry Pi OS Lite, inject EchoFlow in a chroot, output `echoflow.img.xz`.
2. **Golden SD card** — configure a Pi manually, then `dd` the card to an image file.

---

## Automated build (OS + EchoFlow client)

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
cd EchoFlow
chmod +x install.sh configure-mpd.sh scripts/*.sh

# Default: 32-bit image for Pi 3 / Zero 2 W
sudo ./scripts/build-flashable-image.sh --arch armhf

# 64-bit image for Pi 4 / Pi 5
sudo ./scripts/build-flashable-image.sh --arch arm64

# Headless-only image without the default fullscreen local display
sudo ./scripts/build-flashable-image.sh --arch arm64 --no-kiosk
```

Output files:

```text
image/out/echoflow-armhf.img
image/out/echoflow-armhf.img.xz
```

First run downloads the base Raspberry Pi OS Lite image into `image/cache/` (~500 MB download).

### 3. Flash the image

**Raspberry Pi Imager:** Choose **Use custom** and select `echoflow-armhf.img.xz` (Imager decompresses automatically).

**Command line:**

```bash
xz -dk image/out/echoflow-armhf.img.xz
sudo dd if=image/out/echoflow-armhf.img of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

Replace `/dev/sdX` with your SD card device (whole disk, not a partition).

### 4. First boot

1. Insert SD card and power the Pi.
2. Ethernet or configure Wi‑Fi (Raspberry Pi Imager advanced options before flash, or SSH + `setup-wifi.sh`).
3. Open:

```text
http://echoflow.local
```

SSH is enabled via the standard `boot/ssh` flag on the boot partition.
The flashable image creates an initial SSH/kiosk user:

```text
user: pi
password: echoflow
```

Change this password after first boot.

Default hostname: **echoflow** (mDNS).

### 5. Publish to GitHub Releases

```bash
./scripts/publish-image-release.sh v0.1.0 image/out/echoflow-armhf.img.xz
```

Public URL after upload:

```text
https://github.com/BASF2HD/EchoFlow/releases/latest/download/echoflow.img.xz
```

Rename the asset to `echoflow.img.xz` when publishing the primary 32-bit image, or publish separate `echoflow-arm64.img.xz` assets.

### GitHub Actions

Workflow **Build flashable image** (Actions tab → Run workflow) builds on `ubuntu-latest` and uploads the `.img.xz` as an artifact. Use for releases without a local Linux box.

---

## Golden SD card workflow (manual)

Use this when tuning audio on real hardware before baking an image.

### 1. Prepare the Pi

Flash Raspberry Pi OS Lite, boot, copy EchoFlow, run:

```bash
cd EchoFlow
sudo ./install.sh usb-dac   # or auto, hdmi, dac-hat, etc.
```

Test:

```bash
systemctl status mpd echoflow-api nginx
curl http://127.0.0.1/api/health
sudo /opt/echoflow/scripts/appliance-self-test.sh
```

Do not publish an image until the appliance self-test passes on a real Pi and
WiFi handoff has been tested once with a correct password and once with an
incorrect password to confirm that the EchoFlow recovery hotspot returns.

### 2. Clean before imaging

On the Pi:

```bash
sudo /opt/echoflow/scripts/golden-image-cleanup.sh
# or from a source tree:
sudo ./scripts/golden-image-cleanup.sh
sudo shutdown now
```

### 3. Create `.img` from the SD card

On a Linux PC with the card attached:

```bash
sudo ./scripts/create-image.sh /dev/sdX echoflow.img
```

### 4. Shrink and compress (optional)

```bash
sudo pishrink.sh echoflow.img
xz -T0 -9 -k echoflow.img
```

---

## Architecture matrix

| Pi model | Recommended image |
|----------|-------------------|
| Pi 3, Pi 3 B+, Pi Zero 2 W | `echoflow-armhf.img.xz` (32-bit OS) |
| Pi 4, Pi 5 | `echoflow-arm64.img.xz` (64-bit OS) |

Both use **Raspberry Pi OS Lite (Bookworm)** as the base and include the fullscreen EchoFlow local display by default. Pass `--no-kiosk` only for a headless-only image.

---

## What is preinstalled

- Raspberry Pi OS Lite (Bookworm)
- MPD + ALSA audio (`configure-mpd.sh`)
- EchoFlow Python API + nginx UI
- SQLite library scanner (mutagen)
- systemd units: `echoflow-api`, `echoflow-mount`, `echoflow-startup-scan`
- Avahi hostname **echoflow**
- SSH enabled on first boot

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
