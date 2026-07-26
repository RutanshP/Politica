# Daily sync: federal bills+votes, federal politicians, federal vote-stat backfill, state
# legislator queue drain, state roll calls, news, legislation cleanup (purges bills stuck Failed
# for 30+ days), then rebuild derived data (analytics/search/issues/entities) last so it reflects
# everything synced above.
#
# Registered as a Scheduled Task -- see scripts/windows/README.md for setup.

. "$PSScriptRoot\common.ps1"
Start-PoliticaLog -Name "sync-daily" | Out-Null

try {
  if (-not (Wait-ForPoliticaServer -TimeoutSeconds 60)) {
    Write-Host "FATAL: Politica dev server is not responding on $Global:PoliticaBaseUrl" -ForegroundColor Red
    Write-Host "Is the 'Politica Dev Server' scheduled task / run-dev-server.ps1 running?" -ForegroundColor Red
    exit 1
  }

  Write-Host "=== Federal bills + votes ===" -ForegroundColor Magenta
  & "$Global:PoliticaRepoRoot\sync-politica.ps1" -FederalBillsIncremental -SyncVotes

  Write-Host "=== Federal politicians ===" -ForegroundColor Magenta
  & "$Global:PoliticaRepoRoot\sync-politica.ps1" -FederalPoliticiansIncremental

  Write-Host "=== Federal politician vote-stat backfill ===" -ForegroundColor Magenta
  & "$Global:PoliticaRepoRoot\sync-politica.ps1" -BackfillPoliticianVoteStats

  Write-Host "=== State legislators (queue drain) ===" -ForegroundColor Magenta
  Invoke-StatePeopleQueueDrain -StatesPerRun 3

  Write-Host "=== State roll calls ===" -ForegroundColor Magenta
  $stateCodes = Get-PoliticaDefaultStateCodes
  Invoke-PoliticaSync -Path "/api/internal/sync/state-votes?states=$($stateCodes -join ',')" -TimeoutSec 3000 | Out-Null

  Write-Host "=== FEC funding graph (chunk of 60) ===" -ForegroundColor Magenta
  # ~5 FEC calls per member against a 1,000 req/hour key; 60/day covers every
  # current member in ~9 days, then keeps rotating by staleness.
  Invoke-PoliticaSync -Path "/api/internal/sync/fec-funding-graph?limit=60" -TimeoutSec 3600 | Out-Null

  Write-Host "=== News ===" -ForegroundColor Magenta
  Invoke-PoliticaSync -Path "/api/internal/sync/news" | Out-Null

  Write-Host "=== Legislation cleanup (bills failed 30+ days with no new action) ===" -ForegroundColor Magenta
  Invoke-PoliticaSync -Path "/api/internal/sync/legislation-cleanup" | Out-Null

  Write-Host "=== Rebuild derived data ===" -ForegroundColor Magenta
  Invoke-PoliticaSync -Path "/api/internal/rebuild" | Out-Null

  Write-Host "Daily sync complete." -ForegroundColor Green
} finally {
  Stop-Transcript | Out-Null
}
