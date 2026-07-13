param(
  [switch]$FederalBillsIncremental,
  [int]$BillChunkSize = 25,
  [string]$FederalBillId,
  [switch]$FederalVotesRepair,
  [int]$FederalVotesRepairChunkSize = 25,
  [switch]$FederalPoliticiansIncremental,
  [int]$PoliticianChunkSize = 50,
  [switch]$BackfillPoliticianVoteStats,
  [int]$BackfillPoliticianVoteStatsChunkSize = 25,
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

function Format-MemberLabel {
  param($Member)

  if (-not $Member) {
    return ""
  }

  $parts = @($Member.name)
  if ($Member.title) { $parts += "[$($Member.title)]" }
  if ($Member.state) { $parts += $Member.state }
  if ($Member.district) { $parts += $Member.district }
  return ($parts -join " | ")
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

if ($FederalBillId) {
  $syncVotesParam = if ($SyncVotes) { "&syncVotes=true" } else { "" }
  $syncCommitteesParam = if ($SyncCommittees) { "&syncCommittees=true" } else { "" }
  $encodedBillId = [System.Uri]::EscapeDataString($FederalBillId.ToLowerInvariant())
  $uri = "$base/api/internal/sync/legislation?billIds=$encodedBillId$syncVotesParam$syncCommitteesParam"
  Write-Host "Refreshing federal bill $FederalBillId..." -ForegroundColor Cyan

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -Headers $headers
    $payload = $response.Content | ConvertFrom-Json
    $payload | ConvertTo-Json -Depth 8
  } catch {
    Write-Host "FAILED targeted federal bill refresh for $FederalBillId" -ForegroundColor Red
    Read-ErrorBody $_
  }

  return
}

if ($FederalVotesRepair) {
  $offset = 0
  $batch = if ($FederalVotesRepairChunkSize -gt 0) { $FederalVotesRepairChunkSize } else { 25 }

  while ($true) {
    $uri = "$base/api/internal/sync/legislation?refreshStoredVotes=true&syncVotes=true&offset=$offset&limit=$batch"
    Write-Host "Repairing stored federal vote chunk offset=$offset limit=$batch..." -ForegroundColor Cyan

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -Headers $headers
      $payload = $response.Content | ConvertFrom-Json
      $payload | ConvertTo-Json -Depth 8

      if ($payload.status -ne "success") {
        Write-Host "Chunk failed at offset=$offset" -ForegroundColor Red
        break
      }

      if (-not $payload.metadata) {
        Write-Host "Missing vote repair metadata. Stopping." -ForegroundColor Yellow
        break
      }

      $synced = [int]($payload.metadata.votesSynced)
      $totalStoredVotes = [int]($payload.metadata.totalStoredVotes)
      $requestedOffset = [int]($payload.metadata.requestedOffset)
      $requestedLimit = [int]($payload.metadata.requestedLimit)

      if ($synced -le 0) {
        Write-Host "No more stored federal votes to repair. Stopping." -ForegroundColor Green
        break
      }

      if (($requestedOffset + $synced) -ge $totalStoredVotes) {
        Write-Host "Final stored federal vote repair chunk completed." -ForegroundColor Green
        break
      }

      $offset = $requestedOffset + $requestedLimit
    } catch {
      Write-Host "FAILED stored federal vote repair chunk at offset=$offset" -ForegroundColor Red
      Read-ErrorBody $_
      break
    }

    Write-Host ""
  }

  return
}

if ($FederalPoliticiansIncremental) {
  $offset = 0
  $batch = if ($PoliticianChunkSize -gt 0) { $PoliticianChunkSize } else { 50 }

  while ($true) {
    $uri = "$base/api/internal/sync/politicians?offset=$offset&limit=$batch"
    Write-Host "Running federal politician chunk offset=$offset limit=$batch..." -ForegroundColor Cyan

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -Headers $headers
      $payload = $response.Content | ConvertFrom-Json
      $payload | ConvertTo-Json -Depth 8

      if ($payload.status -ne "success") {
        Write-Host "Chunk failed at offset=$offset" -ForegroundColor Red
        break
      }

      if (-not $payload.metadata) {
        Write-Host "Missing sync metadata. Stopping." -ForegroundColor Yellow
        break
      }

      if ($payload.metadata.updatedMembers) {
        $newMembers = @($payload.metadata.updatedMembers | Where-Object { $_.changeType -eq "new" })
        $changedMembers = @($payload.metadata.updatedMembers | Where-Object { $_.changeType -eq "changed" })

        Write-Host "New politicians: $($newMembers.Count)" -ForegroundColor Green
        foreach ($member in $newMembers) {
          Write-Host ("  + " + (Format-MemberLabel $member))
        }

        Write-Host "Changed politicians: $($changedMembers.Count)" -ForegroundColor Yellow
        foreach ($member in $changedMembers) {
          Write-Host ("  ~ " + (Format-MemberLabel $member))
        }
      }

      if ($payload.metadata.skippedMembers) {
        $skippedMembers = @($payload.metadata.skippedMembers)
        Write-Host "Unchanged politicians skipped: $($skippedMembers.Count)" -ForegroundColor DarkGray
        foreach ($member in $skippedMembers) {
          Write-Host ("  = " + (Format-MemberLabel $member)) -ForegroundColor DarkGray
        }
      }

      $scanned = [int]($payload.metadata.scannedMembers)
      if ($scanned -le 0) {
        Write-Host "No more federal politician records returned. Stopping." -ForegroundColor Yellow
        break
      }

      if ($scanned -lt $batch) {
        Write-Host "Final federal politician chunk completed." -ForegroundColor Green
        break
      }

      $offset += $batch
    } catch {
      Write-Host "FAILED federal politician chunk at offset=$offset" -ForegroundColor Red
      Read-ErrorBody $_
      break
    }

    Write-Host ""
  }

  return
}

if ($BackfillPoliticianVoteStats) {
  $batch = if ($BackfillPoliticianVoteStatsChunkSize -gt 0) { $BackfillPoliticianVoteStatsChunkSize } else { 25 }

  while ($true) {
    $offset = 0
    $uri = "$base/api/internal/sync/politician-stats?offset=$offset&limit=$batch"
    Write-Host "Backfilling politician vote stats offset=$offset limit=$batch..." -ForegroundColor Cyan

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -Headers $headers
      $payload = $response.Content | ConvertFrom-Json
      $payload | ConvertTo-Json -Depth 8

      if ($payload.status -ne "success") {
        Write-Host "Chunk failed at offset=$offset" -ForegroundColor Red
        break
      }

      if (-not $payload.metadata) {
        Write-Host "Missing backfill metadata. Stopping." -ForegroundColor Yellow
        break
      }

      $scanned = [int]($payload.metadata.scannedMissing)
      $totalMissing = [int]($payload.metadata.totalMissing)

      if ($scanned -le 0) {
        Write-Host "No more politicians missing vote stat counters. Stopping." -ForegroundColor Green
        break
      }

      if ($totalMissing -le $scanned -or $scanned -lt $batch) {
        Write-Host "Final politician vote stat backfill chunk completed." -ForegroundColor Green
        break
      }
    } catch {
      Write-Host "FAILED politician stat backfill chunk at offset=$offset" -ForegroundColor Red
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
