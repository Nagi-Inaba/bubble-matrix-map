param(
  [switch]$ProbeNativeFailure
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

if ($ProbeNativeFailure) {
  Invoke-Checked { & $env:ComSpec /d /c exit 7 } 'intentional failure probe'
  throw 'Failure probe unexpectedly succeeded'
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $temporaryBase ("bubble-matrix-map-clean-" + [guid]::NewGuid().ToString('N'))))
if (-not $temporaryRoot.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path -Leaf $temporaryRoot).StartsWith('bubble-matrix-map-clean-')) {
  throw "Unsafe clean-room path: $temporaryRoot"
}
$copy = Join-Path $temporaryRoot 'package'
try {
  New-Item -ItemType Directory -Path $copy -Force | Out-Null
  $files = & git -C $repo ls-files --cached --others --exclude-standard
  foreach ($relative in $files) {
    if ($relative -like 'node_modules/*' -or $relative -like 'dist-cli/*') { continue }
    $source = Join-Path $repo $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $sourceItem = Get-Item -LiteralPath $source -Force
    if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Candidate source is a reparse point: $relative"
    }
    $destination = Join-Path $copy $relative
    $resolvedDestination = [System.IO.Path]::GetFullPath($destination)
    if (-not $resolvedDestination.StartsWith(([System.IO.Path]::GetFullPath($copy) + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Candidate path escapes clean room: $relative"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
  Push-Location $copy
  try {
    Invoke-Checked { git init -q } 'git init'
    Invoke-Checked { npm ci } 'npm ci'
    Invoke-Checked { npm run verify } 'npm run verify'
    Invoke-Checked { npm run audit:public-tree } 'npm run audit:public-tree'
    Invoke-Checked { npm run audit:public-copy } 'npm run audit:public-copy'
  } finally { Pop-Location }
} finally {
  $verifiedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
  if (-not $verifiedTemporaryRoot.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not (Split-Path -Leaf $verifiedTemporaryRoot).StartsWith('bubble-matrix-map-clean-')) {
    throw "Refusing to remove unsafe clean-room path: $verifiedTemporaryRoot"
  }
  if (Test-Path -LiteralPath $verifiedTemporaryRoot) { Remove-Item -LiteralPath $verifiedTemporaryRoot -Recurse -Force }
}
