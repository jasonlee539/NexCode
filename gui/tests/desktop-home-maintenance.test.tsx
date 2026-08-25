import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { clearClientResourceStoresForTests } from "../src/client-resource";
import { LanguageProvider } from "../src/i18n/provider";
import DesktopUsage from "../src/pages/DesktopUsage";
import Maintenance from "../src/pages/Maintenance";
import DesktopDashboard from "../src/pages/desktop-dashboard";

const globalKeys = ["document", "window", "navigator", "localStorage", "sessionStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previous: Record<(typeof globalKeys)[number], unknown>;
let originalFetch: typeof fetch;
let win: Window;
let host: HTMLElement;
let root: Root | null = null;

async function settleUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("desktop surface did not settle");
    await act(async () => { await new Promise<void>(resolve => win.setTimeout(resolve, 10)); });
  }
}

beforeEach(() => {
  previous = Object.fromEntries(globalKeys.map(key => [key, Reflect.get(globalThis, key)])) as typeof previous;
  originalFetch = globalThis.fetch;
  win = new Window({ url: "http://localhost/" });
  Object.defineProperty(win.navigator, "language", { configurable: true, value: "zh-CN" });
  win.localStorage.setItem("nxc-lang", "zh");
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: win.document },
    window: { configurable: true, value: win },
    navigator: { configurable: true, value: win.navigator },
    localStorage: { configurable: true, value: win.localStorage },
    sessionStorage: { configurable: true, value: win.sessionStorage },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearClientResourceStoresForTests();
  host = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.appendChild(host as never);
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  globalThis.fetch = originalFetch;
  clearClientResourceStoresForTests();
  await win.happyDOM?.close?.();
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: previous[key] });
  }
});

test("home always renders a visible 12-month activity grid and non-zero levels", async () => {
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.endsWith("/api/desktop/overview")) {
      return Response.json({
        activityVersion: 2,
        activityScope: "all-local-threads",
        counts: { threads: 1, activeThreads: 1, archivedThreads: 0, skills: 0 },
        localTokenUsage30d: {
          totalTokens: 1_200,
          inputTokens: 1_000,
          cachedInputTokens: 0,
          outputTokens: 200,
          reasoningOutputTokens: 0,
          turns: 1,
          threadCount: 1,
          since: Date.now() - 30 * 86_400_000,
        },
        activity365d: [
          { date: "2026-08-24", threadCount: 1, totalTokens: 200 },
          { date: "2026-08-25", threadCount: 3, totalTokens: 1_000 },
        ],
        recentThreads: [],
        recentSkills: [],
      });
    }
    if (url.includes("/api/codex-auth/accounts")) return Response.json({ accounts: [] });
    if (url.endsWith("/api/codex-auth/active")) return Response.json({ activeCodexAccountId: null });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<LanguageProvider><DesktopDashboard apiBase="http://desktop-activity-test" /></LanguageProvider>);
  });
  await settleUntil(() => host.querySelector(".desktop-home-activity__months-grid")?.getAttribute("data-months") === "12");

  const cells = host.querySelectorAll<HTMLButtonElement>(".desktop-home-activity__cell:not(.is-placeholder)");
  expect(cells).toHaveLength(365);
  expect([...cells].some(cell => Number(cell.dataset.activityLevel) > 0)).toBe(true);
  expect(host.querySelector(".desktop-home-activity .is-level-4")).not.toBeNull();
  expect([...cells].some(cell => cell.style.backgroundColor === "#216e39")).toBe(true);
  expect(host.querySelectorAll(".desktop-home-activity__month")).toHaveLength(12);
  const latest = host.querySelector<HTMLElement>('[data-activity-date="2026-08-25"]');
  expect(latest?.dataset.threadCount).toBe("3");
  expect(latest?.dataset.totalTokens).toBe("1000");
  expect(host.querySelector(".desktop-home-activity__day-detail")?.textContent).toContain("3 个线程");
  expect(host.querySelector(".desktop-home-activity__day-detail")?.textContent).toContain("Token");
  const css = await Bun.file(new URL("../src/styles-desktop-app.css", import.meta.url)).text();
  expect(host.querySelector(".desktop-home-activity__months-grid")?.getAttribute("data-days")).toBe("365");
  expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  expect(css).toContain("grid-template-columns: repeat(7, 7px)");
  expect(css).toContain("width: 7px");
  expect(css).toContain("height: 7px");
});

