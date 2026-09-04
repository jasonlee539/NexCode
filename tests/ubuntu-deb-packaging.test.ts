import { expect, test } from "bun:test";

const root = new URL("..", import.meta.url);
const buildScript = new URL("../desktop/linux/build-deb.sh", import.meta.url);
const launcher = new URL("../desktop/linux/nxc", import.meta.url);
const desktopEntry = new URL("../desktop/linux/com.nexcode.Ubuntu.desktop", import.meta.url);
const nativeShell = new URL("../desktop/linux/nexcode-ubuntu.py", import.meta.url);

test("Ubuntu package stages a self-contained runtime and system desktop entry", async () => {
  const source = await Bun.file(buildScript).text();
  expect(source).toContain('rsync -a "$ROOT_DIR/src/" "$RUNTIME_DIR/src/"');
  expect(source).toContain('rsync -a "$ROOT_DIR/gui/dist/" "$RUNTIME_DIR/gui/dist/"');
  expect(source).toContain("rsync -aH");
  expect(source).toContain('"$ROOT_DIR/node_modules/" "$RUNTIME_DIR/node_modules/"');
  expect(source).toContain("gir1.2-gtk-3.0");
  expect(source).toContain("gir1.2-webkit2-4.0 | gir1.2-webkit2-4.1");
  expect(source).toContain('assert-no-packaged-google-oauth.sh" "$PACKAGE_ROOT"');
  expect(source.indexOf("assert-no-packaged-google-oauth.sh")).toBeLessThan(source.indexOf("dpkg-deb --build"));
  expect(source).toContain('generate-compatibility-manifest.ts" "$ROOT_DIR"');

  const entry = await Bun.file(desktopEntry).text();
  expect(entry).toContain("Exec=nexcode-ubuntu %u");
  expect(entry).toContain("MimeType=x-scheme-handler/nexcode;");
});

test("Ubuntu launchers use the packaged Bun and GTK system theme", async () => {
  const cli = await Bun.file(launcher).text();
  expect(cli).toContain('node_modules/bun/bin/bun.exe');
  expect(cli).toContain('--no-env-file "$RUNTIME_ROOT/bin/nxc.mjs"');

  const shell = await Bun.file(nativeShell).text();
  expect(shell).toContain('gi.require_version("Gtk", "3.0")');
  expect(shell).toContain('gi.require_version("WebKit2", "4.1")');
  expect(shell).not.toContain("Gtk.CssProvider");
  expect(shell).not.toContain("set_property(\"gtk-theme-name\"");

  const packageJson = await Bun.file(new URL("package.json", root)).json();
  expect(packageJson.scripts["ubuntu:deb"]).toBe("bash desktop/linux/build-deb.sh");
});

test("Ubuntu dashboard has one system-adaptive Yaru theme", async () => {
  const app = await Bun.file(new URL("../gui/src/App.tsx", import.meta.url)).text();
  const styles = await Bun.file(new URL("../gui/src/styles.css", import.meta.url)).text();
  expect(app).not.toContain("nxc-theme");
  expect(app).not.toContain("data-theme");
  expect(styles).toContain("--accent:       light-dark(#e95420, #e95420);");
  expect(styles).toContain('--font-ui: Ubuntu, Cantarell, "Noto Sans", system-ui, sans-serif;');
});
