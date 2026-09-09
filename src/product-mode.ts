/**
 * NexCode Desktop is a Codex management application. Its loopback listener is
 * reserved for the dashboard and management API; it is not a model proxy.
 *
 * The CLI entry point sets this marker so dynamic command paths observe the
 * same product boundary. Tests and embedded legacy-runtime fixtures can leave
 * it unset when they exercise the retired proxy implementation in isolation.
 */
export const NEXCODE_MANAGEMENT_ONLY_ENV = "NEXCODE_MANAGEMENT_ONLY";

export function enableManagementOnlyRuntime(env: NodeJS.ProcessEnv = process.env): void {
  env[NEXCODE_MANAGEMENT_ONLY_ENV] = "1";
}

export function isManagementOnlyRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[NEXCODE_MANAGEMENT_ONLY_ENV] === "1";
}
