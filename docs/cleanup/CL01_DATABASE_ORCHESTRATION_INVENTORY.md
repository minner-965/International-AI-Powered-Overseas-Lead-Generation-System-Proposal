# CL01 — Database and Orchestration Inventory

Read-only catalog/count inspection of `lead_generation`, schema `leadgen`, with n8n metadata in `public` and queue metadata in `pgboss`. Complete per-object metadata and classification: [CL01_DATABASE_ORCHESTRATION_INVENTORY.json](CL01_DATABASE_ORCHESTRATION_INVENTORY.json).

No application rows, credentials, workflow parameter bodies or contact content are included. Catalog column names and schema dependencies are retained. No database change, queue replay or external request was executed by this inventory.

## Coverage

| Object | Count |
|---|---:|
| Tables | 147 |
| Views | 12 |
| Functions | 35 |
| Triggers | 57 |
| Foreign keys | 308 |
| Total classified tables/views/functions/triggers | 251 |
| Unclassified objects | 0 |
| Tracked workflow JSONs | 4 |
| Actual n8n instance workflows | 4 |
| Queue names represented by retained jobs | 36 |

Every relation records exact row count, columns, code reference files, incoming/outgoing foreign keys, view dependencies, migration origins and a classification. Functions record signature, trigger consumers, catalog dependencies and source references. Triggers record owning table, bound function and enabled state.

| Classification | Objects |
|---|---:|
| CURRENT_WRITE | 218 |
| CURRENT_READ | 16 |
| HISTORICAL_AUDIT | 7 |
| UNUSED_EMPTY | 7 |
| UNUSED_WITH_HISTORY | 3 |

These are conservative static usage classifications. `UNUSED_*` means review is required; all 251 objects have `deletion_proof=false`. PL/pgSQL and dynamic SQL dependencies are not exhaustively represented in pg_depend. Empty functions have no row-count meaning; their UNUSED_EMPTY classification specifically means no direct source/trigger invocation was proven, not safe removal. Trigger and audit dependencies must be reviewed before later cleanup.

## Actual n8n instance

| Workflow ID | Persisted active | Current/review purpose |
|---|---|---|
| dpvPhase10AutoEvidenceReconciliation | true | Scheduled evidence reconciliation; CURRENT compatibility producer |
| dpvPhase1TwoWeekDemo | false | Earlier research webhook; HISTORICAL_COMPAT review |
| dpvPhase6Enrichment | true | Contact/cooperation enrichment webhook; CURRENT compatibility producer |
| dpvPhase61CategoryProcurement | true | Category validation/match webhook; CURRENT compatibility producer with legacy name |

The inventory captures actual instance identity, active version, archive flag, node types and trigger names. It separately records repository workflow JSONs; a repository active flag is not substituted for live instance state. During maintenance n8n is stopped, so persisted active=true does not mean its triggers are executing.

## Queues and workers

The JSON records all registered pg-boss queues, schedules and per-queue retained job counts by state. The 43 application queue declarations and constant-based producer/handler references are mapped in CL01_RUNTIME_REACHABILITY.md. The 36 retained-job queue names also include dead-letter/internal queues; these counts measure different inventories.

| Runtime role | Producer/consumer scope | Maintenance state |
|---|---|---|
| demo-dashboard | HTTP producers and reconciliation timers | stopped |
| category-worker | Research, category evidence, contact enrichment, opportunity calculations | stopped |
| outreach-worker | Verification, SMTP, IMAP, replies, sales tasks and CRM queue handlers | stopped |
| data-worker | Import/export and post-import calculation | stopped |
| n8n | Scheduled/webhook orchestration | stopped |
| PostgreSQL | Application, n8n and durable queues | running |

Frozen history includes failed research/evidence/contact-verification jobs and dead-letter records, plus a queued category-scope refresh. No records were cleared or replayed. These are later CL08/CL15 investigation targets, not failures introduced by this inventory. Two automatic first-touch jobs are completed.

## Cross-check

The 147 tables match the independent CL00 snapshot. CL00 restore and after-inventory comparisons both have zero changed table fingerprints; controls and all 62 migration checksums match. This report supplies inventory evidence only. STOP after CL01.
