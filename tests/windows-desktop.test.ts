import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("Windows desktop package", () => {
  test("packages the canonical GUI and runtime without copying the repository", () => {
    const build = read("desktop", "scripts", "build-windows.ps1");
    expect(build).toContain('Copy-Directory -Source (Join-Path $root "gui\\dist")');
    expect(build).toContain('Copy-TrackedSourceTree -Destination (Join-Path $runtime "src")');
    expect(build).toContain('-Source (Join-Path $root "node_modules")');
    expect(build).toContain('".bin", ".cache", ".old-*"');
    expect(build).toContain('"bun", "bun-types", "typescript"');
    expect(build).toContain('"Microsoft.Web.WebView2.LICENSE.txt"');
    expect(build).toContain('"Microsoft.Web.WebView2.NOTICE.txt"');
    expect(build).not.toContain("Copy-Directory -Source $root");
  });

  test("pins the official WebView2 SDK and validates every required runtime asset", () => {
    const project = read("desktop", "windows", "NexCode", "NexCode.csproj");
    const installer = read("desktop", "windows", "Installer", "InstallerProgram.cs");
    expect(project).toContain('PackageReference Include="Microsoft.Web.WebView2" Version="1.0.4129.50"');
    expect(project).toContain("<TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>");
    expect(installer).toContain('Path.Combine(stage, "Microsoft.Web.WebView2.Core.dll")');
    expect(installer).toContain('Path.Combine(stage, "runtime", "bin", "bun.exe")');
    expect(installer).toContain('Path.Combine(stage, "runtime", "gui", "dist", "index.html")');
  });

  test("keeps OAuth, external navigation, tray exit, and runtime shutdown parity", () => {
    const form = read("desktop", "windows", "NexCode", "MainForm.cs");
    const runtime = read("desktop", "windows", "NexCode", "RuntimeController.cs");
    expect(form).toContain("nexcode:oauth-complete");
    expect(form).toContain("ShouldOpenExternally");
    expect(form).toContain("完全退出 NexCode");
    expect(form).toContain("CoreWebView2.DownloadStarting");
    expect(form).toContain("ClientSize = new Size(1215, 735)");
    expect(form).toContain("MaximumSize = MinimumSize");
    expect(form).toContain("trayIcon.Visible = true");
    expect(form).toContain("await runtime.StopAsync()");
    expect(runtime).toContain('CreateRuntimeStartInfo(runtimeRoot, bunPath, cliPath, "stop")');
    expect(runtime).toContain('startInfo.EnvironmentVariables["NEXCODE_DESKTOP_APP"] = "1"');
    expect(runtime).toContain('startInfo.EnvironmentVariables["NXC_BUN_RUNTIME_SOURCE"] = "bundled"');
    expect(runtime).toContain('string.Equals(JsonString(body, "service"), "nexcode"');
  });

  test("installer is per-user, path-bounded, and owns its registered surfaces", () => {
    const installer = read("desktop", "windows", "Installer", "InstallerProgram.cs");
    expect(installer).toContain("Environment.SpecialFolder.LocalApplicationData");
    expect(installer).toContain('"Programs",\n                    "NexCode"');
    expect(installer).toContain('private const string ProtocolKey = @"Software\\Classes\\nexcode"');
    expect(installer).toContain("output.StartsWith(root, StringComparison.OrdinalIgnoreCase)");
    expect(installer).toContain("string.Equals(target, InstallDirectory, StringComparison.OrdinalIgnoreCase)");
    expect(installer).toContain("账户和路由配置将保留");
    expect(installer).not.toContain("Registry.LocalMachine");
  });

  test("scans the final Windows payload before producing either distribution", () => {
    const build = read("desktop", "scripts", "build-windows.ps1");
    const scanAt = build.indexOf("assert-no-packaged-google-oauth.ps1");
    const zipAt = build.indexOf("CreateFromDirectory");
    const installerAt = build.indexOf("Compiling single-file Windows installer");
    expect(scanAt).toBeGreaterThan(0);
    expect(zipAt).toBeGreaterThan(scanAt);
    expect(installerAt).toBeGreaterThan(zipAt);
  });
});
