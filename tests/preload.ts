/**
 * Bun test preload — the FIRST line of defense for the developer's real NexCode home.
 *
 * `bun run test` already sandboxes HOME/NEXCODE_HOME/CODEX_HOME through
 * `scripts/test.ts`. The incident this file prevents happened under a bare
 * `bun test <file>` — the command anyone reaches for while iterating on one test —
 * which gets no wrapper and therefore had no isolation at all. A preload runs for
 * EVERY invocation, so the protection no longer depends on remembering the wrapper.
 * (devlog `_plan/260730_codex_rs_upstream_v2_live_handoff/070`.)
 *
 * Import order below is load-bearing: importing the guard captures the real home at
 * module load, and that must happen BEFORE this file replaces HOME.
 */
import { isTestHomeGuardArmed, protectedHomeForTests } from "../src/lib/test-home-guard";
import { createIsolatedTestEnvironment } from "../scripts/test";
import { rmSync } from "node:fs";

// Under `bun run test` the wrapper already handed us a sandbox (and NXC_REAL_HOME so the
// guard could still see the true home). Isolating again is harmless and deliberate: the
// alternative — inferring "already isolated" from path shapes — would trust exactly the
// user-controlled environment state this file exists to distrust.
const isolated = createIsolatedTestEnvironment();
for (const [key, value] of Object.entries(isolated.env)) {
  if (value !== undefined) process.env[key] = value;
}

// Arm the guard only after the sandbox is in place, so nothing observes a half-applied
// state. The guard's protected path was already captured at import time above.
process.env.NXC_TEST_HOME_GUARD = "1";
// Ordinary route tests mock `fetch` and must never escape to the real ChatGPT
// WebSocket merely because the developer upgraded Bun. Dedicated WS tests inject
// their own supported runtime through HandleResponsesOptions and bypass this value.
process.env.NXC_TEST_CODEX_WS_RUNTIME = "1.3.14";
// Lets a test assert one preload per process rather than assuming Bun's scheduling.
process.env.NXC_TEST_PRELOAD_PID = String(process.pid);

if (!isTestHomeGuardArmed() || !protectedHomeForTests()) {
  throw new Error("test home guard failed to arm; refusing to run tests unprotected");
}

// Clean up only the root this preload created. The `bun run test` wrapper owns its own.
process.on("exit", () => {
  try { rmSync(isolated.root, { recursive: true, force: true }); } catch { /* best effort at exit */ }
});
