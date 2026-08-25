import { expect, test } from "bun:test";

test("macOS desktop content size is fixed at 1215 by 735", async () => {
  const source = await Bun.file(new URL("../desktop/macos/Sources/NexCodeApp.swift", import.meta.url)).text();
  expect(source).toContain("contentRect: NSRect(x: 0, y: 0, width: 1215, height: 735)");
  expect(source).toContain("let fixedContentSize = NSSize(width: 1215, height: 735)");
  expect(source).toContain("window.contentMinSize = fixedContentSize");
  expect(source).toContain("window.contentMaxSize = fixedContentSize");
  expect(source).not.toContain(".resizable");
  expect(source).not.toContain("setFrameAutosaveName");
  expect(source).not.toContain("window.zoom(nil)");
});

test("macOS desktop keeps a status item whose full quit stops the bundled runtime", async () => {
  const source = await Bun.file(new URL("../desktop/macos/Sources/NexCodeApp.swift", import.meta.url)).text();
  expect(source).toContain("NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)");
  expect(source).toContain('NSMenuItem(title: "完全退出 NexCode"');
  expect(source).toContain("func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }");
  expect(source).toContain('stopper.arguments = [bundled.cli.path, "stop"]');
  expect(source).toContain("runtime.stop { NSApp.reply(toApplicationShouldTerminate: true) }");
});
