import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];
const script = join(import.meta.dir, "..", "desktop", "scripts", "assert-no-packaged-google-oauth.sh");
const dmgScript = join(import.meta.dir, "..", "desktop", "scripts", "build-dmg.sh");
const portableScript = join(import.meta.dir, "..", "desktop", "scripts", "build-portable.sh");
const appScript = join(import.meta.dir, "..", "desktop", "scripts", "build-app.sh");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stagedApp(): string {
  const root = mkdtempSync(join(tmpdir(), "nexcode-desktop-package-"));
  roots.push(root);
  const app = join(root, "NexCode.app");
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  return app;
}

test("desktop packaging accepts configured Google OAuth values when the app does not contain them", () => {
  const app = stagedApp();
  writeFileSync(join(app, "Contents", "Resources", "runtime.txt"), "safe runtime");
  const result = Bun.spawnSync({
    cmd: ["bash", script, app],
    env: {
      ...process.env,
      GOOGLE_ANTIGRAVITY_CLIENT_ID: "private-client-id-123456789",
      GOOGLE_ANTIGRAVITY_CLIENT_SECRET: "private-client-secret-123456789",
    },
  });
  expect(result.exitCode).toBe(0);
});

test("desktop packaging blocks captured Google OAuth values without logging the credential", () => {
  const app = stagedApp();
  const secret = "private-client-secret-987654321";
  writeFileSync(join(app, "Contents", "Resources", "captured.txt"), `generated=${secret}`);
  const result = Bun.spawnSync({
    cmd: ["bash", script, app],
    env: { ...process.env, GOOGLE_ANTIGRAVITY_CLIENT_SECRET: secret },
  });
  const stderr = result.stderr.toString();
  expect(result.exitCode).toBe(1);
  expect(stderr).toContain("GOOGLE_ANTIGRAVITY_CLIENT_SECRET");
  expect(stderr).not.toContain(secret);
});

test("desktop packaging rejects environment files in the staged app", () => {
  const app = stagedApp();
  writeFileSync(join(app, "Contents", "Resources", ".env"), "PRIVATE_BUILD_VALUE=redacted");
  const result = Bun.spawnSync({ cmd: ["bash", script, app], env: { ...process.env } });
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("environment file");
});

test("DMG packaging revalidates an existing app even when the app build is skipped", async () => {
  const source = await Bun.file(dmgScript).text();
  expect(source).toContain('bash "$SCRIPT_DIR/assert-no-packaged-google-oauth.sh" "$APP_PATH"');
  expect(source.indexOf("assert-no-packaged-google-oauth.sh")).toBeLessThan(source.indexOf("hdiutil create"));
});

test("portable packaging revalidates both source and extracted apps", async () => {
  const source = await Bun.file(portableScript).text();
  expect(source.match(/assert-no-packaged-google-oauth\.sh/g)).toHaveLength(2);
  expect(source.match(/codesign --verify --deep --strict/g)).toHaveLength(2);
  expect(source).toContain("ditto -x -k");
});

test("macOS app packaging accepts the npm Bun executable name", async () => {
  const source = await Bun.file(appScript).text();
  expect(source).toContain('node_modules/bun/bin/bun.exe');
});
