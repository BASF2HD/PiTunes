#!/usr/bin/env bash
# Build and sign PiTunes A/B system-update release assets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=""
ARCH=""
BOOT_IMAGE=""
ROOT_IMAGE=""
SIGNING_KEY=""
OUTPUT_DIR="${ROOT}/image/out/system-update"

usage() {
  cat <<EOF
Build signed PiTunes A/B system-update assets.

Usage:
  $0 --version 1.4.0 --arch aarch64 \\
    --boot-image boot.img --root-image root.img \\
    --signing-key /secure/path/pitunes-system-update-private.pem

Options:
  --version VERSION     Semantic PiTunes version
  --arch ARCH           Runtime architecture reported by uname -m
  --boot-image PATH     Raw FAT boot partition image
  --root-image PATH     Raw ext4 root partition image
  --signing-key PATH    Offline/private RSA or EC signing key
  --output-dir PATH     Asset output directory
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --boot-image) BOOT_IMAGE="$2"; shift 2 ;;
    --root-image) ROOT_IMAGE="$2"; shift 2 ;;
    --signing-key) SIGNING_KEY="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "--version must be semantic, for example 1.4.0" >&2
  exit 1
}
[ -n "${ARCH}" ] || { echo "--arch is required" >&2; exit 1; }
[ -f "${BOOT_IMAGE}" ] || { echo "Boot image not found: ${BOOT_IMAGE}" >&2; exit 1; }
[ -f "${ROOT_IMAGE}" ] || { echo "Root image not found: ${ROOT_IMAGE}" >&2; exit 1; }
[ -s "${SIGNING_KEY}" ] || { echo "Signing key not found: ${SIGNING_KEY}" >&2; exit 1; }
command -v openssl >/dev/null
command -v sha256sum >/dev/null
command -v xz >/dev/null

mkdir -p "${OUTPUT_DIR}"
BOOT_ASSET="pitunes-system-${VERSION}-${ARCH}-boot.img.xz"
ROOT_ASSET="pitunes-system-${VERSION}-${ARCH}-root.img.xz"
MANIFEST="${OUTPUT_DIR}/pitunes-system-manifest.json"
SIGNATURE="${OUTPUT_DIR}/pitunes-system-manifest.sig"
RELEASE_DESCRIPTOR="${OUTPUT_DIR}/pitunes-release.json"

xz -T0 -9 -c "${BOOT_IMAGE}" >"${OUTPUT_DIR}/${BOOT_ASSET}"
xz -T0 -9 -c "${ROOT_IMAGE}" >"${OUTPUT_DIR}/${ROOT_ASSET}"
BOOT_SHA="$(sha256sum "${OUTPUT_DIR}/${BOOT_ASSET}" | awk '{print $1}')"
ROOT_SHA="$(sha256sum "${OUTPUT_DIR}/${ROOT_ASSET}" | awk '{print $1}')"
BOOT_SIZE="$(wc -c <"${OUTPUT_DIR}/${BOOT_ASSET}" | tr -d ' ')"
ROOT_SIZE="$(wc -c <"${OUTPUT_DIR}/${ROOT_ASSET}" | tr -d ' ')"

python3 - "${MANIFEST}" "${VERSION}" "${ARCH}" "${BOOT_ASSET}" "${BOOT_SHA}" "${BOOT_SIZE}" \
  "${ROOT_ASSET}" "${ROOT_SHA}" "${ROOT_SIZE}" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = {
    "schemaVersion": 1,
    "product": "PiTunes",
    "updateType": "system",
    "strategy": "rpi-tryboot-ab",
    "version": sys.argv[2],
    "architecture": sys.argv[3],
    "boot": {"asset": sys.argv[4], "sha256": sys.argv[5], "bytes": int(sys.argv[6])},
    "root": {"asset": sys.argv[7], "sha256": sys.argv[8], "bytes": int(sys.argv[9])},
}
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

python3 - "${RELEASE_DESCRIPTOR}" "${VERSION}" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "schemaVersion": 1,
    "product": "PiTunes",
    "version": sys.argv[2],
    "updateType": "system",
}, indent=2) + "\n", encoding="utf-8")
PY

openssl dgst -sha256 -sign "${SIGNING_KEY}" -out "${SIGNATURE}" "${MANIFEST}"
openssl dgst -sha256 -verify <(openssl pkey -in "${SIGNING_KEY}" -pubout) \
  -signature "${SIGNATURE}" "${MANIFEST}" >/dev/null

cat <<EOF
Signed PiTunes system-update assets created in:
  ${OUTPUT_DIR}

Upload all five files to the matching stable GitHub Release:
  pitunes-release.json
  pitunes-system-manifest.json
  pitunes-system-manifest.sig
  ${BOOT_ASSET}
  ${ROOT_ASSET}

Keep the signing key offline and never add it to Git.
EOF
