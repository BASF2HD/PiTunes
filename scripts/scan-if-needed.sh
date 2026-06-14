#!/usr/bin/env bash
set -euo pipefail

DB="/var/lib/mpd/tag_cache"

if [ ! -s "${DB}" ]; then
  mpc -h 127.0.0.1 update >/dev/null 2>&1 || true
fi
