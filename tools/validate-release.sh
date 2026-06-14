#!/usr/bin/env bash
# Read-only release checks for maintainers and CI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_TAG="${1:-}"
cd "${ROOT}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

PYTHON="${PITUNES_VALIDATION_PYTHON:-python3}"
if ! "${PYTHON}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  for candidate in python3.13 python3.12 python3.11 python3.10; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      PYTHON="${candidate}"
      break
    fi
  done
fi
"${PYTHON}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' ||
  fail "Python 3.10 or newer is required for release validation."

VERSION="$("${PYTHON}" -c 'import json; print(json.load(open("config/version.json", encoding="utf-8"))["version"])')"
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "config/version.json must contain a semantic version."
if [ -n "${EXPECTED_TAG}" ] && [ "${EXPECTED_TAG}" != "v${VERSION}" ]; then
  fail "Release tag ${EXPECTED_TAG} does not match config version v${VERSION}."
fi

for path in backend frontend scripts config systemd nginx install.sh configure-mpd.sh LICENSE SECURITY.md; do
  [ -e "${path}" ] || fail "Required release path is missing: ${path}"
done

for path in \
  scripts/pitunes-update.sh scripts/pitunes-system-update.sh scripts/pitunes-system-boot-check.sh \
  systemd/pitunes-update.service systemd/pitunes-system-update.service systemd/pitunes-system-boot-check.service \
  tools/build-ab-image.sh tools/build-system-update-bundle.sh \
  docs/UPDATES.md docs/AB_SYSTEM_UPDATES.md; do
  [ -e "${path}" ] || fail "Required update path is missing: ${path}"
done

if find scripts -maxdepth 1 -type f ! -name '*.sh' -print -quit | grep -q .; then
  fail "scripts/ is reserved for installed appliance shell scripts; move development tools to tools/."
fi

for path in .cursor backups config/plymouth config/boot; do
  [ ! -e "${path}" ] || fail "Obsolete or generated path must not be published: ${path}"
done

if grep -RE 'PITUNES_LOGIN_PASSWORD:-PiTunes|password: PiTunes' tools/chroot-install.sh docs README.md >/dev/null 2>&1; then
  fail "A public default SSH password is present."
fi

if command -v openssl >/dev/null 2>&1; then
  while IFS= read -r pem; do
    if openssl pkey -in "${pem}" -noout >/dev/null 2>&1; then
      fail "Private signing key must not be published: ${pem}"
    fi
  done < <(find . -type f -name '*.pem' -not -path './.git/*' -print)
fi

while IFS= read -r script; do
  bash -n "${script}"
done < <(find . -type f -name '*.sh' -not -path './.git/*' -print | sort)

"${PYTHON}" - <<'PY'
from pathlib import Path

for path in sorted(Path(".").rglob("*.py")):
    if ".git" in path.parts:
        continue
    compile(path.read_text(encoding="utf-8"), str(path), "exec")
PY

if command -v node >/dev/null 2>&1; then
  node --check frontend/assets/app.js
  node --check frontend/assets/renderer.js
  node --check frontend/assets/coverflow.js
fi

"${ROOT}/tests/test_update_script.sh"
"${ROOT}/tests/test_system_update_script.sh"
"${ROOT}/tests/test_system_boot_check.sh"
git diff --check
echo "PiTunes v${VERSION} release checks passed."
