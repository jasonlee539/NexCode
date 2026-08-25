import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { clearClientResourceStoresForTests } from "../src/client-resource";
import { LanguageProvider } from "../src/i18n/provider";
import Threads from "../src/pages/Threads";

const globals = ["document", "window", "navigator", "localStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previous: Record<(typeof globals)[number], unknown>;
let testWindow: Window;
let host: HTMLElement;
let root: Root | null = null;

const thread = {
  id: "thread-1",
  title: "Demo thread",
  preview: "Build the feature",
  projectName: "NexCode",
  cwd: "/work/nexcode",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  archivedAt: null,
  archived: false,
  pinned: false,
  tokensUsed: 1234,
  model: "gpt-5",
  reasoningEffort: "high",
  source: "cli",
  agentNickname: "",
  agentRole: "",
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>(resolve => testWindow.setTimeout(resolve, 0));
  await Promise.resolve();
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  if (!match) throw new Error(`missing button: ${label}`);
  return match as HTMLButtonElement;
}

beforeEach(() => {
  clearClientResourceStoresForTests();
  previous = Object.fromEntries(globals.map(key => [key, Reflect.get(globalThis, key)])) as typeof previous;
  testWindow = new Window({ url: "http://localhost/" });
  testWindow.localStorage.setItem("nxc-lang", "zh");
  Object.defineProperty(testWindow.navigator, "language", { configurable: true, value: "zh-CN" });
  const mockFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/desktop/threads?")) {
      return new Response(JSON.stringify({
        total: 1,
        counts: { all: 1, active: 1, archived: 0 },
        threads: [thread],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      fileName: "Demo-thread.md",
      markdown: "# Demo thread\n\n## User\n\nBuild the feature\n\n## Assistant\n\nDone.\n",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    localStorage: { configurable: true, value: testWindow.localStorage },
    fetch: { configurable: true, value: mockFetch },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = testWindow.document.createElement("div") as unknown as HTMLElement;
  testWindow.document.body.appendChild(host as never);
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  clearClientResourceStoresForTests();
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: previous[key] });
  await testWindow.happyDOM?.close?.();
});

test("views a thread as rendered Markdown, returns to the list, and starts a native Markdown download", async () => {
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<LanguageProvider><Threads apiBase="" /></LanguageProvider>);
    await flush();
  });

  await act(async () => {
    button("查看").click();
    await flush();
  });
  expect(host.querySelector(".desktop-markdown h1")?.textContent).toBe("Demo thread");
  expect(host.querySelectorAll(".desktop-markdown h2").length).toBe(2);
  expect(button("返回线程列表")).toBeTruthy();

  await act(async () => button("返回线程列表").click());
  expect(button("查看")).toBeTruthy();

  await act(async () => {
    button("导出").click();
    await flush();
  });
  const download = testWindow.document.body.querySelector("a[download]") as HTMLAnchorElement | null;
  expect(download).not.toBeNull();
  expect(download?.pathname).toBe("/api/desktop/threads/thread-1/export");
  expect(download?.search).toBe("?download=1");
  expect(host.textContent).toContain("请在保存对话框中选择文件夹和 Markdown 文件名。");
});
