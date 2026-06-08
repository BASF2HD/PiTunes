# PiTunes Image Downloads

PiTunes images are distributed as compressed Raspberry Pi flashable images through GitHub Releases.

Latest image link:

```text
https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes.img.xz
```

Use this link in public pages, posts, or documentation once the first release asset has been uploaded.

## Build Your Own Image

On Debian/Ubuntu Linux:

```bash
sudo ./scripts/build-flashable-image.sh --arch armhf
```

See [IMAGE_CREATION.md](IMAGE_CREATION.md) for Pi 4 (`arm64`), kiosk mode, and publishing.

## Download And Flash

1. Download `pitunes.img.xz` from the latest release (or use your built `image/out/pitunes-*.img.xz`).
2. Flash it with Raspberry Pi Imager (**Use custom**), Balena Etcher, or `dd`.
3. Boot the Pi.
4. Open:

```text
http://pitunes.local
```

If your browser cannot resolve `pitunes.local`, use the Pi IP address.

## Publish A New Image Release

After creating a tested image with [IMAGE_CREATION.md](IMAGE_CREATION.md), upload it as a release asset:

```bash
./scripts/publish-image-release.sh v0.1.0 pitunes.img.xz
```

The script creates or updates the GitHub release and uploads the image as:

```text
pitunes.img.xz
```

After upload, the latest download URL becomes:

```text
https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes.img.xz
```

## Release Naming

Use semantic version tags:

```text
v0.1.0
v0.2.0
v1.0.0
```

Suggested release title:

```text
PiTunes v0.1.0 Raspberry Pi Image
```

## Checks Before Publishing

- The image boots on a Raspberry Pi 3 or 3B+.
- `http://pitunes.local` loads.
- MPD starts.
- USB DAC or selected output works.
- `/mnt/music` scan works.
- The image is compressed as `pitunes.img.xz`.
- No personal Wi-Fi credentials, shell history, or private files remain in the image.
