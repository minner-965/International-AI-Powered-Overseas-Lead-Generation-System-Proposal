# CL13 Database Objects and Current Projections

## Result — 2026-09-13

Read-only inventory and focused projection regression completed. **No table, column, function, trigger or view was deleted; no migration was added or edited; no production data was written.** No object has the complete zero-consumer, zero-history and isolated-replay evidence required for a DROP. This is a conservative retention result, not a claim that every compatibility object is obsolete or removed.

Execution containers were confirmed stopped by `cleanup-maintenance-guard.mjs`; PostgreSQL remained running. Persisted automation controls were not changed. No provider, Hunter, SMTP, CRM or worker execution was invoked. Exa source/configuration supplied by the user is retained; this database audit does not validate its network credentials.

## Actual inventory

The regenerated [machine inventory](CL13_DATABASE_INVENTORY.json) and [complete table classification](CL13_DATABASE_TABLES.md) contain actual aggregate database results and reference evidence for every `leadgen` table. No customer payloads or credentials are exported.

| Object / classification | Count |
| --- | ---: |
| Tables | 147 |
| Views | 12 |
| Columns, including view columns | 2,375 |
| Functions | 35 |
| Non-internal triggers | 57 |
| Foreign-key constraints | 308 |
| CURRENT_WRITE tables | 136 |
| CURRENT_READ tables | 10 |
| HISTORICAL_AUDIT tables | 1 |
| UNUSED_EMPTY / UNUSED_WITH_HISTORY tables | 0 / 0 |
| Proven DROP candidates | 0 |

Classification is conservative static reachability, including retained compatibility/admin code, not evidence that a paused writer is executing. `rule_versions` has three historical rows and is retained as HISTORICAL_AUDIT. Nonempty unreferenced objects are classified as audit history rather than disposable history. Column matching is not relation-aware proof of zero use; every column remains retained.

The scanner now includes nonignored untracked source files as well as tracked working-tree files, so newly supplied Exa modules are not silently omitted. Static name matches can overcount comments or shared identifiers; dynamic SQL can evade literal matches. These limitations block deletion, rather than justify it.

## Retained objects and current-path boundaries

| Object group | Evidence and disposition |
| --- | --- |
| `official_route_manual_tasks` / `official_route_manual_task_current` | Ten historical task rows; three current-view rows. Repository history reader, migration checks and maintenance reports still reference them. Retain audit/compatibility reads; do not reinstate manual-route gating. CL03/CL09 already retire the write entry points. |
| `product_master_current_revisions`, product-opportunity candidates/gaps | Some relations are empty, but catalog/category compatibility readers and FK dependencies remain. Retain; do not reinterpret exact SKU availability as an Opportunity Pool condition. |
| `business_opportunity_current`, `commercial_product_fit_current` | Referenced compatibility projections remain. The MC04 current pool and independent readiness/eligibility projection are authoritative for current business presentation. A historical view name alone is not deletion evidence. |
| `recall_company_name_candidates` | No literal production-source caller found; migration 017 and a migration test remain. REVIEW_REQUIRED, retained. Complete external/dynamic caller and isolated-drop replay proof is absent. |
| `recall_historical_customer_candidates` | No literal production-source caller found; migration 017 defines it. REVIEW_REQUIRED, retained for the same incomplete-proof reason. |
| Functions bound to triggers | All 57 installed triggers resolve to catalog functions in the inventory. Installed bindings are live dependencies, not orphan evidence. No trigger/function is removed. |
| Provider/search, outbound/inbound, suppression, Activity, SalesTask and lineage tables | Current source, FK or historical audit requirements remain. Preserve all records, snapshots and evidence. |

`HISTORICAL_AUDIT` is an audit classification here, not a new database permission or trigger. No read-only enforcement is falsely claimed. No applied migration was rewritten to remove an object; no new migration was justified. Migration 063 remains outside this audit's production-write scope.

## Current projection contract

