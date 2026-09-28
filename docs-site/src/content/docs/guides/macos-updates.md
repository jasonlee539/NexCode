---
title: NexCode macOS desktop updates
description: Install the first OTA-capable Mac build and update it in the app.
---

NexCode macOS 1.0.1 adds automatic update checks and a **检查更新…** (Check for
updates) command in the application and menu-bar menus. Install 1.0.1 manually
from the [GitHub release](https://github.com/jasonlee539/NexCode/releases/tag/v1.0.1):
version 1.0.0 cannot install an OTA update itself. Move the app out of the DMG
into a writable Applications folder before updating.

When a newer stable release includes assets for your Mac's architecture, NexCode
asks before downloading and restarting. It verifies the signed manifest,
SHA-256, size, version, and architecture. Missing or invalid update resources
cannot be installed. Windows-only releases are skipped.

The installer retains the previous app beside NexCode. If the new management
runtime fails to start, it restores that app. It does not replace account,
configuration, or thread data. The downloads are ad-hoc signed; the independent
OTA signature is not Apple notarization.

This version also adds native Markdown save dialogs and brings Windows account
switching improvements to the Mac. Confirming a switch stops Codex processes
before updating the login through the encrypted profile vault. Credentials
created by older releases may require one new login. Relaunch Codex after the
switch completes.
