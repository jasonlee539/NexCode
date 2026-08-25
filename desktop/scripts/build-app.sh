#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${NEXCODE_APP_OUTPUT_DIR:-$ROOT_DIR/dist}"
APP_PATH="$OUTPUT_DIR/NexCode.app"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nexcode-app.XXXXXX")"
STAGE_APP="$STAGE_DIR/NexCode.app"

cleanup_stage() {
  rm -rf "$STAGE_DIR"
}
trap cleanup_stage EXIT

find_bun() {
  local candidate
  for candidate in \
    "$ROOT_DIR/node_modules/bun/bin/bun" \
    "$ROOT_DIR/node_modules/.bin/bun" \
    "$(command -v bun 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! BUN_BIN="$(find_bun)"; then
  printf 'Bundled Bun is missing. Run npm install in %s first.\n' "$ROOT_DIR" >&2
  exit 1
fi

MASTER_ICON="$ROOT_DIR/desktop/assets/NexCode-1024.png"
DEFAULT_SDK="$(xcrun --sdk macosx --show-sdk-path)"
COMPATIBLE_SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [[ -d "$COMPATIBLE_SDK" ]]; then
  MACOS_SDK="$COMPATIBLE_SDK"
else
  MACOS_SDK="$DEFAULT_SDK"
fi
MODULE_CACHE="$STAGE_DIR/module-cache"
mkdir -p "$MODULE_CACHE"

if [[ ! -f "$MASTER_ICON" ]]; then
  mkdir -p "$ROOT_DIR/desktop/assets"
  CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFT_MODULECACHE_PATH="$MODULE_CACHE" \
    swift -sdk "$MACOS_SDK" "$ROOT_DIR/desktop/scripts/generate-icon.swift" "$MASTER_ICON"
fi

if [[ "${NEXCODE_SKIP_PRODUCT_BUILD:-0}" != "1" ]]; then
  printf 'Building NexCode dashboard...\n'
  (
    cd "$ROOT_DIR/gui"
    "$BUN_BIN" install --frozen-lockfile
    "$BUN_BIN" run build
  )

  printf 'Validating NexCode runtime...\n'
  (
    cd "$ROOT_DIR"
    "$BUN_BIN" install --frozen-lockfile
    "$BUN_BIN" run typecheck
  )
fi

CONTENTS_DIR="$STAGE_APP/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
RUNTIME_DIR="$RESOURCES_DIR/runtime"
mkdir -p "$MACOS_DIR" "$RUNTIME_DIR/bin" "$RUNTIME_DIR/gui" "$RESOURCES_DIR"

printf 'Compiling native macOS shell...\n'
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFT_MODULECACHE_PATH="$MODULE_CACHE" swiftc \
  -sdk "$MACOS_SDK" \
  -target "$(uname -m)-apple-macos13.0" \
  -O \
  -whole-module-optimization \
  -framework AppKit \
  -framework WebKit \
  "$ROOT_DIR/desktop/macos/Sources/NexCodeApp.swift" \
  -o "$MACOS_DIR/NexCode"

cp "$ROOT_DIR/desktop/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$BUN_BIN" "$RUNTIME_DIR/bin/bun"
chmod 755 "$RUNTIME_DIR/bin/bun" "$MACOS_DIR/NexCode"

# Finder metadata is neither needed nor reliable inside a signed runtime bundle.
# rsync avoids copying extended attributes and excludes Finder's metadata file;
# the untracked-file pass below removes every other local-only source artifact.
rsync -a --exclude='.DS_Store' --exclude='._*' "$ROOT_DIR/src/" "$RUNTIME_DIR/src/"
# Release artifacts must not absorb local screenshots, scratch files, or other
# untracked material merely because it sits below src/. Tracked files are copied
# from the working tree above, so edits to existing runtime sources are retained.
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  while IFS= read -r -d '' untracked_path; do
    relative_path="${untracked_path#src/}"
    if [[ "$relative_path" != "$untracked_path" ]]; then
      rm -f -- "$RUNTIME_DIR/src/$relative_path"
    fi
  done < <(git -C "$ROOT_DIR" ls-files --others -z -- src)
fi
ditto "$ROOT_DIR/gui/dist" "$RUNTIME_DIR/gui/dist"
ditto "$ROOT_DIR/node_modules" "$RUNTIME_DIR/node_modules"
ditto "$ROOT_DIR/bin" "$RUNTIME_DIR/bin-launcher"
ditto "$ROOT_DIR/assets" "$RUNTIME_DIR/assets"
cp "$ROOT_DIR/package.json" "$ROOT_DIR/LICENSE" "$ROOT_DIR/NOTICE" "$ROOT_DIR/AGENTS_INSTALL.md" "$RUNTIME_DIR/"

# Never let credentials from the maintainer's build shell become app resources.
# The check deliberately runs after every runtime asset has been assembled and
# before signing, so the signed .app and every DMG derived from it inherit the
# same boundary.
bash "$SCRIPT_DIR/assert-no-packaged-google-oauth.sh" "$STAGE_APP"

CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFT_MODULECACHE_PATH="$MODULE_CACHE" \
  swift -sdk "$MACOS_SDK" "$ROOT_DIR/desktop/scripts/generate-icns.swift" \
  "$MASTER_ICON" "$RESOURCES_DIR/NexCode.icns"

codesign --force --deep --sign - "$STAGE_APP"
codesign --verify --deep --strict "$STAGE_APP"

mkdir -p "$OUTPUT_DIR"
if [[ -e "$APP_PATH" ]]; then
  mv "$APP_PATH" "$APP_PATH.previous.$(date +%s)"
fi
mv "$STAGE_APP" "$APP_PATH"

printf 'Built %s\n' "$APP_PATH"
