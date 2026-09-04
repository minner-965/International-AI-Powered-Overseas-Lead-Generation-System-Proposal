# Phase 10 Internal Limit and Legacy Inventory

## Scope and method

WP-U01 performed a repository-wide read-only search over production source, UI, workflows, scripts, tests, configuration, migrations and active documentation. The primary expression produced 449 matching lines across 64 non-documentation files. Import/call, queue, route, workflow, migration and PostgreSQL object references were checked separately.

No item in this inventory was deleted or edited during U01.

## Classification inventory

| Classification | Files/symbols | Current reference state | Required later action |
|---|---|---|---|
| ACTIVE_LIMIT_CONFIG | `.env.example`: `AUTO_EVIDENCE_COMPANY_COOLDOWN_HOURS`, `AUTO_EVIDENCE_MAX_ATTEMPTS`, `MAX_TAVILY_CREDITS_PER_RUN_UNITS`, `MAX_TAVILY_UNITS_PER_TASK_RUN`, `MAX_TAVILY_CREDITS_PER_DAY_UNITS`, `MAX_TAVILY_UNITS_PER_COMPANY_PROFILE_CYCLE`, `MAX_TAVILY_CREDITS_PER_BILLING_PERIOD_UNITS` | Still advertised despite provider-only production policy | Remove in U05 |
| ACTIVE_LIMIT_CONFIG | `src/autoEvidence/AutoEvidenceOrchestrator.js`: dormant parsing branches and `tavilyInternalLimitsEnabled=false` compatibility fields | Imported by server and workers | Remove internal-cap parsing/fields in U05; retain provider policy |
| ACTIVE_LIMIT_CONFIG | `src/server.js`: forwards run/daily/pool/company/billing cap fields to `TavilyUsageAudit` | Production wiring; values currently null/disabled | Remove internal Tavily cap wiring in U05 |
| ACTIVE_LIMIT_ENFORCEMENT | `src/search/TavilyUsageAudit.js`: `TavilyCreditBudget`, `internalLimitsEnabled`, run/daily/purpose/company/profile/billing checks and reservation balance | Production module is imported by discovery, enrichment and category services; internal branch is disabled in current server wiring but remains executable and defaults to enabled when instantiated without override | Split audit/idempotency from internal enforcement; remove limit branches in U06, retain append-only usage events |
| ACTIVE_LIMIT_ENFORCEMENT | `src/autoEvidence/AutoEvidenceOrchestrator.js`: legacy ledger-cap check in `budgetResumeEligibility` | Executable resume path | Replace with provider runtime capacity only in U06/U07 |
| ACTIVE_BUDGET_RECONCILIATION | `selectDueBudgetResumes`, `autoResumeBudgetPaused`, `resumeBudgetPaused`, `dispatchBudgetResume`, budget-window schedule keys and result counters in `AutoEvidenceOrchestrator.js` | Called by active reconciliation and controlled batch | Remove internal-window semantics in U09; retain canonical continuation/replay for provider-native recovery |
| ACTIVE_BUDGET_RECONCILIATION | `scripts/repair-phase10-budget-paused-continuations.mjs` | One-off script, no production import; calls legacy resume API | Supersede after U03/U04; candidate DEAD_CODE after evidence is preserved |
| ACTIVE_BUDGET_UI | `public/ui/phase9-research-workbench.js`: budget-paused labels, remaining budget, reset/reconciliation display | Loaded by current Research Workbench | Replace Tavily internal-budget presentation with provider status in U10-D; preserve Hunter-specific hold distinction |
| ACTIVE_BUDGET_UI | `public/app.js`, `public/ui/opportunity-workspace.js` | Generic historical status labels remain reachable | Retain only historical-read labels or relabel explicitly as historical in U10-D/U11 |
| PROVIDER_NATIVE_LIMIT | `src/search/TavilyProviderAccountState.js` | Active provider state, usage cache, 429/432/auth/timeout mapping | Retain |
| PROVIDER_NATIVE_LIMIT | `src/search/TavilySearchProvider.js`, `src/server.js` provider-status/create gate | Active search and ResearchJob gate | Retain; verify in U07/U12 |
| PROVIDER_NATIVE_LIMIT | `compose.yaml`: `TAVILY_USAGE_POLICY=PROVIDER_ACCOUNT_ONLY` | Active deployment policy, not a quantity cap | Retain until policy constant can be simplified without ambiguity |
| IDEMPOTENCY | `AutoEvidenceOrchestrator.js`: execution key, strategy/query fingerprint, stage claim, checkpoint replay | Active | Retain |
| IDEMPOTENCY | `ResearchDirectDispatchService.js`: atomic outbox, singleton queue identity, retry state | Active server import, route and worker consumer | Retain |
| IDEMPOTENCY | continuation fields/outbox in migrations 043/045 and repair diagnostics | Active lineage/audit | Retain |
| AUDIT | `provider_usage_events`, `providerUsageProjection`, `TavilyUsageAudit` event settlement | Canonical provider audit used by API/UI/export | Retain while removing only cap enforcement |
| AUDIT | `research_jobs.search_*` and `social_search_*` summary columns/writes | Still written/read in discovery, verification, workbench and workflow | Stop treating them as truth in U10-B; preserve historical columns/read compatibility until a new migration proves safe |
| HISTORICAL_MIGRATION | migrations 014, 016, 023, 029, 030, 035, 037, 039, 043, 044, 045 | Applied schema/history | Retain unchanged with checksums |
| HISTORICAL_READ_COMPAT | `productOpportunity.js`, `CategoryProcurementService.js`, `product-match-ui.js` legacy `NO_EXACT_SKU`/`INTERNAL_CATALOG_UPLOAD_REQUIRED` projections | Production imports and UI consumers exist; current decision logic already ignores exact SKU as a gate | Keep minimal historical projection; remove ordinary UI exposure only after U10-A tests are replaced |
| HISTORICAL_READ_COMPAT | `BUDGET_PAUSED`, `budget_state`, `cooldown_until`, `max_attempts` database columns/check constraints | Existing rows and applied migrations depend on them | Stop current writes; retain schema/read compatibility in U11 unless a new migration proves every dependency absent |
| DEAD_CODE candidate | Internal-limit condition branches inside `TavilyCreditBudget` | Disabled by current production policy but covered by old-policy tests | Delete branches in U06 and replace tests; the whole audit module is not dead |
| DEAD_CODE candidate | Old internal-budget-only tests: `phase10-tavily-fair-budget.test.js` and limit-oriented cases in `phase10-tavily-usage-audit.test.js` | Test-only references | Replace with provider-native, dedupe and audit coverage in U05/U06/U12 |
| DEAD_CODE candidate | `scripts/repair-phase10-budget-paused-continuations.mjs` | No production import, API route, queue consumer, workflow or HTML reference | Retire only after U03/U04 canonical repair evidence |
| UNKNOWN | `triggerResearchWorkflow` fallback and n8n Research webhook in `server.js` / `workflows/01-two-week-demo.json` | Direct queue is canonical, but fallback and active workflow references still exist | Do not delete in U01; resolve deployment/workflow dependency in U10-C |
| UNKNOWN | Full physical deletion of `productOpportunity.js` or legacy product UI symbols | Active production imports and tests exist | Do not delete; first separate current category result from historical compatibility in U10-A |
| UNKNOWN | Physical removal of `provider_credit_ledger` and budget-related columns/constraints | Historical and runtime audit code references remain | Do not drop; U11 dependency proof required |

