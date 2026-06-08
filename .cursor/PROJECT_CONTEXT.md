# PiTunes — agent context handoff

Use this file when starting a new Cursor chat on the PiTunes workspace. The user should `@PROJECT_CONTEXT.md` so the agent does not need the full EchoFlow chat history.

## Project

- **Name:** PiTunes (renamed from EchoFlow; commit `e3aaa1b`)
- **Path:** `C:\Users\TCT\Downloads\App\PiTunes`
- **GitHub:** https://github.com/BASF2HD/PiTunes (`main`)
- **Do not use:** `C:\Users\TCT\Downloads\App\EchoFlow` (old folder name; stale copy)

## Local dev

- Mock server: `.\scripts\start-mock.ps1` or `py -3 scripts\mock-server.py`
- **URL:** http://127.0.0.1:8095 (port **8095**, not 8090)
- Restart mock server after backend/mock changes

## Internet radio (implemented)

- Search via Radio Browser: `GET /api/library/radio/search` (pagination 20/page)
- Save / favourite / remove: `POST /api/library/radio/stations`, `/favourites`, `/remove`
- Browse saved: `GET /api/library/radio?scope=favourites|all`
- Drawer for radio stations (not empty "0 songs" playlist)
- Three-dots menu on search: Favourite, Save, More info, Remove

## Radio logos / cover art (important)

### Problem solved
- Search list showed logos; **coverflow (Three.js WebGL)** did not — CORS/tainted canvas
- Favourites showed **old blue per-title placeholder** (station initial + name) instead of new icon

### Architecture (Volumio + moOde hybrid)
- Remote favicons only via same-origin proxy: `GET /api/library/radio/icon?url=...&title=...`
- Server fetches, **disk-caches** under `ART_CACHE_DIR/radio-icons/` (SHA-256 of URL)
- Saved station metadata in `userdata.json`; playback lookup by **stream URL** (moOde pattern)
- Stations without a real `http(s)` favicon use static asset: `/assets/radio-no-logo.svg`

### Key frontend files
- `frontend/assets/app.js` — `radioIconProxyUrl()`, `hasRadioFavicon()`, `loadRadioBrowse()`, `ensureTexture()`
- `frontend/assets/renderer.js` — `loadRadioTexture()`, `createRadioPlaceholderTexture()`, `invalidateRadioTextures()`
- `frontend/assets/radio-no-logo.svg` — boombox on **white** background (no-logo placeholder)
- Rebuild placeholder: `py -3 scripts/build-radio-placeholder.py`

### Rules for agents
1. **Never** pass external favicon URLs directly into WebGL — always proxy or static asset
2. No-logo stations → `RADIO_NO_LOGO_ASSET` (`/assets/radio-no-logo.svg?v=2`), same for search and coverflow
3. On `loadRadioBrowse()`, call `invalidateRadioTextures()` to avoid stale WebGL cache
4. Only persist favicons that start with `http://` or `https://` (`userdata._sanitize_favicon`)
5. Bump `app.js?v=` in `frontend/index.html` after frontend changes

## Recent commits (radio / logos)

- `9c46b71` — Boombox placeholder; fix favourites old blue cover; unified static asset
- `687c927` — Same-origin icon proxy + disk cache; texture pipeline fixes
- `ccb7b77` — Internet radio search, favourites, cover art logos

## Known limitations / future work

- ~~Disk cache has no TTL~~ — 7-day TTL on `radio-icons` disk cache (`backend/library/radio_icons.py`)
- ~~Saved stations do not auto-refresh favicon~~ — browse enriches missing favicons via Radio Browser (`list_radio_stations(enrich_missing_favicons=True)`)
- ~~Prefetch logo on save~~ — `add_radio_station` looks up favicon and prefetches into disk cache
- Dynamic now-playing art from stream metadata is separate from station logo (not implemented)
- v0.3 roadmap: CSS 2D CoverFlow fallback, artist picker, scan progress indicator

## Brand / logo assets

- **Sources:** `config/brand/pitunes-logo-source.png` (boot), `pitunes-logo-branded.png` (README/favicons)
- **Regenerate:** `py -3 scripts/build-brand-assets.py`
- **Boot splash:** framebuffer only (`pitunes-fb-splash.service`, no Plymouth) — see `docs/BOOT_SPLASH.md`
- **GitHub / web:** light gray `#d1d1d1` + white logo (from branded source)
- **Web favicon:** `frontend/favicon.ico`, `frontend/assets/favicon.svg`, `pitunes-icon-192.png`
- **GitHub README:** `docs/assets/pitunes-logo.png`
- **GitHub social preview:** `.github/social-preview.png` (upload in repo Settings → General → Social preview)

## Docs

- `docs/RADIO.md` — radio feature overview
