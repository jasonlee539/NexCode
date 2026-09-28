#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nexcode-ota-tests.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT
SDK="$(xcrun --sdk macosx --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
fi
COMMON=(-parse-as-library -sdk "$SDK" -target "$(uname -m)-apple-macos13.0" -module-cache-path "$STAGE_DIR/cache")
xcrun swiftc "${COMMON[@]}" \
  "$ROOT_DIR/desktop/macos/Sources/UpdateService.swift" \
  "$ROOT_DIR/desktop/macos/Tests/UpdateValidationTests.swift" -o "$STAGE_DIR/validation"
"$STAGE_DIR/validation" "$@"
xcrun swiftc "${COMMON[@]}" -D UPDATE_INSTALLER_TEST -framework AppKit \
  "$ROOT_DIR/desktop/macos/Sources/UpdateInstaller.swift" \
  "$ROOT_DIR/desktop/macos/Tests/UpdateInstallerTests.swift" -o "$STAGE_DIR/installer"
"$STAGE_DIR/installer"
