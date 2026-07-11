$headers = @{
  Authorization = "Bearer abcbcdcde"
}

$base = "http://127.0.0.1:3000"

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
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $reader.ReadToEnd()
    } catch {
      $_.Exception.Message
    }
  }
  Write-Host ""
}

Write-Host "Checking health..." -ForegroundColor Yellow
Invoke-WebRequest -UseBasicParsing -Uri "$base/api/health" | Select-Object -ExpandProperty Content

Write-Host ""
Write-Host "Checking sync status..." -ForegroundColor Yellow
Invoke-WebRequest -UseBasicParsing -Uri "$base/api/sync-status" | Select-Object -ExpandProperty Content
