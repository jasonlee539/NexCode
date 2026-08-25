import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { MarkdownDocument } from "../src/components/MarkdownDocument";

const globals = ["document", "window", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previous: Record<(typeof globals)[number], unknown>;
let testWindow: Window;
let host: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  previous = Object.fromEntries(globals.map(key => [key, Reflect.get(globalThis, key)])) as typeof previous;
  testWindow = new Window({ url: "http://localhost/" });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
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
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: previous[key] });
  await testWindow.happyDOM?.close?.();
});

test("renders local thread Markdown without injecting raw HTML", async () => {
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(host);
    root.render(<MarkdownDocument source={`# Thread title

- Project: NexCode
- Model: \`gpt-5\`

## Assistant

**Done.**

\`\`\`ts
const ready = true;
\`\`\`

<script>window.compromised = true</script>`} />);
  });

  expect(host.querySelector("h1")?.textContent).toBe("Thread title");
  expect(host.querySelectorAll("li").length).toBe(2);
  expect(host.querySelector("pre code")?.textContent).toBe("const ready = true;");
  expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).toContain("<script>window.compromised = true</script>");
});
