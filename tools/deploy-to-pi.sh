#!/usr/bin/env bash
# Deploy PiTunes frontend + backend from this repo to the Pi.
# pitunes.local serves files from /opt/pitunes on the Pi — editing the Mac
# repo alone does NOT update what you see in the browser until you run this.
#
# Usage: SSHPASS='PiTunes' tools/deploy-to-pi.sh
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

"${SSH[@]}" "${PI_HOST}" "mkdir -p ${STAGING}/assets ${STAGING}/backend-library ${STAGING}/scripts ${STAGING}/systemd"
"${SCP[@]}" "${ROOT}/frontend/index.html" "${PI_HOST}:${STAGING}/"
"${SCP[@]}" "${ROOT}/frontend/assets/app.js" \
        "${ROOT}/frontend/assets/renderer.js" \
        "${ROOT}/frontend/assets/styles.css" \
        "${ROOT}/frontend/assets/coverflow.js" \
        "${PI_HOST}:${STAGING}/assets/"
"${SCP[@]}" "${ROOT}/backend/server.py" \
        "${ROOT}/backend/playback.py" \
        "${PI_HOST}:${STAGING}/"
"${SCP[@]}" "${ROOT}/backend/library/scanner.py" \
        "${ROOT}/backend/library/art_resolver.py" \
        "${ROOT}/backend/library/queries.py" \
        "${ROOT}/backend/library/system.py" \
        "${PI_HOST}:${STAGING}/backend-library/"
"${SCP[@]}" "${ROOT}/scripts/pitunes-update.sh" "${PI_HOST}:${STAGING}/scripts/"
"${SCP[@]}" "${ROOT}/systemd/pitunes-update.service" "${PI_HOST}:${STAGING}/systemd/"

"${SSH[@]}" "${PI_HOST}" "sudo cp ${STAGING}/index.html ${REMOTE_ROOT}/frontend/ && \
  sudo cp ${STAGING}/assets/app.js ${STAGING}/assets/renderer.js \
    ${STAGING}/assets/styles.css ${STAGING}/assets/coverflow.js \
    ${REMOTE_ROOT}/frontend/assets/ && \
  sudo cp ${STAGING}/server.py ${STAGING}/playback.py ${REMOTE_ROOT}/backend/ && \
  sudo cp ${STAGING}/backend-library/scanner.py ${STAGING}/backend-library/art_resolver.py \
    ${STAGING}/backend-library/queries.py ${STAGING}/backend-library/system.py \
    ${REMOTE_ROOT}/backend/library/ && \
  sudo cp ${STAGING}/scripts/pitunes-update.sh ${REMOTE_ROOT}/scripts/ && \
  sudo chmod +x ${REMOTE_ROOT}/scripts/pitunes-update.sh && \
  sudo cp ${STAGING}/systemd/pitunes-update.service /etc/systemd/system/ && \
  SYSTEMCTL_BIN=\$(command -v systemctl) && \
  sudo touch /etc/sudoers.d/pitunes-services && \
  sudo sed -i '\#pitunes-update.sh#d' /etc/sudoers.d/pitunes-services && \
  if ! sudo grep -Fxq \"pitunes ALL=(root) NOPASSWD: \${SYSTEMCTL_BIN} start pitunes-update.service\" /etc/sudoers.d/pitunes-services; then \
    echo \"pitunes ALL=(root) NOPASSWD: \${SYSTEMCTL_BIN} start pitunes-update.service\" | sudo tee -a /etc/sudoers.d/pitunes-services >/dev/null; \
    sudo chmod 0440 /etc/sudoers.d/pitunes-services; \
    sudo visudo -cf /etc/sudoers.d/pitunes-services >/dev/null; \
  fi && \
  rm -rf ${STAGING} && \
  sudo systemctl daemon-reload && \
  sudo systemctl restart pitunes-api.service pitunes-display.service"

echo
echo "Deploy complete. Hard-refresh http://pitunes.local (Cmd+Shift+R)."
