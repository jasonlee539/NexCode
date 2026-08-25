import { describe, expect, test } from "bun:test";
import { isNexCodeDesktopApp } from "../src/desktop-app";

describe("desktop app detection", () => {
  test("recognizes the native WebView user agent", () => {
    expect(isNexCodeDesktopApp({
      search: "",
      userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 NexCode/1.0",
    })).toBe(true);
  });

  test("supports an explicit desktop query for embedded clients", () => {
    expect(isNexCodeDesktopApp({ search: "?desktop=1", userAgent: "browser" })).toBe(true);
  });

  test("keeps the regular browser dashboard in full mode", () => {
    expect(isNexCodeDesktopApp({ search: "", userAgent: "Mozilla/5.0" })).toBe(false);
  });
});
