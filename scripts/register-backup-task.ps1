# Registers (or replaces) a Windows Task Scheduler job that saves a Kestrel backup every day.
# Run it yourself from the project folder in PowerShell. Nothing here runs automatically.
#   .\scripts\register-backup-task.ps1 -Time 02:00
# Remove it later with:  Unregister-ScheduledTask -TaskName "Kestrel backup"
param(
  [ValidatePattern('^\d{2}:\d{2}$')][string]$Time = "02:00"
)

$script = Join-Path $PSScriptRoot "run-backup.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# StartWhenAvailable runs a missed job once the PC is back on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "Kestrel backup" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Saves a Kestrel backup every day at $Time" -Force | Out-Null
Write-Host "Registered 'Kestrel backup': daily at $Time. Keep the Kestrel app running (npm run start), and CRON_SECRET set in .env.local."
Write-Host "Results are written to $env:LOCALAPPDATA\Kestrel\backup.log"
