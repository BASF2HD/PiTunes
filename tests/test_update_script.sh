#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT}/scripts/pitunes-update.sh"

version_is_newer 1.2.1 1.2.0
version_is_newer 2.0.0 1.99.99
if version_is_newer 1.2.0 1.2.0; then
  echo "Equal versions must not be offered as updates." >&2
  exit 1
fi

CURRENT="$(read_version "${ROOT}")"
[ "${CURRENT}" = "1.3.0" ]

WORK_DIR="$(mktemp -d /tmp/pitunes-update-test.XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT
TARGET_VERSION="${CURRENT}"
TARGET_TAG="v${CURRENT}"
validate_source_tree "${ROOT}"

echo "OTA script checks passed."
