param(
  [string]$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $ChromePath)) { throw "Chrome executable not found: $ChromePath" }
Invoke-WebRequest 'http://127.0.0.1:4175/' -UseBasicParsing -TimeoutSec 5 | Out-Null
$screenshotRoot = Join-Path $projectRoot 'docs\screenshots'
$captureRoot = Join-Path $projectRoot ('.output\docs-captures-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force $screenshotRoot, $captureRoot | Out-Null
$views = @(
  @('panel', '01-chat.png', '520,940'),
  @('approval', '02-approval.png', '520,940'),
  @('options', '03-settings.png', '1120,1000'),
  @('memory', '04-memory.png', '1120,1000'),
  @('presets', '05-presets.png', '1120,1000')
)
foreach ($view in $views) {
  $target = Join-Path $screenshotRoot $view[1]
  $profile = Join-Path $captureRoot $view[0]
  $arguments = @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ('--user-data-dir="' + $profile + '"'), ('--window-size=' + $view[2]),
    '--hide-scrollbars', '--timeout=30000', '--virtual-time-budget=10000',
    ('--screenshot="' + $target + '"'), ('http://127.0.0.1:4175/?view=' + $view[0])
  )
  $started = Get-Date
  $captureProcess = Start-Process -FilePath $ChromePath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $captureRoot ($view[0] + '.txt')) `
    -RedirectStandardError (Join-Path $captureRoot ($view[0] + '.log'))
  if ($captureProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $target)) {
    throw "Capture failed: $($view[0]). Inspect $captureRoot"
  }
  if ((Get-Item -LiteralPath $target).LastWriteTime -lt $started) { throw "Capture not updated: $target" }
  Write-Output $target
}
Write-Output "Capture logs and isolated profiles: $captureRoot"
