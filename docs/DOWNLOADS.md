# PiTunes Image Downloads

PiTunes images are **Raspberry Pi OS Lite (Bookworm)** disk images with the appliance preinstalled. They are distributed as `.img.xz` files on [GitHub Releases](https://github.com/BASF2HD/PiTunes/releases).

## Which image do I need?

| Raspberry Pi | Base OS | Download (after first release) |
|--------------|---------|----------------------------------|
| Pi 3, Pi 3 B+, Pi Zero 2 W | 32-bit Lite (`armhf`) | `https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes-armhf.img.xz` |
| Pi 4, Pi 5 | 64-bit Lite (`arm64`) | `https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes-arm64.img.xz` |

Older releases may also ship `pitunes.img.xz` as an alias for the 32-bit image.

## Build your own

On Debian/Ubuntu Linux:

```bash
chmod +x install.sh configure-mpd.sh scripts/*.sh tools/*.sh

# 32-bit Lite
sudo ./tools/build-flashable-image.sh --arch armhf

# 64-bit Lite
sudo ./tools/build-flashable-image.sh --arch arm64
```

See [IMAGE_CREATION.md](IMAGE_CREATION.md) for kiosk mode, publishing, and GitHub Actions.

## Download and flash

1. Download the correct `.img.xz` for your Pi (see table above).
2. Flash with Raspberry Pi Imager (**Use custom**), Balena Etcher, or `dd`.
3. When using Raspberry Pi Imager, set login credentials or an SSH key in advanced options if remote shell access is needed.
4. Boot the Pi.
5. Open `http://pitunes.local` (or the Pi IP address).

## Publish a new release

Publish **both** architectures when possible:

```bash
./tools/publish-image-release.sh v1.3.0 image/out/pitunes-armhf.img.xz pitunes-armhf.img.xz
./tools/publish-image-release.sh v1.3.0 image/out/pitunes-arm64.img.xz pitunes-arm64.img.xz
```

Optional legacy alias for the 32-bit primary download:

```bash
./tools/publish-image-release.sh v1.3.0 image/out/pitunes-armhf.img.xz pitunes.img.xz
```

## Release naming

Tags use semantic versions, for example `v1.3.0` and `v1.3.1`.

Suggested title: `PiTunes v1.3.0 Raspberry Pi Images`

## Checks before publishing

- **armhf** image boots on Pi 3 / Pi 3 B+ / Pi Zero 2 W.
- **arm64** image boots on Pi 4 / Pi 5.
- `http://pitunes.local` loads on both.
- MPD, USB DAC (or selected output), and `/mnt/music` scan work.
- No personal Wi-Fi credentials or private files remain in the image.
