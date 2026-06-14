#!/usr/bin/env bash
# Finalize machine-specific state before PiTunes network services start.
set -euo pipefail

STATE_DIR="/var/lib/pitunes"
DONE_FILE="${STATE_DIR}/firstboot.done"

[ -f "${DONE_FILE}" ] && exit 0

install -d -m 0755 "${STATE_DIR}"
systemctl disable userconfig.service 2>/dev/null || true
systemctl mask userconfig.service 2>/dev/null || true
rm -f /etc/systemd/system/getty.target.wants/userconfig.service 2>/dev/null || true
rm -f /boot/userconf /boot/userconf.txt /boot/firmware/userconf /boot/firmware/userconf.txt 2>/dev/null || true
systemctl disable getty@tty1.service 2>/dev/null || true
systemctl mask getty@tty1.service 2>/dev/null || true
rm -f /etc/issue.d/IP.issue 2>/dev/null || true
printf '\n' >/etc/issue 2>/dev/null || true
printf '\n' >/etc/motd 2>/dev/null || true

systemd-machine-id-setup >/dev/null 2>&1 || true
ssh-keygen -A

touch "${DONE_FILE}"
