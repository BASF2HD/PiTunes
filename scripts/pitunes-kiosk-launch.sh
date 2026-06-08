#!/usr/bin/env bash
# Run inside the openbox X session: dark screen, then Chromium with in-page splash only.
set -euo pipefail

URL="${PITUNES_DISPLAY_URL:-http://127.0.0.1/?kiosk=1&v=279}"
DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
PROFILE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/pitunes-kiosk-chromium"
CHROMIUM="$(command -v chromium-browser || command -v chromium)"

export DISPLAY XAUTHORITY

xsetroot -solid '#08080f' >/dev/null 2>&1 || true
xset s off >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root >/dev/null 2>&1 &
fi

nginx_wait=0
while ! curl -fsS --max-time 1 http://127.0.0.1/ >/dev/null 2>&1; do
  nginx_wait=$((nginx_wait + 1))
  if [ "${nginx_wait}" -ge 15 ]; then
    break
  fi
  sleep 0.1
done

mkdir -p "${PROFILE_DIR}"
rm -f "${PROFILE_DIR}"/Singleton*

exec "${CHROMIUM}" \
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
  --background-color=0x08080f \
  --kiosk "${URL}"
