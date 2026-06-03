# EchoFlow Backend API

The backend is a small Python service: **MPD** for playback, **SQLite** for browse/search. No Flask/FastAPI dependency; intended for Raspberry Pi 3 and Pi Zero 2 W.

## Modules

- `server.py` — HTTP routes, artwork, settings
- `mpd_client.py` — persistent per-thread MPD connections
- `shared.py` — paths and MPD helpers
- `library/` — SQLite schema, incremental scanner, queries

## Library cache

Database: `/var/cache/echoflow/library.db` (`ECHOFLOW_LIBRARY_DB`).

```bash
curl -X POST http://127.0.0.1/api/library/rescan
curl http://127.0.0.1/api/library/scan-status
```

Requires `python3-mutagen` (installed by `install.sh`).

Key endpoints:

- `GET /api/library/albums?offset=0&limit=96`
- `GET /api/library/scan-status`
- `GET /api/search?q=query`
- `GET /api/albums` (legacy)
- `GET /api/artists`
- `GET /api/tracks?album=Album%20Name`
- `GET /api/status`
- `GET /api/art?album=Album%20Name`
- `POST /api/play-album` with `{"album":"Album Name"}`
- `POST /api/play-track` with `{"file":"relative/path.flac"}`
- `POST /api/pause`, `/api/resume`, `/api/toggle`, `/api/stop`
- `POST /api/next`, `/api/previous`
- `POST /api/volume` with `{"volume":75}`
- `POST /api/seek` with `{"seconds":120}`
- `POST /api/library/rescan` (SQLite + MPD update)
- `POST /api/rescan` (alias)
- `GET /api/settings`
- `POST /api/settings`

Album art is resolved from folder images (`cover.jpg`, `folder.jpg`, …) or MPD `readpicture`. Thumbnails are cached at **128px** (CoverFlow) and **420px** under `/var/cache/echoflow/art` (`/api/art?album_id=1&size=128`).
