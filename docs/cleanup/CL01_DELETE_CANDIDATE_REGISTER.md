# CL01 — Deletion Candidate Register

## Follow-on resolution — CL02/CL03, 2026-09-08

The original CL01 inventory below remains the frozen before-state. CL02 retired the competing `docs/current-project-status.schema.json` after replacing its parser references; its exact content is retained as `docs/history/status/pre-cl02-current-project-status.schema.json`. The old current-status document is archived separately. CL03 removed three active access/readiness filter controls and three current export columns, while retaining read-only historical assessments and all database rows. No service, queue, table or applied migration file was deleted. See CL02_CURRENT_STATE_CLEANUP.md and CL03_BUSINESS_LEGACY_REMOVAL.md for executed tests and scope. Other candidates remain unapproved for deletion in this round.

## Original CL01 decision

Decision: inventory only; actual deleted files, routes, queues and database objects = 0. Candidate means a review target, not permission to remove it.

## Classification vocabulary

`KEEP_CURRENT`, `DELETE_ACTIVE_CODE`, `DELETE_DUPLICATE`, `RETIRE_TO_HISTORY`, `KEEP_IMMUTABLE_HISTORY`, `REVIEW_REQUIRED`.

No item currently has complete proof for DELETE_ACTIVE_CODE or DELETE_DUPLICATE. Text-scan REMOVE_ACTIVE denotes a lexical review target; it is not the deletion classification.

| Candidate / exact source | Current evidence | Classification | Next package / required proof |
|---|---|---|---|
| docs/CURRENT_PROJECT_STATUS.md historical phase13_search and earlier current narratives | Current parser still validates historical keys together with MC07 | RETIRE_TO_HISTORY | CL02: consolidate current truth and update parser/schema together; preserve audit facts |
| services/demo-dashboard/src/search/discoveryService.js | Outside current static entrypoint graph after frozen-plan integration | REVIEW_REQUIRED | CL04: resolve CLI/test/dynamic imports and replacement behavior before deletion |
| services/demo-dashboard/src/outreach Gmail/Resend adapters and related config | Compatibility references remain in service, worker and test surfaces | REVIEW_REQUIRED | CL06: exact references and future-provider decision; protect SMTP/IMAP shared behavior |
| public/app.js, public/opportunity-ui.js, public/product-match-ui.js | Procurement/supplier-route and old reason labels are still referenced | REVIEW_REQUIRED | CL03/CL10: separate visible labels from historical value mappings |
| public/index.html legacy procurement filter/section wording | Active document contains lexical matches | REVIEW_REQUIRED | CL10: preserve hooks and payload semantics during copy replacement |
| public/phase5.css, phase7.css, ui/phase8-*.css, ui/phase9-research-workbench.css, ui/phase10-workbench.css | Still referenced; old filenames do not establish obsolete behavior | KEEP_CURRENT | CL11: selector-level runtime and responsive coverage before replacement |
| docs/ui/reference/dpv-workspace-reference-dashboard.html | Historical visual reference and current test/reference obligations | REVIEW_REQUIRED | CL11: neutral reference and regression references must be resolved first |
| scripts/ historical one-off repair tools | Per-file inventory records consumers; no blanket removal proof | REVIEW_REQUIRED | CL12: operator/CI references and recovery needs |
| .agents/vendor/resend-skills/ | Development references dominate Resend word matches; not served UI | KEEP_CURRENT | CL12/CL14: inspect skill dependency before pruning any vendor files |
| database/migrations/001–062 | Applied immutable migration chain; checksums frozen | KEEP_IMMUTABLE_HISTORY | Never delete or rewrite |
| Source/evidence, decisions, outbound/inbound, suppression, activities, sales tasks, provider ledger | Audit lineage and current/read compatibility consumers | KEEP_IMMUTABLE_HISTORY | History remains even if producer is retired |
| Empty DB objects and queues | Counts alone do not prove no dependencies | REVIEW_REQUIRED | CL08/CL13: caller, producer, consumer, FK, trigger, history and restore evidence |
| Existing failed/dead-letter research, evidence, contact-verification and export queue records | Present in frozen pg-boss metadata; these predate this read-only inventory | KEEP_IMMUTABLE_HISTORY | CL08/CL15: investigate original error and replay policy without deleting history or triggering live calls |
| MC07 automation controls, frozen plan executor, email fact bridge, templates and reservations | Accepted production path | KEEP_CURRENT | Protect throughout cleanup |

## Evidence required to promote a candidate to deletion

