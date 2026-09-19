param(
  [Parameter(Mandatory = $true)][string]$PrivateKeyPath,
  [string]$OutputDirectory,
  [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [IO.Path]::GetFullPath((Join-Path $scriptDirectory "..\.."))
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $root "dist"
}
if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = [string]((Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version)
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
$privateKey = [IO.Path]::GetFullPath($PrivateKeyPath)
$publicKey = Join-Path $root "desktop\windows\NexCode\UpdateSigningPublicKey.xml"
$installer = Join-Path $output "Windows-Ota-Updata.exe"
$checksum = Join-Path $output "Windows-Ota-Updata.exe.sha256"
$manifest = Join-Path $output "Windows-Ota-Updata.json"
$signature = Join-Path $output "Windows-Ota-Updata.sig"

foreach ($path in @($privateKey, $publicKey, $installer)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "A required OTA signing input is missing."
  }
}

function Assert-OutputPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $outputPrefix = $output.TrimEnd('\') + '\'
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "An OTA signing output escaped the output directory."
  }
}

function Write-AtomicBytes {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][byte[]]$Bytes
  )
  Assert-OutputPath -Path $Path
  $temporary = "$Path.tmp-$([Guid]::NewGuid().ToString('N'))"
  Assert-OutputPath -Path $temporary
  try {
    [IO.File]::WriteAllBytes($temporary, $Bytes)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$installerSize = (Get-Item -LiteralPath $installer).Length
$utf8NoBom = [Text.UTF8Encoding]::new($false)
$checksumBytes = $utf8NoBom.GetBytes("$installerHash  Windows-Ota-Updata.exe`n")
$manifestObject = [ordered]@{
  version = $ExpectedVersion
  file = "Windows-Ota-Updata.exe"
  size = $installerSize
  sha256 = $installerHash
}
$manifestBytes = $utf8NoBom.GetBytes((($manifestObject | ConvertTo-Json -Compress) + "`n"))

$csp = New-Object System.Security.Cryptography.CspParameters
$csp.ProviderType = 24
$signer = New-Object System.Security.Cryptography.RSACryptoServiceProvider($csp)
try {
  $signer.PersistKeyInCsp = $false
  $signer.FromXmlString([IO.File]::ReadAllText($privateKey))
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $signatureBytes = $signer.SignData($manifestBytes, $sha256)
  } finally {
    $sha256.Dispose()
  }
} finally {
  $signer.Dispose()
}

$verifier = New-Object System.Security.Cryptography.RSACryptoServiceProvider($csp)
try {
  $verifier.PersistKeyInCsp = $false
  $verifier.FromXmlString([IO.File]::ReadAllText($publicKey))
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    if (-not $verifier.VerifyData($manifestBytes, $sha256, $signatureBytes)) {
      throw "The private OTA signing key does not match the embedded public key."
    }
  } finally {
    $sha256.Dispose()
  }
} finally {
  $verifier.Dispose()
}

$encodedSignature = $utf8NoBom.GetBytes(([Convert]::ToBase64String($signatureBytes) + "`n"))
Write-AtomicBytes -Path $checksum -Bytes $checksumBytes
Write-AtomicBytes -Path $manifest -Bytes $manifestBytes
Write-AtomicBytes -Path $signature -Bytes $encodedSignature
Write-Host "Signed Windows OTA release assets for version $ExpectedVersion."
