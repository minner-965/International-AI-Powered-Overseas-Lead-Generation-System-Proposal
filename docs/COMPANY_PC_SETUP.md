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
Keep provider, email and CRM credentials in n8n's credential manager.

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
