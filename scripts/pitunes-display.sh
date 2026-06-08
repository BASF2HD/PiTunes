#!/usr/bin/env bash
set -euo pipefail

URL="${PITUNES_DISPLAY_URL:-http://127.0.0.1/?kiosk=1}"
DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
PROFILE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/pitunes-kiosk-chromium"
CACHE_STAMP="${PROFILE_DIR}/.pitunes-ui-cache-version"
UI_CACHE_VERSION="${PITUNES_UI_CACHE_VERSION:-2}"
POLL_SEC="${PITUNES_DISPLAY_POLL_SEC:-0.2}"
SPLASH_IMAGE="${PITUNES_SPLASH_IMAGE:-/opt/pitunes/frontend/assets/pitunes-logo.png}"
CHROMIUM="$(command -v chromium-browser || command -v chromium)"
FEH_PID=""

export DISPLAY XAUTHORITY

cleanup() {
  if [ -n "${FEH_PID}" ] && kill -0 "${FEH_PID}" 2>/dev/null; then
    kill "${FEH_PID}" 2>/dev/null || true
    wait "${FEH_PID}" 2>/dev/null || true
  fi
  FEH_PID=""
}
trap cleanup EXIT INT TERM

poll_sleep() {
  sleep "${POLL_SEC}"
}

show_x_splash() {
  if [ "${PITUNES_X_SPLASH:-1}" = "0" ]; then
    xsetroot -solid '#000000' >/dev/null 2>&1 || true
    return
  fi
  if command -v feh >/dev/null 2>&1 && [ -f "${SPLASH_IMAGE}" ]; then
    feh --fullscreen --auto-zoom --no-fehbg --borderless "${SPLASH_IMAGE}" &
    FEH_PID=$!
    return
  fi
  xsetroot -solid '#000000' >/dev/null 2>&1 || true
}

while [ ! -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do
  poll_sleep
done

show_x_splash

while ! curl -fsS --max-time 1 http://127.0.0.1/ >/dev/null 2>&1; do
  poll_sleep
done

mkdir -p "${PROFILE_DIR}"
rm -f "${PROFILE_DIR}"/Singleton*
if [ "${PITUNES_CLEAR_CHROMIUM_CACHE:-0}" = "1" ] || [ "$(cat "${CACHE_STAMP}" 2>/dev/null || true)" != "${UI_CACHE_VERSION}" ]; then
  rm -rf "${PROFILE_DIR}/Default/Cache" "${PROFILE_DIR}/Default/Code Cache" 2>/dev/null || true
  echo "${UI_CACHE_VERSION}" >"${CACHE_STAMP}"
fi

xset s off >/dev/null 2>&1 || true
xset -dpms >/dev/null 2>&1 || true
xset s noblank >/dev/null 2>&1 || true
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root >/dev/null 2>&1 &
fi

CHROMIUM_FLAGS=(
  --user-data-dir="${PROFILE_DIR}"
  --no-first-run
  --no-default-browser-check
  --noerrdialogs
  --disable-session-crashed-bubble
  --disable-extensions
  --disable-breakpad
  --disable-domain-reliability
  --disable-features=TranslateUI,MediaRouter,OptimizationHints,AutofillServerCommunication,PasswordManager,Autofill,PasswordImport,IsolateOrigins,site-per-process
  --disable-background-networking
  --disable-component-update
  --disable-sync
  --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows
  --autoplay-policy=no-user-gesture-required
  --disk-cache-size=33554432
  --media-cache-size=16777216
  --touch-events=enabled
  --enable-low-end-device-mode
  --enable-gpu-rasterization
  --use-gl=egl
  --use-angle=gles
  --ignore-gpu-blocklist
)

exec "${CHROMIUM}" "${CHROMIUM_FLAGS[@]}" --kiosk "${URL}"
