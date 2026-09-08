# CL09 API / Service Cleanup

## Result

CL09 route audit and compatibility regression completed. No endpoint met the plan's all-consumer-zero deletion condition, so this package deletes **0 routes and 0 services**. This is a conservative retention result, not a claim that every historical route has been removed. No production database, worker, provider or mail execution was started.

The complete route matrix is [CL09_ROUTE_INVENTORY.md](CL09_ROUTE_INVENTORY.md). It covers all 160 statically registered routes in the four current Express registration modules, including the two dynamic email webhooks that the original literal-only CL01 scanner omitted. Each row records source, authentication, business owner, service calls, browser/internal/test/script/n8n references, conservative DB-write and side-effect bounds, and classification. Runtime-generated or external callers remain a limitation; zero static references alone is not deletion proof.

`scripts/cleanup-cl09-api-inventory.mjs` creates the new matrix without importing the server or touching CL01's immutable inventory. Route-level mutation bounds are explicitly distinguished from a complete transitive SQL audit, which is not claimed here.

## Candidate dispositions

| Candidate | Decision | Actual dependency / reason |
|---|---|---|
| Start Review / manual official-route write endpoints | KEEP_RETIRED_BOUNDARY | No active V3 panel, but `phase7-backend-integration.test.js` still validates the compatibility endpoints; service/repository and new HTTP tests prove 410 with zero SQL/queue writes. Keep the explicit retirement response and role guard. |
| Manual official-route history GET | KEEP_IMMUTABLE_HISTORY | `Phase7Repository.listManualOfficialRoutes` supports historical completed records; CL03 tests preserve this audit path. No current opportunity gate is restored. |
| Old research generate-queries/discover endpoints | KEEP_RETIRED_BOUNDARY | CL04 already removed the obsolete engines. Token-protected 410 handlers and their regression contract remain; no frozen-planner replacement is changed. |
| Category-procurement job APIs | KEEP_CURRENT | Current category validation, internal workflow callbacks, company projections and tests still use the stable endpoint identity. A historical path word is not proof of a retired business function. |
| Product opportunity / category match company APIs | KEEP_CURRENT | Current Company Detail and business projection callers exist. MC04 scoring and opportunity pool decisions stay unchanged. |
| Gmail-only endpoints | REVIEW_REQUIRED / retain | CL06 proved provider/worker/admin compatibility references; the all-reference-zero condition is not met. Deleting routes alone would leave the connected compatibility contract inconsistent. |
| Controlled application endpoints | KEEP_CURRENT_COMPAT | OquMail first-touch and CRM reuse controlled context plumbing; tests and operating tools retain references. Historical mail/audit records remain intact. |
| Old opportunity APIs / management actions | KEEP_REFERENCED | Current frontend/administrative fallback/test consumers remain. No per-email approval gate is inserted into current automatic first-touch. |
| Auto-evidence / category-scope APIs with no literal caller | REVIEW_REQUIRED / retain | Static absence is not proof against dynamic/operator clients. These remain registered current service functions; deleting solely from an absent literal would exceed the plan's evidence requirement. |

No migration, historical decision, email, suppression, Activity, SalesTask, source or evidence record was changed.

## Verification

Integrated CL09–CL11 regression: **1,158 tests; 1,104 passed, 54 skipped, 0 failed**. No skipped integration test is claimed passed. Read-only fingerprints of all 147 production business tables match baseline; automation controls, applied migration hashes, backup hashes and orchestration snapshot remain unchanged. Migration 063 is still pending; no migration was added this round. Secret scan and current-state DB/runtime validation PASS. No production service startup or external call. Local checkpoint only, STOP after CL11 without push/tag.

Command: `node --test test/cleanup-cl09-api.test.js` from `services/demo-dashboard`.

**3 passed, 0 failed, 0 skipped.** The isolated Express server binds a random loopback port and uses in-memory service substitutes; production execution containers remain stopped.

- Retired manual reconcile/action POSTs return HTTP 410 / `RETIRED_POLICY`, with zero SQL and zero queue calls.
- SALES role receives HTTP 403 before a retired administrative mutation reaches its service.
- Current draft lookup returns its approved draft on success and HTTP 404 / `OUTREACH_DRAFT_NOT_FOUND` for absence.

Maintenance guard passed before inspection. No SMTP, Hunter, search provider or external CRM request was made. The combined CL09–CL11 handoff records full regression and production data fingerprint verification separately.
