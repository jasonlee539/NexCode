import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCommand } from "./registry";

const repoRoot = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

function packageVersion(): string {
  const raw = readFileSync(join(repoRoot, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "unknown";
}

export function printVersion(): void {
  console.log(`nexcode ${packageVersion()}`);
}

export function printUsage(): void {
  console.log(`nexcode (nxc) — Universal provider proxy for Codex

Usage:
  nxc setup                   Interactive setup (alias: init)
  nxc start [--port <port>]   Start the proxy server (auto-syncs models to Codex)
  nxc stop                    Stop the proxy AND restore native Codex (plain codex works again)
  nxc restore                 Restore native Codex without stopping (alias: eject)
  nxc restore back            Re-point codex at the running proxy (undo restore)
  nxc recover-history --legacy-openai
                               Explicitly recover pre-backup syncResumeHistory rows
  nxc uninstall               Remove service/shim/config and restore native Codex (alias: remove)
  nxc service [sub]           Run as a background service (default: install/update/start)
  nxc codex-shim <sub>        Auto-start proxy when \`codex\` launches (install|status|uninstall|remove)
  nxc tray <sub>              Windows status tray (install|start|stop|status|uninstall)
  nxc ensure                  Ensure the proxy is running and Codex config/cache are current
  nxc sync [--restart-codex]  Fetch models from providers and inject into Codex config
  nxc sync-cache [--restart-codex]
                              Refresh Codex's model cache from the active catalog
  nxc status                  Check proxy server status
  nxc doctor                  Diagnose environment/network issues (WSL, proxy, ChatGPT reachability)
  nxc doctor --reclaim-response-temps
                              Reclaim abandoned response-state temp files (works without a running proxy)
  nxc doctor --recover-zero-byte-coordinator --yes
                              Back up a proven zero-byte Codex coordinator after stopping the proxy
  nxc debug <scope>           provider/usage/injection/claude on|off|status|reset
  nxc login <provider>        OAuth or API-key provider login
  nxc logout <provider>       Remove a stored OAuth login
  nxc gui                     Open the nexcode dashboard
  nxc update [--tag <tag>]    Update nexcode (keeps preview installs on @preview)
  nxc restart                  Stop and restart the proxy
  nxc v2 <sub>                multi_agent_v2 surface (status|on|off|mode|keep-native-v1|threads|mode-hint)
  nxc health [--json]          Check proxy health (exit 0=healthy, 1=not)
  nxc ready [--json] [--wait [--timeout <s>]]  Check post-sync readiness (exit 0 only when ready)
  nxc provider <sub>          Providers, connectivity, quota, and selected models
  nxc account <sub>           Accounts, login/reauth, key pools, and quota controls
  nxc models <sub>            Live/custom models, visibility, context, and shadow calls
  nxc combo <sub>             Combo failover/round-robin routing
  nxc agent <sub>             Subagents, injection, effort caps, and sidecars
  nxc observe <sub>           Logs, usage, storage, memory, and debug data
  nxc route <sub>             Routing features (combo, policy)
  nxc logs [filters]          Alias of nxc observe logs
  nxc usage [--range <7d|30d|all>]  Alias of nxc observe usage
  nxc storage [--json]        Alias of nxc observe storage
  nxc memory [--json]         Alias of nxc observe memory
  nxc api-key <sub>           Alias of nxc access key
  nxc access <sub>            External API keys and endpoint information
  nxc export --client <id>    Print a client config wired to the running proxy (11 clients)
  nxc integration client <sub> Enable, disable, inspect or roll back a client integration
  nxc grok <sub>              Grok Build model selection and apply
  nxc system <sub>            Runtime settings, startup, sync, and updates
  nxc config <sub>            Validated configuration show/get/set/import/export
  nxc lab <sub>               Read-only Compatibility Lab projection inspection
  nxc claude [args...]        Launch Claude Code wired to the proxy (model discovery on)
  nxc claude desktop [sub]    Manage and apply Claude Desktop's four-family profile
  nxc opencode [args...]      Launch opencode wired to the proxy (runtime provider config)
  nxc mcode [args...]         Launch MiniMax Code through its managed provider
  nxc mmx text <sub> [args]   Launch MiniMax CLI text through the proxy
  nxc zcode [sub]             Connect ZCode to the proxy (managed provider)
  nxc help [command]          Show help
  nxc --version | -v          Print version

Examples:
  nxc init                    Set up provider and inject into Codex
  nxc start                   Start on default port (10100)
  nxc start --port 8080       Start on custom port
  nxc help service            Show service command help
  nxc sync                    Sync available models to Codex`);
}

export function hasHelpFlag(values: string[]): boolean {
  return values.some(value => value === "--help" || value === "-h" || value === "help");
}

export function printSubcommandUsage(name: string | undefined): void {
  const entry = name ? findCommand(name) : undefined;
  if (!entry) {
    console.error(`Unknown command: ${name ?? ""}`.trim());
    printUsage();
    process.exit(1);
  }
  console.log(`Usage: ${entry.usage}\n\n${entry.summary}`);
  if (entry.details?.length) console.log(`\n${entry.details.join("\n")}`);
}
