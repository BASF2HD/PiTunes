# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- SQLite library cache for fast album browse, search (FTS5), artists, genres, and years.
- Incremental background library scanner using `python3-mutagen` tag reading.
- Paginated `GET /api/library/albums?offset=&limit=` with `total` count.
- `GET /api/library/scan-status` for scan progress.
- 128px and 420px artwork thumbnail tiers (`/api/art?album_id=&size=`).
- Virtual CoverFlow rendering (fixed GPU card pool, texture LRU).
- Persistent per-thread MPD connections for lower API latency.
- MIT license, contributing guide, and roadmap documents.

### Changed

- Library rescan rebuilds SQLite cache and triggers MPD `update` for playback sync.
- Rebuild artwork button refreshes album art paths in the library database.
- Default album page size reduced to 96 with infinite scroll in the UI.

## [0.1.0] - 2026-06-03

### Added

- Initial EchoFlow release: MPD playback, Python API, nginx UI, USB music mount, flashable image workflow.
