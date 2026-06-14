# Local Testing Without a Raspberry Pi

PiTunes can be tested on a normal computer with the mock server. This serves the real web UI and fake MPD-like API data, so you can inspect layout, controls, and responsive views before flashing a Raspberry Pi image.

## Start the Mock App

From the PiTunes project folder:

```bash
python tools/mock-server.py
```

On Windows, if `python` is not mapped:

```powershell
py -3 tools\mock-server.py
```

Open:

```text
http://127.0.0.1:8095
```

The mock server supports albums, artists, tracks, artwork, playback status, volume, seek, play album, play track, stop, pause, resume, rescan, and settings calls. It does not play real audio.

## Smartphone View

Use your browser's responsive mode:

- Chrome or Edge: press `F12`, then press `Ctrl+Shift+M`.
- Choose a phone preset such as iPhone SE, Pixel, or Galaxy.
- Test Albums, Artists, Tracks, Now, and Settings tabs.
- Confirm the bottom playback controls remain reachable.

Suggested viewport:

```text
390 x 844 portrait
```

## Playback Landscape View

Use responsive mode and rotate the viewport.

Suggested viewport:

```text
844 x 390 landscape
```

Check:

- Now tab artwork and text fit without overlap.
- Transport controls stay visible.
- Seek and volume sliders are usable.
- Track rows do not resize unpredictably.

## Monitor View

Test a desktop monitor viewport.

Suggested viewports:

```text
1366 x 768
1920 x 1080
```

Check:

- Sidebar navigation is visible.
- PiTunes album browser scrolls horizontally.
- Album list and artist list use available width.
- Player bar does not cover active content.

## Configuration View

Click `Settings`.

Check:

- Music folder input defaults to `/mnt/music`.
- Audio output menu shows auto, USB DAC, DAC HAT, HDMI, and headphones.
- Save button returns a mock saved message.

## Browser Console Checks

Open the developer console and confirm there are no JavaScript errors after:

- Loading the page.
- Switching every tab.
- Searching the library.
- Pressing play/pause/stop/next/previous.
- Moving volume and seek sliders.
- Saving settings.

## What Still Needs Real Pi Testing

The mock app validates UI and API wiring, but these still require Raspberry Pi hardware:

- ALSA device selection.
- USB DAC and DAC HAT output.
- MPD playback with real files.
- USB drive auto-mounting.
- Avahi/mDNS on the target network.
- Boot-time library scan.
