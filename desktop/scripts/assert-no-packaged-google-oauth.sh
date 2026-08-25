#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-}"
if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  printf 'A staged NexCode.app directory is required for credential validation.\n' >&2
  exit 2
fi

assert_value_absent() {
  local variable_name="$1"
  local value="${!variable_name:-}"
  [[ -z "$value" ]] && return 0

  if LC_ALL=C grep -R -a -F -q -- "$value" "$APP_PATH"; then
    printf 'Desktop packaging blocked: %s was found in the staged app.\n' "$variable_name" >&2
    return 1
  fi
}

# The desktop runtime reads credentials from the launch environment at runtime.
# A build may happen in a shell where these values are present, but none of them
# may be captured by Vite, Swift, copied assets, or another generated artifact.
assert_value_absent GOOGLE_ANTIGRAVITY_CLIENT_ID
assert_value_absent GOOGLE_ANTIGRAVITY_CLIENT_SECRET
assert_value_absent GOOGLE_CLOUD_API_KEY

if find "$APP_PATH" -type f \( -name '.env' -o -name '.env.local' -o -name '.env.production' \) -print -quit | grep -q .; then
  printf 'Desktop packaging blocked: an environment file was found in the staged app.\n' >&2
  exit 1
fi

printf 'Verified staged app contains no configured Google OAuth credentials.\n'
