#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT}/scripts/pitunes-system-update.sh"

command -v openssl >/dev/null
TMP="$(mktemp -d /tmp/pitunes-system-update-test.XXXXXX)"
trap 'rm -rf "${TMP}"' EXIT

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "${TMP}/private.pem" >/dev/null 2>&1
openssl pkey -in "${TMP}/private.pem" -pubout -out "${TMP}/public.pem" >/dev/null 2>&1
PUBLIC_KEY="${TMP}/public.pem"
TARGET_TAG="v1.4.0"
MANIFEST="${TMP}/pitunes-system-manifest.json"
SIGNATURE="${TMP}/pitunes-system-manifest.sig"

python3 - "${MANIFEST}" "$(uname -m)" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "schemaVersion": 1,
    "product": "PiTunes",
    "updateType": "system",
    "strategy": "rpi-tryboot-ab",
    "version": "1.4.0",
    "architecture": sys.argv[2],
    "boot": {"asset": "boot.img.xz", "sha256": "a" * 64, "bytes": 1},
    "root": {"asset": "root.img.xz", "sha256": "b" * 64, "bytes": 1},
}), encoding="utf-8")
PY

openssl dgst -sha256 -sign "${TMP}/private.pem" -out "${SIGNATURE}" "${MANIFEST}"
verify_manifest "${MANIFEST}" "${SIGNATURE}"
[ "${TARGET_VERSION}" = "1.4.0" ]

printf '\n' >>"${MANIFEST}"
if verify_manifest "${MANIFEST}" "${SIGNATURE}" 2>/dev/null; then
  echo "Modified manifests must fail signature verification." >&2
  exit 1
fi

echo "Signed system-update checks passed."