| Dimension | Current authority / code | Boundary verified |
| --- | --- | --- |
| Opportunity Pool | `opportunity_pool_current`; `src/opportunityPool/currentBusinessProjection.js`; category-procurement opportunities route | MC04 bands and stored decisions remain unchanged. Historical supplier/access/manual fields are removed from top-level current output and retained in `historical_compatibility`. |
| Contact Readiness | `src/opportunityPool/contactReadiness.js` | Current labels are independent of pool admission; absent contact does not downgrade an eligible opportunity. |
| Email Eligibility | `src/outreach/phase13EmailEligibility.js` | Address verification, suppression, first-contact, policy and send-window conditions remain separate from commercial opportunity. No historic approval/FIT row is fabricated. No email was executed. |
| Search Runtime | `src/search/PgFrozenSearchStore.js`; `src/research/providerUsageProjection.js` | Frozen plans/executions and canonical provider usage retain job/company identities, replay and used/reserved units. No search or recomputation ran. |
| Automation Controls | `src/automation/AutomationControlService.js` | Persisted revision and immutable events remain authoritative; isolated tests cover transactional mutation and replay behavior. Production controls were not written. |
| Reply Intent | `src/outreach/inbound.js`; Phase7 repository/service | RFC message identity association and explicit reply classification remain; sender-only association is retired. |
| Sales Handoff | Phase7 `createSalesFollowupWork` / repository CRM effects | Matched human replies create the appropriate isolated-test task; opt-out closes follow-ups, unmatched replies produce no CRM effect, replay produces no delta. No automatic follow-up send is introduced. |

## Verification and baseline distinction

- Actual read-only opportunity route: **PASS**, 153 companies; active 37; PRECISION 4, RELEVANT 2, GENERAL_RELEVANT 31, EXPLORATORY 108, NOT_SUITABLE 8. Retired filter arguments do not gate the current pool; historical business fields are absent at the current top level; contact labels and email eligibility have independent shapes. Zero database writes/provider calls.
- Focused isolated tests: **21 passed, 0 failed, 0 skipped** across `cleanup-cl03-current-projection`, `cleanup-cl07-reply-crm`, `phase13-automation-control` and `phase10-provider-usage-projection`.
- Inventory: exact table counts and catalog dependencies read inside READ ONLY transactions. Total table count remains 147.
- Current counts include companies 153, sources 571, contacts 185, outbound messages 4, inbound messages **5**, sales tasks 1. The earlier September 8 snapshot had three inbound messages; therefore this report does **not** claim all production data is unchanged since that historical baseline. Services had resumed before the maintenance freeze was re-established. No prior rows were rolled back or removed to force equality. Root-level baseline reconciliation records the cross-turn deltas separately.
- Historical fingerprint comparison against September 8 reports **FAIL / cross-turn drift**: 33 changed tables, zero removed tables, control comparison unequal. Applied migration hashes and backup hashes remain unchanged; the existing 063 file is the only appended migration. This is not an all-data-unchanged PASS.
- Read-only control inspection: both `PHASE13_AUTO_FIRST_TOUCH` and `RESEARCH_PROVIDER_EXECUTION` remain enabled at revision 5, updated September 9, 17:22:55 +08:00; the old snapshot recorded revision 2. Latest inbound receipt is September 11, 02:56:07 +08:00. These timestamps predate this September 13 audit; no rollback was performed.
- Integrated root-agent regression: **1,161 tests; 1,107 passed, 54 skipped, 0 failed**. Skipped checks are not represented as passed.
- Post-freeze comparison of `cl13-after.json` (September 13 11:47:11 UTC) against `cl13-final.json` (11:48:56 UTC): **PASS**, all 147 table fingerprints, controls, policy, migrations and backup hashes identical; zero changed or removed tables. This is distinct from historical baseline equality. The original baseline remains intact.
- No proposed DROP means no isolated DROP replay is claimed. See [integrated handoff](CL12_CL13_RESULT.md) for the combined acceptance boundaries.

STOP after CL13. No CL14, push, tag, live provider test or service restoration is performed by this work package.
