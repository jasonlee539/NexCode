param(
  [string]$OutputDirectory,
  [switch]$SkipProductBuild,
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [IO.Path]::GetFullPath((Join-Path $scriptDirectory "..\.."))
$workspace = [IO.Path]::GetFullPath((Join-Path $root ".tmp\windows-desktop-build"))
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $output = [IO.Path]::GetFullPath((Join-Path $root "dist"))
} else {
  $output = [IO.Path]::GetFullPath($OutputDirectory)
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $childFull = [IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Build path escaped its owning directory."
  }
}

function Reset-OwnedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Path
  )
  Assert-ChildPath -Parent $Parent -Child $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Copy-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeDirectories = @()
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Required package directory is missing."
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $copyArguments = @($Source, $Destination, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($ExcludeDirectories.Count -gt 0) {
    $resolvedExclusions = foreach ($entry in $ExcludeDirectories) {
      if ([Management.Automation.WildcardPattern]::ContainsWildcardCharacters($entry)) {
        Get-ChildItem -LiteralPath $Source -Directory -Force |
          Where-Object { $_.Name -like $entry } |
          Select-Object -ExpandProperty FullName
      } else {
        Join-Path $Source $entry
      }
    }
    $copyArguments += "/XD"
    $copyArguments += @($resolvedExclusions)
  }
  & robocopy.exe @copyArguments | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "Failed to copy a package directory (robocopy exit $LASTEXITCODE)."
  }
}

