# Contributing to PiTunes

Thank you for helping improve PiTunes. This project targets **Raspberry Pi OS Lite (Bookworm)** on Pi 3, Pi 3B+, Pi 4, Pi 5, and Pi Zero 2 W — **32-bit (`armhf`)** and **64-bit (`arm64`)** images. Keep changes small and testable on low-memory hardware.

## Development setup

1. Clone the repository.
2. Run the mock API for UI work (no MPD required):

```bash
python tools/mock-server.py
```

Open `http://127.0.0.1:8095`.

3. For backend work with a real library, run on a Pi or Linux host with MPD and music under `/mnt/music`:

```bash
cd backend
sudo -E python3 server.py
```

Set `PITUNES_CACHE_DIR` to a writable path if not using `/var/cache/pitunes`.

## Code guidelines

- **Do not** replace the Python backend with Node.js.
- Keep MPD responsible for playback only; put browse/search metadata in SQLite.
- Prefer stdlib and apt packages (`python3-mutagen`, `python3-pil`) over heavy dependencies.
- Match existing style: minimal comments, no unnecessary abstractions.
- Keep installed appliance commands in `scripts/`; put build and local-development commands in `tools/`.
- Test CoverFlow changes in browser responsive mode and on a Pi 3 when possible.
- Run `./tools/validate-release.sh` before opening a pull request.

## Pull requests

1. Describe hardware tested (e.g. Pi 3B+, Zero 2 W).
2. Note any API changes and update `CHANGELOG.md` under `[Unreleased]`.
3. Keep PRs focused — one feature or fix per PR when possible.

## Reporting issues

Include Pi model, OS version, library size (approx. albums/tracks), and relevant logs:

```bash
sudo journalctl -u pitunes-api -n 80
mpc status
```

Report security issues privately as described in [SECURITY.md](SECURITY.md).
