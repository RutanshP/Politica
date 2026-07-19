# Registers the four Windows Scheduled Tasks that keep Politica's data synced:
#   - Politica Dev Server   : At log on, keeps `next dev` running on :3000 (see run-dev-server.ps1)
#   - Politica Daily Sync   : Daily, bills/votes/politicians/stats/state-people/state-votes/news/rebuild
#   - Politica Committees Sync : Every 3 days, federal committee roster resync
#   - Politica Weekly Sync  : Weekly, state bills+committees (scope=detail) + sponsored-bill history
#
# Re-run this script any time to update the tasks (it replaces existing ones with the same name).
# To remove them: Unregister-ScheduledTask -TaskName "Politica ..." -Confirm:$false

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$psExe = (Get-Command powershell.exe).Source
# Scoping the logon trigger (and Register-ScheduledTask itself) to the current user avoids
# needing an elevated/admin session -- an "any user" AtLogOn trigger requires admin to register,
# but a single-user one doesn't.
$currentUser = "$env:USERDOMAIN\$env:USERNAME"

function Register-PoliticaTask {
  param(
    [string]$Name,
    [string]$ScriptPath,
    [Microsoft.Management.Infrastructure.CimInstance]$Trigger,
    [TimeSpan]$ExecutionTimeLimit
  )

  $action = New-ScheduledTaskAction -Execute $psExe `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit $ExecutionTimeLimit

  try {
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings `
      -User $currentUser -RunLevel Limited -Force -ErrorAction Stop | Out-Null
    Write-Host "Registered: $Name" -ForegroundColor Green
  } catch {
    Write-Host "FAILED to register: $Name" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}

# --- Politica Dev Server: at log on, no time limit (it runs forever by design) ---------------
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
Register-PoliticaTask -Name "Politica Dev Server" `
  -ScriptPath "$repo\scripts\windows\run-dev-server.ps1" `
  -Trigger $logonTrigger `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

# --- Politica Daily Sync: every day at 03:00 ---------------------------------------------------
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At "03:00"
Register-PoliticaTask -Name "Politica Daily Sync" `
  -ScriptPath "$repo\scripts\windows\sync-daily.ps1" `
  -Trigger $dailyTrigger `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# --- Politica Committees Sync: every 3 days at 03:30 -------------------------------------------
$committeesTrigger = New-ScheduledTaskTrigger -Daily -At "03:30" -DaysInterval 3
Register-PoliticaTask -Name "Politica Committees Sync" `
  -ScriptPath "$repo\scripts\windows\sync-committees.ps1" `
  -Trigger $committeesTrigger `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# --- Politica Weekly Sync: every Sunday at 04:00 ------------------------------------------------
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "04:00"
Register-PoliticaTask -Name "Politica Weekly Sync" `
  -ScriptPath "$repo\scripts\windows\sync-weekly.ps1" `
  -Trigger $weeklyTrigger `
  -ExecutionTimeLimit (New-TimeSpan -Hours 8)

Write-Host ""
Write-Host "Done. Review with: Get-ScheduledTask -TaskName 'Politica *' | Format-Table TaskName,State"
Write-Host "The dev server task only starts at your next log on -- start it now with:"
Write-Host "  Start-ScheduledTask -TaskName 'Politica Dev Server'"
