---
title: Installation
description: Install the nexcode (nxc) proxy, its prerequisites, and verify it runs.
---

nexcode installs two equivalent command names, `nxc` and `nexcode`. Both launch the same small
local HTTP server (built on Bun). Model requests go to the provider selected by routing; optional
vision and web-search sidecars can also use your ChatGPT login when a routed model needs them.

## Prerequisites

| Requirement | Why |
| --- | --- |
| **[Node](https://nodejs.org) ≥ 18** | `nxc` runs on the Bun runtime, but the runtime is bundled automatically on `npm install` — you do **not** need to install Bun yourself. |
| **[OpenAI Codex](https://openai.com/codex)** (CLI, App, or SDK) | The client nexcode sits in front of. nexcode writes to `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`). |
| A provider account or API key | Anthropic, xAI, Kimi, Ollama Cloud, OpenRouter, an OpenAI-compatible endpoint, or your ChatGPT login. |

## Install

```bash
npm install -g @bitkyc08/nexcode
```

:::note[npm blocked the bun postinstall?]
Recent npm versions may block bun's postinstall script (`npm warn
install-scripts ... blocked because they are not covered by allowScripts`),
which leaves the bundled Bun runtime unprepared. Reinstall allowing bun's
script — and always include the package name (npm's abbreviated suggestion
omits it, which would reinstall the current directory instead):

```bash
npm install -g --allow-scripts=bun @bitkyc08/nexcode

# if the original install used sudo, keep using sudo:
sudo npm install -g --allow-scripts=bun @bitkyc08/nexcode
```
:::

Verify both command aliases are on your `PATH`:

```bash
nxc --version
nexcode --version
```

### Release channels

The stable `latest` channel already includes GPT-5.6 Sol/Terra/Luna catalog support for ChatGPT,
OpenAI API-key, OpenRouter, and experimental Cursor routes. Upstream access is still account-gated;
the catalog entries do not grant access by themselves. Use the preview channel only to test
unreleased nexcode builds:

```bash
npm install -g @bitkyc08/nexcode@preview
nxc update --tag preview
```

## Run from source

To hack on nexcode itself:

```bash
git clone https://github.com/lidge-jun/nexcode.git
cd nexcode
bun install
bun run dev:proxy   # starts the proxy API in dev mode (src/cli/index.ts start)
bun run dev:gui     # starts the dashboard dev server (another terminal)
```

`bun run dev` remains an alias for `bun run dev:proxy`. The proxy API exposes `/healthz`,
`/v1/responses`, and `/api/*`; `GET /` serves the packaged dashboard only after `bun run build:gui`
has produced `gui/dist`. While hacking on the dashboard, run the frontend separately with
`bun run dev:gui`.

## What gets created

nexcode state lives under `$NEXCODE_HOME` (default `~/.nexcode`). Codex integration files live
under `$CODEX_HOME` (default `~/.codex`).

| Path | Purpose |
| --- | --- |
| `$NEXCODE_HOME/config.json` | Your providers, default provider, port, and options. |
| `$NEXCODE_HOME/nxc.pid` | PID of the running proxy (single-instance guard). |
| `$NEXCODE_HOME/runtime-port.json` | The live PID, hostname, and port, including an automatically selected fallback port. |
| `$NEXCODE_HOME/auth.json` | Stored OAuth credentials (when you `nxc login`). |
| `$NEXCODE_HOME/catalog-backup*.json` | Codex model catalog backups made before nexcode edits it. |
| `$CODEX_HOME/config.toml` | On loopback, nexcode adds a marker-owned root `openai_base_url`; non-loopback binds use `model_provider = "nexcode"` plus `[model_providers.nexcode]` so Codex can send the API-auth header. |
| `$CODEX_HOME/nexcode.config.toml` | Fallback/reference profile written alongside the main Codex config. |
| `$CODEX_HOME/nexcode-catalog.json` | Synced native and routed model catalog used by Codex. |

:::note
nexcode never deletes your Codex config. Every injection is reversible — `nxc stop`, `nxc restore`,
or `nxc eject` strip exactly the lines nexcode added and restore native Codex.
:::

## Next

Continue to the [Quickstart](/getting-started/quickstart/) to configure your first provider,
or read [How It Works](/getting-started/how-it-works/) for the architecture.
