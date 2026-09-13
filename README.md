# DPV International Sales Workspace

DPV's overseas company research, category-based opportunity assessment, contact verification, email review and sales follow-up workspace.

## Current operating documents

- [Current project status](docs/CURRENT_PROJECT_STATUS.md): verified execution state and current work boundary.
- [Operations runbook](docs/OPERATIONS_RUNBOOK.md): startup, maintenance and restoration checks.
- [Business scope](docs/rules/PHASE13_BUSINESS_SCOPE.md), [opportunity pool](docs/rules/PHASE13_OPPORTUNITY_POOL_RULES.md) and [contact readiness](docs/rules/PHASE13_CONTACT_READINESS_RULES.md): independent business rules.
- [Search providers](docs/SEARCH_PROVIDER.md): provider configuration.
- [Model runtime](docs/LLM_RUNTIME_ACTUAL_STATE.md): implemented capabilities versus planned integrations.
- [UI system V3](docs/UI_SYSTEM_V3.md): shared frontend conventions.
- [Version history](docs/VERSION_CHANGELOG.md): release records.

Opportunity admission, contact readiness and email eligibility are separate states. A category-level match does not require an exact internal SKU. Email execution remains subject to persisted policy, address verification, approval, suppression and deduplication checks.

## Development

The application uses the existing HTML/CSS/JavaScript frontend, Express services, PostgreSQL, transactional work queues and configured integrations. Read current status and the operations runbook before starting workers: startup may resume persisted jobs and automation.

Workspace: <http://localhost:3000>. Local setup guidance: [Company computer setup](docs/COMPANY_PC_SETUP.md).

## Historical records

[docs/history/](docs/history/) retains acceptance results, prior phase assessments and superseded visual references. These record the behavior at the stated date, not the current operating contract. Original proposals and document-generation assets are historical reference material. Current runtime must not use historical reports as policy input.

## Security

Keep credentials, completed environment files, customer exports and database backups outside Git. See [SECURITY.md](SECURITY.md). Shared source folders remain read-only.
