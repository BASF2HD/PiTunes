# EchoFlow Backend API

The backend is a small Python service that talks to MPD over the local MPD socket/TCP protocol. It has no Flask/FastAPI dependency and is intended to run well on a Raspberry Pi 3.

Key endpoints:

- `GET /api/albums`
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
- `POST /api/rescan`
- `GET /api/settings`
- `POST /api/settings`

Album art is resolved from common folder image names first, then from MPD `readpicture` embedded metadata if MPD supports it for that file. Thumbnails are cached under `/var/cache/echoflow/art`.
