# NexCode Desktop

## macOS updates (1.0.1+)

The app checks the latest stable `jasonlee539/NexCode` GitHub Release after
startup; **NexCode → 检查更新…** and the menu-bar icon provide a manual check.
Updates require user confirmation. The client verifies an Ed25519-signed
manifest, SHA-256, version, architecture and byte count before extracting the
archive. A release without all Mac assets is skipped. Install the first
OTA-capable version manually: 1.0.0 has no updater.

An installed app must be in a writable directory, outside the mounted DMG.
The updater shuts down NexCode, stages the replacement on the same volume,
retains `NexCode.previous-<id>.app`, and restores it if the new app cannot start
its management runtime. Account and thread data stay in their existing homes.
These packages are ad-hoc code signed; OTA signatures do not imply Apple
Developer ID signing or notarization.

Build and release from a clean, committed checkout:

```bash
npm run desktop:test
npm run desktop:build
NEXCODE_SKIP_APP_BUILD=1 npm run desktop:dmg
NEXCODE_SKIP_APP_BUILD=1 npm run desktop:portable
NEXCODE_SKIP_APP_BUILD=1 npm run desktop:ota
node desktop/scripts/sign-macos-ota.mjs \
  dist/Mac-Ota-Updata-arm64.zip /secure/path/private.pem 1.0.1 "$(git rev-parse HEAD)"
```

Publish the archive and its `.zip.sha256`, `.json` and `.sig` siblings to the
matching `v<version>` GitHub Release. The embedded public key is
`desktop/macos/UpdateSigningPublicKey.txt`. Keep the private Ed25519 key outside
git, back it up securely, and never pass it to build/dependency processes. Key
initialization (`--init-key <private-path>`) refuses to overwrite an existing
public or private key. Future releases must use this same key.

Thread Markdown export now uses a macOS save panel and reports success only
after the file is written. Account switching uses the encrypted native-profile
vault shared with the Windows implementation, preserves refreshed credentials,
and asks for a new login when a legacy credential lacks its identity token.

This directory contains the native macOS shell and the reproducible local app
packager. It does not import files from any sibling project; the packaged app
receives its runtime, dashboard, dependencies, and Bun executable from this
NexCode tree.

Build from the repository root:

```bash
npm run desktop:build
open dist/NexCode.app

# Build a drag-to-Applications installer image.
npm run desktop:dmg

# Build an installation-free portable archive.
npm run desktop:portable
```

The installer is written to `dist/NexCode.dmg`. Set
`NEXCODE_SKIP_APP_BUILD=1` to package an already-built `NexCode.app` without
rebuilding it first. The portable archive is written to
`dist/NexCode-portable-macos-arm64.zip` and supports the same skip flag.

The app build copies only the runtime allowlist shown in `build-app.sh`; it does
not copy the repository's `.env` files or the user's home/config directories.
Before signing, packaging also scans the staged app for the configured Google
OAuth client ID, client secret, and Google Cloud API key. The build fails
without printing the credential if any configured value was captured in the
app. Because DMG creation packages that verified `.app`, the same guarantee
applies to both formats.

The app starts the bundled management-only runtime, discovers its actual
loopback port, loads the dashboard in WebKit, opens external OAuth pages in the
default browser, and asks the service to shut down cleanly when the app quits.
The loopback service exposes the management UI and API only; Codex model requests
continue to connect directly to OpenAI. It is an internal implementation detail
rather than a user-facing browser entry point.
After OAuth succeeds, the callback returns to NexCode through the registered
`nexcode://oauth-complete` application URL. Runtime data is stored under
`~/.nexcode` unless `NEXCODE_HOME` is set.
