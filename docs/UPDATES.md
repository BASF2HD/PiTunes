# Update and Rollback Policy

PiTunes separates application updates from Raspberry Pi OS maintenance so a UI or playback change cannot unexpectedly replace the operating system.

## Stable app OTA

The Settings update action:

1. checks the latest stable GitHub Release
2. requires its version to be newer than the installed `config/version.json`
3. downloads that release by immutable commit SHA
4. validates required files, shell syntax, Python syntax, and release version
5. creates application and system-file rollback archives
6. installs PiTunes-owned files only
7. restarts nginx and the API, then waits for `/api/health`
8. restores the previous version automatically if validation or health checks fail

The update screen remains locked while installation is running. Logs are stored at `/var/log/pitunes-update.log`; status is stored at `/var/lib/pitunes/update-status.json`. The newest three rollback sets are retained by default.

App OTA does not run `apt`, replace the kernel, update firmware, or modify the Raspberry Pi OS base.

Existing devices running the older `main`-tracking updater must receive the first release-based updater while `main` is held at that release commit. After that migration release, stable devices follow releases only.

## Signed A/B system OTA

PiTunes contains a capability-gated A/B updater for curated kernel, firmware,
Chromium, MPD, dependency, and Raspberry Pi OS security updates. It is disabled
on existing two-partition images and must not be enabled publicly until the A/B
image layout and power-loss test matrix pass on supported hardware.

The updater verifies signed release assets, writes only the inactive boot/root
slot, performs one Raspberry Pi `tryboot`, and commits the new slot only after
nginx, MPD, the API, and `/api/health` pass. See
[AB_SYSTEM_UPDATES.md](AB_SYSTEM_UPDATES.md).

Until an A/B image passes that gate, OS security fixes are delivered through
newly built and tested SD-card images:

1. update the pinned Raspberry Pi OS release in `image/build.env`
2. build both supported architectures
3. boot-test each image on supported hardware
4. verify playback, kiosk, WiFi recovery, AirPlay, Bluetooth, storage, and reboot
5. publish image checksums with the release

Do not enable unattended full-distribution upgrades on public PiTunes images. An untested package transition can break audio, Chromium kiosk mode, networking, or boot without a reliable rollback path.

## Release routing

The UI always presents one Software Update action. A release may include
`pitunes-release.json` with one update type:

- `app`: install using transactional App OTA
- `system`: install only on a matching A/B-capable image
- `image`: show that a newly tested SD-card image is required

Releases without the descriptor remain App OTA releases for compatibility.

## Staging OTA safely

Use a separate staging Pi or cloned SD card:

1. install the currently published stable release
2. add a small test library and verify playback
3. publish a prerelease and test it manually; stable devices ignore prereleases
4. test a deliberately failing health check and confirm rollback
5. publish the release as stable only after reboot and appliance self-test pass

For a failed update, collect:

```bash
sudo tail -n 200 /var/log/pitunes-update.log
cat /var/lib/pitunes/update-status.json
sudo journalctl -u pitunes-update.service -n 200 --no-pager
```
