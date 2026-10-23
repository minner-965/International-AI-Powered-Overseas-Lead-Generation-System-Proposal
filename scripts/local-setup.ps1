# SIM Overseas Prospecting - first-time setup on a Windows PC with Docker Desktop.
# Run from the repository root in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\local-setup.ps1
# Safe to run again: existing .env files are kept and the database is never reset.
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }
function RandomHex([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}
# Docker reads env files literally; a UTF-8 byte-order mark would corrupt the first name.
function WriteUtf8NoBom($path, $text) { [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false)) }
function SetValue($text, $name, $value) {
  $pattern = "(?m)^$([regex]::Escape($name))=.*$"
  if ($text -match $pattern) { return [regex]::Replace($text, $pattern, "$name=$value") }
  return $text.TrimEnd() + "`n$name=$value`n"
}
# Windows PowerShell 5.1 turns a native command's stderr into a terminating error under
# ErrorActionPreference=Stop; collect it as text and let the caller check $LASTEXITCODE.
function RunNative([scriptblock]$command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return (& $command 2>&1 | ForEach-Object { "$_" }) -join "`n" } finally { $ErrorActionPreference = $previous }
}
function WaitForWorkspace {
  for ($i = 0; $i -lt 90; $i++) {
    # Another system on the same port would also answer; require this workspace's identity.
    try { $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 3; if ($health.status -eq 'ok' -and $health.service -eq 'sim-leadgen') { return } } catch { }
    Start-Sleep -Seconds 2
  }
  Fail 'The workspace did not start. Run: docker compose logs --tail 80 demo-dashboard'
}

Step 'Checking tools'
if (-not (Test-Path 'compose.yaml')) { Fail 'Run this script from the repository root (the folder that contains compose.yaml).' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git is not installed: https://git-scm.com/download/win' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker Desktop is not installed: https://www.docker.com/products/docker-desktop/' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop is not running. Start it, wait until it says "Engine running", then run this script again.' }

Step 'Creating local configuration (kept out of Git)'
if (-not (Test-Path '.env')) {
  $text = Get-Content '.env.example' -Raw
  $text = SetValue $text 'POSTGRES_PASSWORD' (RandomHex 24)
  $text = SetValue $text 'INTERNAL_API_TOKEN' (RandomHex 32)
  $text = SetValue $text 'N8N_ENCRYPTION_KEY' (RandomHex 32)
  foreach ($name in 'TAVILY_API_KEY','DATAFORSEO_LOGIN','DATAFORSEO_PASSWORD','BRAVE_SEARCH_API_KEY','CRM_BASE_URL','CRM_API_KEY') { $text = SetValue $text $name '' }
  WriteUtf8NoBom (Join-Path $PWD '.env') $text
  Write-Host 'Created .env with a new random database password and internal token.'
} else { Write-Host '.env already exists - kept.' }
if (-not (Test-Path '.env.phase2')) { Copy-Item '.env' '.env.phase2'; Write-Host 'Created .env.phase2 (application settings).' } else { Write-Host '.env.phase2 already exists - kept.' }
foreach ($name in '.env.phase7-outreach', '.env.phase7-api') {
  if (-not (Test-Path $name)) {
    WriteUtf8NoBom (Join-Path $PWD $name) (Get-Content "$name.example" -Raw)
    Write-Host "Created $name (mail and CRM settings are off until you fill them in)."
  } else { Write-Host "$name already exists - kept." }
}

# DASHBOARD_PORT in .env sets the workspace port (default 3100; sq-system uses 3000).
$portLine = Select-String -Path '.env' -Pattern '^DASHBOARD_PORT=(\d+)\s*$' | Select-Object -First 1
$port = if ($portLine) { $portLine.Matches[0].Groups[1].Value } else { '3100' }
$baseUrl = "http://localhost:$port"
$running = RunNative { docker compose ps -q demo-dashboard }
if (-not $running.Trim() -and (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Fail "Port $port is already used by another program. Set DASHBOARD_PORT=<another free port> in .env and run this script again."
}

Step 'Building and starting the system (first build takes several minutes)'
# The init and worker services reuse the image built for demo-dashboard; build it first
# so compose never tries to pull that name from a registry.
docker compose build demo-dashboard
if ($LASTEXITCODE -ne 0) { Fail 'docker compose build failed. Copy the messages above and send them to Claude.' }
docker compose up -d postgres demo-dashboard category-worker outreach-worker data-worker
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed. Copy the messages above and send them to Claude.' }

Step "Waiting for the workspace to answer on $baseUrl"
WaitForWorkspace

Step 'Applying database migrations'
# A new database already contains every migration from the PostgreSQL init scripts;
# --baseline records them once. An existing database (ledger already filled, or created
# before the newest migration) refuses the baseline, so it gets the normal apply instead.
$output = RunNative { docker compose exec -T demo-dashboard node src/phase7/migrationRunner.js --apply --baseline }
if ($LASTEXITCODE -eq 0) { Write-Host 'Migration ledger recorded for the new database.' }
elseif ($output -match 'empty migration ledger|created from all migration files') {
  $output = RunNative { docker compose exec -T demo-dashboard node src/phase7/migrationRunner.js --apply }
  if ($LASTEXITCODE -ne 0) { Write-Host $output; Fail 'Migration apply failed.' }
  $applied = ([regex]::Matches($output, '"migration_key":"([^"]+)","checksum_sha256":"[^"]+","status":"APPLIED"') | ForEach-Object { $_.Groups[1].Value }) -join ', '
  if ($applied) { Write-Host "Applied new migrations: $applied" } else { Write-Host 'Database already up to date.' }
  # Services started before the new migrations; restart them so they see the new schema.
  if ($applied) { docker compose restart demo-dashboard category-worker outreach-worker data-worker | Out-Null; WaitForWorkspace }
} else { Write-Host $output; Fail 'Migration baseline failed.' }

Step 'Supply categories'
node --version *> $null
if ($LASTEXITCODE -eq 0) { node scripts/setup-supply-categories.mjs --base $baseUrl --list }
else { docker compose exec -T demo-dashboard node project-scripts/setup-supply-categories.mjs --base http://127.0.0.1:3000 --list }

Write-Host "`nSIM workspace is running: $baseUrl" -ForegroundColor Green
Write-Host @'
Next steps (see docs/deploy/WINDOWS_LOCAL_SETUP.md):
  1. Approve supply categories, for example:
       node scripts/setup-supply-categories.mjs --categories WOMENSWEAR:DRESSES,WOMENSWEAR:TOPS
  2. Fill search keys in .env.phase2 (EXA_API_KEY / TAVILY_API_KEY), mail in .env.phase7-outreach
     (SMTP/IMAP 587/993, SMTP_MESSAGE_ID_DOMAIN = your domain), Hunter and Feishu if used.
  3. Apply changes: docker compose up -d --force-recreate demo-dashboard category-worker outreach-worker data-worker
  4. Send the first email to your own test address before switching automation on.
'@
