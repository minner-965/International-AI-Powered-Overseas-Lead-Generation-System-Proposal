# Phase 10.1 Procurement / Route Legacy Inventory

## Result

- Scope: WP-B01 read-only inventory.
- Classification coverage: every match from the required procurement, purchasing, supplier-onboarding, vendor-registration, tender, RFP/RFQ, supplier-portal, official-route, Contact Queue and historical blocker searches is assigned below.
- `UNKNOWN`: **0**.
- No source or runtime data was changed by WP-B01.

## Active decision and scoring paths

| Classification | Location | What is active | Planned treatment |
|---|---|---|---|
| ACTIVE_BUSINESS_GATE | `services/demo-dashboard/src/phase7/opportunityDecision.js` | Opportunity decision reads the legacy category status and distribution procurement/resale evidence. | WP-B03 removes procurement evidence as a hard gate. |
| ACTIVE_BUSINESS_GATE | `services/demo-dashboard/src/categoryProcurement/cooperationV3.js` | Commercial readiness maps legacy category/procurement statuses and coverage into blockers. | WP-B03 adapts it to category confirmation. |
| ACTIVE_BUSINESS_GATE | `services/demo-dashboard/src/outreach/eligibility.js` | Pre-send eligibility requires the legacy category match status. | Preserve send safety; WP-B03/B08 consume the new category result. |
| ACTIVE_BUSINESS_GATE | `services/demo-dashboard/src/categoryProcurement/productOpportunity.js`, `commercialProductFit.js` | Historical category status names are read for compatibility and optional ranking. | Keep optional product fit non-blocking; migrate labels in WP-B08/B09. |
| ACTIVE_BUSINESS_GATE | `services/demo-dashboard/src/categoryProcurement/categoryProcurementMatch.js` | Current category rule mixes category facts, buyer model, sourcing/import and assortment depth. | WP-B02 separates company-category confirmation from buyer/procurement evidence. |
| ACTIVE_BUSINESS_GATE | `rules/category-procurement-match/v1/decision.json` | Versioned GoRules decision graph contains the legacy mixed rule. | WP-B02 aligns the graph with company-category-only semantics while retaining compatibility output. |

## Active discovery, workers and automatic task creation

| Classification | Location | What is active | Planned treatment |
|---|---|---|---|
| ACTIVE_SEARCH_STRATEGY | `services/demo-dashboard/src/categoryProcurement/CategoryEvidenceService.js` | Builds category/buyer discovery queries, crawls official pages and credible public results, and persists evidence. | WP-B02 limits category queries to operating-category evidence. |
| ACTIVE_SEARCH_STRATEGY | `services/demo-dashboard/src/categoryProcurement/categoryObservationExtractor.js` | Extracts product/category and business-operation observations; also contains buying-department/intermediary signals. | Category observations remain; buying-department evidence is not a category gate. |
| ACTIVE_SEARCH_STRATEGY | `services/demo-dashboard/src/autoEvidence/strategyCatalog.js` | S01–S10 strategy queries include supplier/procurement/portal terms and Buyer job-title terms. | WP-B02 removes procurement-route terms from category research; Buyer/Purchasing/Procurement titles remain contact terms. |
| ACTIVE_SEARCH_STRATEGY | `services/demo-dashboard/src/market/marketProfiles.js` | Holds product-category, company-operation, Buyer-title, procurement-department and supplier-route vocabularies. | Category workers use only category/operation terms; contact-title terms stay available. Route vocabularies retire in WP-B04. |
| ACTIVE_SEARCH_STRATEGY | `services/demo-dashboard/src/enrichment/decisionMakerQueryGenerator.js`, `HunterProvider.js`, `roleNormalizer.js`, `procurementExtractor.js`, `EnrichmentService.js` | Contact research and legacy supplier/procurement extraction. | Buyer/Purchasing/Procurement job titles stay; supplier-route extraction/feasibility use is handled in WP-B03/B04. |
| ACTIVE_AUTO_TASK_CREATION | `services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js`, `executors.js` | Creates and advances category/contact evidence tasks and refreshes decisions. | WP-B07 repairs immediate progression; B02 changes only category semantics/queries. |
| ACTIVE_AUTO_TASK_CREATION | `services/demo-dashboard/src/server.js`, `src/jobs/phase5Queue.js` | Registers category calculation, evidence, contact and reconciliation workers. | Preserve in B02; later packages simplify route-task registration. |
| ACTIVE_AUTO_TASK_CREATION | `services/demo-dashboard/src/research/researchTaskProjection.js`, `ResearchWorkbenchService.js` | Projects blockers/status into the Research workspace. | Rename and simplify in WP-B08 after gates are changed. |

## Active manual official-route queue

