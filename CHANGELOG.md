# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Automated flashable Raspberry Pi image builder (`scripts/build-flashable-image.sh`) — Raspberry Pi OS Lite + EchoFlow.
- Chroot install path for image builds (`scripts/chroot-install.sh`, `ECHOFLOW_IMAGE_BUILD=1`).
- Golden image cleanup script (`scripts/golden-image-cleanup.sh`).
- Optional HDMI kiosk setup (`scripts/setup-kiosk.sh`, build flag `--kiosk`).
- GitHub Actions workflow `build-image.yml` for manual image builds.
- Pinned base OS URLs in `image/build.env`.

## [0.1.0] - 2026-06-03

### Added

- Initial EchoFlow release: MPD playback, Python API, nginx UI, USB music mount, flashable image workflow.
