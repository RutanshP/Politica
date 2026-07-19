# Keeps `next dev` running on :3000, restarting automatically if it exits.
#
# `next build` currently OOMs on this machine generating static pages, so the sync jobs rely on a
# persistently-running dev server rather than a self-contained build+start+stop cycle. Registered
# as a Scheduled Task trigger "At log on" -- see scripts/windows/README.md for setup.

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $repo

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "dev-server.log"

while ($true) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $logFile -Value "[$timestamp] Starting next dev on :3000..."
  Write-Host "[$timestamp] Starting next dev on :3000..."

  & npx next dev -p 3000 *>> $logFile

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $logFile -Value "[$timestamp] next dev exited (code $LASTEXITCODE); restarting in 5s..."
  Write-Host "[$timestamp] next dev exited (code $LASTEXITCODE); restarting in 5s..."
  Start-Sleep -Seconds 5
}