| Classification | Location | What is active | Planned treatment |
|---|---|---|---|
| ACTIVE_MANUAL_QUEUE | `database/migrations/041_phase10_manual_official_route_queue.sql` | Append-only official-route task and action schema. | Historical schema remains immutable; additive retirement occurs in WP-B09. |
| ACTIVE_MANUAL_QUEUE | `services/demo-dashboard/src/phase7/repository.js` | Projects supplier/vendor/procurement/contact routes, deduplicates by company/profile/route and records manual actions. | Retire manual route-task projection and actions in WP-B04/B05 while preserving source contacts. |
| ACTIVE_API_FIELD | `services/demo-dashboard/src/phase7/router.js`, `service.js`, `categoryProcurement/opportunitiesRoute.js` | Serves workspace manual routes, actions and legacy category/procurement fields. | Remove/compatibly project in WP-B04/B08. |
| ACTIVE_UI_LABEL | `services/demo-dashboard/public/ui/contact-queue.js`, `index.html`, `app.js`, `opportunity-ui.js`, `product-match-ui.js`, `phase7-ui.js`, `ui/opportunity-workspace.js`, `ui/phase9-research-workbench.js`, `verification-ui.js`, `ui/filters.js` | Displays procurement/category wording and the manual official-route section. | Remove route queue in WP-B04; unify category/contact wording in WP-B08. |
| ACTIVE_EXPORT_FIELD | `services/demo-dashboard/src/phase7/service.js`, `src/dataExchange/exportPolicy.js` | Exports legacy `category_procurement_*` and customer procurement-category fields. | Add compatibility-safe category names in WP-B08/B09. |
| ACTIVE_AUTO_TASK_CREATION | `services/demo-dashboard/src/phase7/repository.js`, `src/enrichment/EnrichmentService.js` | Reconciliation materializes manual route tasks from discovered contacts. | Stop task creation in WP-B04; retain useful company contacts. |

## Historical and compatibility-only references

| Classification | Location | Reason |
|---|---|---|
| HISTORICAL_MIGRATION | `database/migrations/010`, `019`, `023`, `024`, `025`, `028`, `029`, `030`, `031`, `040`, `041` | Applied immutable schema/history; never rewrite. New semantics require an additive migration in WP-B09. |
| HISTORICAL_READ_COMPATIBILITY | `workflows/03-phase6_1-category-procurement-match.json`, `workflows/README.md` | Existing n8n compatibility workflow and legacy job/type names; direct pg-boss remains canonical. |
| HISTORICAL_READ_COMPATIBILITY | `scripts/classify-and-purge-empty-research-jobs.mjs`, `scripts/classify-stale-auto-evidence-tasks.mjs`, `scripts/verify-current-project-status.mjs`, `services/demo-dashboard/scripts/phase10-pre-email-automation-acceptance.mjs` | Operational scripts read historical table/status names and earlier acceptance fields. |
| HISTORICAL_REPORT | `docs/CURRENT_PROJECT_STATUS.md`, `DPV_PHASE10_CURRENT_MASTER_HANDOFF.md`, `OPERATIONS_EXPAND_VERIFIED_COMPANY_POOL.md`, all `PHASE6*`, `PHASE7*`, `PHASE8*`, `PHASE9*`, `PHASE10*` result/research/audit documents and `VERSION_CHANGELOG.md` | Immutable execution evidence and prior design descriptions. Wording is historical, not an active rule. |
| HISTORICAL_READ_COMPATIBILITY | `services/demo-dashboard/test/fixtures/phase10-four-quadrant-validation-manifest-v1.json` and existing Phase 6–10 tests | Regression fixtures intentionally preserve old statuses until the package that changes each consumer. |
| DEAD_CODE | None identified | Every non-document match is imported, registered, queried, rendered, tested, or retained for explicit read compatibility. |

## Required path map

| Required item | Located implementation |
|---|---|
| Opportunity decision rule | `src/phase7/opportunityDecision.js` |
| GoRules table | `rules/category-procurement-match/v1/decision.json` |
| Target-category resolver | `src/categoryProcurement/targetCategoryContext.js`, `CategoryScopeService.js` |
| Category worker | `src/categoryProcurement/CategoryEvidenceService.js`, `CategoryProcurementService.js`, `src/autoEvidence/executors.js` |
| Contact worker | `src/enrichment/EnrichmentService.js`, `HunterProvider.js`, `src/autoEvidence/executors.js` |
| Auto-evidence scheduler | `src/autoEvidence/AutoEvidenceOrchestrator.js`, `strategyCatalog.js` |
| Manual official-route service/API | `src/phase7/repository.js`, `service.js`, `router.js` |
| Contact Queue UI | `public/ui/contact-queue.js`, `public/index.html` |
| Manual action endpoint | `POST /api/manual-official-routes/:id/actions` in `src/phase7/router.js` |
| Reconciliation | manual route projection in `src/phase7/repository.js`; scheduler reconciliation in `src/autoEvidence/AutoEvidenceOrchestrator.js` |
| Export mapping | `src/phase7/service.js`, `src/dataExchange/exportPolicy.js` |
| Status generator | `src/research/researchTaskProjection.js`, `src/research/ResearchWorkbenchService.js`, `scripts/verify-current-project-status.mjs` |

## B01 gate

All discovered matches have an assigned class and planned disposition. `UNKNOWN = 0`; WP-B02 may proceed.