test("home never fabricates all-thread activity from recent or active-account data", async () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.endsWith("/api/desktop/overview")) {
      return Response.json({
        counts: { threads: 2, activeThreads: 2, archivedThreads: 0, skills: 0 },
        localTokenUsage30d: { totalTokens: 4_200, threadCount: 2, since: Date.now() - 30 * 86_400_000 },
        recentThreads: [
          { id: "one", updatedAt: today.getTime(), createdAt: today.getTime(), tokensUsed: 3_000 },
          { id: "two", updatedAt: yesterday.getTime(), createdAt: yesterday.getTime(), tokensUsed: 1_200 },
        ],
        recentSkills: [],
      });
    }
    if (url.includes("/api/codex-auth/accounts")) return Response.json({ accounts: [] });
    if (url.endsWith("/api/codex-auth/active")) return Response.json({ activeCodexAccountId: null });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<LanguageProvider><DesktopDashboard apiBase="http://desktop-activity-fallback-test" /></LanguageProvider>);
  });
  await settleUntil(() => host.querySelector(".desktop-home-activity__months-grid")?.getAttribute("data-months") === "12");

  const colored = host.querySelectorAll<HTMLElement>(".desktop-home-activity__cell:not(.is-level-0):not(.is-placeholder)");
  expect(colored).toHaveLength(0);
  expect(host.querySelector(".desktop-home-activity__day-detail")?.textContent).toContain("0 个线程");
});

test("daily Token bars use the full trend grid width", async () => {
  const days = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    totalTokens: index + 1,
    inputTokens: index + 1,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    turns: 1,
    threadCount: 1,
  }));
  globalThis.fetch = (async () => Response.json({
    ranges: Object.fromEntries(["1d", "3d", "7d", "30d"].map(range => [range, {
      totalTokens: 30,
      inputTokens: 30,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      turns: 30,
      threadCount: 1,
    }])),
    days,
    topThreads: { "1d": [], "3d": [], "7d": [], "30d": [] },
    coverage: { threadRecords: 1, scannedThreads: 1, fallbackThreads: 0, skippedThreads: 0 },
  })) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<LanguageProvider><DesktopUsage apiBase="http://desktop-usage-test" /></LanguageProvider>);
  });
  await settleUntil(() => host.querySelector(".desktop-usage-chart") !== null);
  const chart = host.querySelector<HTMLElement>(".desktop-usage-chart")!;
  expect(chart.dataset.days).toBe("7");
  expect(chart.style.gridTemplateColumns).toContain("repeat(7, minmax(0, 1fr))");
  const css = await Bun.file(new URL("../src/styles-desktop-app.css", import.meta.url)).text();
  expect(css).toContain("grid-template-columns: minmax(0, 1fr) 238px");
  expect(host.querySelector(".desktop-usage-trend-panel")).not.toBeNull();
  expect(host.querySelector(".desktop-usage-panel.desktop-usage-trend")).toBeNull();
  expect(css).toContain("width: clamp(10px, 58%, 52px)");
  expect(css).toContain("width: 100%");
});

test("one-click maintenance reports each completed repair step", async () => {
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.endsWith("/api/desktop/maintenance/repair")) {
      return Response.json({
        ok: true,
        repaired: ["local-directories", "launcher", "catalog", "runtime-state"],
        warnings: [],
        diagnostics: {
          ok: true,
          generatedAt: Date.now(),
          checks: {
            runtime: true,
            codexHome: true,
            configFile: true,
            authentication: true,
            stateDatabase: true,
            processEnumeration: true,
            skillsDirectory: true,
          },
          runtime: { platform: "darwin", bunVersion: "1.4.0", uptimeSeconds: 1 },
          counts: { threads: 1, activeThreads: 1, archivedThreads: 0, skills: 1, codexProcesses: 0, storageBytes: 0, storageFiles: 0 },
        },
      });
    }
    if (url.endsWith("/api/system/codex-restart")) {
      return Response.json({
        success: true,
        stateBefore: "not_running",
        synced: true,
        requested: [],
        stopped: [],
        surviving: [],
        failed: [],
        code: "nothing_running",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<LanguageProvider><Maintenance apiBase="http://desktop-maintenance-test" /></LanguageProvider>);
  });
  const repair = [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.includes("一键排查并修复"));
  expect(repair).toBeDefined();
  await act(async () => { repair!.click(); });
  await settleUntil(() => host.querySelectorAll(".desktop-repair-steps > div").length === 5);
  expect(host.textContent).toContain("Codex 启动器");
  expect(host.textContent).toContain("运行检查正常");
});
