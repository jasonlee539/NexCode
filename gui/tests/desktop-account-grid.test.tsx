import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import DesktopAccountGrid from "../src/components/DesktopAccountGrid";
import type { CodexAccountEntry } from "../src/hooks/useCodexAccountPool";
import { LanguageProvider } from "../src/i18n/provider";

const globals = ["document", "window", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previous: Record<(typeof globals)[number], unknown>;
let win: Window;
let host: HTMLElement;
let root: Root | null = null;

const accounts: CodexAccountEntry[] = [
  {
    id: "__main__",
    email: "m***n@example.test",
    isMain: true,
    paused: false,
    priority: 0,
    hasCredential: true,
    plan: "pro",
    quota: { weeklyPercent: 5, updatedAt: Date.now() },
  },
  {
    id: "pool-1",
    email: "p***l@example.test",
    isMain: false,
    paused: false,
    priority: 0,
    hasCredential: true,
    plan: "pro",
    quota: { weeklyPercent: 10, updatedAt: Date.now() },
  },
];

beforeEach(() => {
  previous = Object.fromEntries(globals.map(key => [key, Reflect.get(globalThis, key)])) as typeof previous;
  win = new Window({ url: "http://localhost/" });
  Object.defineProperty(win.navigator, "language", { configurable: true, value: "zh-CN" });
  win.localStorage.setItem("nxc-lang", "zh");
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: win.document },
    window: { configurable: true, value: win },
    navigator: { configurable: true, value: win.navigator },
    localStorage: { configurable: true, value: win.localStorage },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.appendChild(host as never);
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  for (const key of globals) {
    Object.defineProperty(globalThis, key, { configurable: true, value: previous[key] });
  }
  await win.happyDOM?.close?.();
});

test("all accounts keep independent quota cards while local 30-day Tokens render once", async () => {
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(
      <LanguageProvider>
        <DesktopAccountGrid
          accounts={accounts}
          activeId={null}
          switchingId={null}
          refreshing={false}
          localUsage30d={{
            totalTokens: 229_377_073,
            inputTokens: 228_062_070,
            cachedInputTokens: 217_564_800,
            outputTokens: 1_047_233,
            reasoningOutputTokens: 361_465,
            turns: 1_923,
            threadCount: 17,
          }}
          usageLoading={false}
          onRefresh={() => {}}
          onAdd={() => {}}
          onSwitch={() => {}}
          onReauth={() => {}}
          onRemove={() => {}}
        />
      </LanguageProvider>,
    );
  });

  expect(host.querySelectorAll(".desktop-account-card").length).toBe(2);
  expect(host.querySelectorAll(".desktop-account-card__usage").length).toBe(0);
  expect(host.querySelectorAll(".desktop-account-local-usage").length).toBe(1);
  expect(host.querySelector(".desktop-account-local-usage__value strong")?.textContent).toBe("229.4M");
  const text = host.textContent ?? "";
  expect(text).toContain("5%");
  expect(text).toContain("10%");
  expect(text).toContain("17 个线程 · 1923 轮");
});

test("a settled missing quota says unavailable instead of refreshing forever", async () => {
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(
      <LanguageProvider>
        <DesktopAccountGrid
          accounts={[{ ...accounts[0]!, quota: null }]}
          activeId={null}
          switchingId={null}
          refreshing={false}
          localUsage30d={null}
          usageLoading={false}
          onRefresh={() => {}}
          onAdd={() => {}}
          onSwitch={() => {}}
          onReauth={() => {}}
          onRemove={() => {}}
        />
      </LanguageProvider>,
    );
  });

  expect(host.textContent).toContain("额度暂不可用");
  expect(host.textContent).not.toContain("额度正在刷新");
});
