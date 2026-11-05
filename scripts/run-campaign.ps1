# Starts one Kestrel campaign by calling the local app. Windows Task Scheduler runs this.
# Reads APP_BASE_URL and CRON_SECRET from .env.local, so no secret lives in the task itself.
# The app must be running (for example `npm run start`) at the scheduled time.
param([Parameter(Mandatory = $true)][int]$CampaignId)

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

$dataDir = Join-Path $root "data"
New-Item -ItemType Directory -Force $dataDir | Out-Null
$log = Join-Path $dataDir "scheduler.log"

if (-not $secret) {
  "$(Get-Date -Format s) campaign $CampaignId FAILED: CRON_SECRET is not set in .env.local" | Add-Content $log
  exit 1
}

try {
  $r = Invoke-RestMethod -Method Post -Uri "$base/api/cron/run?campaign=$CampaignId" `
    -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 30
  "$(Get-Date -Format s) campaign $CampaignId started: $($r | ConvertTo-Json -Compress -Depth 5)" | Add-Content $log
} catch {
  "$(Get-Date -Format s) campaign $CampaignId FAILED: $($_.Exception.Message)" | Add-Content $log
  exit 1
}
