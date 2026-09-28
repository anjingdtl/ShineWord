$ErrorActionPreference = 'Stop'

$releaseVariableNames = @(
  'SHINE_WRITER_RELEASE_STORE_FILE',
  'SHINE_WRITER_RELEASE_STORE_PASSWORD',
  'SHINE_WRITER_RELEASE_KEY_ALIAS',
  'SHINE_WRITER_RELEASE_KEY_PASSWORD'
)

foreach ($name in $releaseVariableNames) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
    $userValue = [Environment]::GetEnvironmentVariable($name, 'User')
    if (-not [string]::IsNullOrWhiteSpace($userValue)) {
      [Environment]::SetEnvironmentVariable($name, $userValue, 'Process')
    }
  }
}

$missing = @(
  $releaseVariableNames | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, 'Process'))
  }
)
if ($missing.Count -gt 0) {
  throw "Missing release signing variable(s): $($missing -join ', ')"
}

if (-not (Test-Path -LiteralPath $env:SHINE_WRITER_RELEASE_STORE_FILE)) {
  throw 'Release signing keystore does not exist at the configured path.'
}

$mobileRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Push-Location $mobileRoot
try {
  npm run apk:release
  if ($LASTEXITCODE -ne 0) {
    throw "Signed release APK build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
