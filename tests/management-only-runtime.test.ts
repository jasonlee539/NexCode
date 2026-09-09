import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncModelsToCodex } from "../src/codex/sync";
import { injectCodexConfig } from "../src/codex/inject";
import { handleAccessCommand } from "../src/cli/access";
import type { NxcConfig } from "../src/types";

const config: NxcConfig = {
  port: 10100,
  hostname: "127.0.0.1",
  defaultProvider: "openai",
  providers: {
    openai: {
      adapter: "openai-responses",
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-only",
      defaultModel: "gpt-test",
    },
  },
};

describe("management-only product boundary", () => {
  const desktopBundleId = "a".repeat(64);

  test("sync never invokes the Codex config injector", async () => {
    let injected = 0;
    let refreshed = 0;
    const result = await syncModelsToCodex(10100, config, null, {
      injectCodexConfig: async () => {
        injected += 1;
        return { success: true, message: "unexpected" };
      },
      refreshCodexModelCatalog: async () => {
        refreshed += 1;
        throw new Error("unexpected catalog refresh");
      },
    }, { managementOnly: true });

    expect(result.status).toBe("skipped");
    expect(injected).toBe(0);
    expect(refreshed).toBe(0);
  });

  test("direct injection calls cannot write openai_base_url", async () => {
    const result = await injectCodexConfig(10100, config, { managementOnly: true });
    expect(result.status).toBe("skipped");
    expect(result.message).toContain("openai_base_url was not written");
  });

  test("the local listener rejects model requests before an adapter can run", async () => {
    const root = mkdtempSync(join(tmpdir(), "nxc-management-server-child-"));
    const nexcodeHome = join(root, "nexcode");
    const codexHome = join(root, "codex");
    mkdirSync(nexcodeHome, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "helpers", "management-only-server-child.ts")], {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          NEXCODE_HOME: nexcodeHome,
          CODEX_HOME: codexHome,
          NEXCODE_DESKTOP_BUNDLE_ID: desktopBundleId,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}")).toMatchObject({
        status: 404,
        message: expect.stringContaining("management-only"),
        desktopBundleId,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("legacy access commands cannot send a model request to the management port", async () => {
    let requested = 0;
    const previousError = console.error;
    console.error = () => {};
    try {
      const exitCode = await handleAccessCommand(
        ["test", "gpt-test"],
        {
          baseUrl: "http://127.0.0.1:10100",
          fetchImpl: async () => {
            requested += 1;
            return new Response("unexpected");
          },
        },
        { managementOnly: true },
      );
      expect(exitCode).toBe(2);
      expect(requested).toBe(0);
    } finally {
      console.error = previousError;
    }
  });
});
