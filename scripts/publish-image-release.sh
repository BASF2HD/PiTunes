#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
IMAGE="${2:-}"
ASSET_NAME="${3:-}"
REPO="${GITHUB_REPOSITORY:-BASF2HD/PiTunes}"

if [ -z "${VERSION}" ] || [ -z "${IMAGE}" ]; then
  echo "Usage: ./scripts/publish-image-release.sh v0.1.0 image/out/pitunes-armhf.img.xz [asset-name]"
  echo "Examples:"
  echo "  $0 v0.1.0 image/out/pitunes-armhf.img.xz pitunes-armhf.img.xz"
  echo "  $0 v0.1.0 image/out/pitunes-arm64.img.xz pitunes-arm64.img.xz"
  exit 1
fi

if [ -z "${ASSET_NAME}" ]; then
  case "${IMAGE}" in
    *arm64*) ASSET_NAME="pitunes-arm64.img.xz" ;;
    *armhf*) ASSET_NAME="pitunes-armhf.img.xz" ;;
    *) ASSET_NAME="pitunes.img.xz" ;;
  esac
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

TITLE="PiTunes ${VERSION} Raspberry Pi Images"
NOTES=$(cat <<EOF
PiTunes Raspberry Pi OS Lite image (\`${ASSET_NAME}\`).

- \`pitunes-armhf.img.xz\` — 32-bit Lite for Pi 3 / Pi Zero 2 W
- \`pitunes-arm64.img.xz\` — 64-bit Lite for Pi 4 / Pi 5

Download and flash with Raspberry Pi Imager, Balena Etcher, or dd.

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
