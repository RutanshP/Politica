# Weekly sync: state bills + committees (scope=detail), and the federal sponsored-bill history
# backfill. Both are heavy, slow-changing, and not something worth re-running daily:
#
#   - scope=detail hits OpenStates' 10 req/min limit hard (confirmed: one state's bill list alone
#     ran 20+ pages during testing) -- doing this for 10 states daily isn't realistic.
#   - The sponsored-bill history backfill walks every federal member's full career, which barely
#     changes week to week.
#
# Registered as a Scheduled Task with a weekly recurrence -- see scripts/windows/README.md.
# Both calls are given generous timeouts since this is meant to run unattended overnight.

. "$PSScriptRoot\common.ps1"
Start-PoliticaLog -Name "sync-weekly" | Out-Null

try {
  if (-not (Wait-ForPoliticaServer -TimeoutSeconds 60)) {
    Write-Host "FATAL: Politica dev server is not responding on $Global:PoliticaBaseUrl" -ForegroundColor Red
    exit 1
  }

  Write-Host "=== State bills + committees (scope=detail) ===" -ForegroundColor Magenta
  $stateCodes = Get-PoliticaDefaultStateCodes
  Invoke-PoliticaSync -Path "/api/internal/sync/state-legislation?scope=detail&states=$($stateCodes -join ',')" -TimeoutSec 21600 | Out-Null

  Write-Host "=== Federal sponsored-bill history backfill ===" -ForegroundColor Magenta
  Invoke-PoliticaSync -Path "/api/internal/sync/politician-sponsored-bills" -TimeoutSec 14400 | Out-Null

  Write-Host "Weekly sync complete." -ForegroundColor Green
} finally {
  Stop-Transcript | Out-Null
}
