# NexCode Desktop

This directory contains the native Windows shell and reproducible local app
packager. The packaged app receives its runtime, dashboard, dependencies, and
Bun executable from this NexCode tree. It renders the same `gui/dist`
dashboard used during development, so themes and product behavior stay on one
implementation.

Build the x64 portable application and per-user installer from PowerShell:

```powershell
npm run desktop:build
```

The command writes these release artifacts to `dist/`:

- `NexCode-windows-x64/` — runnable portable directory containing
  `NexCode.exe` and the bundled runtime.
- `NexCode-windows-x64-portable.zip` — portable distribution archive.
- `NexCode-Setup-<version>-x64.exe` — single-file installer with uninstall,
  Start menu, desktop shortcut, and `nexcode://` protocol registration.

Use `npm run desktop:portable` to omit the installer. Windows builds
require Visual Studio 2019 or newer with the .NET Framework 4.7.2 targeting
pack. The app uses the automatically updated Microsoft Edge WebView2 Runtime;
Windows 10/11 normally provides it, and the app shows a recovery link when it
is missing.

The app build copies only the runtime allowlist shown in `build-windows.ps1`;
it does not copy the repository's `.env` files or the user's home/config directories.
Before signing or installer creation, packaging also scans the staged app for
the configured Google OAuth client ID, client secret, and Google Cloud API key.
The build fails without printing the credential if any configured value was
captured in the app. The same check therefore covers the Windows portable
archive and installer.

The app starts the bundled management service, discovers its actual loopback port, loads the
dashboard in WebView2, opens external OAuth pages in the default browser, and
asks the service to shut down cleanly when the app quits. The loopback service
serves only the dashboard and authenticated management APIs: `/v1/*` model
requests are rejected, and NexCode never writes `openai_base_url` into Codex.
Codex CLI and Codex App therefore continue to contact their native endpoint
directly. On startup, NexCode removes routing fields left by earlier versions.

Account selection is a native credential operation. After explicit confirmation,
NexCode stops verified Codex App/CLI processes and atomically replaces the
effective `CODEX_HOME/auth.json` through the encrypted native-profile vault.
The dashboard updates its selected account only after that transaction succeeds.
After OAuth succeeds, the callback returns to NexCode through the registered
`nexcode://oauth-complete` application URL.
Runtime data is stored under `~/.nexcode` unless `NEXCODE_HOME` is set.
