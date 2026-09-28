# NexCode for Ubuntu

This source tree is the Ubuntu desktop edition of NexCode. It runs the React
dashboard and its local management API in a GTK 3 + WebKitGTK shell. The local
HTTP port is management transport only: Codex CLI/App model requests continue
to connect directly to OpenAI and are never relayed through NexCode.

The native window does not install a GTK CSS provider or override the user's
theme. It uses Ubuntu's active GTK theme directly. Dashboard colors use the Yaru
palette and follow the desktop light/dark preference; there is no separate
NexCode theme selector.

The desktop shell uses WebKitGTK's software compositor by default. This avoids
driver-specific blank windows seen with accelerated compositing on some X11 and
Wayland systems. Set `WEBKIT_DISABLE_COMPOSITING_MODE=0` only when diagnosing
graphics behavior and explicitly opting back into hardware compositing.

## Build the `.deb`

On Ubuntu 22.04 or newer:

```bash
npm ci
npm run ubuntu:deb
```

The package is written to `dist/nexcode-ubuntu_<version>_<architecture>.deb`.
The build bundles Bun and all runtime JavaScript dependencies, so Bun does not
need to be installed separately on the target machine.

## Install and run

```bash
sudo apt install ./dist/nexcode-ubuntu_*.deb
nexcode-ubuntu
```

NexCode also appears in the Ubuntu application menu. The package provides the
usual CLI commands as both `nxc` and `nexcode`.

```bash
nxc status
nxc gui
```

Runtime configuration remains in `~/.nexcode` unless `NEXCODE_HOME` is set.
Removing the Debian package does not delete that user-owned configuration.

Selecting an account closes running Codex processes and atomically replaces
the native `$CODEX_HOME/auth.json` login through the encrypted native-profile
vault. The original login can be selected again, refreshed credentials are
preserved, and accounts missing an identity token ask for a new login. Reopen
Codex after switching; both the CLI and app use the selected account.

## Updates and exports (1.0.1)

Use **Check for Updates** in the window header or tray menu. Installed copies
also check once on startup. NexCode discovers stable Ubuntu releases separately
from Windows and macOS, verifies an Ed25519 signature, SHA-256, architecture and
Debian package identity, then asks Ubuntu for administrator authorization to
install the `.deb`. Reopen NexCode after installation. Cancelling authorization
or a failed installation restarts the management service; your accounts and
configuration remain in your user directory. Debian package installation is
managed by APT; it does not provide an application-level rollback transaction.

Version 1.0.0 has no OTA client: install the 1.0.1 `.deb` once to enable future
in-app updates. Development checkouts can check releases, but cannot install OTA.

Thread export opens Ubuntu's native save dialog. Choose the Markdown filename
and directory, confirm replacement if needed, and receive success only after
the file is saved. Cancelling does not display a success message. Other dashboard
downloads also use the native save dialog.

## Signed OTA release

The public key is `desktop/linux/UpdateSigningPublicKey.pem`. Keep its matching
private Ed25519 key outside version control and back it up securely. Existing
clients will reject a replacement key. Initialize a key only for a new update
channel: `python3 desktop/linux/sign_ota.py --init-key /secure/path/private.pem`.

From a clean committed checkout, after running the runtime, GUI and Ubuntu tests:

```bash
npm run ubuntu:deb
python3 desktop/linux/sign_ota.py \
  --package dist/Ubuntu-Ota-Updata-amd64.deb \
  --private-key /secure/path/private.pem \
  --version 1.0.1 --source-commit "$(git rev-parse HEAD)"
```

Publish `Ubuntu-Ota-Updata-amd64.deb`, its `.deb.sha256`, `.json` and `.sig`
siblings, plus the versioned Debian installer, under `ubuntu-v1.0.1` in
`jasonlee539/NexCode`. Mark platform-specific releases as **not latest** to
preserve the Windows update channel. Do not overwrite existing release assets.
ARM64 uses the same procedure on an ARM64 Ubuntu host and the `arm64` filenames.
The signer checks the packaged version, public key and source commit before
reading the private key; it refuses dirty source trees and mismatched packages.
