# EchoFlow Restore Plan

Baseline captured **before the stack-layout refactor** (album info / cover / chrome layering).

## Baseline reference

| Item | Value |
|------|--------|
| Git tag | `baseline-pre-stack-layout-v119` |
| Frontend cache | `app.js?v=119`, `styles.css?v=119` |
| Pi host | `pi@192.168.1.126` |
| Pi app root | `/opt/echoflow/` |
| Pi display service | `echoflow-display` |

## What this baseline includes

- **Frontend (v119):** overlay layout (seek/search/volume over cover), album info font A-/A+/reset with cover lift, fullscreen transport, settings close button, custom audio settings pickers, layout fixes for album info visibility and cover offset.
- **Backend:** `audio_output.py`, DAC HAT catalog (`config/dac-hats.json`), `/api/audio/devices` and `/api/audio/output`, `scripts/apply-audio-output.sh`.
- **Not in git (Pi-only / optional):** `backend/input_sources.py` (AirPlay/external input — imported optionally; missing file does not break server).

## Restore from git (Mac or any clone)

```bash
cd /path/to/EchoFlow

# Option A — exact tagged baseline
git fetch origin
git checkout baseline-pre-stack-layout-v119

# Option B — stay on main at the baseline commit
git checkout main
git pull origin main
# baseline commit is the one tagged baseline-pre-stack-layout-v119
```

Hard reset local work to the tag (destructive):

```bash
git fetch origin
git reset --hard baseline-pre-stack-layout-v119
```

## Deploy baseline to Pi

From your Mac, with the repo checked out at the baseline tag/commit:

```bash
SRC=/path/to/EchoFlow
PI=pi@192.168.1.126
REMOTE=/opt/echoflow

# Frontend
rsync -az "$SRC/frontend/assets/" "$PI:/tmp/echoflow-restore/"
rsync -az "$SRC/frontend/index.html" "$PI:/tmp/echoflow-restore/"
ssh "$PI" "sudo cp /tmp/echoflow-restore/app.js /tmp/echoflow-restore/styles.css \
  /tmp/echoflow-restore/renderer.js $REMOTE/frontend/assets/ && \
  sudo cp /tmp/echoflow-restore/index.html $REMOTE/frontend/"

# Backend audio (if rolling back backend too)
rsync -az "$SRC/backend/audio_output.py" "$PI:/tmp/echoflow-restore/"
rsync -az "$SRC/backend/server.py" "$PI:/tmp/echoflow-restore/"
rsync -az "$SRC/config/dac-hats.json" "$PI:/tmp/echoflow-restore/"
rsync -az "$SRC/scripts/apply-audio-output.sh" "$PI:/tmp/echoflow-restore/"
ssh "$PI" "sudo cp /tmp/echoflow-restore/audio_output.py /tmp/echoflow-restore/server.py \
  $REMOTE/backend/ && \
  sudo cp /tmp/echoflow-restore/dac-hats.json $REMOTE/config/ && \
  sudo cp /tmp/echoflow-restore/apply-audio-output.sh $REMOTE/scripts/ && \
  sudo chmod +x $REMOTE/scripts/apply-audio-output.sh"

# Restart services
ssh "$PI" "sudo systemctl restart echoflow-api echoflow-display"
```

## Pi quick backup (before any experiment)

Run on the Pi **before** deploying a risky change:

```bash
sudo mkdir -p /tmp/echoflow-deploy
sudo cp -a /opt/echoflow/frontend/assets/app.js \
  /opt/echoflow/frontend/assets/styles.css \
  /opt/echoflow/frontend/assets/renderer.js \
  /opt/echoflow/frontend/index.html \
  /tmp/echoflow-deploy/
```

Restore from that Pi backup without git:

```bash
sudo cp /tmp/echoflow-deploy/app.js /tmp/echoflow-deploy/styles.css \
  /tmp/echoflow-deploy/renderer.js /opt/echoflow/frontend/assets/
sudo cp /tmp/echoflow-deploy/index.html /opt/echoflow/frontend/
sudo systemctl restart echoflow-display
```

## Verification checklist

After restore, confirm on the Pi touchscreen:

1. Cover art visible, not clipped at top or bottom.
2. Album title/artist visible below the cover (not hidden).
3. Seek bar above the cover; does not overlap album info in normal mode.
4. Settings → Album Info Font A+/A- changes text size and cover shifts.
5. Settings → Audio Output shows route / DAC HAT / ALSA pickers; Apply Output works.
6. Fullscreen: transport buttons bottom-left; seek bar stays above info.
7. Browse menus and song drawer still work.

API smoke test (from Mac):

```bash
curl -s http://192.168.1.126/api/audio/devices | head -c 200
curl -s http://192.168.1.126/api/health
```

## Refactor workflow (stack layout)

1. Create branch: `git checkout -b feat/stack-layout`
2. Implement phases from the stack-layout design doc (top chrome / stage / bottom chrome).
3. If broken on Pi: `git checkout baseline-pre-stack-layout-v119` and redeploy using commands above.
4. Do **not** change cache `?v=` on `main` until the refactor is verified on Pi.

## Known limitations at this baseline

- Layout uses `positionChrome()` with 3D offset tuning — fragile across screen sizes (why the stack-layout refactor is planned).
- Cover vertical position uses `DEFAULT_COVERFLOW_OFFSET_Y = 32` (normal) / `16` (fullscreen).
- Album info is absolutely positioned over the canvas area, anchored to projected cover bounds.
