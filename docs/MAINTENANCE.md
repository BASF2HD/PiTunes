# Maintainer Guide

PiTunes is maintained as an appliance, not as a general-purpose Raspberry Pi installation. Changes must preserve playback, boot, network recovery, and local-display behavior.

## Repository ownership

| Path | Purpose | Installed on device |
|------|---------|---------------------|
| `backend/` | Python API and library index | Yes |
| `frontend/` | Browser and kiosk UI | Yes |
| `scripts/` | Appliance runtime and on-device maintenance scripts | Yes |
| `config/` | Versioned appliance defaults | Yes |
| `systemd/` | PiTunes-owned units | Installed into `/etc/systemd/system` |
| `nginx/` | PiTunes web-server configuration | Installed |
| `tools/` | Build, release, local-development, and asset-generation commands | No |
| `tests/` | Automated checks | No |
| `image/` | Image-build metadata and generated-output location | No |
| `docs/` | User and maintainer documentation | No |

Do not move installed runtime paths without a migration that supports existing devices. Systemd units and backend modules depend on `/opt/pitunes/scripts/`.

## Naming conventions

- Product-owned services and persistent files use the `pitunes-` or `pitunes` prefix.
- Shell commands use lowercase kebab-case, for example `pitunes-update.sh`.
- Python modules use lowercase snake_case.
- Generated files belong under ignored cache/output directories and must not be committed.
- Historical backups do not belong in the repository. Use Git tags and release artifacts.

## Change process

1. Make a focused change and update `CHANGELOG.md`.
2. Run `./tools/validate-release.sh`.
3. Test the mock UI for frontend/backend contract changes.
4. Test on a staging Pi, including reboot and `sudo /opt/pitunes/scripts/appliance-self-test.sh`.
5. Test OTA rollback before publishing a stable release.
6. Tag only a commit that passed staging validation.

## Release rules

- `main` is development history; installed stable devices do not update directly from it.
- Stable app OTA follows the latest non-draft, non-prerelease GitHub Release.
- A release tag must be `v<config/version.json>`.
- Major Raspberry Pi OS changes require newly built and tested images.
- Never publish an image containing logs, host keys, saved WiFi networks, music, or maintainer credentials.
- Never publish `pitunes-release.json` with `updateType: system` until the signed
  A/B bundle and power-loss matrix pass on staging hardware.
- Keep the system-update private signing key offline and outside this repository.

## Cleanup policy

The following are always local/generated and are ignored:

- `.cache/`
- `backups/`
- `__pycache__/`
- `image/cache/`, `image/work/`, and generated files under `image/out/`

Run `tools/validate-release.sh` before release to catch obsolete paths and accidental runtime/development mixing.
