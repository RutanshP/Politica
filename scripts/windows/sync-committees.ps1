# Federal committee roster resync -- every 3 days. Separate from the daily bill sync because it
# refetches all ~236 current committees + the unitedstates/congress-legislators membership
# dataset, which is unnecessary to redo every single day. `limit=1` keeps the bill side of this
# same call trivial; committees always refresh in full regardless of the bill limit.
#
# Registered as a Scheduled Task with a 3-day recurrence -- see scripts/windows/README.md.

. "$PSScriptRoot\common.ps1"
Start-PoliticaLog -Name "sync-committees" | Out-Null

try {
  if (-not (Wait-ForPoliticaServer -TimeoutSeconds 60)) {
    Write-Host "FATAL: Politica dev server is not responding on $Global:PoliticaBaseUrl" -ForegroundColor Red
    exit 1
  }

  Write-Host "=== Federal committees (full roster resync) ===" -ForegroundColor Magenta
  Invoke-PoliticaSync -Path "/api/internal/sync/legislation?syncCommittees=true&limit=1&mode=incremental" -TimeoutSec 3000 | Out-Null

  Write-Host "Committees sync complete." -ForegroundColor Green
} finally {
  Stop-Transcript | Out-Null
}
