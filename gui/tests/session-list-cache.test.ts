import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  clearSessionListCache,
  readSessionListCache,
  writeSessionListCache,
} from "../src/session-list-cache";

const globals = ["document", "window", "navigator", "sessionStorage"] as const;
let previousGlobals: Record<(typeof globals)[number], unknown>;
let testWindow: Window;

function install() {
  previousGlobals = Object.fromEntries(globals.map(key => [key, Reflect.get(globalThis, key)])) as typeof previousGlobals;
  testWindow = new Window({ url: "http://localhost/" });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    sessionStorage: { configurable: true, value: testWindow.sessionStorage },
  });
  sessionStorage.clear();
}

function restore() {
  testWindow.close();
  for (const key of globals) {
    Object.defineProperty(globalThis, key, { configurable: true, value: previousGlobals[key] });
  }
}

afterEach(restore);

test("session list cache round-trips non-secret JSON shapes", () => {
  install();
  writeSessionListCache("nxc.test", { range: "30d", surface: "claude", n: 3 });
  expect(readSessionListCache<{ range: string; surface: string; n: number }>("nxc.test")).toEqual({
    range: "30d",
    surface: "claude",
    n: 3,
  });
  clearSessionListCache("nxc.test");
  expect(readSessionListCache("nxc.test")).toBeNull();
});

test("session list cache returns null for corrupt JSON", () => {
  install();
  sessionStorage.setItem("nxc.bad", "{not-json");
  expect(readSessionListCache("nxc.bad")).toBeNull();
});
