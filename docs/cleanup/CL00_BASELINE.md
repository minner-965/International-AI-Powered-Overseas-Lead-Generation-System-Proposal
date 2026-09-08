# CL00 — MC07 Freeze and Safety Baseline

Scope: CL00 and CL01 only. No cleanup deletion is authorized in this round.

## Git freeze

- Accepted source branch: `phase12-workspace-ui-v3`.
- Source HEAD and observed remote branch HEAD: `07af1424ad92ab9ba490b9bcafa5d025d0e16e19`.
- Working tree before cleanup: clean. No tags pointed at source HEAD.
- Cleanup branch: `phase13-cleanup-deai`.
- Local checkpoint: `8abfd7f4ef1a9e1267ae9c5b456df4302322bd75`.
- No reset, clean, restore, force-push or deletion was used.
- Existing tags remain intact, including the Phase 10–12 acceptance tags. Final cleanup push/tag belongs to CL16.

## Maintenance protection

This round uses a process-level maintenance guard: dashboard, outreach-worker, category-worker, data-worker and n8n are stopped. PostgreSQL remains running. These are the deployed producers/consumers of provider, Hunter, SMTP and CRM work; stopping them prevents new reservations and external calls during the frozen audit. No application database control was set OFF.

Run `node scripts/cleanup-maintenance-guard.mjs` to check the guard, or append `--apply` to reapply it. The check fails if an execution container is running or missing. The workspace is intentionally unavailable during this maintenance window; IMAP execution is also paused while its persisted intent remains enabled. This is a temporary full execution freeze, not an online read-only UI implementation. Explicitly starting containers bypasses this operational guard and must be avoided during cleanup.

At the authorized final restoration step, review pending work and remove this maintenance condition with `docker compose up -d demo-dashboard outreach-worker category-worker data-worker n8n`, then verify flags, provider state and queue recovery. This command was not executed in CL00/CL01. Tavily remains paused when its account is exhausted.

## Backup and restore

Ignored local backup directory: `artifacts/backups/cleanup-cl00-20260908/`.

| Artifact | SHA-256 |
|---|---|
| database.dump | a40f86abf0053882a56455e865356f799ee9fed664d9519b74938caf05d5f5f9 |
| schema.sql | 27761168f3b17fb4dde3d60348d4f448da2c1d7ad58c5c3adbf806c69583844f |

The full PostgreSQL custom-format dump includes application, queue and n8n data in the database. Its catalog contains 2,361 lines. `pg_restore --exit-on-error` successfully restored it into the separate `cleanup_cl00_restore_20260908` database, without connecting an application to that database. Backup artifacts contain confidential data and stay ignored and local. `migration-checksums.json` records all 62 immutable migration files. No migration was changed or applied.

## Frozen data

The baseline `before.json` was captured at `2026-09-08T09:34:47.789Z` after all execution services stopped. All 147 application tables have row counts and sorted row-content fingerprints; the confidential snapshot is ignored. Counts reflect actual database state at this freeze, rather than copying the earlier MC07 report. Background automation between MC07 acceptance and the freeze accounts for the newer counts.

| Entity | Rows |
|---|---:|
| companies | 153 |
| sources | 571 |
| contacts | 185 |
| decision_maker_contacts | 165 |
| opportunity_pool_decisions | 331 |
| active business opportunities (view) | 37 |
| research_jobs | 514 |
| research_batches | 1 |
| research_query_plans | 27 |
| research_query_executions | 31 |
| provider_usage_events | 1,139 |
| outbound_messages | 4 |
| inbound_messages | 3 |
| opportunity_activities | 4 |
| sales_tasks | 1 |
| contact_suppressions | 2 |
| automation_controls | 2 |

Search has 29 PERSISTED, 1 NOT_FOUND and 1 RATE_LIMITED execution. The frozen plan remains 579 total / 30 completed / 549 remaining. Tavily account state is CREDIT_EXHAUSTED. Both automation controls remain enabled at revision 2; policy MC07_DPV_FIRST_TOUCH_V1 remains enabled. Two automatic reservations remain PROVIDER_ACCEPTED.

## Validation

- Baseline suite: 1,119 tests, 1,063 passed, 56 optional/environment skips, zero failures.
- Maintenance guard: PASS; PostgreSQL running and all five execution services stopped.
- Backup full restore: PASS. Fingerprint comparison and post-inventory evidence are recorded in the final verification section below.
- Secret scan: PASS; no configured secrets found in tracked deliverables.
- The round performs no Search/Hunter/SMTP/WhatsApp/external CRM test calls. Database fingerprints are checked again after inventory to verify no application-side effects.

## Final verification

- Full restore comparison: all 147 application tables match the production baseline in row count and sorted row-content fingerprint; changed tables = 0.
- Post-inventory comparison: changed application tables = 0; automation controls and first-touch policy equal the baseline; all 62 migration checksums unchanged.
- `before.json`, `restore.json`, `after.json` and `migration-checksums.json` are retained in the ignored backup directory. Both dump hashes remain unchanged.
- The restored verification database is retained for later isolated checks; no database or source file was deleted.
- CL00 PASS. Maintenance protection remains active at STOP; restoring execution belongs to the later explicitly authorized cleanup restoration step.
