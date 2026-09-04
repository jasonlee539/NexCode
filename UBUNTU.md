# NexCode for Ubuntu

This source tree is the Ubuntu desktop edition of NexCode. It keeps the Bun
proxy and React dashboard while replacing the macOS-only application shell with
a GTK 3 + WebKitGTK shell and a Debian package build.

The native window does not install a GTK CSS provider or override the user's
theme. It uses Ubuntu's active GTK theme directly. Dashboard colors use the Yaru
palette and follow the desktop light/dark preference; there is no separate
NexCode theme selector.

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