Record zero runtime/API/UI/worker/n8n/config/test-behavior references, zero database FK/current dependency, no historical/audit requirement, verified replacement where applicable, and passing isolated regression. Dynamic references remain unresolved until inspected; missing static hits are not zero-runtime evidence.

Each route and database object has its own inventory classification in CL01_RUNTIME_REACHABILITY.md and CL01_DATABASE_ORCHESTRATION_INVENTORY.md/JSON. Those classifications describe observed usage and are independent of this removal decision.

## Thirty-area coverage

| Areas | Evidence |
|---|---|
| 01 Git; 25 migrations; 29 secrets | CL00_BASELINE.md; ignored migration manifest; secret scan |
| 02 current docs; 28 plans/docs/results | CL01_REPO_INVENTORY.md; CL01_TEXT_SCAN.md |
| 03 rules; 04 opportunities/companies; 05 research/batches | Runtime import and route/service maps; DB references |
| 06 planner/router; 07 adapters; 08 contact/Hunter | Runtime modules, config names, dependency inventory |
| 09 eligibility; 10 templates; 11 SMTP; 12 IMAP/replies | Runtime reachability; worker handlers; protected MC07 sources |
| 13 CRM/activity/tasks; 14 suppression/bounce | DB object/FK inventory; routes and queue handlers |
| 15 n8n; 16 queues/workers | Live database orchestration metadata and tracked workflow graphs |
| 17 APIs; 18 renderers; 19 assets/CSS/HTML | Route inventory; UI view/API and asset references |
| 20 config; 21 dependencies; 22 scripts; 26 Docker | Repo inventory and worker topology |
| 23 import/export; 24 DB objects | Data exchange routes and DB catalog/dependency inventory |
| 27 tests/fixtures; 30 routes/dialogs/mobile | Baseline regression and static UI inventory; interactive CL15 checks deferred while maintenance is active |

CL01 does not perform the later deletion, UI rewrite, dependency removal, current-state consolidation or browser acceptance packages. Its original boundary was STOP after CL01.

## Subsequent CL04–CL06 disposition (2026-09-08)

- CL04: retired the unreferenced synchronous discovery and hardcoded query generator; retained required country conversion. Old internal endpoints now return authenticated HTTP 410 without side effects. Current frozen planning and provider adapters remain.
- CL05: removed the three-mailbox verification cutoff; retained freshness, evidence, suppression and real provider capacity safeguards.
- CL06: corrected unselected Gmail reconciliation isolation; nonzero route/worker dependencies keep Gmail/Resend and manual fallback in REVIEW_REQUIRED. Configuration comments distinguish these from Phase13 automation; values remain unchanged.
- Details and evidence: CL04_SEARCH_PROVIDER_CLEANUP.md, CL05_CONTACT_HUNTER_CLEANUP.md, CL06_EMAIL_LEGACY_CLEANUP.md. No CL07 work is authorized in this handoff.

## Subsequent authorized CL07–CL08 disposition (2026-09-08)

- CL07: removed the unused in-memory reply correlator and sender-only fallback; retained current RFC correlation, shared classifier, Activity, CRM outbox, SalesTask, suppression and bounce handling.
- CL08: removed four orphan handler/queue declarations and corresponding compose allowlists: generate-outreach-draft, validate-outreach-draft, parse-reference-import, refresh-opportunity-exception-queue. Current producers, pending jobs, schedules and outbox references were checked; registered queues and historical records remain untouched.
- Category workflow export display name is now Target Category Validation. Internal identity, webhook, version and graph remain unchanged; no persisted instance import occurred.
- Referenced Gmail, external CRM and repair/reconciliation mechanisms remain. See CL07_REPLY_CRM_CLEANUP.md and CL08_ORCHESTRATION_CLEANUP.md. STOP after CL08, without CL09 or final push/tag.

## Subsequent authorized CL09–CL11 disposition (2026-09-08)

- CL09: 160 routes inventoried; none met all-consumer-zero retirement prerequisites. Existing 410 boundaries and role protections tested; current/admin/history compatibility retained.
- CL10: replaced obsolete app-owned labels and internal narrative with concise bilingual business wording; added full public HTML/JS copy regression. Original business evidence and correspondence remain verbatim.
- CL11: removed zero-caller contact table styles and preparatory component aliases. Current/dynamic selectors, linked assets and reference HTML with current test dependency retained. Fixed content-sized verification badge alignment.
- Detailed evidence is in CL09_API_SERVICE_CLEANUP.md, CL09_ROUTE_INVENTORY.md, CL10_UI_DEAI_RESULT.md and CL11_UI_ASSET_CLEANUP.md. STOP after CL11; no CL12 activation or final push/tag.
