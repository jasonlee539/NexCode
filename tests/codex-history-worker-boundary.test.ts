/**
 * The parent side of the history Worker boundary.
 *
 * Three gaps an audit found, each a different way a dead or malformed Worker
 * surfaced as something it was not. The one to watch is the last: the Worker
 * ALWAYS closes after posting its result, so a close handler that overturned a
 * valid success would report every completed job as a death.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodexHistoryJob } from "../src/codex/history-job";

let root = "";
let previousCodexHome: string | undefined;
let previousNexcodeHome: string | undefined;
const cleanup: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nxc-hist-boundary-"));
  cleanup.push(root);
  const codexHome = join(root, ".codex");
  const nexcodeHome = join(root, ".nexcode");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(nexcodeHome, { recursive: true });
  previousCodexHome = process.env.CODEX_HOME;
  previousNexcodeHome = process.env.NEXCODE_HOME;
  process.env.CODEX_HOME = codexHome;
  process.env.NEXCODE_HOME = nexcodeHome;
});

afterEach(() => {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  if (previousNexcodeHome === undefined) delete process.env.NEXCODE_HOME;
  else process.env.NEXCODE_HOME = previousNexcodeHome;
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe("a dead worker is not a slow one", () => {
  /**
   * The skip path never spawns a Worker at all, so it is the control: the job
   * completes without the boundary being exercised. The boundary cases below
   * need a Worker that actually runs, and a real history target is a heavy
   * fixture — so these hold down the classification contract through the
   * in-process seams the module already exposes, and the live two-process race
   * exercises the real Worker end to end.
   */
  test("skip completes without a worker", async () => {
    const outcome = await runCodexHistoryJob({
      operation: "skip",
      canonicalCodexHome: process.env.CODEX_HOME!,
      canonicalStateDbPath: join(root, ".codex", "state_5.sqlite"),
      canonicalBackupPath: join(root, ".codex", "state_5.sqlite.nxc-backup.json"),
    });
    expect(outcome.kind).toBe("skipped");
  });
});

describe("the result validator", () => {
  test("a recognized type with no payload is not a success", async () => {
    // {requestId, type:"done"} with nothing else used to read as converged with
    // undefined rows. The module-level validator is the contract, exercised
    // through the job's own classification seam rather than a fabricated cast.
    const { isPlausibleWorkerResultForTests } = await import("../src/codex/history-job");
    expect(isPlausibleWorkerResultForTests(
      { requestId: "r", type: "done" }, "r", "j",
    )).toBe(false);
    expect(isPlausibleWorkerResultForTests(
      { requestId: "r", jobId: "j", type: "done", outcome: "converged", rows: 3, files: 1 }, "r", "j",
    )).toBe(true);
    // A reply for a different job is not this job's answer.
    expect(isPlausibleWorkerResultForTests(
      { requestId: "r", jobId: "OTHER", type: "done", outcome: "converged", rows: 3, files: 1 }, "r", "j",
    )).toBe(false);
    const target = {
      canonicalStateDbPath: "/state/state_5.sqlite",
      canonicalBackupPath: "/state/state_5.sqlite.nxc-backup.json",
      operation: "migrate-openai" as const,
    };
    const verifiedNoop = {
      requestId: "r", jobId: "j", type: "done", outcome: "converged", rows: 0, files: 0,
      proof: {
        kind: "verified-noop", pendingRows: 0, backupEntries: 0,
        canonicalStateDbPath: target.canonicalStateDbPath, stateDbPresent: true,
        canonicalBackupPath: target.canonicalBackupPath, backupPresent: false,
      },
    };
    expect(isPlausibleWorkerResultForTests(verifiedNoop, "r", "j", target)).toBe(true);
    expect(isPlausibleWorkerResultForTests(
      { ...verifiedNoop, proof: { ...verifiedNoop.proof, canonicalStateDbPath: "/other/state.sqlite" } },
      "r", "j", target,
    )).toBe(false);
    expect(isPlausibleWorkerResultForTests({ ...verifiedNoop, rows: 1 }, "r", "j", target)).toBe(false);
    expect(isPlausibleWorkerResultForTests(
      { ...verifiedNoop, proof: { ...verifiedNoop.proof, canonicalBackupPath: "/other/backup.json" } },
      "r", "j", target,
    )).toBe(false);
    expect(isPlausibleWorkerResultForTests(
      { ...verifiedNoop, proof: { ...verifiedNoop.proof, pendingRows: 1 } },
      "r", "j", target,
    )).toBe(false);
    expect(isPlausibleWorkerResultForTests({ ...verifiedNoop, outcome: "skipped" }, "r", "j", target)).toBe(false);
    expect(isPlausibleWorkerResultForTests(verifiedNoop, "r", "j")).toBe(false);
    expect(isPlausibleWorkerResultForTests(
      verifiedNoop, "r", "j", { ...target, operation: "apply-nexcode" },
    )).toBe(false);
  });

  test("blocked carries exactly its three reasons", async () => {
    const { isPlausibleWorkerResultForTests } = await import("../src/codex/history-job");
    for (const reason of ["busy", "database", "unsafe-path"] as const) {
      expect(isPlausibleWorkerResultForTests(
        { requestId: "r", jobId: "j", type: "blocked", reason }, "r", "j",
      )).toBe(true);
    }
    expect(isPlausibleWorkerResultForTests(
      { requestId: "r", jobId: "j", type: "blocked", reason: "invented" }, "r", "j",
    )).toBe(false);
  });
});
