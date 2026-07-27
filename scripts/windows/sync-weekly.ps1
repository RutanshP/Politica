# Weekly sync: state bills + committees (scope=detail), the federal sponsored-bill history
# backfill, and the federal election candidate roster. All slow-changing, not worth re-running
# daily:
#
#   - scope=detail hits OpenStates' 10 req/min limit hard (confirmed: one state's bill list alone
#     ran 20+ pages during testing) -- doing this for 10 states daily isn't realistic.
#   - The sponsored-bill history backfill walks every federal member's full career, which barely
#     changes week to week.
#   - FEC candidate filings move at filing-deadline pace (weeks), not daily.
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

  Write-Host "=== Election candidates (House, Senate, President) ===" -ForegroundColor Magenta
  Invoke-PoliticaSync -Path "/api/internal/sync/election-candidates" -TimeoutSec 3600 | Out-Null

  Write-Host "Weekly sync complete." -ForegroundColor Green
} finally {
  Stop-Transcript | Out-Null
}
