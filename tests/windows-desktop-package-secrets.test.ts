import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const script = join(import.meta.dir, "..", "desktop", "scripts", "assert-no-packaged-google-oauth.ps1");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stagedApp(): string {
  const root = mkdtempSync(join(tmpdir(), "nexcode-windows-package-"));
  roots.push(root);
  const app = join(root, "NexCode-windows-x64");
  mkdirSync(join(app, "runtime"), { recursive: true });
  return app;
}

function runScanner(stage: string, env: Record<string, string | undefined>) {
  if (process.platform !== "win32") return null;
  return Bun.spawnSync({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-StagePath",
      stage,
    ],
    env: { ...process.env, ...env },
  });
}

test("Windows packaging accepts configured OAuth values when the payload does not contain them", () => {
  const app = stagedApp();
  writeFileSync(join(app, "runtime", "safe.txt"), "safe runtime");
  const result = runScanner(app, {
    GOOGLE_ANTIGRAVITY_CLIENT_ID: "private-client-id-123456789",
    GOOGLE_ANTIGRAVITY_CLIENT_SECRET: "private-client-secret-123456789",
  });
  if (!result) return;
  expect(result.exitCode).toBe(0);
});

test("Windows packaging blocks a captured OAuth value without logging it", () => {
  const app = stagedApp();
  const secret = "private-client-secret-987654321";
  writeFileSync(join(app, "runtime", "captured.txt"), `generated=${secret}`);
  const result = runScanner(app, { GOOGLE_ANTIGRAVITY_CLIENT_SECRET: secret });
  if (!result) return;
  const output = result.stderr.toString() + result.stdout.toString();
  expect(result.exitCode).toBe(1);
  expect(output).toContain("GOOGLE_ANTIGRAVITY_CLIENT_SECRET");
  expect(output).not.toContain(secret);
});

test("Windows packaging rejects environment files in the staged app", () => {
  const app = stagedApp();
  writeFileSync(join(app, "runtime", ".env"), "PRIVATE_BUILD_VALUE=redacted");
  const result = runScanner(app, {});
  if (!result) return;
  const output = result.stderr.toString() + result.stdout.toString();
  expect(result.exitCode).toBe(1);
  expect(output).toContain("environment file");
});
