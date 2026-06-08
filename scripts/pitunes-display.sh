#!/usr/bin/env bash
set -euo pipefail

URL="${PITUNES_DISPLAY_URL:-http://127.0.0.1/?kiosk=1}"
DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
PROFILE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/pitunes-kiosk-chromium"
CACHE_STAMP="${PROFILE_DIR}/.pitunes-ui-cache-version"
UI_CACHE_VERSION="${PITUNES_UI_CACHE_VERSION:-1}"
POLL_SEC="${PITUNES_DISPLAY_POLL_SEC:-0.2}"
CHROMIUM="$(command -v chromium-browser || command -v chromium)"

export DISPLAY XAUTHORITY

poll_sleep() {
  sleep "${POLL_SEC}"
}

while [ ! -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do
  poll_sleep
done

xsetroot -solid '#000000' >/dev/null 2>&1 || true

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
