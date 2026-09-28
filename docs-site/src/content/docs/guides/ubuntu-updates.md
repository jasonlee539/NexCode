---
title: Ubuntu desktop updates and export
description: Signed Ubuntu OTA updates, native file exports and account switching.
---

The Ubuntu desktop edition in `jasonlee539/NexCode` supports signed OTA updates
starting with 1.0.1. Install the 1.0.1 Debian package manually once when upgrading
from 1.0.0, which does not contain an OTA client.

Select **Check for Updates** in the window header or tray menu. Installed copies
also check on startup. A release must match Ubuntu and the current CPU
architecture, pass the embedded Ed25519 public-key signature check, and match
the signed size, SHA-256 and Debian package identity. Windows and Mac releases
do not change the Ubuntu update channel.

After download and verification, Ubuntu requests administrator authorization
to install the package using APT. Reopen NexCode after installation. Cancelling
authorization or an installation failure restarts the local management service.
Your accounts and settings remain in your user directory. Installation uses
Debian's package manager; automatic application-level rollback is not provided.

Thread **Export** opens a native save dialog for a Markdown file. Select a
directory and filename, and confirm before replacing a file. Success is shown
only after the write completes; cancelling does not claim an export occurred.
Other dashboard downloads also open the native save dialog.

Account switching uses the encrypted native-profile vault and preserves tokens
refreshed by Codex. You can return to the original login. Legacy accounts lacking
an identity token ask for reauthentication before switching. Close and reopen
Codex after switching to use the selected account.

Release maintainers should follow the signed-package procedure in
[UBUNTU.md](https://github.com/jasonlee539/NexCode/blob/Ubuntu/UBUNTU.md).
