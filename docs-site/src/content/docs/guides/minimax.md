---
title: MiniMax clients
description: Route MiniMax Code and MiniMax CLI text commands through NexCode without exposing MiniMax credentials.
---

MiniMax publishes two different command-line products. NexCode integrates each at
the protocol boundary it actually exposes:

- **MiniMax Code** (`mcode`) is a coding agent with custom Anthropic Messages providers.
- **MiniMax CLI** (`mmx`) is a multimodal platform CLI. Only its `text` resource speaks
  the Anthropic-compatible API that NexCode can route.

## MiniMax Code

Install and sign in to MiniMax Code using MiniMax's instructions first. Then start
NexCode and connect the reversible file integration:

```bash
nxc start
nxc integration client enable --client mcode
nxc mcode
```

![MiniMax Code integration shown with isolated example data](/screenshots/minimax-code-integration.png)

The integration merges one block into `~/.minimax/config.yaml`:

```yaml
custom_provider:
  nexcode:
    name: NexCode
    kind: custom
    enabled: true
    api: anthropic-messages
    options:
      apiKey: nexcode-loopback
      baseURL: http://127.0.0.1:10100
      authMode: api-key
    models:
      anthropic/claude-opus-5:
        limit:
          context: 1000000
```

The real generated model list and its known context windows and reasoning-effort ladders
come from the running NexCode catalog. A model with no authoritative context window or
effort ladder omits that field instead of receiving a guessed value. MCode keeps the
currently selected effort in the session, so NexCode exports `effortOptions` without
overwriting that selection. The block does not write a real key, does not replace
`defaultModel`, and does not change your MiniMax login. In MCode, choose a model under
`custom_provider:nexcode/...`.

`nxc mcode` verifies that this provider points at the currently running proxy before it
launches the client. After the one-time enable, `nxc sync` refreshes the owned block when
the port or catalog capabilities change. Automatic sync never creates an unowned block,
recreates one you removed, or overwrites a file that changed after NexCode wrote it; use
the enable command when you intentionally want to reconnect. Disable or restore it through
the same audited integration system:

```bash
nxc integration client disable --client mcode
nxc integration client history --client mcode
nxc integration client restore --op <opId> [--confirm-drift]
```

`MINIMAX_DATA_DIR` and the legacy `MAVIS_DATA_DIR` are honored. Relative overrides are
refused because NexCode and MCode may start in different working directories.

## MiniMax CLI (`mmx`)

Install the official CLI separately:

```bash
npm install -g mmx-cli
mmx --version
```

Route a text command through NexCode by using the wrapper and an NexCode model id:

```bash
nxc mmx text chat \
  --model anthropic/claude-opus-5 \
  --message "Explain this function"

nxc mmx --output json text chat \
  --model openai/gpt-5.6-sol \
  --message "Return a JSON summary"
```

MMX hard-codes `/anthropic/v1/messages` below its API base URL. The wrapper starts a
temporary loopback bridge for the lifetime of the child process. It accepts only POST
requests to that Messages path and `/anthropic/v1/messages/count_tokens`, mapping them
to NexCode's existing `/v1/messages` and `/v1/messages/count_tokens` data plane while
preserving request bodies and query data. Canonical NexCode request translation,
usage accounting and configured downstream provider authentication remain in effect;
providers receive `x-api-key` or bearer transport according to their configuration.
Streaming preserves Anthropic message and content events. Before forwarding, the bridge
removes incoming admission credential headers and pins the public
`nexcode-loopback` placeholder. Arbitrary Anthropic resources are not proxied, and
the bridge is never exposed beyond loopback.

The wrapper also creates a temporary `MMX_CONFIG_DIR` containing only that placeholder,
then deletes it after `mmx` exits. Your `~/.mmx/config.json`, OAuth tokens and MiniMax
API key are never loaded or copied.

The following limits are intentional:

- Only `text chat` and `text repl` are routed through NexCode.
- `--api-key`, `--base-url` and `--region` are refused by the wrapper so caller
  credentials or destination selectors cannot conflict with the isolated bridge.
- The wrapper is loopback-only because MMX cannot send NexCode's dedicated
  `x-nexcode-api-key` admission header for a remote bind.
- Run plain `mmx` for `image`, `video`, `speech`, `music`, `vision`, `search`, `quota`,
  `auth`, `config`, `file` and `update`; those call MiniMax-specific APIs that NexCode
  does not emulate.

`mmx` defaults its text model to `MiniMax-M3`. Pass `--model <provider/model>` when you
want a specific NexCode route; otherwise normal NexCode model routing rules decide
whether the default id is available.
