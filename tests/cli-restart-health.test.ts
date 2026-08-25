import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cliPath = join(repoRoot, "src", "cli", "index.ts");

/**
 * Every subprocess in this file runs against a private temp NEXCODE_HOME so no
 * check can ever discover/inspect/mutate the operator's real proxy state. The
 * ready describe keeps ONLY the help-routing subprocess checks: the
 * network/no-proxy/argument-validation ready tests live as injected tests in
 * tests/cli-ready.test.ts (no real loopback/home).
 */
function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 10000,
  });
}

function isolatedHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeIsolatedConfig(dir: string): void {
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    port: 19999,
    providers: { openai: { adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex", authMode: "forward" } },
    defaultProvider: "openai",
    codexAutoStart: false,
  }), "utf8");
}

describe("nxc restart", () => {
  test("restart --help prints usage", () => {
    const dir = isolatedHome("nxc-restart-help-");
    try {
      const result = runCli(["restart", "--help"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("nxc restart");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("help restart shows restart help entry", () => {
    const dir = isolatedHome("nxc-restart-help-entry-");
    try {
      const result = runCli(["help", "restart"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Stop the proxy and restart");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("nxc health", () => {
  test("health --help prints usage", () => {
    const dir = isolatedHome("nxc-health-help-");
    try {
      const result = runCli(["health", "--help"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("nxc health");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("help health shows health help entry", () => {
    const dir = isolatedHome("nxc-health-help-entry-");
    try {
      const result = runCli(["help", "health"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Check proxy health");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("health exits 1 with no proxy running (isolated home)", () => {
    const dir = isolatedHome("nxc-health-");
    writeIsolatedConfig(dir);
    try {
      const result = runCli(["health"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("not healthy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("health --json exits 1 with valid JSON when no proxy", () => {
    const dir = isolatedHome("nxc-health-json-");
    writeIsolatedConfig(dir);
    try {
      const result = runCli(["health", "--json"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.pid).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("nxc ready", () => {
  // Only the help-routing subprocess checks live here. The default-probe,
  // --json, --wait, --timeout, and argument-validation cases are injected tests
  // in tests/cli-ready.test.ts (no real loopback/home).
  test("ready --help prints usage (exit 0)", () => {
    const dir = isolatedHome("nxc-ready-help-");
    try {
      const result = runCli(["ready", "--help"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("nxc ready");
      expect(result.stdout).toContain("--wait");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("help ready shows the ready help entry", () => {
    const dir = isolatedHome("nxc-ready-help-entry-");
    try {
      const result = runCli(["help", "ready"], { NEXCODE_HOME: dir });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("post-sync readiness");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
