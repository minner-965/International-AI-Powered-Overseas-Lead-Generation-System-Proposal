# Continue Development on a Company Computer

## 1. Prerequisites

Install or obtain company-approved access to:

- Git
- GitHub account with access to the private repository
- Docker Desktop or a company-approved container runtime
- n8n deployment environment
- PostgreSQL
- A company-approved large-language-model API
- Approved search/company-data and contact-enrichment providers
- Corporate email and CRM test accounts

## 2. Clone the repository

```powershell
git clone https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal.git
Set-Location International-AI-Powered-Overseas-Lead-Generation-System-Proposal
```

## 3. Create local configuration

```powershell
Copy-Item .env.example .env
```

Complete `.env` locally with company-approved credentials. The completed file is excluded from Git and must stay on the deployment computer or in the company's secret manager.

Create the Python environment used by the proposal-generation source:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Start the local development services:

```powershell
docker compose up -d --build
docker compose ps
```

Then open `http://localhost:3000` for the demonstration dashboard. Open
`http://localhost:5678` for n8n and create the local owner account if prompted.
Keep legacy n8n integration credentials in n8n's credential manager. Phase 7
email Provider secrets stay in the Express/worker secret boundary and are not
stored in n8n.

### Phase 7 safe defaults

Before starting Phase 7 services, keep the checked-in defaults closed:

```ini
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
OUTBOUND_EMAIL_PROVIDER=NONE
INBOUND_EMAIL_PROVIDER=NONE
RESEND_USE_CASE=DISABLED
HUNTER_MODE=DISABLED
```

Create the management token, management CSRF secret and internal worker token as separate local secrets:

```ini
DPV_MANAGEMENT_API_TOKEN=<local management token>
DPV_MANAGEMENT_API_ACTOR=<server-bound local actor>
DPV_MANAGEMENT_API_ROLE=MANAGEMENT
DPV_MANAGEMENT_CSRF_SECRET=<separate local CSRF secret>
INTERNAL_API_TOKEN=<local internal worker token>
```

The management token identifies authenticated browser operations. The CSRF
secret signs management-state changes and must be different from the management
token. The internal token is only for n8n/worker-to-Express calls and does not
represent a human approval. Do not expose any of these values in browser
bundles or hard-coded JavaScript, workflow exports, screenshots or logs. The
management token is entered at runtime by an authorized operator and retained
only in that browser tab's session storage; the CSRF secret and internal token
remain server-side.

The Phase 7 workflow is:

```text
workflows/04-phase7-controlled-outreach-and-data-exchange.json
```

Import it into n8n only after Express exposes
`POST /api/internal/phase7/orchestrate`. It is credential-free and reads
`APP_INTERNAL_BASE_URL` and `INTERNAL_API_TOKEN` from the n8n runtime. Keep the
workflow inactive until the internal endpoint and Phase 7 queues are verified.

The workflow accepts only these orchestration actions:

```text
OUTREACH_RECHECK
IMPORT_DISCOVER
EXPORT_PROCESS
CRM_SYNC
```

It contains no SMTP, Resend, database, local-file or shared-directory node.
Provider secrets remain in the Express/worker secret boundary.

For a local Phase 7 outreach worker, copy the example outside Git-tracked
configuration and fill only company-approved values:

```powershell
Copy-Item .env.phase7-outreach.example .env.phase7-outreach
```

Keep outbound Provider `NONE` through Phase 7 acceptance. Resend is restricted
to explicit opt-in or an existing transactional relationship and is not the
Provider for public-lead cold outreach.

Import staging and export artifacts must stay in the configured non-public,
Git-ignored runtime directories. Do not mount an entire shared drive into the
web container. Shared-file discovery uses an allowlist, copies a source into
local staging, verifies source-before/local/source-after SHA-256, and parses only
the local copy.

Run the explicit Phase 7 migration only after backing up PostgreSQL and reviewing
the pending migration result:

```powershell
docker compose exec demo-dashboard npm run phase7:migrate
```

After migration, rerun the same command to verify idempotent replay, then run the
full test suite and the database count/zero-send checks documented in
`docs/PHASE7_RESULT.md`. The verified Phase 7 development database recorded
`APPLIED` on the first migration run and `SKIPPED` on replay, with all recorded
pre-existing business-table counts unchanged. A newly cloned company computer
must reproduce those checks against its own restored database before use.

Phase 7 separates HTTP and background responsibilities:

```text
demo-dashboard   HTTP/API only; PGBOSS_PROCESS_JOBS=false
category-worker  Phase 5/6/6.1 category and opportunity queues only
outreach-worker  Phase 7 outreach queues only; only service allowed to load .env.phase7-outreach
data-worker      Phase 7 import/export queues only; no Phase 2 or outbound Provider env file
```

The three workers run with `HTTP_LISTEN_ENABLED=false` and explicit
`PGBOSS_QUEUE_ALLOWLIST` values. Keep `.env.phase7-outreach` absent, or retain its
closed defaults, until company approval and a separate live-pilot phase.

ExcelJS is fixed at 4.4.0 for the Phase 7 XLSX runtime. The current dependency
audit reports 2 moderate transitive findings; the automated forced fix proposes
a downgrade to ExcelJS 3.4.0 and was not applied because it would leave the
pinned and tested runtime. Track a compatible upstream resolution and rerun the
full import/export test set before changing the version.

## 4. Confirm the project baseline

Read these files before implementation:

1. `README.md`
2. `docs/PROJECT_CONTEXT.md`
3. Latest Chinese and English proposals in `final_updated_v3/`
4. n8n management deck in `management_demo/`
5. Budget workbooks in `outputs/`

## 5. Implementation structure

The development scaffold contains:

```text
workflows/      Exported n8n workflow JSON
database/       PostgreSQL schema and migration files
services/       Optional API adapters and validation services
tests/          Live-data acceptance checks
runbooks/       Operations, backup and incident procedures
```

## 6. Credential handling

- Store n8n credentials through n8n's credential manager.
- Use a stable, protected `N8N_ENCRYPTION_KEY` for the deployment.
- Do not export credentials with workflow JSON.
- Do not place tokens directly in Code, HTTP Request or Edit Fields nodes.
- Use test accounts and de-identified sample data during development.
- Rotate any secret that is accidentally committed and remove it from Git history.

## 7. First development checkpoint

The first checkpoint is implemented as a no-send workflow and dashboard that
collects real UAE public business records. Verify the live collector with
`node tests/live_acceptance.mjs`. The dashboard shows source URLs, timestamps,
deduplication, qualification reasons, contact status, scoring and human approval
while enforcing `send_status = 'disabled'`.
