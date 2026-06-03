# EchoFlow

A lightweight standalone Raspberry Pi 3 / 3B+ music player image project based on Raspberry Pi OS Lite 32-bit.

The system uses MPD for audio playback, a small local Python API, nginx, and a plain HTML/CSS/JavaScript EchoFlow web UI. After setup it works offline and serves the interface at:

```text
http://raspberrypi.local
```

## Hardware Target

- Raspberry Pi 3 or Raspberry Pi 3B+
- Raspberry Pi OS Lite 32-bit
- USB DAC, HDMI, headphone output, or DAC HAT
- Music stored on a USB drive labelled `MUSIC` or mounted/copied at `/mnt/music`
- SD card large enough for the OS, cache, and any local music you copy onto it

## Project Layout

```text
backend/                 Local Python MPD API service
frontend/                Static EchoFlow web UI
systemd/                 Boot services
nginx/                   Web server config
config/                  Default app settings
scripts/                 Mount, Wi-Fi, scan, and image scripts
docs/                    Image creation and troubleshooting guides
install.sh               Full system installer
configure-mpd.sh         MPD/audio setup script
```

## Features

- EchoFlow album browser
- Album, artist, and track lists
- Album artwork display
- Play, pause, stop, next, previous
- Volume control
- Seek/progress bar
- Currently playing screen
- Library rescan button
- Settings page for music folder and audio output preference
- Folder artwork detection from `folder.jpg`, `cover.jpg`, `album.jpg`, `front.jpg`, and PNG/JPEG variants
- Embedded artwork lookup through MPD `readpicture` when available
- Local thumbnail cache for faster browsing
- USB music drive auto-mount support
- Optional Wi-Fi setup script
- Image creation guide for reusable flashable `.img` files

## Install From Raspberry Pi OS Lite

1. Flash Raspberry Pi OS Lite 32-bit to an SD card.
2. Boot the Pi and log in locally or by SSH.
3. Copy this project folder to the Pi.
4. Run:

```bash
cd EchoFlow
sudo chmod +x install.sh configure-mpd.sh scripts/*.sh
sudo ./install.sh
```

For a common USB DAC setup:

```bash
sudo ./install.sh usb-dac
```

For a DAC HAT that needs a boot overlay:

```bash
sudo HAT_OVERLAY=hifiberry-dac ./install.sh dac-hat
```

Replace `hifiberry-dac` with the overlay required by your HAT vendor.

## Music Library

Recommended USB drive setup:

1. Format a USB drive as FAT32, exFAT, NTFS, or ext4.
2. Label the partition `MUSIC`.
3. Copy music folders onto it.
4. Put album art beside tracks as `folder.jpg` or `cover.jpg` where possible.
5. Plug the drive into the Pi and reboot, or run:

```bash
sudo systemctl restart echoflow-mount.service
mpc update
```

You can also copy music directly into `/mnt/music`.

## Services

- `mpd.service` - audio backend
- `echoflow-api.service` - local API on `127.0.0.1:8080`
- `nginx.service` - web UI and API proxy on port `80`
- `echoflow-mount.service` - attempts to mount the music USB drive at boot
- `echoflow-startup-scan.service` - scans MPD if the database is missing
- `avahi-daemon.service` - makes `raspberrypi.local` discoverable on many home networks

Useful commands:

```bash
sudo systemctl status mpd echoflow-api nginx
sudo journalctl -u echoflow-api -n 100
mpc status
mpc update
```

## API Summary

The frontend talks to local endpoints under `/api/`:

- `GET /api/albums`
- `GET /api/artists`
- `GET /api/tracks?album=...`
- `GET /api/tracks?artist=...`
- `GET /api/status`
- `GET /api/art?album=...`
- `POST /api/play-album`
- `POST /api/play-track`
- `POST /api/pause`
- `POST /api/resume`
- `POST /api/stop`
- `POST /api/next`
- `POST /api/previous`
- `POST /api/volume`
- `POST /api/seek`
- `POST /api/rescan`
- `GET /api/settings`
- `POST /api/settings`

## Optional Wi-Fi Setup

Run on the Pi:

```bash
sudo /opt/echoflow/scripts/setup-wifi.sh "SSID" "PASSWORD" GB
```

For a prebuilt image, you can also configure Wi-Fi before first boot using the Raspberry Pi Imager advanced options.

## Test Without a Raspberry Pi

Run the local mock server:

```bash
python scripts/mock-server.py
```

Open `http://127.0.0.1:8090` and use your browser's responsive mode to test smartphone, landscape playback, monitor, and settings views. See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md).

## Create a Reusable Flashable Image

Follow [docs/IMAGE_CREATION.md](docs/IMAGE_CREATION.md). The short version is:

1. Install and test everything on a source SD card.
2. Clean logs and machine-specific files.
3. Shut down the Pi.
4. Use a Linux machine to read the SD card into a `.img` file.
5. Optionally shrink and compress it.
6. Flash that `.img` to other SD cards.

Raspberry Pi images are flashable `.img` files, not ISO installers.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for USB DAC, DAC HAT, Wi-Fi, MPD library, artwork, and music drive mounting fixes.

## Performance Notes

- No Docker
- No desktop environment
- No frontend build system
- No cloud dependency
- MPD handles playback
- nginx serves static files
- Python API does simple MPD command translation and artwork caching
- Thumbnail cache avoids repeatedly resizing album art on older hardware
