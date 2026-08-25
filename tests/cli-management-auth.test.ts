import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeRequest } from "../src/cli/runtime-api";
import { stopProxyGracefully } from "../src/lib/process-control";
import { fetchClaudeContextWindows } from "../src/cli/claude";
import type { NxcConfig } from "../src/types";

const previousHome = process.env.NEXCODE_HOME;
const previousDataToken = process.env.NEXCODE_API_AUTH_TOKEN;
const previousAdminToken = process.env.NEXCODE_ADMIN_AUTH_TOKEN;
const homes: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousHome === undefined) delete process.env.NEXCODE_HOME;
  else process.env.NEXCODE_HOME = previousHome;
  if (previousDataToken === undefined) delete process.env.NEXCODE_API_AUTH_TOKEN;
  else process.env.NEXCODE_API_AUTH_TOKEN = previousDataToken;
  if (previousAdminToken === undefined) delete process.env.NEXCODE_ADMIN_AUTH_TOKEN;
  else process.env.NEXCODE_ADMIN_AUTH_TOKEN = previousAdminToken;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function capturedManagementToken(): Promise<string | null> {
  let token: string | null = null;
  await runtimeRequest("/api/config", {}, {
    baseUrl: "http://127.0.0.1:10100",
    fetchImpl: async (_input, init) => {
      token = new Headers(init?.headers).get("x-nexcode-api-key");
      return Response.json({ ok: true });
    },
  });
  return token;
}

describe("CLI management authentication", () => {
  test("the management environment token replaces the data token", async () => {
    process.env.NEXCODE_API_AUTH_TOKEN = "data-secret";
    process.env.NEXCODE_ADMIN_AUTH_TOKEN = "admin-secret";
    expect(await capturedManagementToken()).toBe("admin-secret");
  });

  test("the protected management token file is used when the environment token is absent", async () => {
    const home = mkdtempSync(join(tmpdir(), "nxc-cli-admin-auth-"));
    homes.push(home);
    process.env.NEXCODE_HOME = home;
    process.env.NEXCODE_API_AUTH_TOKEN = "data-secret";
    delete process.env.NEXCODE_ADMIN_AUTH_TOKEN;
    writeFileSync(join(home, "admin-api-token"), `nxc_admin_${"a".repeat(43)}\n`, { mode: 0o600 });
    expect(await capturedManagementToken()).toBe(`nxc_admin_${"a".repeat(43)}`);
  });

  test("graceful stop sends the management token instead of the data token", async () => {
    let token: string | null = null;
    const result = await stopProxyGracefully(1234, {
      readRuntime: () => ({ port: 10100, hostname: "127.0.0.1" }),
      waitExit: () => true,
      env: {
        NEXCODE_API_AUTH_TOKEN: "data-secret",
        NEXCODE_ADMIN_AUTH_TOKEN: "admin-secret",
      },
      fetchFn: async (_input, init) => {
        token = new Headers(init?.headers).get("x-nexcode-api-key");
        return new Response(null, { status: 200 });
      },
    });
    expect(result).toBe(true);
    expect(token).toBe("admin-secret");
  });

  test("Claude context discovery sends the management token", async () => {
    process.env.NEXCODE_API_AUTH_TOKEN = "data-secret";
    process.env.NEXCODE_ADMIN_AUTH_TOKEN = "admin-secret";
    let token: string | null = null;
    globalThis.fetch = (async (_input, init) => {
      token = new Headers(init?.headers).get("x-nexcode-api-key");
      return Response.json({ contextWindows: { "gpt-test": 200_000 } });
    }) as typeof fetch;
    const config = {
      port: 10100,
      defaultProvider: "test",
      providers: {},
      apiKeys: [{
        id: "configured",
        name: "Configured data key",
        key: "nxc_data_configured-secret",
        createdAt: "2026-07-28T00:00:00.000Z",
      }],
    } as NxcConfig;

    expect(await fetchClaudeContextWindows(config, 10100)).toEqual({ "gpt-test": 200_000 });
    expect(token).toBe("admin-secret");
  });
});
