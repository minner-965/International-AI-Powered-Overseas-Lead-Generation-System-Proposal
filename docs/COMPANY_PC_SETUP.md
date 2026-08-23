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

## 4. Confirm the project baseline

Read these files before implementation:

1. `README.md`
2. `docs/PROJECT_CONTEXT.md`
3. Latest Chinese and English proposals in `final_updated_v3/`
4. n8n management deck in `management_demo/`
5. Budget workbooks in `outputs/`

## 5. Create the implementation structure

The next development phase should add:

```text
workflows/      Exported n8n workflow JSON
database/       PostgreSQL schema and migration files
services/       Optional API adapters and validation services
tests/          Workflow fixtures and acceptance checks
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

The first checkpoint is a no-send workflow that produces a reviewable list of 50 sourced candidate companies for one market and product category. It must show source traceability, deduplication, qualification reasons, contact-verification status and an approval state.

