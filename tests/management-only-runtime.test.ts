import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server";

let testHome = "";
let previousNexcodeHome: string | undefined;
let previousManagementOnly: string | undefined;

beforeEach(() => {
  previousNexcodeHome = process.env.NEXCODE_HOME;
  previousManagementOnly = process.env.NEXCODE_MANAGEMENT_ONLY;
  testHome = mkdtempSync(join(tmpdir(), "nxc-management-only-"));
  process.env.NEXCODE_HOME = testHome;
  process.env.NEXCODE_MANAGEMENT_ONLY = "1";
});

afterEach(() => {
  if (previousNexcodeHome === undefined) delete process.env.NEXCODE_HOME;
  else process.env.NEXCODE_HOME = previousNexcodeHome;
  if (previousManagementOnly === undefined) delete process.env.NEXCODE_MANAGEMENT_ONLY;
  else process.env.NEXCODE_MANAGEMENT_ONLY = previousManagementOnly;
  rmSync(testHome, { recursive: true, force: true });
});

test("management listener advertises its mode and rejects every model data-plane transport", async () => {
  const server = startServer(0);
  try {
    const health = await fetch(new URL("/healthz", server.url));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ service: "nexcode", runtimeMode: "management" });

    for (const [path, init] of [
      ["/v1/models", { method: "GET" }],
      ["/v1/responses", { method: "POST", body: "{}" }],
      ["/v1/chat/completions", { method: "OPTIONS" }],
    ] as const) {
      const response = await fetch(new URL(path, server.url), init);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    }
  } finally {
    await server.stop(true);
  }
});
