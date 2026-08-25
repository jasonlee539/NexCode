import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "src", "styles-desktop-app.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(css);
  if (!match) throw new Error(`missing CSS rule: ${selector}`);
  return match[1];
}

test("desktop home account usage and local data cards use equal columns", () => {
  expect(rule(".desktop-home-main-grid")).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
});

test("daily Token trend and Token composition use equal columns", () => {
  expect(rule(".desktop-usage-insights")).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
});

test("desktop content clears the native macOS traffic-light controls", () => {
  expect(css).toContain("height: calc(100dvh - 44px);\n  margin: 36px 8px 8px 0;");
});
