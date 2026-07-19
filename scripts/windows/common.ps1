# Shared helpers for the Windows sync scripts. Dot-source this from each cadence script:
#   . "$PSScriptRoot\common.ps1"
#
# All sync scripts assume the app is already running at $Global:PoliticaBaseUrl -- see
# run-dev-server.ps1, which a Scheduled Task keeps alive at log on. Nothing here boots or stops
# a server itself.

$Global:PoliticaRepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$Global:PoliticaBaseUrl = "http://127.0.0.1:3000"

# Task Scheduler runs these hidden -- there's no console to see Write-Host output on. Call this
# right after dot-sourcing common.ps1, and Stop-Transcript (in a finally block) before exiting.
function Start-PoliticaLog {
  param([Parameter(Mandatory = $true)][string]$Name)

  $logDir = Join-Path $Global:PoliticaRepoRoot "logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $logFile = Join-Path $logDir "$Name.log"
  Start-Transcript -Path $logFile -Append | Out-Null
  return $logFile
}

function Get-PoliticaEnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $envFile = Join-Path $Global:PoliticaRepoRoot ".env.local"
  if (-not (Test-Path $envFile)) {
    throw "FATAL: .env.local not found at $envFile"
  }

  $line = Get-Content $envFile | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  return ($line -replace "^$Name=", '').Trim()
}

function Get-PoliticaSyncSecret {
  $secret = Get-PoliticaEnvValue -Name "POLITICA_SYNC_SECRET"
  if (-not $secret) {
    throw "FATAL: POLITICA_SYNC_SECRET not set in .env.local"
  }
  return $secret
}

# Mirrors OPENSTATES_DEFAULT_STATE_CODES in lib/server/state-sync.ts. Override via
# POLITICA_OPENSTATES_STATE_CODES in .env.local to keep both in sync if you change the list.
function Get-PoliticaDefaultStateCodes {
  $configured = Get-PoliticaEnvValue -Name "POLITICA_OPENSTATES_STATE_CODES"
  if ($configured) {
    return ($configured -split ',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }
  }
  return @("ca", "ny", "tx", "fl", "il", "pa", "oh", "ga", "mi", "nc")
}

function Wait-ForPoliticaServer {
  param([int]$TimeoutSeconds = 60)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$Global:PoliticaBaseUrl/api/health" -TimeoutSec 5 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  return $false
}

function Invoke-PoliticaSync {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$TimeoutSec = 3000
  )

  $secret = Get-PoliticaSyncSecret
  $headers = @{ Authorization = "Bearer $secret" }
  $uri = "$Global:PoliticaBaseUrl$Path"

  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] POST $uri" -ForegroundColor Cyan
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -Headers $headers -TimeoutSec $TimeoutSec
    Write-Host $response.Content
    return $response.Content | ConvertFrom-Json
  } catch {
    Write-Host "FAILED: $uri" -ForegroundColor Red
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      Write-Host ($reader.ReadToEnd()) -ForegroundColor Red
    } catch {
      Write-Host $_.Exception.Message -ForegroundColor Red
    }
    return $null
  }
}

# Ports scripts/state-sync-queue.txt draining (previously only in the bash sync-states.sh) to
# PowerShell, minus the self-contained server boot/shutdown -- the server is already running.
function Invoke-StatePeopleQueueDrain {
  param([int]$StatesPerRun = 3)

  $queueFile = Join-Path $Global:PoliticaRepoRoot "scripts\state-sync-queue.txt"
  if (-not (Test-Path $queueFile)) {
    Write-Host "No state-sync-queue.txt found; skipping state legislator queue drain." -ForegroundColor Yellow
    return
  }

  $pendingStates = Get-Content $queueFile | Where-Object { $_ -notmatch '^\s*(#|$)' } | ForEach-Object { $_.Trim() }
  if ($pendingStates.Count -eq 0) {
    Write-Host "State legislator queue is empty -- every default state has a full sync." -ForegroundColor Green
    return
  }

  $statesThisRun = $pendingStates | Select-Object -First $StatesPerRun
  Write-Host "State legislators this run: $($statesThisRun -join ', ')" -ForegroundColor Cyan

  foreach ($state in $statesThisRun) {
    $result = Invoke-PoliticaSync -Path "/api/internal/sync/state-legislation?states=$state&scope=people"
    if (-not $result) {
      Write-Host "[$state] request failed; leaving it in the queue." -ForegroundColor Yellow
      continue
    }

    $responseText = $result | ConvertTo-Json -Depth 10
    if ($responseText -match '(?i)daily quota') {
      Write-Host "OpenStates daily quota exhausted. Stopping; queue left intact for the next run." -ForegroundColor Yellow
      return
    }

    if ($result.status -eq 'failed') {
      Write-Host "[$state] sync failed; leaving it in the queue." -ForegroundColor Yellow
      continue
    }

    # Only drop the state from the queue once it actually completed.
    $allLines = Get-Content $queueFile
    $remaining = $allLines | Where-Object { $_.Trim().ToLower() -ne $state.ToLower() }
    Set-Content -Path $queueFile -Value $remaining
    Write-Host "[$state] done; removed from queue." -ForegroundColor Green
  }
}
