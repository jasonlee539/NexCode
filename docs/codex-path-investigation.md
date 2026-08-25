# Codex Path Investigation

Date: 2026-06-19

> **Archive note.** This is a dated investigation record, not current behavior
> documentation. Some details (e.g. the referenced Codex version) reflect the state
> at the time of writing. For current behavior see
> [nexcode.me](https://nexcode.me/) and the
> maintainer source-of-truth under [`structure/`](../structure).

This note records the web/source investigation behind nexcode's Codex path
handling. The short version is that modern Codex resolves almost all durable
local state through `CODEX_HOME`, not a platform-specific nexcode guess. If
`CODEX_HOME` is unset, Codex falls back to `~/.codex`.

## Primary conclusion

nexcode should treat Codex's home directory exactly as Codex does:

1. If `CODEX_HOME` is set and non-empty, it must already exist and be a
   directory.
2. That directory is canonicalized.
3. If `CODEX_HOME` is not set, the default is `<user home>/.codex`.
4. All nexcode-managed Codex files should be written under that resolved root:
   - `$CODEX_HOME/config.toml`
   - `$CODEX_HOME/nexcode.config.toml`
   - `$CODEX_HOME/nexcode-catalog.json`
   - `$CODEX_HOME/models_cache.json`

The old nexcode behavior assumed `homedir()/.codex` everywhere. That happened
to work on many macOS setups because Codex and nexcode both landed on the same
default. It breaks when Codex is launched with a different `CODEX_HOME`, when
the Desktop/App host injects one, or when a service manager starts nexcode
without the same shell environment.

## Web findings

### `CODEX_HOME`

OpenAI's Codex environment variable reference says `CODEX_HOME` is used by the
CLI, IDE extension, app-server, and installers. It defaults to `~/.codex` and is
the root for config, auth, logs, sessions, skills, and standalone package
metadata. It also states that if the variable is set, the directory must already
exist.

Source:
https://developers.openai.com/codex/environment-variables

The open-source Codex implementation confirms the same behavior in
`codex-rs/utils/home-dir/src/lib.rs`: it reads `CODEX_HOME`, rejects missing or
non-directory paths, canonicalizes a valid directory, and otherwise appends
`.codex` to the user's home directory.

Source:
https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs

Node/Bun's `os.homedir()` is not a Codex-compatible replacement for
`CODEX_HOME`. The Node docs say POSIX uses `$HOME` first, while Windows uses
`USERPROFILE` first. That explains why `homedir()/.codex` usually matched on
macOS/Linux terminals but was still the wrong abstraction for Codex.

Source:
https://nodejs.org/api/os.html#oshomedir

### User config and profiles

Codex user configuration lives under the Codex home. The current docs commonly
show the default path as `~/.codex/config.toml`, but the same docs also state
that Codex local state is under `CODEX_HOME`.

Sources:
https://developers.openai.com/codex/config-advanced
https://developers.openai.com/codex/config-reference

The profile model changed in modern Codex. OpenAI's advanced configuration docs
say that `--profile profile-name` loads the base config and then overlays
`~/.codex/profile-name.config.toml`; profile files should use top-level config
keys and must not be nested under `[profiles.profile-name]`.

The same page states that in Codex `0.134.0` and later, `--profile` no longer
reads `[profiles.profile-name]` from `config.toml`, and the top-level
`profile = "profile-name"` selector is no longer supported.

Source:
https://developers.openai.com/codex/config-advanced

For nexcode this means:

```toml
# $CODEX_HOME/nexcode.config.toml
model_provider = "nexcode"
model_catalog_json = "/absolute/path/to/nexcode-catalog.json"
```

Do not write this as:

```toml
[profiles.nexcode]
model_provider = "nexcode"
```

### `model_catalog_json`

The Codex configuration reference lists `model_catalog_json` as a string path to
a JSON model catalog loaded on startup. It also says a selected
`$CODEX_HOME/profile-name.config.toml` profile file can override it per profile.

Source:
https://developers.openai.com/codex/config-reference

The open-source config types show the same key at both levels:

- root `ConfigToml.model_catalog_json`
- profile `ConfigProfile.model_catalog_json`

Sources:
https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs
https://github.com/openai/codex/blob/main/codex-rs/config/src/profile_toml.rs

The source comments say this catalog is applied on startup only. Practically,
nexcode must write or update the catalog before the target Codex process
starts or must ask the user/process to restart. Editing the catalog while Codex
is already running is not enough for all surfaces.

### `models_cache.json`

The Codex models manager source defines `MODEL_CACHE_FILE` as
`models_cache.json` and constructs the cache path as
`codex_home.join(MODEL_CACHE_FILE)`. It also defines the default model cache TTL
as 300 seconds.

Source:
https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/manager.rs

For nexcode this means invalidation must target:

```text
$CODEX_HOME/models_cache.json
```

not:

```text
~/.codex/models_cache.json
```

GitHub issues in the official Codex repository also repeatedly mention
`models_cache.json` as the local model list/cache file, including Windows paths
such as `C:\Users\<user>\.codex\models_cache.json`. Issues are not the primary
source of truth, but they confirm the same practical behavior users observe.

Examples:
https://github.com/openai/codex/issues/12542
https://github.com/openai/codex/issues/23119

### Project `.codex/config.toml`

Codex can also read project-scoped `.codex/config.toml` files inside a repo, but
only when the project is trusted. OpenAI's docs say project config cannot
override machine-local provider/auth/profile/telemetry keys such as
`model_provider`, `model_providers`, `profile`, and `profiles`.

Source:
https://developers.openai.com/codex/config-advanced

Therefore nexcode provider injection must remain user-level/profile-level. It
should not rely on a project-local `.codex/config.toml` to install
`model_provider` or `[model_providers.nexcode]`.

### Global instructions under Codex home

OpenAI's `AGENTS.md` guide says the global instruction scope is also under the
Codex home directory: Codex reads `AGENTS.override.md` or `AGENTS.md` there,
unless `CODEX_HOME` points elsewhere.

Source:
https://developers.openai.com/codex/guides/agents-md

This is another confirmation that `CODEX_HOME` is the root concept, not a
hardcoded `~/.codex` path.

## Platform-specific path notes

### macOS

Default path when `CODEX_HOME` is unset:

```text
/Users/<user>/.codex
```

Why the old code often worked on macOS:

- Terminal-launched Codex usually had no `CODEX_HOME`.
- nexcode used `os.homedir()/.codex`.
- Codex also fell back to `~/.codex`.

So both processes touched the same files by coincidence. The implementation was
still wrong because it ignored the official override.

For launchd services, the plist must explicitly carry the same environment if
nexcode was installed under a custom `CODEX_HOME`. The `launchd.plist` man
page defines `ProgramArguments` and `EnvironmentVariables`; the latter sets
additional environment variables before running the job.

Source:
https://www.manpagez.com/man/5/launchd.plist/

nexcode service plist should include:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>NXC_SERVICE</key><string>1</string>
  <key>PATH</key><string>...</string>
  <key>CODEX_HOME</key><string>/Users/me/.codex-custom</string>
</dict>
```

when `CODEX_HOME` was set during service installation.

### Linux

Default path when `CODEX_HOME` is unset:

```text
/home/<user>/.codex
```

The direct `nxc start` path works if the shell environment matches the shell
that later launches Codex. The service path is different: `systemd --user`
starts nexcode from a unit file, not necessarily from the same interactive
shell environment.

The systemd docs define `Environment=` for variables passed to executed
processes, and `StandardOutput=`/`StandardError=` support destinations such as
`append:path`.

Sources:
https://www.man7.org/linux/man-pages/man5/systemd.exec.5.html
https://www.flatcar.org/docs/latest/setup/systemd/environment-variables/

nexcode systemd units should pin the resolved install-time variables:

```ini
[Service]
Environment="NXC_SERVICE=1"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="CODEX_HOME=/home/me/.codex-custom"
StandardOutput="append:/home/me/.nexcode/service.log"
StandardError="append:/home/me/.nexcode/service.log"
```

If `CODEX_HOME` is omitted from the unit, nexcode can inject one Codex home
while Codex reads another. That recreates the "model list only shows native
models" bug on Linux service installs.

### Windows

Default path when `CODEX_HOME` is unset:

```text
C:\Users\<user>\.codex
```

This follows from Codex's `~/.codex` fallback plus Windows home-directory
resolution. Node's `os.homedir()` uses `USERPROFILE` first on Windows, but again
nexcode must prefer `CODEX_HOME` before touching `homedir()`.

OpenAI's Windows Codex docs also refer to diagnostics under `CODEX_HOME`, for
example:

```text
CODEX_HOME/.sandbox/sandbox.log
CODEX_HOME/.sandbox-secrets/
```

Source:
https://developers.openai.com/codex/windows

For Windows services, nexcode currently uses Task Scheduler. Microsoft's
`schtasks /create` documentation says `/tr` is the program or command to run
and `/sc onlogon` schedules a task whenever a user logs on. This means the
registered task should run the nexcode command with paths fully quoted.

Source:
https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create

Because Task Scheduler does not automatically encode nexcode-specific
environment overrides into the command the way a shell session does, nexcode
service install writes a small `.cmd` wrapper under `~/.nexcode/`. That wrapper
sets `NXC_SERVICE=1`, preserves `PATH`, preserves `CODEX_HOME` when present, and
then starts nexcode.

## Required nexcode behavior

### Resolve paths once, from Codex rules

Use a shared helper equivalent to:

```text
resolveCodexHome():
  if CODEX_HOME is non-empty:
    require it to exist
    require it to be a directory
    return canonical path
  else:
    return homedir()/.codex
```

Then derive:

```text
CODEX_CONFIG_PATH       = $CODEX_HOME/config.toml
CODEX_PROFILE_PATH      = $CODEX_HOME/nexcode.config.toml
DEFAULT_CATALOG_PATH    = $CODEX_HOME/nexcode-catalog.json
CODEX_MODELS_CACHE_PATH = $CODEX_HOME/models_cache.json
```

### Inject root config

Root `$CODEX_HOME/config.toml` should contain:

```toml
model_provider = "nexcode"
model_catalog_json = "/absolute/path/to/nexcode-catalog.json"

[model_providers.nexcode]
name = "NexCode Proxy"
base_url = "http://127.0.0.1:10100/v1"
wire_api = "responses"
requires_openai_auth = true
```

`model_provider` and `model_providers` must live in user-level config, not
project-local config.

### Inject profile config

`$CODEX_HOME/nexcode.config.toml` should use top-level keys:

```toml
model_provider = "nexcode"
model_catalog_json = "/absolute/path/to/nexcode-catalog.json"
```

This is the supported shape for:

```shell
codex --profile nexcode
```

### Remove legacy profile tables

Remove old blocks from `$CODEX_HOME/config.toml`:

```toml
[profiles.nexcode]
```

and avoid writing:

```toml
profile = "nexcode"
```

for modern Codex.

### Keep catalog startup behavior in mind

`model_catalog_json` is startup-loaded. After catalog changes, nexcode should:

- invalidate `$CODEX_HOME/models_cache.json` when appropriate;
- ensure the catalog exists before Codex starts;
- advise restart or trigger a fresh Codex process when a running UI does not
  pick up the new catalog.

### Service managers must preserve relevant environment

If a user runs `CODEX_HOME=/some/path nxc service install`, the service
definition should preserve that value:

- Linux: add `Environment="CODEX_HOME=/some/path"` to the systemd user unit.
- macOS: add `CODEX_HOME` under launchd `EnvironmentVariables`.
- Windows: run Task Scheduler through an explicit `.cmd` wrapper that sets
  `NXC_SERVICE=1` and preserves `CODEX_HOME` when present.

## Why macOS appeared fine

The old code was not macOS-correct in principle; it was default-path-compatible.
On a typical macOS terminal:

```text
Codex default     -> /Users/<user>/.codex
nexcode old     -> /Users/<user>/.codex
```

So model catalog/profile files landed where Codex read them. Windows exposed the
bug because the active Codex process and nexcode could disagree on the Codex
home, and because modern Codex requires the new profile file plus startup model
catalog path.

## Regression checklist

Run these cases before release:

1. Windows default home:
   - unset `CODEX_HOME`
   - run `nxc sync`
   - verify `$USERPROFILE\.codex\nexcode.config.toml`
   - verify `$USERPROFILE\.codex\nexcode-catalog.json`
   - verify `codex debug models` includes routed models

2. Windows custom home:
   - create a temp directory
   - set `CODEX_HOME` to it
   - run `nxc sync`
   - verify no writes go to `$USERPROFILE\.codex` except unrelated existing
     files

3. macOS default home:
   - unset `CODEX_HOME`
   - run `nxc sync`
   - verify `~/.codex/nexcode.config.toml`

4. macOS custom home:
   - set `CODEX_HOME` to an existing directory
   - run `nxc service install`
   - inspect `~/Library/LaunchAgents/com.nexcode.proxy.plist`
   - verify `CODEX_HOME` appears in `EnvironmentVariables`

5. Linux default home:
   - unset `CODEX_HOME`
   - run `nxc sync`
   - verify `~/.codex/nexcode.config.toml`

6. Linux custom home with service:
   - set `CODEX_HOME` to an existing directory
   - run `nxc service install`
   - inspect `~/.config/systemd/user/nexcode-proxy.service`
   - verify `Environment="CODEX_HOME=..."`

7. Catalog refresh:
   - add/remove routed models
   - verify `$CODEX_HOME/models_cache.json` is invalidated
   - restart Codex and confirm model picker/debug list includes routed models

## Source index

- OpenAI Codex environment variables:
  https://developers.openai.com/codex/environment-variables
- OpenAI Codex advanced configuration:
  https://developers.openai.com/codex/config-advanced
- OpenAI Codex configuration reference:
  https://developers.openai.com/codex/config-reference
- OpenAI Codex CLI reference:
  https://developers.openai.com/codex/cli/reference
- OpenAI Codex Windows docs:
  https://developers.openai.com/codex/windows
- OpenAI Codex AGENTS.md guide:
  https://developers.openai.com/codex/guides/agents-md
- Codex `CODEX_HOME` source:
  https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs
- Codex models manager/cache source:
  https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/manager.rs
- Codex root config TOML type:
  https://github.com/openai/codex/blob/main/codex-rs/config/src/config_toml.rs
- Codex profile TOML type:
  https://github.com/openai/codex/blob/main/codex-rs/config/src/profile_toml.rs
- Node/Bun home-directory semantics:
  https://nodejs.org/api/os.html#oshomedir
- systemd execution environment:
  https://www.man7.org/linux/man-pages/man5/systemd.exec.5.html
- systemd environment directive summary:
  https://www.flatcar.org/docs/latest/setup/systemd/environment-variables/
- launchd plist keys:
  https://www.manpagez.com/man/5/launchd.plist/
- Microsoft Task Scheduler `schtasks /create`:
  https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create
