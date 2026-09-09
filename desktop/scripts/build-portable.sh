#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${NEXCODE_APP_OUTPUT_DIR:-$ROOT_DIR/dist}"
APP_PATH="$OUTPUT_DIR/NexCode.app"
ARCH="$(uname -m)"
PORTABLE_PATH="${NEXCODE_PORTABLE_PATH:-$OUTPUT_DIR/NexCode-portable-macos-$ARCH.zip}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nexcode-portable.XXXXXX")"
STAGE_ZIP="$STAGE_DIR/NexCode-portable-macos-$ARCH.zip"
VERIFY_DIR="$STAGE_DIR/verify"

cleanup_stage() {
  rm -rf "$STAGE_DIR"
}
trap cleanup_stage EXIT

if [[ "${NEXCODE_SKIP_APP_BUILD:-0}" != "1" ]]; then
  bash "$SCRIPT_DIR/build-app.sh"
fi

if [[ ! -d "$APP_PATH" ]]; then
  printf 'NexCode.app is missing at %s\n' "$APP_PATH" >&2
  exit 1
fi

bash "$SCRIPT_DIR/assert-no-packaged-google-oauth.sh" "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"

# ditto preserves the executable modes and app-bundle metadata needed after the
# archive is copied to another Mac. The extracted archive is verified before it
# replaces a previous portable build.
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$STAGE_ZIP"
mkdir -p "$VERIFY_DIR"
ditto -x -k "$STAGE_ZIP" "$VERIFY_DIR"
bash "$SCRIPT_DIR/assert-no-packaged-google-oauth.sh" "$VERIFY_DIR/NexCode.app"
codesign --verify --deep --strict "$VERIFY_DIR/NexCode.app"

mkdir -p "$(dirname "$PORTABLE_PATH")"
mv -f "$STAGE_ZIP" "$PORTABLE_PATH"

printf 'Built %s\n' "$PORTABLE_PATH"
shasum -a 256 "$PORTABLE_PATH"
