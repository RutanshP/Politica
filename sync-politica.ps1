param(
  [switch]$FederalBillsIncremental,
  [int]$BillChunkSize = 25,
  [switch]$SyncVotes,
  [switch]$SyncCommittees
)

$headers = @{
  Authorization = "Bearer abcbcdcde"
}

$base = "http://127.0.0.1:3000"

function Read-ErrorBody {
  param($ErrorRecord)

  try {
    $reader = New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream())
    return $reader.ReadToEnd()
  } catch {
    return $ErrorRecord.Exception.Message
  }
}

if ($FederalBillsIncremental) {
  $offset = 0
  $batch = if ($BillChunkSize -gt 0) { $BillChunkSize } else { 25 }
  $syncVotesParam = if ($SyncVotes) { "&syncVotes=true" } else { "" }
  $syncCommitteesParam = if ($SyncCommittees) { "&syncCommittees=true" } else { "" }

  while ($true) {
    $uri = "$base/api/internal/sync/legislation?offset=$offset&limit=$batch$syncVotesParam$syncCommitteesParam"
    Write-Host "Running federal legislation chunk offset=$offset limit=$batch..." -ForegroundColor Cyan

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -Headers $headers
      $payload = $response.Content | ConvertFrom-Json
      $payload | ConvertTo-Json -Depth 8

      if ($payload.status -ne "success") {
        Write-Host "Chunk failed at offset=$offset" -ForegroundColor Red
        break
      }

      $synced = [int]($payload.recordCount)
      if ($synced -le 0) {
        Write-Host "No more federal bill records returned. Stopping." -ForegroundColor Yellow
        break
      }

      if ($payload.metadata -and $payload.metadata.billsSynced -lt $batch) {
        Write-Host "Final federal bill chunk completed." -ForegroundColor Green
        break
      }

      $offset += $batch
    } catch {
      Write-Host "FAILED federal legislation chunk at offset=$offset" -ForegroundColor Red
      Read-ErrorBody $_
      break
    }

    Write-Host ""
  }

  return
}

$endpoints = @(
  "/api/internal/sync/politicians",
  "/api/internal/sync/legislation",
  "/api/internal/sync/state-legislation",
  "/api/internal/sync/finance",
  "/api/internal/sync/news",
  "/api/internal/rebuild"
)

foreach ($endpoint in $endpoints) {
  Write-Host "Running $endpoint..." -ForegroundColor Cyan
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri "$base$endpoint" -Headers $headers
    Write-Host "OK: $endpoint" -ForegroundColor Green
    $response.Content
  } catch {
    Write-Host "FAILED: $endpoint" -ForegroundColor Red
    Read-ErrorBody $_
  }
  Write-Host ""
}

Write-Host "Checking health..." -ForegroundColor Yellow
Invoke-WebRequest -UseBasicParsing -Uri "$base/api/health" | Select-Object -ExpandProperty Content

Write-Host ""
Write-Host "Checking sync status..." -ForegroundColor Yellow
Invoke-WebRequest -UseBasicParsing -Uri "$base/api/sync-status" | Select-Object -ExpandProperty Content
