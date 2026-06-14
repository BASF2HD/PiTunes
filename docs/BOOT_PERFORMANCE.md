# PiTunes boot performance

Run this on a **booted Pi** (not Windows dev host):

```bash
sudo /opt/pitunes/scripts/boot-performance-report.sh
```

Reports are written to `/var/log/pitunes/boot-performance-*.txt`.

## Quick commands

```bash
systemd-analyze
systemd-analyze blame | head -30
systemd-analyze critical-chain
systemd-analyze critical-chain pitunes-display.service
```

## Implemented optimisations

| Change | Effect |
|--------|--------|
| `nginx.service` override (no `network-online`) | UI stack no longer waits 5–15 s for DHCP/WiFi |
| `NetworkManager-wait-online` disabled | Removes artificial network stall from boot path |
| `pitunes-display` starts after `lightdm` only | Chromium launches as soon as X is up; script polls nginx |
| `pitunes-display.sh` waits for `/` not `/api/health` | Static UI appears before API/library finish starting |
| openbox autostart: `xsetroot` + `unclutter` | Black background and hidden cursor instead of blank desktop |
| Samba via `pitunes-samba-late.timer` | Starts ~10 s after boot; avoids ordering cycle and multi-user stall |
| `pitunes-startup-scan` after display | Library scan does not block UI |

### Critical path to CoverFlow UI

```text
local-fs → nginx + pitunes-api + mpd (parallel, no network-online)
         → lightdm → openbox (black background)
         → pitunes-display (Chromium)
         → pitunes-mount / startup-scan / hotspot (background)
```

`pitunes-display.service` waits for:

1. `lightdm` / X11 socket
2. `GET http://127.0.0.1/` (nginx static UI; API loads in-page)

### Services that often dominate `blame`

| Service | Why | Recommendation |
|---------|-----|----------------|
| `NetworkManager-wait-online` | DHCP/WiFi timeout | **Disabled** on PiTunes image |
| `nmbd.service` | NetBIOS browse | **Deferred** past graphical boot |
| `pitunes-hotspot.service` | Network watch | Starts **after** `pitunes-display` |
| `pitunes-startup-scan.service` | Library scan | Runs **after** `pitunes-display.service` |
| `smbd` / `avahi-daemon` | LAN sharing / mDNS | Optional defer if boot time critical |

### Preserve (do not disable)

- `mpd.service`, `pitunes-api.service`, `nginx.service`
- `pitunes-display.service`, `lightdm.service`
- `shairport-sync.service`, `bluetooth.service`, `bluealsa.service`
- `pitunes-bt-agent.service`, `pitunes-bluealsa-aplay.service`

## Optional optimisations (manual)

### USB-only music: faster mount unit

```ini
# /etc/systemd/system/pitunes-mount.service.d/no-wait-network.conf
[Unit]
Wants=
After=local-fs.target
```

Only if you do **not** need NAS music at boot.

### Defer Samba / Avahi (LAN features)

```bash
sudo systemctl disable smbd nmbd avahi-daemon
# Enable from Settings when needed, or add timer-based start
```

## Chromium kiosk (implemented)

| Change | File |
|--------|------|
| GPU flags, cache sizing | `scripts/pitunes-display.sh` |
| Black X background until Chromium paints | `scripts/setup-kiosk.sh` openbox autostart |
| Inline `#08080f` background | `frontend/index.html` |
| gzip for JS/CSS | `nginx/pitunes.conf` |

## Cold boot vs soft reboot

Power-off/on can feel slower than `sudo reboot` because:

- SD card and filesystem init are colder
- WiFi association may take longer before background services finish
- Perceived time includes firmware and kernel startup **before** `systemd-analyze` starts counting

Use `systemd-analyze` on the Pi after a cold boot for real numbers on your hardware.

## Boot presentation

PiTunes deliberately masks Plymouth and the obsolete framebuffer splash. The kiosk stays dark until Chromium displays the in-app PiTunes splash. Re-run `sudo /opt/pitunes/scripts/setup-kiosk-boot.sh` after changing boot configuration.
