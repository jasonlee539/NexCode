param(
  [Parameter(Mandatory = $true)][string]$StagePath
)

$ErrorActionPreference = "Stop"
$stage = [IO.Path]::GetFullPath($StagePath)
if (-not [IO.Directory]::Exists($stage)) {
  throw "A staged NexCode Windows directory is required for credential validation."
}

$environmentNames = @(
  "GOOGLE_ANTIGRAVITY_CLIENT_ID",
  "GOOGLE_ANTIGRAVITY_CLIENT_SECRET",
  "GOOGLE_CLOUD_API_KEY"
)

function Test-ByteSequence {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][byte[]]$Needle
  )

  if ($Needle.Length -eq 0) { return $false }
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $buffer = New-Object byte[] (65536 + $Needle.Length - 1)
    $carry = 0
    while (($read = $stream.Read($buffer, $carry, 65536)) -gt 0) {
      $length = $carry + $read
      $lastStart = $length - $Needle.Length
      for ($start = 0; $start -le $lastStart; $start++) {
        $match = $true
        for ($index = 0; $index -lt $Needle.Length; $index++) {
          if ($buffer[$start + $index] -ne $Needle[$index]) {
            $match = $false
            break
          }
        }
        if ($match) { return $true }
      }

      $carry = [Math]::Min($Needle.Length - 1, $length)
      if ($carry -gt 0) {
        [Array]::Copy($buffer, $length - $carry, $buffer, 0, $carry)
      }
    }
    return $false
  } finally {
    $stream.Dispose()
  }
}

$files = Get-ChildItem -LiteralPath $stage -Recurse -File -Force
foreach ($file in $files) {
  if ($file.Name -in @(".env", ".env.local", ".env.production")) {
    throw "Desktop packaging blocked: an environment file was found in the staged app."
  }
}

foreach ($name in $environmentNames) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrEmpty($value)) { continue }
  $needle = [Text.Encoding]::UTF8.GetBytes($value)
  foreach ($file in $files) {
    if (Test-ByteSequence -Path $file.FullName -Needle $needle) {
      throw "Desktop packaging blocked: $name was found in the staged app."
    }
  }
}

Write-Host "Verified staged app contains no configured Google OAuth credentials."