## Reference checks for deletion candidates

### Internal Tavily budget implementation

- Production imports of `TavilyUsageAudit`: discovery, enrichment and category evidence services.
- `TavilyCreditBudget` direct production imports: none outside its module; direct imports exist in tests.
- Conclusion: remove internal enforcement functions/branches, not the provider audit module.

### Internal pause/resume implementation

- `autoResumeBudgetPaused` is called by active reconciliation and the one-off repair script.
- `resumeBudgetPaused` is called by controlled-batch handling.
- Resume outbox dispatch is part of checkpoint/continuation safety and must be retained under provider-native naming/semantics.
- Conclusion: old budget-window selection and reset logic is active, not dead; rewrite in U09.

### Exact-SKU/catalog compatibility

- `CategoryProcurementService.js` imports `productOpportunity.js`.
- `phase10DryRun.js`, server routes, UI helpers and contract tests consume its result.
- Current calculator already returns category-qualified results without creating catalog-maintenance work.
- Conclusion: legacy statuses are read compatibility, not yet removable files.

### Provider summary counters

- Writes/reads remain in `discoveryService.js`, `companyVerificationService.js`, `ResearchWorkbenchService.js`, `server.js`, `public/app.js` and `workflows/01-two-week-demo.json`.
- `provider_usage_events` projection is already canonical.
- Conclusion: summary writes are duplicate-state candidates, but historical columns remain until U10-B/U11.

### ResearchJob dispatch

- `ResearchDirectDispatchService` is imported and instantiated by `server.js`, registered as the `EXECUTE_RESEARCH_JOB` queue consumer, and reconciled on a timer.
- `triggerResearchWorkflow` and the n8n Research webhook remain as an active fallback when direct queue is disabled.
- Conclusion: direct dispatch is retained; fallback deletion remains UNKNOWN pending U10-C deployment proof.

## Database object inventory

- Budget/credit/reservation tables: `leadgen.provider_credit_ledger` only.
- Matching stored functions: 0.
- Matching views/materialized views: 0.
- Matching triggers by body: 0.
- Relevant constraints remain on `auto_evidence_tasks`, `auto_evidence_task_attempts`, `auto_evidence_schedule_events`, `provider_account_states`, `provider_account_state_events`, `provider_credit_ledger`, `provider_usage_events`, and `research_jobs` historical counter/budget columns.
- Migration 039 and all earlier/later applied migrations remain immutable.

## Complete match-family disposition

The 64-file primary search set is fully dispositioned by family:

- Applied migration matches: HISTORICAL_MIGRATION.
- Provider account/429/432/PAYGO/usage endpoint matches: PROVIDER_NATIVE_LIMIT.
- Query fingerprint, execution key, continuation, outbox, retry and lease matches: IDEMPOTENCY.
- `provider_usage_events` and projection matches: AUDIT.
- Tavily daily/run/job/purpose/company/profile/cooldown/max-attempt configuration or checks: ACTIVE_LIMIT_CONFIG or ACTIVE_LIMIT_ENFORCEMENT.
- Budget-window resume and `BUDGET_PAUSED` current write paths: ACTIVE_BUDGET_RECONCILIATION.
- Current UI budget/remaining/reset labels: ACTIVE_BUDGET_UI.
- Hunter 429/credit controls and outreach retry caps: outside Tavily-limit deletion scope and retained as provider/email controls.
- Historical reports/tests/migration assertions: HISTORICAL_READ_COMPAT or HISTORICAL_MIGRATION; old-policy-only tests are DEAD_CODE candidates to replace, not simply remove.
- Generic unrelated `limit`, `cooldown`, or 429 matches in matching/import/outreach utilities: outside the internal Tavily quota policy and retained.

## U01 deletion safety conclusion

No complete production module currently satisfies every physical-deletion condition. Several functions/branches and one-off tests/scripts are deletion candidates, but the two UNKNOWN groups above require later dependency proof. U01 therefore authorizes no deletion.
