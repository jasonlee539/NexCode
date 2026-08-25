#!/bin/bash
set -euo pipefail

echo "Installing nexcode..."

if ! command -v node &>/dev/null; then
  echo "Node.js 18+ is required. Install Node from https://nodejs.org/ and rerun this script." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required. Current version: $(node --version)" >&2
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "npm is required to install the published nexcode package." >&2
  exit 1
fi

echo "Using Node $(node --version)"

# Install nexcode globally
# If npm reports "install scripts blocked" for bun, rerun as:
#   npm install -g --allow-scripts=bun @bitkyc08/nexcode
# (keep sudo if the original install used sudo)
npm install -g @bitkyc08/nexcode

if ! command -v nxc &>/dev/null; then
  NPM_BIN="$(npm bin -g 2>/dev/null || printf "%s/bin" "$(npm prefix -g)")"
  echo "nexcode installed, but 'nxc' is not on PATH." >&2
  echo "Add your npm global bin directory to PATH, then rerun your shell: $NPM_BIN" >&2
  exit 1
fi

if ! nxc help >/dev/null; then
  echo "nexcode installed, but 'nxc help' failed. Check your npm global install and PATH." >&2
  exit 1
fi

echo ""
echo "✅ nexcode installed! Run 'nxc init' to set up."
