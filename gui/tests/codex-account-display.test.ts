import { expect, test } from "bun:test";
import { codexAccountDisplayLabel, type CodexAccountDisplayIdentity } from "../src/codex-account-display";
import type { TFn } from "../src/i18n/shared";

const t = ((key, vars) => {
  if (key === "codexAuth.mainAccount") return "主账号";
  if (key === "pws.accountOrdinal") return `账号 ${vars?.count ?? "1"}`;
  return key;
}) as TFn;

test("empty aliases never hide a valid account email", () => {
  const account = { id: "pool-a", alias: "   ", email: "a***e@example.test" };
  expect(codexAccountDisplayLabel([account], account, t)).toBe("a***e@example.test");
});

test("switch labels prefer the configured account name", () => {
  const account = { id: "pool-a", alias: "工作账号", email: "a***e@example.test" };
  expect(codexAccountDisplayLabel([account], account, t)).toBe("工作账号");
});

test("missing identities use human labels instead of opaque ids", () => {
  const accounts: CodexAccountDisplayIdentity[] = [
    { id: "__main__", isMain: true },
    { id: "opaque-storage-id" },
  ];
  expect(codexAccountDisplayLabel(accounts, accounts[0]!, t)).toBe("主账号");
  expect(codexAccountDisplayLabel(accounts, accounts[1]!, t)).toBe("账号 2");
});
