#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="${NEXCODE_APP_OUTPUT_DIR:-$ROOT_DIR/dist}"
ARCH="$(uname -m)"
export NEXCODE_PORTABLE_PATH="$OUTPUT_DIR/Mac-Ota-Updata-$ARCH.zip"
bash "$SCRIPT_DIR/build-portable.sh"
printf 'OTA archive built. Sign separately with desktop/scripts/sign-macos-ota.mjs before publishing.\n'
