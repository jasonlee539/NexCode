import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFileAsync } from "../src/config";
import {
  switchNativeCodexAccount,
  type NativeAccountCredentialSnapshot,
} from "../src/codex/native-account-switch";
import { readNativeEnvelope, resolveNativeProfileContext } from "../src/codex/native-profile-store";
import { NativeProfileError } from "../src/codex/native-profile-types";

function jwt(accountId: string, email: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    chatgpt_account_id: accountId,
    email,
    chatgpt_plan_type: "plus",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
}

function authEnvelope(accountId: string, email: string): string {
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      id_token: jwt(accountId, email),
      access_token: jwt(accountId, email),
      refresh_token: `refresh-${accountId}`,
      account_id: accountId,
    },
  }, null, 2) + "\n";
}

let root = "";
let codexHome = "";
let configDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nxc-native-account-switch-"));
  codexHome = join(root, "codex");
  configDir = join(root, "nexcode");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(configDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("native Codex account switching", () => {
  test("captures the current login before atomically replacing auth.json", async () => {
    const sourceId = "account-source";
    const targetId = "account-target";
    const authPath = join(codexHome, "auth.json");
    writeFileSync(authPath, authEnvelope(sourceId, "source@example.test"), { mode: 0o600 });
    const context = resolveNativeProfileContext({ codexHome, configDir });
    const captured: NativeAccountCredentialSnapshot[] = [];
    const transitions: string[] = [];

    const result = await switchNativeCodexAccount({
      idToken: jwt(targetId, "target@example.test"),
      accessToken: jwt(targetId, "target@example.test"),
      refreshToken: `refresh-${targetId}`,
      expiresAt: Date.now() + 3600_000,
      chatgptAccountId: targetId,
    }, source => { captured.push(source); }, {
      resolveContext: () => context,
      processProbe: async () => ({ status: "clear", count: 0 }),
      readEnvelope: readNativeEnvelope,
      atomicWrite: atomicWriteFileAsync,
      applyTransition: (from, to) => { transitions.push(`${from}->${to}`); },
      now: Date.now,
    });

    expect(result).toEqual({ changed: true, accountId: targetId });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      accountId: sourceId,
      email: "source@example.test",
      credential: { chatgptAccountId: sourceId, refreshToken: `refresh-${sourceId}` },
    });
    const active = JSON.parse(readFileSync(authPath, "utf8")) as { tokens: { account_id: string } };
    expect(active.tokens.account_id).toBe(targetId);
    expect(transitions).toEqual([`${sourceId}->${targetId}`]);
  });

  test("refuses a switch while Codex is running and leaves auth.json unchanged", async () => {
    const source = authEnvelope("account-source", "source@example.test");
    const authPath = join(codexHome, "auth.json");
    writeFileSync(authPath, source, { mode: 0o600 });
    const context = resolveNativeProfileContext({ codexHome, configDir });
    let persisted = false;

    const operation = switchNativeCodexAccount({
      accessToken: jwt("account-target", "target@example.test"),
      refreshToken: "refresh-target",
      expiresAt: Date.now() + 3600_000,
      chatgptAccountId: "account-target",
    }, () => { persisted = true; }, {
      resolveContext: () => context,
      processProbe: async () => ({ status: "busy", count: 2 }),
      readEnvelope: readNativeEnvelope,
      atomicWrite: atomicWriteFileAsync,
      applyTransition: () => {},
      now: Date.now,
    });

    await expect(operation).rejects.toMatchObject({ code: "CODEX_BUSY" } satisfies Partial<NativeProfileError>);
    expect(persisted).toBe(false);
    expect(readFileSync(authPath, "utf8")).toBe(source);
  });
});
