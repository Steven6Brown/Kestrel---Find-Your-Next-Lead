# Registers (or replaces) a Windows Task Scheduler job that runs one campaign on a schedule.
# Run it yourself from the project folder in PowerShell. Nothing here runs automatically.
#   .\scripts\register-task.ps1 -CampaignId 1 -Schedule Daily -Time 06:00
# Remove a job later with:  Unregister-ScheduledTask -TaskName "Kestrel campaign 1"
param(
  [Parameter(Mandatory = $true)][int]$CampaignId,
  [ValidateSet("Daily", "Weekdays", "Weekly")][string]$Schedule = "Daily",
  [ValidatePattern('^\d{2}:\d{2}$')][string]$Time = "06:00"
)

$script = Join-Path $PSScriptRoot "run-campaign.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -CampaignId $CampaignId"

switch ($Schedule) {
  "Daily"    { $trigger = New-ScheduledTaskTrigger -Daily -At $Time }
  "Weekdays" { $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $Time }
  "Weekly"   { $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At $Time }
}

# StartWhenAvailable runs a missed job once the PC is back on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$name = "Kestrel campaign $CampaignId"
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description "Starts Kestrel campaign $CampaignId ($Schedule at $Time)" -Force | Out-Null
Write-Host "Registered '$name': $Schedule at $Time. Keep the Kestrel app running (npm run start)."
