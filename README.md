# EchoFlow

EchoFlow is a lightweight Raspberry Pi music player OS with local music playback, CoverFlow-style browsing, AirPlay input (planned), Bluetooth audio input (planned), and DAC-friendly output.

Built for **Raspberry Pi OS Lite** on Pi 3, Pi 3B+, Pi 4, and Pi Zero 2 W (32-bit image; 64-bit supported for Pi 4/5).

## Download

Latest Raspberry Pi image (after the first GitHub Release):

[Download `echoflow.img.xz`](https://github.com/BASF2HD/EchoFlow/releases/latest/download/echoflow.img.xz)

**Build your own** flashable image (Raspberry Pi OS Lite + EchoFlow) on Linux:

```bash
sudo apt install qemu-user-static binfmt-support kpartx rsync wget xz-utils
chmod +x install.sh configure-mpd.sh scripts/*.sh
sudo ./scripts/build-flashable-image.sh --arch armhf    # Pi 3 / Zero 2 W
# sudo ./scripts/build-flashable-image.sh --arch arm64  # Pi 4 / Pi 5
```

Output: `image/out/echoflow-armhf.img.xz`. Full guide: [docs/IMAGE_CREATION.md](docs/IMAGE_CREATION.md).

Flash with Raspberry Pi Imager (**Use custom**), Balena Etcher, or `dd`, then boot the Pi and open:

```text
http://echoflow.local
```

The download link becomes active after the first GitHub Release image asset is published. See [docs/DOWNLOADS.md](docs/DOWNLOADS.md).

The system uses MPD for audio playback, a small local Python API, nginx, and a plain HTML/CSS/JavaScript EchoFlow web UI. After setup it works offline and serves the interface at:

```text
http://echoflow.local
```

## Hardware Target

- Raspberry Pi 3, Pi 3B+, Pi 4, or Pi Zero 2 W
- Raspberry Pi OS Lite (32-bit recommended for Pi 3 / Zero 2 W)
- USB DAC, HDMI, headphone output, or DAC HAT
- Music stored on a USB drive labelled `MUSIC` or mounted/copied at `/mnt/music`
- SD card large enough for the OS, cache, and any local music you copy onto it

## Project Layout

```text
backend/                 Local Python API (playback via MPD, library via SQLite)
backend/library/         SQLite cache, scanner, browse/search queries
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
- SQLite library cache for fast browse/search on large collections
- Incremental background library scan (`python3-mutagen`)
- Local thumbnail cache (128px + 420px) for faster browsing
- Virtual CoverFlow (fixed GPU card pool for thousands of albums)
- USB music drive auto-mount support
- Optional Wi-Fi setup script
- Automated flashable `.img` builder (`scripts/build-flashable-image.sh`) — OS + EchoFlow client
- Optional HDMI kiosk mode (`--kiosk`)

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
- `avahi-daemon.service` - makes `echoflow.local` discoverable on many home networks

For an already-installed Pi that still appears under the default Raspberry Pi hostname, run:

```bash
sudo hostnamectl set-hostname echoflow
sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1\techoflow/' /etc/hosts
sudo systemctl restart avahi-daemon nginx
```

Useful commands:

```bash
sudo systemctl status mpd echoflow-api nginx
sudo journalctl -u echoflow-api -n 100
mpc status
mpc update
```

## API Summary

The frontend talks to local endpoints under `/api/`:

- `GET /api/library/albums?offset=0&limit=96`
- `GET /api/library/scan-status`
- `GET /api/search?q=...`
- `GET /api/albums` (legacy)
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

## WiFi hotspot (Moode-style)

If the Pi has no Ethernet and cannot join your home WiFi, EchoFlow starts a setup access point automatically (like moOde Audio):

| | |
|---|---|
| SSID | `EchoFlow` |
| Default password | `echoflowaudio` (change in `/etc/echoflow/wifi-hotspot.conf`) |
| Web UI | http://172.24.1.1 or http://echoflow.local |

Join the hotspot from a phone or laptop, open the URL above, then connect to your home network with `setup-wifi.sh` or `POST /api/network/wifi/connect`. Full details: [docs/WIFI_HOTSPOT.md](docs/WIFI_HOTSPOT.md).

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

To publish a public download asset after building and testing the image:

```bash
./scripts/publish-image-release.sh v0.1.0 echoflow.img.xz
```

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for USB DAC, DAC HAT, Wi-Fi, MPD library, artwork, and music drive mounting fixes.

## Performance Notes

- No Docker
- No desktop environment
- No frontend build system
- No cloud dependency
- **MPD** handles playback, queue, and volume only
- **SQLite** handles album browse, search, and metadata
- nginx serves static files
- Python API translates player commands to MPD and serves artwork from cache
- Thumbnail cache avoids repeatedly resizing album art on older hardware

See [docs/ROADMAP.md](docs/ROADMAP.md) for AirPlay, Bluetooth, and EchoFlow OS milestones.
