import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("Windows desktop package", () => {
  test("packages the canonical GUI and runtime without copying the repository", () => {
    const build = read("desktop", "scripts", "build-windows.ps1");
    expect(build).toContain('Copy-Directory -Source (Join-Path $root "gui\\dist")');
    expect(build).toContain('Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $runtime "gui\\dist\\index.html")');
    expect(build).toContain('(Join-Path $runtime "desktop-bundle-id.txt")');
    expect(build).toContain('Copy-TrackedSourceTree -Destination (Join-Path $runtime "src")');
    expect(build).toContain("ls-files --cached --others --exclude-standard -- src");
    expect(build).toContain('-Source (Join-Path $root "node_modules")');
    expect(build).toContain('".bin", ".cache", ".old-*"');
    expect(build).toContain('"bun", "bun-types", "typescript"');
    expect(build).toContain('"Microsoft.Web.WebView2.LICENSE.txt"');
    expect(build).toContain('"Microsoft.Web.WebView2.NOTICE.txt"');
    expect(build).toContain('"Windows-Ota-Updata.exe"');
    expect(build).toContain('"Windows-Ota-Updata.exe.sha256"');
    expect(build).toContain('"Windows-Ota-Updata.json"');
    expect(build).toContain('"Windows-Ota-Updata.sig"');
    expect(build).not.toContain("Copy-Directory -Source $root");
  });

  test("signs OTA metadata only after the product build has completed", () => {
    const signer = read("desktop", "scripts", "sign-windows-ota.ps1");
    expect(signer).toContain("[Parameter(Mandatory = $true)][string]$PrivateKeyPath");
    expect(signer).toContain("The private OTA signing key does not match the embedded public key.");
    expect(signer).toContain("Write-AtomicBytes -Path $signature");
    expect(signer).toContain("Windows-Ota-Updata.json");
    expect(signer).toContain("Windows-Ota-Updata.sig");
  });

  test("pins the official WebView2 SDK and validates every required runtime asset", () => {
    const project = read("desktop", "windows", "NexCode", "NexCode.csproj");
    const installer = read("desktop", "windows", "Installer", "InstallerProgram.cs");
    expect(project).toContain('PackageReference Include="Microsoft.Web.WebView2" Version="1.0.4129.50"');
    expect(project).toContain("<TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion>");
    expect(project).toContain('<Compile Include="UpdateService.cs" />');
    expect(project).toContain('<EmbeddedResource Include="UpdateSigningPublicKey.xml">');
    expect(installer).toContain('Path.Combine(stage, "Microsoft.Web.WebView2.Core.dll")');
    expect(installer).toContain('Path.Combine(stage, "runtime", "bin", "bun.exe")');
    expect(installer).toContain('Path.Combine(stage, "runtime", "gui", "dist", "index.html")');
    expect(installer).toContain('Path.Combine(stage, "runtime", "desktop-bundle-id.txt")');
  });

  test("keeps OAuth, external navigation, tray exit, and runtime shutdown parity", () => {
    const form = read("desktop", "windows", "NexCode", "MainForm.cs");
    const runtime = read("desktop", "windows", "NexCode", "RuntimeController.cs");
    expect(form).toContain("nexcode:oauth-complete");
    expect(form).toContain("ShouldOpenExternally");
    expect(form).toContain("完全退出 NexCode");
    expect(form).toContain("CoreWebView2.DownloadStarting");
    expect(form).toContain("CoreWebView2.WebMessageReceived");
    expect(form).toContain('"nexcode:save-markdown"');
    expect(form).toContain("new FileStream(dialog.FileName, FileMode.Create, FileAccess.Write, FileShare.None)");
    expect(form).toContain("settings.IsZoomControlEnabled = false");
    expect(form).toContain("webView.ZoomFactor = 1.0");
    expect(form).toContain("PreferredClientWidth * scale");
    expect(form).toContain("PreferredClientHeight * scale");
    expect(form).toContain("Screen.FromControl(this).WorkingArea");
    expect(form).toContain("MaximizeBox = true");
    expect(form).toContain("MaximumSize = Size.Empty");
    expect(form).not.toContain("MaximumSize = MinimumSize");
    expect(form).not.toContain("new Size(1215, 735)");
    expect(form).toContain("trayIcon.Visible = true");
    expect(form).toContain("await runtime.StopAsync()");
    expect(form).toContain('menu.Items.Add("重启管理服务"');
    expect(form).not.toContain("重启本地代理");
    expect(form).not.toContain("关闭本地代理");
    expect(runtime).toContain('CreateRuntimeStartInfo(runtimeRoot, bunPath, cliPath, "stop")');
    expect(runtime).toContain('startInfo.EnvironmentVariables["NEXCODE_DESKTOP_APP"] = "1"');
    expect(runtime).toContain('startInfo.EnvironmentVariables["NEXCODE_MANAGEMENT_ONLY"] = "1"');
    expect(runtime).toContain('startInfo.EnvironmentVariables["NEXCODE_DESKTOP_BUNDLE_ID"] = ReadDesktopBundleId(runtimeRoot)');
    expect(runtime).toContain('startInfo.EnvironmentVariables["NXC_BUN_RUNTIME_SOURCE"] = "bundled"');
    expect(runtime).toContain('string.Equals(JsonString(body, "service"), "nexcode"');
    expect(runtime).toContain('string.Equals(JsonString(body, "mode"), "management"');
    expect(runtime).toContain('string.Equals(JsonString(body, "desktopBundleId"), expectedBundleId');
    expect(runtime).toContain("NexCode 管理服务未能在 30 秒内就绪");
    expect(runtime).not.toContain("本地代理未能在 30 秒内就绪");
  });

  test("adopts only the management service serving this desktop bundle", () => {
    const cli = read("src", "cli", "index.ts");
    const server = read("src", "server", "index.ts");
    expect(cli).toContain("body.desktopBundleId === expectedBundleId");
    expect(server).toContain("desktopBundleId,");
    expect(server).toContain("NEXCODE_DESKTOP_BUNDLE_ID");
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
    expect(installer).toContain('string.Equals(value, "/ota"');
    expect(installer).toContain('uninstall.SetValue("DisplayVersion", InstalledProductVersion(target))');
  });

  test("OTA checks fixed GitHub Release assets and verifies the signed manifest before install", () => {
    const updater = read("desktop", "windows", "NexCode", "UpdateService.cs");
    const form = read("desktop", "windows", "NexCode", "MainForm.cs");
    const publicKey = read("desktop", "windows", "NexCode", "UpdateSigningPublicKey.xml");
    expect(updater).toContain("https://api.github.com/repos/jasonlee539/NexCode/releases/latest");
    expect(updater).toContain('InstallerAssetName = "Windows-Ota-Updata.exe"');
    expect(updater).toContain('ChecksumAssetName = "Windows-Ota-Updata.exe.sha256"');
    expect(updater).toContain('ManifestAssetName = "Windows-Ota-Updata.json"');
    expect(updater).toContain('SignatureAssetName = "Windows-Ota-Updata.sig"');
    expect(updater).toContain("VerifyAndParseManifest");
    expect(updater).toContain("rsa.VerifyData(manifestBytes, sha, signature)");
    expect(updater).toContain("SHA256.Create()");
    expect(updater).toContain("CompareVersions(version, CurrentVersion) <= 0");
    expect(publicKey).toMatch(/^<RSAKeyValue><Modulus>[A-Za-z0-9+/=]+<\/Modulus><Exponent>AQAB<\/Exponent><\/RSAKeyValue>\s*$/);
    expect(form).toContain('new ProcessStartInfo(installer, "/silent /ota")');
    expect(form).toContain("BeginUpdateCheck(false)");
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
