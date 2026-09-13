# CL12 — Dependencies, scripts, configuration and Docker

Verification date: 2026-09-13. Scope: cleanup only; no live provider requests, mail delivery, production writes, service restoration or dependency major upgrade.

## Result

Cleanup inventory and configuration checks completed. **Security acceptance remains REVIEW_REQUIRED**: npm reports two high-severity affected packages. This report does not claim a clean security audit or authorize runtime restoration.

## Dependencies and scripts

- All 16 direct production dependencies have current consumers; no devDependencies. No package meets zero-use deletion criteria. Detailed retained-script classifications are in `CL12_DEPENDENCY_SCRIPTS.md` (September 8 inventory, 77 tracked script files). Newly introduced cleanup and user Exa files are additional working-tree files, not obsolete candidates.
- `pg` is directly imported by `src/server.js` (line 3) and used to construct the database pool; generic text matches in the generated inventory are not its retention rationale.
- Six historical repair candidates retain references/recovery relevance; the four required deletion conditions are not established. No repair script was executed or deleted.
- Package description now identifies the current overseas sales workspace. Package identity and versions are preserved.
- `npm install --ignore-scripts --no-fund`: PASS, up to date, 443 packages audited. Lifecycle scripts intentionally skipped; no version/lock update required.
- `npm ls --depth=0`: PASS, all 16 direct dependencies installed.
- `npm run test:native-smoke`: PASS; local GoRules calculation returned 42 without provider or database access.
- `npm audit --omit=dev`: two high affected packages, Nodemailer 7.0.6 and ImapFlow 1.2.10 through nested Nodemailer. The audit's aggregate vulnerable Nodemailer range is `<=9.1.0`; npm proposes breaking upgrade to 10.0.9. No forced update applied.

Audit references include [address parser DoS](https://github.com/advisories/GHSA-rcmh-qjqh-p98v), [raw-option file/URL access bypass](https://github.com/advisories/GHSA-p6gq-j5cr-w38f), [SMTP envelope.size injection](https://github.com/advisories/GHSA-c7w3-x93f-qmm8), and [recipient-domain validation bypass](https://github.com/advisories/GHSA-cc9r-2j5m-2m83). Presence in the dependency graph is confirmed; application exploitability was not established by this audit. Remediation needs transport compatibility, reply and suppression regression before restoration.

## Configuration cleanup

Removed example-only keys after exact-token scanning of `services`, `scripts`, `workflows` and `compose.yaml` returned no current consumers:

`LLM_API_KEY`, `LLM_MODEL`, `SEARCH_API_KEY`, `ENRICHMENT_API_KEY`, `PRODUCT_OPPORTUNITY_MAX_CANDIDATES`, `OUTREACH_ALLOWED_MARKETS`, `ALLOW_ACCEPT_ALL_SEND`, `DATA_IMPORT_MAX_FILE_BYTES`, `DATA_IMPORT_MAX_ROWS`, `DATA_IMPORT_MAX_COLUMNS`, `DATA_IMPORT_MAX_CELL_CHARS`, `RESEND_FROM_NAME`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `SMTP_FROM_NAME`.

The first eleven were removed from `.env.example` as applicable; outreach duplicates and unused sender-name fields were removed from `.env.phase7-outreach.example`. Import limits remain implemented in `dataExchange/fileContract.js`. First-touch sender display name remains template-owned. Updated comments distinguish legacy transport gates from independent persisted first-touch policy.

Gmail/Resend transport credentials and CRM/Hunter budgets remain because concrete compatibility/current consumers exist (including `src/phase7/service.js`). Names alone are not deletion evidence. No private environment file or user Exa configuration was changed, read into this report or reset. Exa connectivity is not tested by CL12.

## Docker inventory

`docker compose config --quiet`: PASS. Seven services retained; each has an operational purpose.

| Service | Purpose / image | Health and exposure |
|---|---|---|
| postgres | Business/audit persistence; postgres:17-alpine | pg_isready; no host port in base compose |
| n8n | Existing orchestration; n8nio/n8n:2.36.7 | Loopback-bound configured port; no compose healthcheck |
| phase7-runtime-init | Runtime directory ownership; application image | One-shot completion dependency; no listener |
| demo-dashboard | UI and API; locally built Node 24 Alpine image | /api/health; host port 3000 |
| category-worker | Research/category queues; application image | Worker readiness file and PID; no HTTP listener |
| outreach-worker | Contact/reply/mail/CRM queues; application image | Worker readiness file and PID; no HTTP listener |
| data-worker | Import/export/recalculation queues; application image | Worker readiness file and PID; no HTTP listener |

Retained volumes: `postgres_data` (database), `n8n_data` (orchestrator state), `phase7_runtime` (staging/exports). Migration initialization mount remains read-only. Dockerfile runs as `node`, uses pinned package lock through npm ci, and bundles current source/rules/config/static assets. No image, service, volume or Docker configuration was deleted. Host port 3000 is not loopback-restricted in base compose; this existing deployment exposure is recorded, not silently changed during cleanup.

Maintenance guard on September 13: PASS, all five execution containers stopped; PostgreSQL running. Persisted automation controls were not modified. Actual private Exa override is user-owned and outside this base-compose audit; preserve it for the separately authorized configuration verification.

## Handoff

No zero-use dependency/service deletion was justified. Configuration-only obsolete examples were removed. Outstanding: dependency security remediation and runtime restoration acceptance. Continue only the separately authorized CL13; no CL14, push, tag, live research or email from this work package.
