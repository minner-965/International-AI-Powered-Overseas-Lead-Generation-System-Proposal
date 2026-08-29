# DPV International AI-Powered Overseas B2B Lead Generation System

This repository preserves the proposals, management demonstrations, cost workbooks, generation sources and project context for DPV International's overseas lead-generation initiative.

## Current business scope

- Current phase: B2B only.
- Primary buyer: overseas importer / wholesaler.
- Required capability: the buyer imports products, holds stock, distributes locally and supplies chain stores or organized retail networks.
- B2C customer acquisition is a possible later phase and is outside the current plan.
- Existing and expansion context: Mexico, United Arab Emirates and Bangladesh.

## Proposed operating model

n8n orchestrates the workflow. Search APIs, public business directories, B2B/trade-data providers and approved public web sources supply company records. Rules and AI classify evidence, product fit and lead priority. Contact-enrichment services validate decision-makers. Human approval remains in the first-release outreach process.

```text
Market and product parameters
  -> multilingual search terms
  -> approved data sources and APIs
  -> company extraction
  -> normalization and deduplication
  -> B2B/importer-wholesaler qualification
  -> chain-store supply evidence
  -> contact enrichment and verification
  -> scoring and product matching
  -> message drafting
  -> human approval
  -> email / sales task
  -> reply classification and CRM update
```

## Repository contents

- `deliverables/`: original Chinese and English Word proposals.
- `final_updated_v3/`: latest bilingual proposal set used as the formal reference.
- `management_demo/`: English management presentations and PDF copies, including the n8n workflow-focused six-slide deck.
- `outputs/`: Chinese and English cost-budget workbooks.
- `build_dpv_proposals.py`: proposal document-generation source.
- `demo_build/`: management-demo generation source and retained notes.
- `n8n_edit_build/`: n8n-focused presentation generation source and template notes.
- `.codex_cost_workbook/`: cost-workbook generation source.
- `doc_assets/`: logos and document visual assets.
- `docs/PROJECT_CONTEXT.md`: consolidated decisions and continuation context.
- `docs/COMPANY_PC_SETUP.md`: steps for continuing work on a company computer.

Historical document folders are intentionally retained because the repository was created after several proposal revisions. Rendering caches and artifact-inspection intermediates are excluded through `.gitignore`.

## Phase-one two-week demo

The local demo is now implemented. It includes PostgreSQL 17, n8n 2.36.7, a
browser-based human review dashboard, the proposal's eight-part 100-point score,
source evidence, deterministic deduplication and a credential-free n8n workflow.

The default run collects current public business information from approved UAE
company websites, the Emirates Online clothing-wholesaler directory and
OpenStreetMap/Overpass. It stores the original URL and capture time for every
record, keeps unsupported qualification claims at a lower tier, and explicitly
rejects OEM/private-label/buying-house records. Every collection is cumulative:
existing real leads are updated, new leads are appended, and no previous real
record is deleted. The current target category is women’s apparel, including
dresses, camisole/slip dresses, tops and skirts.

Outbound sending is not implemented and remains disabled even after human approval.

Start it with:

```powershell
docker compose up -d --build
node tests/live_acceptance.mjs
```

- Review dashboard: <http://localhost:3000>
- n8n: <http://localhost:5678>
- Imported workflow: `DPV Phase 1 - Live Public Data Demo`

See [runbooks/LOCAL_DEVELOPMENT.md](runbooks/LOCAL_DEVELOPMENT.md) for operation
and reset instructions. Live provider, contact-enrichment, LLM, email and CRM
integrations are deliberately deferred until approved credentials are available.
Public directory records are candidates, not verified prospects; a human must
confirm the legal entity, decision-maker and commercial fit before outreach.

## Security

Do not commit completed `.env` files, API keys, email credentials, n8n credential exports, real customer lists, personal contact information, CRM exports or database backups. See [SECURITY.md](SECURITY.md).

## Continue development

Follow [docs/COMPANY_PC_SETUP.md](docs/COMPANY_PC_SETUP.md), then begin with the first workflow milestone described in [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md).

For an already configured development computer, start Docker Desktop, run
`docker compose up -d`, and open <http://localhost:3000>.
