# EchoFlow Roadmap

EchoFlow is a lightweight Raspberry Pi music player OS with local music playback, CoverFlow-style browsing, AirPlay input, Bluetooth audio input, and DAC-friendly output.

## v0.2 — Library performance (in progress)

- [x] SQLite library cache and incremental scanner
- [x] Paginated albums API and FTS search
- [x] Virtual CoverFlow and 128px artwork tier
- [ ] Document Pi Zero 2 W / Pi 4 in README hardware matrix

## v0.3 — UI and polish

- [ ] CSS 2D CoverFlow fallback (no WebGL) for Pi Zero 2 W
- [ ] Artist picker (not only first artist)
- [ ] Scan progress indicator in main UI
- [ ] Real ALSA device list in settings

## v0.4 — AirPlay

- [ ] Shairport Sync install script and systemd unit
- [ ] Source manager: Local / AirPlay
- [ ] Auto-pause MPD when AirPlay session starts

## v0.5 — Bluetooth

- [ ] BlueALSA receiver mode
- [ ] Pairing and device management UI
- [ ] Source manager: Bluetooth input

## v0.6 — EchoFlow OS image

- [x] Automated flashable image build (`scripts/build-flashable-image.sh`)
- [x] Golden SD cleanup + manual `create-image.sh` workflow
- [ ] Published release on GitHub with checksums
- [x] GitHub Actions workflow to build image artifacts
- [ ] CI smoke tests (API health, library scan)

## v1.0 — Public stable

- [ ] Security review (LAN-only API model documented)
- [ ] User guide vs developer guide split
- [ ] Screenshot set for README and releases