function Copy-TrackedSourceTree {
  param([Parameter(Mandatory = $true)][string]$Destination)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $paths = & git.exe -C $root ls-files -- src
  if ($LASTEXITCODE -ne 0 -or $paths.Count -eq 0) {
    throw "Unable to enumerate tracked runtime source files."
  }
  foreach ($relative in $paths) {
    if (-not $relative.StartsWith("src/", [StringComparison]::Ordinal)) { continue }
    $source = Join-Path $root ($relative.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $runtimeRelative = $relative.Substring(4).Replace('/', '\')
    $target = Join-Path $Destination $runtimeRelative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

function Resolve-MSBuild {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $installation = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
    if (-not [string]::IsNullOrWhiteSpace($installation)) {
      $candidate = Join-Path $installation "MSBuild\Current\Bin\MSBuild.exe"
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  $framework = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
  if (Test-Path -LiteralPath $framework) { return $framework }
  throw "MSBuild was not found. Install Visual Studio 2019 or newer with .NET Framework 4.7.2 targeting tools."
}

function Resolve-Bun {
  $candidates = @(
    (Join-Path $root "node_modules\@oven\bun-windows-x64\bin\bun.exe"),
    (Join-Path $root "node_modules\bun\bin\bun.exe"),
    (Join-Path $root "node_modules\.bin\bun.exe"),
    (Join-Path $root "node_modules\.bin\bun.cmd")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw "Bundled Bun is missing. Run npm ci in the repository root first."
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Failure
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

if ($env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "ARM64")) {
  throw "The Windows desktop packager must run on 64-bit Windows."
}

$bun = Resolve-Bun
$msbuild = Resolve-MSBuild
Reset-OwnedDirectory -Parent (Join-Path $root ".tmp") -Path $workspace
$appBuild = Join-Path $workspace "app"
$installerBuild = Join-Path $workspace "installer"
$portableStage = Join-Path $workspace "NexCode-windows-x64"
$icon = Join-Path $workspace "NexCode.ico"
New-Item -ItemType Directory -Path $appBuild, $installerBuild, $portableStage, $output -Force | Out-Null

& (Join-Path $scriptDirectory "generate-windows-icon.ps1") `
  -Source (Join-Path $root "desktop\assets\NexCode-1024.png") `
  -Destination $icon

if (-not $SkipProductBuild) {
  Write-Host "Building NexCode dashboard..."
  Push-Location (Join-Path $root "gui")
  try {
    Invoke-Checked -FilePath $bun -Arguments @("install", "--frozen-lockfile") -Failure "GUI dependency installation failed."
    Invoke-Checked -FilePath $bun -Arguments @("run", "build") -Failure "GUI build failed."
  } finally {
    Pop-Location
  }

  Write-Host "Validating NexCode runtime..."
  Push-Location $root
  try {
    # npm is the bootstrap path on a clean Windows checkout. Invoke the pinned
    # TypeScript entry directly so Bun does not need to reinterpret npm's .bin
    # shims before it can validate the runtime.
    Invoke-Checked -FilePath $bun -Arguments @("node_modules\typescript\bin\tsc", "--noEmit") -Failure "Runtime typecheck failed."
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $root "gui\dist\index.html") -PathType Leaf)) {
  throw "The dashboard build is missing. Run a full Windows desktop build first."
}

Write-Host "Compiling native Windows shell..."
$appProject = Join-Path $root "desktop\windows\NexCode\NexCode.csproj"
Invoke-Checked -FilePath $msbuild -Arguments @(
  $appProject,
  "/restore",
  "/m",
  "/nologo",
  "/verbosity:minimal",
  "/p:Configuration=Release",
  "/p:Platform=x64",
  "/p:NexCodeIconPath=$icon",
  "/p:OutDir=$appBuild\"
) -Failure "The native Windows shell failed to compile."

$requiredShellFiles = @(
  "NexCode.exe",
  "NexCode.exe.config",
  "Microsoft.Web.WebView2.Core.dll",
  "Microsoft.Web.WebView2.WinForms.dll",
  "WebView2Loader.dll"
)
foreach ($name in $requiredShellFiles) {
  $source = Join-Path $appBuild $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "The native Windows shell output is incomplete: $name"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $portableStage $name) -Force
}

$assetsPath = Join-Path $root "desktop\windows\NexCode\obj\project.assets.json"
if (-not (Test-Path -LiteralPath $assetsPath -PathType Leaf)) {
  throw "The WebView2 restore manifest is missing."
}
$restoreAssets = Get-Content -LiteralPath $assetsPath -Raw | ConvertFrom-Json
$packageRoots = @($restoreAssets.packageFolders.PSObject.Properties.Name)
if ($packageRoots.Count -eq 0) { throw "The NuGet package root was not recorded." }
$webViewPackage = Join-Path $packageRoots[0] "microsoft.web.webview2\1.0.4129.50"
$thirdParty = Join-Path $portableStage "THIRD-PARTY"
New-Item -ItemType Directory -Path $thirdParty -Force | Out-Null
foreach ($entry in @(
  @{ Source = "LICENSE.txt"; Target = "Microsoft.Web.WebView2.LICENSE.txt" },
  @{ Source = "NOTICE.txt"; Target = "Microsoft.Web.WebView2.NOTICE.txt" }
)) {
  $source = Join-Path $webViewPackage $entry.Source
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "The restored WebView2 package is missing its license material."
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $thirdParty $entry.Target) -Force
}

Write-Host "Assembling bundled Windows runtime..."
$runtime = Join-Path $portableStage "runtime"
New-Item -ItemType Directory -Path (Join-Path $runtime "bin") -Force | Out-Null
Copy-Item -LiteralPath $bun -Destination (Join-Path $runtime "bin\bun.exe") -Force
Copy-TrackedSourceTree -Destination (Join-Path $runtime "src")
Copy-Directory -Source (Join-Path $root "gui\dist") -Destination (Join-Path $runtime "gui\dist")
# The executable is already copied to runtime/bin. npm/Bun caches, old install
# snapshots, bin shims, and typecheck-only packages are not runtime inputs and
# would otherwise duplicate the 85 MiB Bun binary several times in every build.
Copy-Directory `
  -Source (Join-Path $root "node_modules") `
  -Destination (Join-Path $runtime "node_modules") `
  -ExcludeDirectories @(".bin", ".cache", ".old-*", "@oven", "@types", "@typescript", "bun", "bun-types", "typescript")
Copy-Directory -Source (Join-Path $root "bin") -Destination (Join-Path $runtime "bin-launcher")
Copy-Directory -Source (Join-Path $root "assets") -Destination (Join-Path $runtime "assets")
foreach ($name in @("package.json", "LICENSE", "NOTICE", "AGENTS_INSTALL.md")) {
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $runtime $name) -Force
}

& (Join-Path $scriptDirectory "assert-no-packaged-google-oauth.ps1") -StagePath $portableStage

$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$portableDirectory = Join-Path $output "NexCode-windows-x64"
$portableZip = Join-Path $output "NexCode-windows-x64-portable.zip"
Assert-ChildPath -Parent $output -Child $portableDirectory
Assert-ChildPath -Parent $output -Child $portableZip
if (Test-Path -LiteralPath $portableDirectory) { Remove-Item -LiteralPath $portableDirectory -Recurse -Force }
if (Test-Path -LiteralPath $portableZip) { Remove-Item -LiteralPath $portableZip -Force }
Move-Item -LiteralPath $portableStage -Destination $portableDirectory

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
  $portableDirectory,
  $portableZip,
  [IO.Compression.CompressionLevel]::Optimal,
  $false
)

$installerPath = $null
if (-not $SkipInstaller) {
  Write-Host "Compiling single-file Windows installer..."
  $installerProject = Join-Path $root "desktop\windows\Installer\NexCodeInstaller.csproj"
  Invoke-Checked -FilePath $msbuild -Arguments @(
    $installerProject,
    "/m",
    "/nologo",
    "/verbosity:minimal",
    "/p:Configuration=Release",
    "/p:Platform=x64",
    "/p:NexCodeIconPath=$icon",
    "/p:NexCodePayloadPath=$portableZip",
    "/p:OutDir=$installerBuild\"
  ) -Failure "The NexCode Windows installer failed to compile."

  $builtInstaller = Join-Path $installerBuild "NexCodeInstaller.exe"
  if (-not (Test-Path -LiteralPath $builtInstaller -PathType Leaf)) {
    throw "The Windows installer output is missing."
  }
  $installerPath = Join-Path $output "NexCode-Setup-$version-x64.exe"
  Assert-ChildPath -Parent $output -Child $installerPath
  Copy-Item -LiteralPath $builtInstaller -Destination $installerPath -Force
}

Write-Host "Windows desktop artifacts are ready:"
Write-Host "  NexCode-windows-x64\NexCode.exe"
Write-Host "  NexCode-windows-x64-portable.zip"
if ($installerPath) { Write-Host "  NexCode-Setup-$version-x64.exe" }
Write-Host "SHA-256:"
Get-FileHash -Algorithm SHA256 -LiteralPath $portableZip | Select-Object Hash, @{ Name = "File"; Expression = { Split-Path -Leaf $_.Path } } | Format-Table -AutoSize
if ($installerPath) {
  Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath | Select-Object Hash, @{ Name = "File"; Expression = { Split-Path -Leaf $_.Path } } | Format-Table -AutoSize
}
