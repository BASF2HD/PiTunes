#!/usr/bin/env bash
# Deploy PiTunes runtime files from this repo to the Pi.
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

"${SSH[@]}" "${PI_HOST}" "rm -rf ${STAGING} && mkdir -p ${STAGING}"
"${SCP[@]}" -r \
  "${ROOT}/backend" \
  "${ROOT}/config" \
  "${ROOT}/frontend" \
  "${ROOT}/nginx" \
  "${ROOT}/scripts" \
  "${ROOT}/systemd" \
  "${ROOT}/install.sh" \
  "${ROOT}/configure-mpd.sh" \
  "${PI_HOST}:${STAGING}/"

"${SSH[@]}" "${PI_HOST}" "sudo mkdir -p ${REMOTE_ROOT} /etc/pitunes && \
  for path in backend config frontend nginx scripts systemd; do \
    sudo rm -rf ${REMOTE_ROOT}/\${path}; \
    sudo cp -a ${STAGING}/\${path} ${REMOTE_ROOT}/; \
  done && \
  sudo install -m 0755 ${STAGING}/install.sh ${REMOTE_ROOT}/install.sh && \
  sudo install -m 0755 ${STAGING}/configure-mpd.sh ${REMOTE_ROOT}/configure-mpd.sh && \
  sudo chmod +x ${REMOTE_ROOT}/scripts/*.sh && \
  sudo chown -R root:root ${REMOTE_ROOT} && \
  sudo install -m 0644 ${REMOTE_ROOT}/backend/pitunes-api.env /etc/pitunes/pitunes-api.env && \
  sudo install -m 0644 ${REMOTE_ROOT}/nginx/pitunes.conf /etc/nginx/sites-available/pitunes.conf && \
  sudo ln -sf /etc/nginx/sites-available/pitunes.conf /etc/nginx/sites-enabled/pitunes.conf && \
  sudo rm -f /etc/nginx/sites-enabled/default && \
  for unit in ${REMOTE_ROOT}/systemd/pitunes-*.service ${REMOTE_ROOT}/systemd/pitunes-*.timer; do \
    [ -f \${unit} ] && sudo install -m 0644 \${unit} /etc/systemd/system/; \
  done && \
  sudo install -m 0644 ${REMOTE_ROOT}/config/pitunes-tmpfiles.conf /usr/lib/tmpfiles.d/pitunes.conf && \
  SYSTEMCTL_BIN=\$(command -v systemctl) && \
  sudo touch /etc/sudoers.d/pitunes-services && \
  sudo sed -i '\#pitunes-update.sh#d' /etc/sudoers.d/pitunes-services && \
  if ! sudo grep -Fxq \"pitunes ALL=(root) NOPASSWD: \${SYSTEMCTL_BIN} start pitunes-update.service\" /etc/sudoers.d/pitunes-services; then \
    echo \"pitunes ALL=(root) NOPASSWD: \${SYSTEMCTL_BIN} start pitunes-update.service\" | sudo tee -a /etc/sudoers.d/pitunes-services >/dev/null; \
    sudo chmod 0440 /etc/sudoers.d/pitunes-services; \
    sudo visudo -cf /etc/sudoers.d/pitunes-services >/dev/null; \
  fi && \
  if ! sudo grep -Fxq \"pitunes ALL=(root) NOPASSWD: \${SYSTEMCTL_BIN} start pitunes-system-update.service\" /etc/sudoers.d/pitunes-services; then \
    echo \"pitunes ALL=(root) NOPASSWD: \${SYSTEMCTL_BIN} start pitunes-system-update.service\" | sudo tee -a /etc/sudoers.d/pitunes-services >/dev/null; \
    sudo chmod 0440 /etc/sudoers.d/pitunes-services; \
    sudo visudo -cf /etc/sudoers.d/pitunes-services >/dev/null; \
  fi && \
  rm -rf ${STAGING} && \
  sudo systemd-tmpfiles --create /usr/lib/tmpfiles.d/pitunes.conf && \
  sudo systemctl daemon-reload && \
  sudo nginx -t && \
  sudo systemctl restart pitunes-api.service nginx.service pitunes-display.service"

echo
echo "Deploy complete. Hard-refresh http://pitunes.local (Cmd+Shift+R)."
