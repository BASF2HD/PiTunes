#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
IMAGE="${2:-}"
REPO="${GITHUB_REPOSITORY:-BASF2HD/PiTunes}"
ASSET_NAME="pitunes.img.xz"

if [ -z "${VERSION}" ] || [ -z "${IMAGE}" ]; then
  echo "Usage: ./scripts/publish-image-release.sh v0.1.0 pitunes.img.xz"
  exit 1
fi

if [ ! -f "${IMAGE}" ]; then
  echo "Image file not found: ${IMAGE}"
  exit 1
fi

case "${VERSION}" in
  v*) ;;
  *)
    echo "Version must start with v, for example v0.1.0"
    exit 1
    ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required: https://cli.github.com/"
  exit 1
fi

gh auth status >/dev/null

TITLE="PiTunes ${VERSION} Raspberry Pi Image"
NOTES=$(cat <<EOF
PiTunes Raspberry Pi OS Lite 32-bit image.

Download and flash \`${ASSET_NAME}\` with Raspberry Pi Imager, Balena Etcher, or dd.

After boot, open:

http://pitunes.local

See README.md and docs/TROUBLESHOOTING.md for setup and troubleshooting.
EOF
)

if gh release view "${VERSION}" --repo "${REPO}" >/dev/null 2>&1; then
  echo "Release ${VERSION} exists. Uploading asset..."
else
  echo "Creating release ${VERSION}..."
  gh release create "${VERSION}" \
    --repo "${REPO}" \
    --title "${TITLE}" \
    --notes "${NOTES}"
fi

gh release upload "${VERSION}" "${IMAGE}#${ASSET_NAME}" \
  --repo "${REPO}" \
  --clobber

echo
echo "Published:"
echo "https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
