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

## Current implementation status

The repository currently contains approved planning materials, management demonstrations, budgets and document-generation sources. Production n8n workflow JSON, database migrations and live service integrations are the next development deliverables.

## Security

Do not commit completed `.env` files, API keys, email credentials, n8n credential exports, real customer lists, personal contact information, CRM exports or database backups. See [SECURITY.md](SECURITY.md).

## Continue development

Follow [docs/COMPANY_PC_SETUP.md](docs/COMPANY_PC_SETUP.md), then begin with the first workflow milestone described in [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md).

