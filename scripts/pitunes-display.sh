#!/usr/bin/env bash
set -euo pipefail

URL="${PITUNES_DISPLAY_URL:-http://127.0.0.1/?kiosk=1}"
DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
PROFILE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/pitunes-kiosk-chromium"
CHROMIUM="$(command -v chromium-browser || command -v chromium)"

export DISPLAY XAUTHORITY

while [ ! -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do
  sleep 1
done

while ! curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; do
  sleep 1
done

mkdir -p "${PROFILE_DIR}"
rm -f "${PROFILE_DIR}"/Singleton*
# Kiosk mode has no manual refresh — clear cached UI on each display start.
rm -rf "${PROFILE_DIR}/Default/Cache" "${PROFILE_DIR}/Default/Code Cache" 2>/dev/null || true

xset s off >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root >/dev/null 2>&1 &
fi

exec "${CHROMIUM}" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI,MediaRouter,OptimizationHints,AutofillServerCommunication,PasswordManager,Autofill,PasswordImport \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --disable-pings \
  --disable-dev-shm-usage \
  --touch-events=enabled \
  --enable-gpu-rasterization \
  --use-angle=gles \
  --kiosk "${URL}"
