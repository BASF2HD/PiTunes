# PiTunes flashable images

This folder holds image build configuration and output paths.

| Path | Purpose |
|------|---------|
| `build.env` | Pinned Raspberry Pi OS Lite download URLs |
| `cache/` | Downloaded base `.img` files (not committed) |
| `work/` | Temporary loop-mount workspace |
| `out/` | Built `pitunes-*.img` and `.img.xz` |

## Build on Linux (recommended)

```bash
cd PiTunes
chmod +x install.sh configure-mpd.sh scripts/*.sh tools/*.sh
sudo apt install qemu-user-static binfmt-support kpartx rsync wget xz-utils

# Pi 3 / Zero 2 W (32-bit OS)
sudo ./tools/build-flashable-image.sh --arch armhf

# Pi 4 / 5 (64-bit OS)
sudo ./tools/build-flashable-image.sh --arch arm64

# Headless-only image without the default HDMI/touchscreen UI
sudo ./tools/build-flashable-image.sh --arch arm64 --no-kiosk
```

Output: `image/out/pitunes-armhf.img.xz` (or `arm64`).

## GitHub Actions

Run workflow **Build flashable image** (manual dispatch) to produce an artifact without a local Linux machine.

## Manual SD card workflow

If you already configured a Pi by hand, use [docs/IMAGE_CREATION.md](../docs/IMAGE_CREATION.md) and `tools/create-image.sh` to `dd` that card to an `.img`.
