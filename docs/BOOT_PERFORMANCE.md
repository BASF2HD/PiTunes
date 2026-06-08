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

## Splash-related wins (implemented)

| Change | Effect |
|--------|--------|
| Remove Plymouth (`splash` cmdline token) | Eliminates initramfs Plymouth and quit-wait delays |
| Framebuffer one-shot splash | No daemon, no animation CPU/GPU load |
| `disable_splash=1` | Drops firmware rainbow delay |
| Quiet cmdline | Hides console painting on HDMI |

## Service bottlenecks (typical PiTunes image)

Measured values depend on SD card, Pi model, and library size. Use `boot-performance-report.sh` on your hardware for real numbers.

### Critical path to CoverFlow UI

```text
local-fs → pitunes-fb-splash → nginx + pitunes-api + mpd (parallel)
         → lightdm → pitunes-display (Chromium)
         → pitunes-mount / network-online / startup-scan (background)
```

`pitunes-display.service` waits for:

1. `lightdm` / X11 socket
2. `GET http://127.0.0.1/` (nginx static UI; API/library load in-page)

### Services that often dominate `blame`

| Service | Why | Recommendation |
|---------|-----|----------------|
| `pitunes-hotspot.service` | `TimeoutStartSec=180`, network watch | Starts **after** `pitunes-display` (off CoverFlow path) |
| `pitunes-mount.service` | USB scan / NAS remount | Runs in parallel; no `network-online` gate |
| `pitunes-startup-scan.service` | Full library scan on first boot | Runs **after** `pitunes-display.service` |
| `userconfig.service` | First-boot user setup (image) | Runs once; negligible after golden image |
| `bluetooth.service` / `hciuart` | Firmware init | Required for BT audio; ~1–3 s typical |
| `smbd` / `avahi-daemon` | LAN sharing / mDNS | Can defer 10–15 s if boot time critical (optional) |
| `plymouth-quit-wait` | **Should be masked** | Remove if still enabled |

### Preserve (do not disable)

- `mpd.service`, `pitunes-api.service`, `nginx.service`
- `pitunes-display.service`, `lightdm.service`
- `shairport-sync.service`, `bluetooth.service`, `bluealsa.service`
- `pitunes-bt-agent.service`, `pitunes-bluealsa-aplay.service`

## Optional optimisations (manual)

### 1. Delay library scan until after UI

```ini
# /etc/systemd/system/pitunes-startup-scan.service.d/after-ui.conf
[Unit]
After=pitunes-display.service
```

```bash
sudo systemctl daemon-reload
```

### 2. USB-only music: faster mount unit

```ini
# /etc/systemd/system/pitunes-mount.service.d/no-wait-network.conf
[Unit]
Wants=
After=local-fs.target
```

Only if you do **not** need NAS music at boot.

### 3. Defer Samba / Avahi (LAN features)

```bash
sudo systemctl disable smbd nmbd avahi-daemon
# Enable from Settings when needed, or add timer-based start
```

### 4. Hotspot only when WiFi missing

Already the design of `wifi-hotspot.sh watch`. If boot is slow on Ethernet-only installs, add a drop-in:

```ini
# /etc/systemd/system/pitunes-hotspot.service.d/after-display.conf
[Unit]
Before=
After=pitunes-display.service
```

## Estimated impact (qualitative)

| Scenario | Typical improvement |
|----------|---------------------|
| Plymouth → framebuffer splash | **2–8 s** faster to multi-user (no plymouth-quit-wait) |
| Remove `network-online` from mount (USB only) | **1–5 s** when network slow |
| Defer startup scan | UI appears before scan; perceived boot much faster |
| Quiet cmdline + `disable_splash` | Cleaner HDMI; small firmware gain |

Run `boot-performance-report.sh` before and after changes on the **same SD card** to record actual deltas.

## Plymouth must stay off

Do not re-enable Plymouth for splash. Use:

```bash
sudo /opt/pitunes/scripts/setup-boot-splash.sh
```

If boot hangs after experiments:

```bash
grep -E 'splash|plymouth' /boot/firmware/cmdline.txt
systemctl is-enabled plymouth-quit-wait.service
```
