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

Step 'Building and starting the system (first build takes several minutes)'
# The init and worker services reuse the image built for demo-dashboard; build it first
# so compose never tries to pull that name from a registry.
docker compose build demo-dashboard
if ($LASTEXITCODE -ne 0) { Fail 'docker compose build failed. Copy the messages above and send them to Claude.' }
docker compose up -d postgres demo-dashboard category-worker outreach-worker data-worker
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed. Copy the messages above and send them to Claude.' }

Step 'Waiting for the workspace to answer on http://localhost:3000'
$ready = $false
for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
  try { $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 3; $ready = ($health.status -eq 'ok') } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { Fail 'The workspace did not start. Run: docker compose logs --tail 80 demo-dashboard' }

Step 'Recording the database migration ledger'
# A new database already contains every migration from the PostgreSQL init scripts;
# --baseline records them once. On later runs the normal apply replays as already applied.
$output = docker compose exec -T demo-dashboard node src/phase7/migrationRunner.js --apply --baseline 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  if ($output -match 'empty migration ledger') {
    $output = docker compose exec -T demo-dashboard node src/phase7/migrationRunner.js --apply 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Host $output; Fail 'Migration check failed.' }
    Write-Host 'Migrations already recorded - verified.'
  } else { Write-Host $output; Fail 'Migration baseline failed.' }
} else { Write-Host 'Migration ledger recorded for the new database.' }

Step 'Supply categories'
node --version *> $null
if ($LASTEXITCODE -eq 0) { node scripts/setup-supply-categories.mjs --list }
else { docker compose exec -T demo-dashboard node project-scripts/setup-supply-categories.mjs --base http://127.0.0.1:3000 --list }

Write-Host "`nSIM workspace is running: http://localhost:3000" -ForegroundColor Green
Write-Host @'
Next steps (see docs/deploy/WINDOWS_LOCAL_SETUP.md):
  1. Approve supply categories, for example:
       node scripts/setup-supply-categories.mjs --categories WOMENSWEAR:DRESSES,WOMENSWEAR:TOPS
  2. Fill search keys in .env.phase2 (EXA_API_KEY / TAVILY_API_KEY), mail in .env.phase7-outreach
     (SMTP/IMAP 587/993, SMTP_MESSAGE_ID_DOMAIN = your domain), Hunter and Feishu if used.
  3. Apply changes: docker compose up -d --force-recreate demo-dashboard category-worker outreach-worker data-worker
  4. Send the first email to your own test address before switching automation on.
'@
