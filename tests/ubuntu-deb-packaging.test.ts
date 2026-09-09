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
  expect(source).toContain("gir1.2-ayatanaappindicator3-0.1");
  expect(source).toContain("gnome-shell-extension-appindicator");
  expect(source).toContain("gir1.2-webkit2-4.0 | gir1.2-webkit2-4.1");
  expect(source).toContain('"$PACKAGE_ROOT/usr/share/pixmaps/nexcode-ubuntu.png"');
  expect(source).toContain('"$PACKAGE_ROOT/DEBIAN/postinst"');
  expect(source).toContain("gtk-update-icon-cache");
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
  expect(cli).toContain("export NEXCODE_MANAGEMENT_ONLY=1");

  const shell = await Bun.file(nativeShell).text();
  expect(shell).toContain('gi.require_version("Gtk", "3.0")');
  expect(shell).toContain('gi.require_version("WebKit2", "4.1")');
  expect(shell).toContain('env["NEXCODE_MANAGEMENT_ONLY"] = "1"');
  expect(shell).toContain('runtime[1] != "management"');
  expect(shell).toContain('observed[1] != "management"');
  expect(shell).toContain('[str(bun), "--no-env-file", str(launcher), "stop"]');
  expect(shell).toContain('Gtk.Label(label="Opening NexCode…")');
  expect(shell).not.toContain("Starting the local NexCode service");
  const compositorFallback = 'os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")';
  expect(shell).toContain(compositorFallback);
  expect(shell.indexOf(compositorFallback)).toBeLessThan(shell.indexOf("import gi"));
  expect(shell).toContain('self.webview.connect("web-process-terminated", self._web_process_terminated)');
  expect(shell).toContain('self.window.set_icon_from_file(str(icon_path))');
  expect(shell).toContain('AyatanaAppIndicator3.Indicator.new(');
  expect(shell).toContain('Gtk.MenuItem.new_with_label("Open NexCode")');
  expect(shell).toContain('Gtk.MenuItem.new_with_label("Quit NexCode")');
  expect(shell).toContain("self.window.hide()");
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
