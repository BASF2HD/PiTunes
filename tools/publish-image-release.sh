#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

VERSION="${1:-}"
IMAGE="${2:-}"
ASSET_NAME="${3:-}"
REPO="${GITHUB_REPOSITORY:-BASF2HD/PiTunes}"

if [ -z "${VERSION}" ] || [ -z "${IMAGE}" ]; then
  echo "Usage: ./tools/publish-image-release.sh v1.3.0 image/out/pitunes-armhf.img.xz [asset-name]"
  echo "Examples:"
  echo "  $0 v1.3.0 image/out/pitunes-armhf.img.xz pitunes-armhf.img.xz"
  echo "  $0 v1.3.0 image/out/pitunes-arm64.img.xz pitunes-arm64.img.xz"
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
    echo "Version must start with v, for example v1.3.0"
    exit 1
    ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required: https://cli.github.com/"
  exit 1
fi

gh auth status >/dev/null
"${ROOT}/tools/validate-release.sh" "${VERSION}"

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Repository must be clean before publishing a release." >&2
  exit 1
fi
HEAD_SHA="$(git rev-parse HEAD)"

CHECKSUM_FILE="$(mktemp /tmp/pitunes-image-sha256.XXXXXX)"
trap 'rm -f "${CHECKSUM_FILE}"' EXIT
if command -v sha256sum >/dev/null 2>&1; then
  IMAGE_SHA256="$(sha256sum "${IMAGE}" | awk '{print $1}')"
else
  IMAGE_SHA256="$(shasum -a 256 "${IMAGE}" | awk '{print $1}')"
fi
printf '%s  %s\n' "${IMAGE_SHA256}" "${ASSET_NAME}" >"${CHECKSUM_FILE}"

TITLE="PiTunes ${VERSION} Raspberry Pi Images"
NOTES=$(cat <<EOF
PiTunes Raspberry Pi OS Lite image (\`${ASSET_NAME}\`).

- Stable app OTA release for existing PiTunes devices
- \`pitunes-armhf.img.xz\` — 32-bit Lite for Pi 3 / Pi Zero 2 W
- \`pitunes-arm64.img.xz\` — 64-bit Lite for Pi 4 / Pi 5

Download and flash with Raspberry Pi Imager, Balena Etcher, or dd.

After boot, open:

http://pitunes.local

See README.md and docs/TROUBLESHOOTING.md for setup and troubleshooting.
EOF
)

if gh release view "${VERSION}" --repo "${REPO}" >/dev/null 2>&1; then
  RELEASE_SHA="$(gh api "repos/${REPO}/commits/${VERSION}" --jq .sha)"
  if [ "${RELEASE_SHA}" != "${HEAD_SHA}" ]; then
    echo "Release ${VERSION} points to ${RELEASE_SHA}, not current HEAD ${HEAD_SHA}." >&2
    exit 1
  fi
  echo "Release ${VERSION} exists. Uploading asset..."
else
  echo "Creating release ${VERSION}..."
  gh release create "${VERSION}" \
    --repo "${REPO}" \
    --target "${HEAD_SHA}" \
    --title "${TITLE}" \
    --notes "${NOTES}"
fi

gh release upload "${VERSION}" "${IMAGE}#${ASSET_NAME}" \
  "${CHECKSUM_FILE}#${ASSET_NAME}.sha256" \
  --repo "${REPO}" \
  --clobber

echo
echo "Published:"
echo "https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
