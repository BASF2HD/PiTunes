# Changelog

## [1.4.2] - 2026-10-06

### Added

- Repeat Off / All / Song and Shuffle controls for native MPD outputs and
  optional browser playback, using official Lucide icons.
- Persist browser playback modes and synchronize native modes with MPD.

### Fixed

- Keep the complete album or playlist queue when starting from a middle song,
  without delaying the first song or restarting playback.
- Preserve background queue completion when pausing or skipping a song.
- Restore playback options on save failure and prevent stale status requests
  from undoing a newly selected mode.

### Changed

- Rebuild both 32-bit and 64-bit images from the tagged source, with playback
  mode tests and installed-file checks in the release workflow.
- Preserve transport button styling, audio formats, and MPD output settings.
- Keep image candidates in draft until physical Pi boot, audio, and OTA
  rollback checks pass.

## [1.4.1] - 2026-09-29

### Fixed

- Keep albums with the same name separate by album artist and release year.
- Update song and album favourite controls immediately, prevent duplicate
  in-flight changes, and restore their state if saving fails.
- Create album playlists with one persistent write instead of a request for
  each song, while preserving track order and removing duplicate entries.

### Changed

- Prepare fresh 32-bit and 64-bit Raspberry Pi images from the tagged source.
  Release builds remain drafts until physical Pi boot and audio checks pass.
- Leave MPD output configuration and native local audio playback unchanged.

## Unreleased

- Added capability-gated signed A/B system-update runtime using Raspberry Pi
  `tryboot`, boot health validation, and automatic rollback.
- Added a separate staging A/B image builder with a stable control partition,
  two boot/root slots, and shared persistent data.
- Added signed system-bundle tooling and unified App/System/Image release
  routing while keeping existing two-partition devices on App OTA.

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Stable OTA now follows versioned GitHub Releases instead of updating directly from `main`.
- Separated installed appliance scripts from build and local-development commands under `tools/`.
- Removed obsolete Plymouth theme, historical restore notes, AI handoff material, and generated local backups.
- Replaced gray favicon assets with a black-and-white PiTunes icon.
- Renamed project from **EchoFlow** to **PiTunes** (paths, services, hostname `pitunes`, mDNS `pitunes.local`, image assets `pitunes-*.img.xz`).
- README and docs now document **both** Raspberry Pi OS Lite images: 32-bit (`armhf`) and 64-bit (`arm64`).

### Added

- Internet radio: Radio Browser search, favourites, saved stations, and MPD stream playback (`docs/RADIO.md`).
- Radio search action menu (favourite, save, more info, remove) and radio logo on cover art with named placeholder when no favicon is available.
- Userdata persistence for favourites, playlists, and radio stations (`backend/library/userdata.py`).
- Mock server helper `tools/start-mock.ps1` for local Windows testing on port 8095.
- Maintainer, update/rollback, and security policies.
- Read-only release validation command (`tools/validate-release.sh`).

- Automated flashable Raspberry Pi image builder (`tools/build-flashable-image.sh`) — Raspberry Pi OS Lite + PiTunes.
- Chroot install path for image builds (`tools/chroot-install.sh`, `PITUNES_IMAGE_BUILD=1`).
- Golden image cleanup script (`scripts/golden-image-cleanup.sh`).
- Optional HDMI kiosk setup (`scripts/setup-kiosk.sh`, build flag `--kiosk`).
- GitHub Actions workflow `build-image.yml` for manual image builds.
- Pinned base OS URLs in `image/build.env`.

## [0.1.0] - 2026-06-03

### Added

- Initial PiTunes release: MPD playback, Python API, nginx UI, USB music mount, flashable image workflow.
