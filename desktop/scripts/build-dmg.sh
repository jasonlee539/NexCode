#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${NEXCODE_APP_OUTPUT_DIR:-$ROOT_DIR/dist}"
APP_PATH="$OUTPUT_DIR/NexCode.app"
DMG_PATH="${NEXCODE_DMG_PATH:-$OUTPUT_DIR/NexCode.dmg}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nexcode-dmg.XXXXXX")"
DMG_ROOT="$STAGE_DIR/root"
STAGE_DMG="$STAGE_DIR/NexCode.dmg"

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

codesign --verify --deep --strict "$APP_PATH"

mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/NexCode.app"
ln -s /Applications "$DMG_ROOT/Applications"

hdiutil create \
  -volname "NexCode" \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  "$STAGE_DMG"
hdiutil verify "$STAGE_DMG"

mkdir -p "$(dirname "$DMG_PATH")"
mv -f "$STAGE_DMG" "$DMG_PATH"

printf 'Built %s\n' "$DMG_PATH"
shasum -a 256 "$DMG_PATH"
