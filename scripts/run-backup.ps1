# Asks the local Kestrel app to save a backup. Windows Task Scheduler runs this (see register-backup-task.ps1).
# Reads APP_BASE_URL and CRON_SECRET from .env.local, so no secret lives in the task itself.
# The app must be running (for example `npm run start`) at the scheduled time.
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.local"
$vars = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $vars[$matches[1]] = $matches[2].Trim('"') }
  }
}
$base = if ($vars["APP_BASE_URL"]) { $vars["APP_BASE_URL"].TrimEnd('/') } else { "http://localhost:3000" }
$secret = $vars["CRON_SECRET"]

$logDir = Join-Path $env:LOCALAPPDATA "Kestrel"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "backup.log"

if (-not $secret) {
  "$(Get-Date -Format s) backup FAILED: CRON_SECRET is not set in .env.local" | Add-Content $log
  exit 1
}

try {
  $r = Invoke-RestMethod -Method Post -Uri "$base/api/cron/backup" -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 120
  "$(Get-Date -Format s) backup saved: $($r.name) ($($r.rows) rows)" | Add-Content $log
} catch {
  "$(Get-Date -Format s) backup FAILED: $($_.Exception.Message)" | Add-Content $log
  exit 1
}
