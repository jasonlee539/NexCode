#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${NEXCODE_DEB_OUTPUT_DIR:-$ROOT_DIR/dist}"
PACKAGE_NAME="nexcode-ubuntu"
UPSTREAM_VERSION="$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)",/\1/p' "$ROOT_DIR/package.json" | head -n 1)"
DEB_VERSION="${NEXCODE_DEB_VERSION:-${UPSTREAM_VERSION//-/~}}"

case "$(uname -m)" in
  x86_64) DEB_ARCH="amd64" ;;
  aarch64|arm64) DEB_ARCH="arm64" ;;
  *)
    printf 'Unsupported Ubuntu architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

find_bun() {
  local candidate
  for candidate in \
    "$ROOT_DIR/node_modules/bun/bin/bun.exe" \
    "$ROOT_DIR/node_modules/bun/bin/bun" \
    "$(command -v bun 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! BUN_BIN="$(find_bun)"; then
  printf 'Bundled Bun is missing. Run npm ci in %s first.\n' "$ROOT_DIR" >&2
  exit 1
fi
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  printf 'Runtime dependencies are missing. Run npm ci in %s first.\n' "$ROOT_DIR" >&2
  exit 1
fi

if [[ "${NEXCODE_SKIP_PRODUCT_BUILD:-0}" != "1" ]]; then
  printf 'Building Ubuntu dashboard...\n'
  (
    cd "$ROOT_DIR/gui"
    "$BUN_BIN" install --frozen-lockfile
    "$BUN_BIN" run build
  )
  "$BUN_BIN" "$SCRIPT_DIR/generate-compatibility-manifest.ts" "$ROOT_DIR"
  printf 'Validating TypeScript runtime...\n'
  (
    cd "$ROOT_DIR"
    "$BUN_BIN" run typecheck
  )
fi

if [[ ! -f "$ROOT_DIR/gui/dist/index.html" ]]; then
  printf 'GUI output is missing. Build it before packaging.\n' >&2
  exit 1
fi
if [[ ! -f "$ROOT_DIR/src/generated/compatibility-version.json" ]]; then
  "$BUN_BIN" "$SCRIPT_DIR/generate-compatibility-manifest.ts" "$ROOT_DIR"
fi

STAGE_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/nexcode-deb.XXXXXX")"
PACKAGE_ROOT="$STAGE_PARENT/${PACKAGE_NAME}_${DEB_VERSION}_${DEB_ARCH}"
RUNTIME_DIR="$PACKAGE_ROOT/usr/lib/nexcode-ubuntu/runtime"
cleanup_stage() {
  rm -rf "$STAGE_PARENT"
}
trap cleanup_stage EXIT

mkdir -p \
  "$PACKAGE_ROOT/DEBIAN" \
  "$PACKAGE_ROOT/usr/bin" \
  "$PACKAGE_ROOT/usr/lib/nexcode-ubuntu" \
  "$RUNTIME_DIR/gui" \
  "$PACKAGE_ROOT/usr/share/applications" \
  "$PACKAGE_ROOT/usr/share/doc/nexcode-ubuntu" \
  "$PACKAGE_ROOT/usr/share/icons/hicolor/1024x1024/apps"

cat > "$PACKAGE_ROOT/DEBIAN/control" <<EOF
Package: $PACKAGE_NAME
Version: $DEB_VERSION
Section: devel
Priority: optional
Architecture: $DEB_ARCH
Depends: python3 (>= 3.8), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.0 | gir1.2-webkit2-4.1, xdg-utils, libc6 (>= 2.31), libstdc++6
Maintainer: NexCode Maintainers <noreply@github.com>
Homepage: https://github.com/lidge-jun/nexcode
Description: Ubuntu desktop provider proxy for Codex and Claude Code
 NexCode exposes multiple LLM providers through one local OpenAI-compatible
 endpoint. This package includes a GTK/WebKit desktop shell and the Bun runtime.
EOF

printf 'Staging packaged runtime...\n'
rsync -a "$ROOT_DIR/src/" "$RUNTIME_DIR/src/"
rsync -a "$ROOT_DIR/gui/dist/" "$RUNTIME_DIR/gui/dist/"
rsync -aH \
  --exclude='/.bin/' \
  --exclude='/.package-lock.json' \
  --exclude='/@types/' \
  --exclude='/@typescript/' \
  --exclude='/bun-types/' \
  --exclude='/typescript/' \
  "$ROOT_DIR/node_modules/" "$RUNTIME_DIR/node_modules/"
rsync -a "$ROOT_DIR/bin/" "$RUNTIME_DIR/bin/"
rsync -a "$ROOT_DIR/assets/" "$RUNTIME_DIR/assets/"
install -m 0644 "$ROOT_DIR/package.json" "$ROOT_DIR/LICENSE" "$ROOT_DIR/NOTICE" "$ROOT_DIR/AGENTS_INSTALL.md" "$RUNTIME_DIR/"

install -m 0755 "$SCRIPT_DIR/nexcode-ubuntu.py" "$PACKAGE_ROOT/usr/lib/nexcode-ubuntu/nexcode-ubuntu.py"
install -m 0755 "$SCRIPT_DIR/nexcode-ubuntu" "$PACKAGE_ROOT/usr/bin/nexcode-ubuntu"
install -m 0755 "$SCRIPT_DIR/nxc" "$PACKAGE_ROOT/usr/bin/nxc"
ln -s nxc "$PACKAGE_ROOT/usr/bin/nexcode"
install -m 0644 "$SCRIPT_DIR/com.nexcode.Ubuntu.desktop" "$PACKAGE_ROOT/usr/share/applications/com.nexcode.Ubuntu.desktop"
install -m 0644 "$ROOT_DIR/desktop/assets/NexCode-1024.png" "$PACKAGE_ROOT/usr/share/icons/hicolor/1024x1024/apps/nexcode-ubuntu.png"
install -m 0644 "$ROOT_DIR/UBUNTU.md" "$PACKAGE_ROOT/usr/share/doc/nexcode-ubuntu/README.md"
install -m 0644 "$ROOT_DIR/LICENSE" "$PACKAGE_ROOT/usr/share/doc/nexcode-ubuntu/copyright"

# Package only predictable permissions. Source files remain readable, while
# launchers and the bundled runtime are executable.
find "$PACKAGE_ROOT" -type d -exec chmod 0755 {} +
find "$PACKAGE_ROOT" -type f -exec chmod go-w {} +
chmod 0755 "$PACKAGE_ROOT/usr/bin/nxc" "$PACKAGE_ROOT/usr/bin/nexcode-ubuntu" \
  "$PACKAGE_ROOT/usr/lib/nexcode-ubuntu/nexcode-ubuntu.py" "$RUNTIME_DIR/node_modules/bun/bin/"bun*

# Reuse the desktop credential boundary after the entire Debian payload has
# been assembled and before dpkg-deb can archive it.
bash "$ROOT_DIR/desktop/scripts/assert-no-packaged-google-oauth.sh" "$PACKAGE_ROOT"

mkdir -p "$OUTPUT_DIR"
OUTPUT_PATH="$OUTPUT_DIR/${PACKAGE_NAME}_${DEB_VERSION}_${DEB_ARCH}.deb"
dpkg-deb --build --root-owner-group "$PACKAGE_ROOT" "$OUTPUT_PATH"
printf 'Built %s\n' "$OUTPUT_PATH"
