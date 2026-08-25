# NexCode Desktop

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
```

The installer is written to `dist/NexCode.dmg`. Set
`NEXCODE_SKIP_APP_BUILD=1` to package an already-built `NexCode.app` without
rebuilding it first.

The app build copies only the runtime allowlist shown in `build-app.sh`; it does
not copy the repository's `.env` files or the user's home/config directories.
Before signing, packaging also scans the staged app for the configured Google
OAuth client ID, client secret, and Google Cloud API key. The build fails
without printing the credential if any configured value was captured in the
app. Because DMG creation packages that verified `.app`, the same guarantee
applies to both formats.

The app starts the bundled proxy, discovers its actual loopback port, loads the
dashboard in WebKit, opens external OAuth pages in the default browser, and asks
the proxy to shut down cleanly when the app quits. The loopback service is an
internal implementation detail rather than a user-facing browser entry point.
After OAuth succeeds, the callback returns to NexCode through the registered
`nexcode://oauth-complete` application URL. Runtime data is stored under
`~/.nexcode` unless `NEXCODE_HOME` is set.
