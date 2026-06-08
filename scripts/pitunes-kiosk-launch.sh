#!/usr/bin/env bash
# Run inside the openbox X session: splash logo, then Chromium kiosk.
set -euo pipefail

URL="${PITUNES_DISPLAY_URL:-http://127.0.0.1/?kiosk=1}"
DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
PROFILE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/pitunes-kiosk-chromium"
LOGO="/opt/pitunes/frontend/assets/pitunes-logo-splash.png"
SPLASH_SECS="${PITUNES_SPLASH_SECS:-3}"
SPLASH_LOGO_WIDTH="${PITUNES_SPLASH_LOGO_WIDTH:-200}"
SPLASH_FRAME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pitunes-splash-frame.png"
CHROMIUM="$(command -v chromium-browser || command -v chromium)"

build_splash_frame() {
  python3 - "${LOGO}" "${SPLASH_FRAME}" "${SPLASH_LOGO_WIDTH}" <<'PY'
import os
import subprocess
import sys

from PIL import Image

logo_path, out_path, logo_width_s = sys.argv[1:4]
logo_width = max(80, int(logo_width_s))
display_w, display_h = 800, 480
try:
    xdpy = subprocess.check_output(
        ["xdpyinfo"],
        env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")},
        text=True,
        stderr=subprocess.DEVNULL,
    )
    for line in xdpy.splitlines():
        if "dimensions:" in line:
            display_w, display_h = map(int, line.split()[1].split("x"))
            break
except Exception:
    pass

logo = Image.open(logo_path).convert("RGBA")
scale = logo_width / logo.width
logo_height = max(1, int(logo.height * scale))
logo = logo.resize((logo_width, logo_height), Image.Resampling.LANCZOS)

canvas = Image.new("RGB", (display_w, display_h), (8, 8, 15))
offset_x = (display_w - logo_width) // 2
offset_y = (display_h - logo_height) // 2
canvas.paste(logo, (offset_x, offset_y), logo)

os.makedirs(os.path.dirname(out_path), exist_ok=True)
canvas.save(out_path, "PNG")
PY
}

export DISPLAY XAUTHORITY

xsetroot -solid '#08080f' >/dev/null 2>&1 || true
xset s off >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root >/dev/null 2>&1 &
fi

SPLASH_START=$SECONDS
SPLASH_PID=""
if command -v feh >/dev/null 2>&1 && [ -s "${LOGO}" ]; then
  build_splash_frame
  if [ -s "${SPLASH_FRAME}" ]; then
    feh --fullscreen --auto-nozoom --no-fehbg --borderless "${SPLASH_FRAME}" >/dev/null 2>&1 &
    SPLASH_PID=$!
  fi
fi

nginx_wait=0
while ! curl -fsS --max-time 1 http://127.0.0.1/ >/dev/null 2>&1; do
  nginx_wait=$((nginx_wait + 1))
  if [ "${nginx_wait}" -ge 10 ]; then
    break
  fi
  sleep 0.1
done

splash_elapsed=$((SECONDS - SPLASH_START))
if [ "${splash_elapsed}" -lt "${SPLASH_SECS}" ]; then
  sleep $((SPLASH_SECS - splash_elapsed))
fi

mkdir -p "${PROFILE_DIR}"
rm -f "${PROFILE_DIR}"/Singleton*

"${CHROMIUM}" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --disable-extensions \
  --disable-breakpad \
  --disable-domain-reliability \
  --disable-features=TranslateUI,MediaRouter,OptimizationHints,AutofillServerCommunication,PasswordManager,Autofill,PasswordImport,IsolateOrigins,site-per-process,BackForwardCache \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --autoplay-policy=no-user-gesture-required \
  --disk-cache-size=33554432 \
  --media-cache-size=16777216 \
  --touch-events=enabled \
  --enable-gpu-rasterization \
  --use-angle=gles \
  --ignore-gpu-blocklist \
  --disable-logging \
  --kiosk "${URL}" &
CHROME_PID=$!

sleep 1
if [ -n "${SPLASH_PID}" ]; then
  kill "${SPLASH_PID}" 2>/dev/null || true
fi

wait "${CHROME_PID}"
