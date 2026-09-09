/**
 * Packaged desktop editions are Codex management applications, not model relays.
 *
 * Keep this process-local instead of persisting it in config.json: an upstream
 * NexCode proxy installation may share the same config directory, while the
 * packaged desktop launcher must never opt Codex into that proxy data plane.
 */
export function isManagementOnlyRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXCODE_MANAGEMENT_ONLY === "1";
}
