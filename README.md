<div align="center">

<a href="https://github.com/BASF2HD/PiTunes">
  <img src="docs/assets/pitunes-logo.png?v=5" alt="PiTunes" width="560">
</a>

# PiTunes

*Lightweight Raspberry Pi music player with CoverFlow, AirPlay, Bluetooth, and internet radio.*

**Website:** [basf2hd.github.io/PiTunes](https://basf2hd.github.io/PiTunes) — enable in repo **Settings → Pages → Deploy from branch → `main` → `/docs`**

</div>

PiTunes is a lightweight Raspberry Pi music player appliance: local library playback with a CoverFlow-style UI, **AirPlay** and **Bluetooth** audio input, DAC-friendly output, SMB music sharing, and captive-portal WiFi setup — all on **Raspberry Pi OS Lite** with no cloud dependency.

Built for **Pi 3, Pi 3 B+, Pi 4, Pi 5, and Pi Zero 2 W** on **Raspberry Pi OS Lite (Bookworm)** — official **32-bit** and **64-bit** images.

## Download

PiTunes publishes separate flashable images from the same **Raspberry Pi OS Lite** base (pinned in `image/build.env`):

| Your Pi | OS | Release asset |
|---------|-----|----------------|
| Pi 3, Pi 3 B+, Pi Zero 2 W | 32-bit Lite (`armhf`) | [`pitunes-armhf.img.xz`](https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes-armhf.img.xz) |
| Pi 4, Pi 5 | 64-bit Lite (`arm64`) | [`pitunes-arm64.img.xz`](https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes-arm64.img.xz) |

A legacy alias [`pitunes.img.xz`](https://github.com/BASF2HD/PiTunes/releases/latest/download/pitunes.img.xz) may point at the 32-bit build on older releases.

**Build your own** on Debian/Ubuntu Linux:

```bash
sudo apt install qemu-user-static binfmt-support kpartx rsync wget xz-utils
chmod +x install.sh configure-mpd.sh scripts/*.sh tools/*.sh

# 32-bit Raspberry Pi OS Lite — Pi 3 / Pi Zero 2 W
sudo ./tools/build-flashable-image.sh --arch armhf

# 64-bit Raspberry Pi OS Lite — Pi 4 / Pi 5
sudo ./tools/build-flashable-image.sh --arch arm64
```

Output: `image/out/pitunes-armhf.img.xz` or `image/out/pitunes-arm64.img.xz`. Full guide: [docs/IMAGE_CREATION.md](docs/IMAGE_CREATION.md).

Flash with Raspberry Pi Imager (**Use custom**), Balena Etcher, or `dd`, then boot the Pi and open:

```text
http://pitunes.local
```

The download link becomes active after the first GitHub Release image asset is published. See [docs/DOWNLOADS.md](docs/DOWNLOADS.md).

## What you get

- **MPD** for local file playback and queue control
- **Python API** + **nginx** serving the web UI on port 80
- **SQLite** library index for fast browse and full-text search
- **Avahi** mDNS (`pitunes.local`) — works on your LAN without a cloud account
- **Fullscreen HDMI display** (Chromium kiosk) on images built with the default display profile
- Works **offline** once installed; optional WiFi hotspot for first-time setup

## Features

### Music library & playback

- CoverFlow album browser (WebGL + GSAP slide animation)
- Paginated album loading for large collections (thousands of albums)
- Browse by **album, artist, composer, year, genre, rating**, or **all songs**
- **Songs drawer** — tap a cover to open the track list, play a song, or favourite the album
- **Favourites** for albums and tracks (starred library)
- **Playlists** — create, add tracks, browse playlist contents
- **Smart playlists** (rule-based, stored in the browser)
- **Internet radio** — search (Radio Browser), favourites, MPD stream playback ([docs/RADIO.md](docs/RADIO.md))
- Full-text **search** across the library
- Transport controls: play, pause, stop, next, previous, seek, volume
- **Now playing** view with album art and progress bar
- Library **rescan** and artwork **cache rebuild**
- Folder artwork (`folder.jpg`, `cover.jpg`, `album.jpg`, `front.jpg`, PNG/JPEG variants)
- Embedded art via MPD `readpicture` when available
- Thumbnail cache at **128px** and **420px**
- Incremental background scan (`python3-mutagen`)
- Supported formats include MP3, FLAC, M4A/AAC, OGG, Opus, WAV, AIFF, ALAC

### Music storage

- USB drive auto-mount (partition label `MUSIC`)
- Internal fallback folder: `/var/lib/pitunes/music`
- Copy music directly to `/mnt/music`
- **SMB / NFS NAS** mount from Settings (configure server, share, credentials)
- **Samba share** of `/mnt/music` for adding music from Mac/PC on the LAN
- udev-triggered remount when a USB drive is plugged in

### Audio output

- Routes: **USB DAC**, **DAC HAT**, **HDMI**, **3.5 mm headphones**
- Large built-in **DAC HAT** list (HiFiBerry, IQaudio, Allo, JustBoom, official Pi DAC, and more)
- Live **ALSA device list** in Settings
- MPD mixer: hardware or software depending on route
- `configure-mpd.sh` and `apply-audio-output.sh` for boot-time routing

### Wireless audio input

- **AirPlay** receiver (`shairport-sync` + `nqptp`) — stream from iPhone, iPad, Mac
- **Bluetooth A2DP sink** (`bluealsa`) — pair a phone and play audio to the Pi
- Advertised on the network as **PiTunes** (Avahi / Bluetooth discoverable)
- Enable or disable AirPlay, Bluetooth, and related helpers from **Settings → Services**
- Now-playing artwork for AirPlay and Bluetooth sessions in the UI

### Network & setup

- **WiFi hotspot** when no Ethernet or home WiFi — SSID `PiTunes`, gateway `172.24.1.1`
- WiFi **scan and connect** from Settings (NetworkManager)
- **SSH** service toggle from Settings
- Hostname **`pitunes`** with `pitunes.local` mDNS

### Display & touch

- Fullscreen **kiosk** UI on HDMI (`pitunes-display.service` + Chromium)
- Touch-friendly layout, on-screen **keyboard** for WiFi fields
- Player **fullscreen** mode in the browser
- Browse position and filters **persist** across reloads (localStorage)

### System

- Settings: music folder picker, audio output, WiFi, NAS, service toggles
- **Reboot** and **shutdown** from Settings
- Appliance **self-test** script: `sudo /opt/pitunes/scripts/appliance-self-test.sh`
- Stable **app-only OTA** with release validation, health checks, logs, and automatic rollback
- Flashable **`.img` / `.img.xz`** build pipeline and GitHub Actions workflow
- Golden-image cleanup for cloning SD cards

## Hardware target

| Model | Recommended image |
|-------|-------------------|
| Pi 3, Pi 3 B+, Pi Zero 2 W | **32-bit** Raspberry Pi OS Lite (`armhf`) |
| Pi 4, Pi 5 | **64-bit** Raspberry Pi OS Lite (`arm64`) |

Both are built from the same Bookworm Lite base URLs in `image/build.env` (not the full desktop OS).
- USB DAC, HDMI, headphone jack, or supported DAC HAT
- Music on USB (`MUSIC` label), NAS, Samba copy, or `/mnt/music`
- SD card sized for OS, artwork cache, and any local music

## Project layout

```text
backend/                 Local Python API (MPD, SQLite library, network, storage)
backend/library/         Scanner, queries, artwork resolver, userdata (favourites/playlists)
frontend/                CoverFlow web UI (HTML/CSS/JS, Three.js, GSAP)
systemd/                 Boot services (API, mount, hotspot, display, Bluetooth, …)
nginx/                   Web server and API reverse proxy
config/                  Versioned appliance defaults (WiFi, Samba, DAC HATs)
scripts/                 Installed runtime and on-device maintenance commands
tools/                   Build, release, local-development, and asset commands
tests/                   Automated checks
docs/                    User and maintainer documentation
install.sh               Full appliance installer
configure-mpd.sh         MPD and ALSA output setup
```

## Install from Raspberry Pi OS Lite

1. Flash Raspberry Pi OS Lite to an SD card.
2. Boot the Pi and log in locally or by SSH.
3. Copy this project folder to the Pi.
4. Run:

```bash
cd PiTunes
sudo chmod +x install.sh configure-mpd.sh scripts/*.sh
sudo ./install.sh
```

Audio output examples:

```bash
sudo ./install.sh usb-dac
sudo HAT_OVERLAY=hifiberry-dac ./install.sh dac-hat
sudo ./install.sh hdmi
sudo ./install.sh headphones
```

## Music library setup

**USB (recommended)**

1. Format a drive as FAT32, exFAT, NTFS, or ext4.
2. Label the partition `MUSIC`.
3. Copy your music library onto it.
4. Plug into the Pi and reboot, or run:

```bash
sudo systemctl restart pitunes-mount.service
```

**NAS (Settings UI or API)**

Configure SMB or NFS server, share name, and credentials — PiTunes mounts the share at `/mnt/music` and starts a library scan.

**Samba import from a Mac/PC**

The Pi shares `\\pitunes\Music` (guest read/write to `/mnt/music`) so you can drag music over the network.

## Services

| Service | Role |
|---------|------|
| `mpd.service` | Local file playback engine |
| `pitunes-api.service` | Python API on `127.0.0.1:8080` |
| `nginx.service` | Web UI and `/api` proxy on port 80 |
| `pitunes-mount.service` | USB / NAS / internal music folder |
| `pitunes-startup-scan.service` | Library scan when the DB is empty |
| `pitunes-hotspot.service` | WiFi recovery AP when offline |
| `pitunes-display.service` | HDMI Chromium kiosk |
| `shairport-sync.service` | AirPlay receiver |
| `bluealsa.service` + `pitunes-bluealsa-aplay.service` | Bluetooth A2DP sink |
| `pitunes-bt-agent.service` | Bluetooth pairing agent |
| `pitunes-bluetooth-discoverable.service` | Keeps Pi discoverable as PiTunes |
| `avahi-daemon.service` | `pitunes.local` mDNS |
| `smbd.service` | Samba music share |
| `NetworkManager.service` | WiFi station + hotspot |
| `ssh.service` | Remote shell (toggle in Settings) |
| `pitunes-update.service` | Stable app-only OTA with rollback |

Useful commands:

```bash
sudo systemctl status mpd pitunes-api nginx shairport-sync bluetooth
sudo journalctl -u pitunes-api -n 100
sudo /opt/pitunes/scripts/appliance-self-test.sh
mpc status
```

Fix hostname on an older install:

```bash
sudo hostnamectl set-hostname pitunes
sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tpitunes/' /etc/hosts
sudo systemctl restart avahi-daemon nginx
```

## API summary

The UI uses JSON endpoints under `/api/`. Highlights:

**Library**

- `GET /api/library/albums?offset=&limit=&filter=`
- `GET /api/library/album/{id}/tracks`
- `GET /api/library/artists|genres|years|composers`
- `GET /api/library/tracks`
- `GET /api/library/favourites`
- `POST /api/library/favourites`
- `GET|POST /api/library/playlists`
- `GET /api/library/radio?scope=all|favourites`
- `GET /api/library/radio/search?q=`
- `POST /api/library/radio/stations` · `POST /api/library/radio/favourites`
- `POST /api/player/radio/play`
- `GET /api/library/scan-status`
- `POST /api/library/rescan`
- `POST /api/library/rebuild-cache`
- `GET /api/search?q=`

**Player**

- `GET /api/player/state`
- `POST /api/player/play|pause|next|previous|seek|volume|queue`

**Network & storage**

- `GET /api/network/wifi/status|scan`
- `POST /api/network/wifi/connect`
- `POST /api/network/hotspot/start|stop`
- `GET /api/storage/network/status`
- `POST /api/storage/network/configure`

**System**

- `GET /api/settings` · `POST /api/settings`
- `GET /api/audio/devices` · `POST /api/audio/output`
- `GET /api/services` · `POST /api/services/control`
- `GET /api/filesystem/roots|browse`
- `POST /api/system/control` (reboot / shutdown)
- `GET /api/system/update/status|log`
- `POST /api/system/update/check|apply`
- `GET /api/health`

Legacy MPD-style routes (`/api/play-album`, `/api/status`, `/api/art`, …) remain for compatibility.

## WiFi hotspot

If the Pi has no Ethernet and cannot join home WiFi, PiTunes starts a setup access point:

| | |
|---|---|
| SSID | `PiTunes` |
| Default password | `pitunesaudio` (change in `/etc/pitunes/wifi-hotspot.conf`) |
| Web UI | http://172.24.1.1 or http://pitunes.local |

Join the hotspot, open the URL, then connect to your network in **Settings** or via:

```bash
sudo /opt/pitunes/scripts/setup-wifi.sh "SSID" "PASSWORD" GB
```

Details: [docs/WIFI_HOTSPOT.md](docs/WIFI_HOTSPOT.md).

## Test without a Raspberry Pi

```bash
python tools/mock-server.py
```

Open `http://127.0.0.1:8095` — responsive mode exercises phone, landscape, and settings layouts. See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md).

## Create a flashable image

Follow [docs/IMAGE_CREATION.md](docs/IMAGE_CREATION.md). Publish a release asset:

```bash
./tools/publish-image-release.sh v1.3.0 image/out/pitunes-armhf.img.xz
```

## Updates and maintenance

Stable devices update PiTunes application files from versioned GitHub Releases, never directly from `main`. Normal OTA does not upgrade Raspberry Pi OS. See [docs/UPDATES.md](docs/UPDATES.md) and [docs/AB_SYSTEM_UPDATES.md](docs/AB_SYSTEM_UPDATES.md) for rollback and system-update policy, and [docs/MAINTENANCE.md](docs/MAINTENANCE.md) for repository ownership and release rules.

Run the read-only release checks before publishing:

```bash
./tools/validate-release.sh v1.3.0
```

## Troubleshooting

[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — USB DAC, DAC HAT, WiFi, hotspot, MPD, artwork, NAS, AirPlay, Bluetooth, and mount issues.

## Performance notes

- No Docker, no desktop environment, no frontend build step
- MPD handles playback only; SQLite handles browse/search metadata
- nginx serves static files; Python API proxies MPD and serves cached art
- CoverFlow animates on index changes (GSAP), not every frame
- Thumbnail cache avoids resizing artwork repeatedly on Pi hardware

## Roadmap

Planned polish and v1.0 items: [docs/ROADMAP.md](docs/ROADMAP.md) (2D CoverFlow fallback, scan progress UI, published release checksums, and more).
