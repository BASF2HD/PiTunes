#!/usr/bin/env bash
# Deploy PiTunes frontend + backend from this repo to the Pi.
# pitunes.local serves files from /opt/pitunes on the Pi — editing the Mac
# repo alone does NOT update what you see in the browser until you run this.
#
# Usage: SSHPASS='PiTunes' scripts/deploy-to-pi.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PI_HOST="${PI_HOST:-pi@192.168.1.126}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/pitunes}"
STAGING="/tmp/pitunes-deploy-$$"
SSH_OPTS=(-o StrictHostKeyChecking=no)
if [[ -n "${SSHPASS:-}" ]]; then
  SSH=(sshpass -e ssh "${SSH_OPTS[@]}")
  SCP=(sshpass -e scp -q "${SSH_OPTS[@]}")
else
  SSH=(ssh "${SSH_OPTS[@]}")
  SCP=(scp -q "${SSH_OPTS[@]}")
fi

echo "Deploying PiTunes from ${ROOT}"
echo "Target: ${PI_HOST}:${REMOTE_ROOT}"
echo "Browser: http://pitunes.local  (or the Pi IP)"
echo

"${SSH[@]}" "${PI_HOST}" "mkdir -p ${STAGING}/assets"
"${SCP[@]}" "${ROOT}/frontend/index.html" "${PI_HOST}:${STAGING}/"
"${SCP[@]}" "${ROOT}/frontend/assets/app.js" \
        "${ROOT}/frontend/assets/renderer.js" \
        "${ROOT}/frontend/assets/styles.css" \
        "${ROOT}/frontend/assets/coverflow.js" \
        "${PI_HOST}:${STAGING}/assets/"
"${SCP[@]}" "${ROOT}/backend/server.py" "${PI_HOST}:${STAGING}/"

"${SSH[@]}" "${PI_HOST}" "sudo cp ${STAGING}/index.html ${REMOTE_ROOT}/frontend/ && \
  sudo cp ${STAGING}/assets/app.js ${STAGING}/assets/renderer.js \
    ${STAGING}/assets/styles.css ${STAGING}/assets/coverflow.js \
    ${REMOTE_ROOT}/frontend/assets/ && \
  sudo cp ${STAGING}/server.py ${REMOTE_ROOT}/backend/ && \
  rm -rf ${STAGING} && \
  sudo systemctl restart pitunes-api.service pitunes-display.service"

echo
echo "Deploy complete. Hard-refresh http://pitunes.local (Cmd+Shift+R)."
