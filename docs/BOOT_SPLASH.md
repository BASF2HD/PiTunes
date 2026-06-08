# PiTunes boot splash (framebuffer, no Plymouth)

PiTunes uses the **fastest** appliance-style splash: a static white logo painted directly to `/dev/fb0`. There is **no Plymouth**, no animation, and no image viewers (`fbi`, `feh`, Chromium, etc.).

## What you see

1. **Kernel / firmware** — Raspberry Pi rainbow splash disabled (`disable_splash=1`).
2. **Framebuffer** — black screen with centered white PiTunes logo (`pitunes-fb-splash.service`).
3. **X / kiosk** — black background until Chromium CoverFlow loads (`pitunes-display.service`).

Logo source: `config/brand/pitunes-logo-source.png` (white marks, transparent background).

## Install / rebuild assets

On the Pi or image chroot (requires `python3-pil`):

```bash
sudo /opt/pitunes/scripts/setup-boot-splash.sh
```

This will:

- Build preset raw frames under `config/boot/` (`splash-WxH-32.raw`, `splash-WxH-16.raw`)
- Mask/disable Plymouth units if present
- Set `cmdline.txt` and `config.txt` boot options
- Enable `pitunes-fb-splash.service`

Regenerate frames only:

```bash
python3 /opt/pitunes/scripts/build-boot-fb-splash.py --build
```

Paint framebuffer manually (debug):

```bash
sudo python3 /opt/pitunes/scripts/build-boot-fb-splash.py --paint
```

## Boot parameters

### `/boot/firmware/cmdline.txt` (or `/boot/cmdline.txt`)

| Token | Purpose |
|--------|---------|
| `quiet` | Suppress most kernel messages |
| `loglevel=0` | Minimal console logging |
| `logo.nologo` | Hide Linux kernel logo |
| `vt.global_cursor_default=0` | Hide blinking cursor |
| `systemd.show_status=false` | Hide systemd status lines |
| `rd.udev.log_level=0` | Quiet initramfs udev |
| `console=tty3` | Keep serial/debug off HDMI tty |

**Do not use** `splash` — that enables Plymouth and slows boot.

### `/boot/firmware/config.txt`

| Key | Value |
|-----|--------|
| `disable_splash=1` | Disable firmware rainbow splash |

**Remove** `auto_initramfs=1` if it was only used for Plymouth.

## Services

| Unit | Role |
|------|------|
| `pitunes-fb-splash.service` | One-shot paint to `/dev/fb0` early in boot |
| `pitunes-display.service` | Chromium CoverFlow UI (replaces splash visually) |

Plymouth units are **masked** when `setup-boot-splash.sh` runs.

## Flashable image builds

`install.sh` calls `setup-boot-splash.sh` during image chroot with `PITUNES_BOOT_DIR=/boot/firmware` so `cmdline.txt` / `config.txt` are baked into the release image.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Rainbow square at power-on | `disable_splash=1` in `config.txt` |
| Plymouth spinner | `splash` removed from cmdline; Plymouth units masked |
| Text scroll on HDMI | `quiet loglevel=0 systemd.show_status=false` |
| Wrong logo size | Run `--build` presets; runtime `--paint` scales for non-preset resolutions |
| Logo disappears before UI | Expected at X startup; openbox/Chromium use black until CoverFlow loads |

See also [BOOT_PERFORMANCE.md](BOOT_PERFORMANCE.md) for systemd timing analysis.
