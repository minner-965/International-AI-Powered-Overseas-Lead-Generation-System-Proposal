# CL08 — Orchestration cleanup

Completed 2026-09-08. Scope: tracked n8n exports, queue declarations/handlers and worker allowlists. No service start, workflow import, database mutation, provider call or message send. Execution maintenance guard passed. STOP after CL08.

## Changes and deletion proof

| Removed queue / handler | Producer references before | Retained/pending jobs and schedules | Replacement / reason |
|---|---:|---:|---|
| `generate-outreach-draft` | 0 | 0 | Obsolete `MANUAL_DRAFT_REQUIRED` placeholder. Current `Phase7Service.createDraft` and automatic first-touch templates remain. |
| `validate-outreach-draft` | 0 | 0 | Only read a draft status; actual submit/approve validation is synchronous and retained. |
| `parse-reference-import` | 0 | 0 | Only returned `getImport`, never parsed. Current `createImportDryRun`/`parseXlsxImportBuffer` paths remain. |
| `refresh-opportunity-exception-queue` | 0 | 0 | Duplicate unused recheck handler. Current `recalculate-business-opportunities` and `refresh-auto-evidence-exception` remain. |

Classification: first three `DELETE_ACTIVE_CODE`; final `DELETE_DUPLICATE`. Removed declarations, expiry-list entries, handlers and Compose allowlist entries. Removed **4 active queue handlers**, not database queue objects. Application declarations: **43 → 39**. No migrations changed.

Reachability inspection covered `src`, `scripts`, `config`, tracked workflows and tests, searching both constant and string names. The authenticated generic Phase7 orchestrator maps only `OUTREACH_RECHECK`, `EXPORT_PROCESS`, `CRM_SYNC` and the explicit shared-import branch; it does not accept arbitrary queue names. Dynamic provider-event/import-effect producers and auto-evidence stage mapping do not target these queues.

Fresh read-only persisted evidence: `artifacts/backups/cleanup-cl00-20260908/cl08-orchestration-before.json`, compared to the after snapshot by the main task. **87 registered queues**, **41 name/state job groups**, **4 instance workflows**, **178 execution-history rows** remain unchanged. The removed queues and their dead-letter queues have zero jobs in every state and zero schedules. Existing registered empty queue definitions remain for later database-object review; they are no longer declared or consumed by the application.

All four transactional-outbox families were additionally checked using aggregate-only matching for the four retired names (hyphen and underscore forms): `auto_evidence_resume_outbox` 5 rows / 0 hits; `crm_sync_outbox` 4 / 0; `research_job_dispatch_outbox` 57 / 0; `data_import_effect_outbox` 0 rows. No payload content was printed. Research dispatch uses its fixed current `execute-research-job` consumer.

## Workers and retained routes

| Role | Producers and queues | Handler owner | Config / health / decision |
|---|---|---|---|
| Dashboard | HTTP/internal routes, completion events, repair timers; no worker processing | `src/server.js` | `PGBOSS_PROCESS_JOBS=false`; stopped for maintenance; KEEP_CURRENT |
| Category worker | Score/replay/ICP APIs; research outbox; category chain; enrichment; auto-evidence events/stages | `server.js`, `autoEvidence/queueHandlers.js` | Explicit allowlist, readiness file and queue health; stopped; KEEP_CURRENT |
| Outreach worker | Manual/automatic send, provider/inbound events, IMAP schedule, reply classification, CRM effects | `phase7/queueHandlers.js`, first-touch handler in `server.js` | Explicit allowlist, provider guards, readiness; stopped; KEEP_CURRENT |
| Data worker | Shared discovery, commit, export and recalculation | `phase7/queueHandlers.js` | Explicit allowlist/readiness; stopped; KEEP_CURRENT |
| n8n | Reviewed enrichment/category webhooks and evidence repair schedule | Tracked exports → authenticated internal routes | Stopped; persisted active flags preserved; KEEP_CURRENT compatibility |

Retained queue families cover score-company/all, customer-match, ICP/replay; enrichment and five category-chain stages; business-opportunity recheck; outreach verification/manual send/automatic first-touch/provider events; IMAP/controlled inbound/reply/follow-up/CRM; shared discovery/commit/export/post-import; eight auto-evidence stages; direct ResearchJob execution. Existing Gmail sync and ambiguity repair have real producer references and remain compatibility paths with CL06 provider guards. `create-sales-followup` has an actual inbound producer and remains. No zero-count queue was deleted solely because empty.

The queued `refresh-category-scope-match` job (1) and all failed/dead-letter research, category and verification history remain untouched. No replay was attempted during cleanup. Repair/reconciliation is `KEEP_CURRENT`.

## n8n exports and identity

| Export / instance | Classification | Action |
|---|---|---|
| `02-phase6-enrichment.json` | KEEP_CURRENT | Referenced enrichment webhook; retained |
| `03-phase6_1-category-procurement-match.json` | KEEP_CURRENT | Display title becomes **DPV Target Category Validation** |
| `03-phase10-auto-evidence-reconciliation.json` | KEEP_CURRENT | Schedule, watchdog and heartbeat retained |
| `04-phase7-controlled-outreach-and-data-exchange.json` | KEEP_CURRENT compatibility | Current authenticated orchestration API target; retained |
| Instance-only inactive `dpvPhase1TwoWeekDemo` | KEEP_IMMUTABLE_HISTORY | No tracked retired JSON exists to remove; instance/history unchanged |

Category handler inspection confirms category evidence, buyer-model, category match, category-level opportunity and cooperation assessment—not a procurement-proof prerequisite. Only its export display title changed. Workflow ID `dpvPhase61CategoryProcurement`, version ID, node IDs/names, connection graph, webhook identity/path, endpoint and job type are unchanged. Persisted instance title remains its historical title until a later reviewed restoration/import; this report does not claim a live rename.

README now describes the category-level purpose and distinguishes immediate event/outbox dispatch from the **30-minute repair schedule**. The interval is retained as a valid fallback, not a normal-path wait. Current runtime scans found no normal-path 30-minute wait assumption to delete. Usage reservation expiry windows are accounting recovery, not dispatch delay, and remain.

## Verification

Integrated CL07–CL08 result: **1,150 tests; 1,096 passed, 54 skipped, 0 failed**. Skipped integration checks are not reported as passed. All 147 business-table fingerprints and persisted controls match baseline; applied migrations and backup hashes are unchanged. Prior migration 063 remains pending, with no new migration this round. Current-state DB/runtime validation, Compose validation and secret audit PASS. Orchestration before/after digest: `729814df3bb958ee978e3b10ca9840a275a0e7f0f0656b4f711174e9194934a9`. No UI edits or live browser acceptance claimed. Local checkpoint only, no push/tag, STOP after CL08.

Focused command from `services/demo-dashboard`: `node --test test/cleanup-cl08-orchestration.test.js test/phase5-infrastructure.test.js test/phase7-backend-integration.test.js test/phase10-research-direct-queue.test.js test/phase10-orchestrator-observability.test.js`.

**46 passed, 0 failed, 0 skipped.** New checks reject retired queues before dispatch, preserve immediate recheck events, parse all four workflow graphs with valid node references, protect category workflow identity and retain actual draft/import paths. Existing fixture tests cover outbox rollback, duplicate create, singleton dispatch, missing-outbox repair and worker checkpoint/ledger replay. No production worker startup or live n8n import was performed; those belong to final restoration acceptance.
