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
the native `$CODEX_HOME/auth.json` login. Reopen Codex after switching; both the
CLI and app then use the account selected in NexCode.
