# PiTunes Roadmap

PiTunes is a lightweight Raspberry Pi music player OS with local music playback, CoverFlow-style browsing, AirPlay input, Bluetooth audio input, and DAC-friendly output.

## v0.2 — Library performance (in progress)

- [x] SQLite library cache and incremental scanner
- [x] Paginated albums API and FTS search
- [x] Virtual CoverFlow and 128px artwork tier
- [x] Document Pi Zero 2 W / Pi 4 / Pi 5 and 32-bit vs 64-bit Lite images in README

## v0.3 — UI and polish

- [ ] CSS 2D CoverFlow fallback (no WebGL) for Pi Zero 2 W
- [ ] Artist picker (not only first artist)
- [ ] Scan progress indicator in main UI
- [x] ALSA device list in settings (`GET /api/audio/devices`)

## v0.4 — AirPlay

- [x] Shairport Sync install (`scripts/setup-wireless-audio.sh`, `shairport-sync.service`)
- [x] Service toggle and now-playing UI in Settings
- [ ] Unified source manager (auto-pause MPD when AirPlay starts)

## v0.5 — Bluetooth

- [x] BlueALSA A2DP sink (`pitunes-bluealsa-aplay.service`, pairing agent)
- [x] Discoverable as PiTunes; enable/disable from Settings
- [ ] Device management UI (paired-device list, forget device)
- [ ] Unified source manager with local library

## v0.6 — PiTunes OS image

- [x] Automated flashable image build (`scripts/build-flashable-image.sh`)
- [x] Golden SD cleanup + manual `create-image.sh` workflow
- [ ] Published release on GitHub with checksums
- [x] GitHub Actions workflow to build image artifacts
- [ ] CI smoke tests (API health, library scan)

## v1.0 — Public stable

- [ ] Security review (LAN-only API model documented)
- [ ] User guide vs developer guide split
- [ ] Screenshot set for README and releases
