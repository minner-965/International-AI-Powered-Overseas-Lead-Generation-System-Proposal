# CL04 Search/provider cleanup

Date: 2026-09-08

## Integrated CL04–CL06 verification

Final full suite: 1,140 tests; 1,086 passed, 54 skipped, 0 failed. Skipped integration checks are not reported as passed. Current status DB/runtime verification and secret audit PASS. Read-only comparison of all 147 production tables: no changes; persisted controls equal baseline. Applied migration files unchanged; previously added 063 remains pending on production (no new migration in this package). Backup hashes remain unchanged. Execution containers remain stopped; no live search/Hunter/SMTP calls. No UI changes or live browser acceptance claimed. Local checkpoint only; no push/tag; STOP after CL06.

Scope: retire pre-MC06 discovery execution, preserve the accepted MC07 frozen-plan pipeline and provider-account capacity protection. No provider calls, production data changes, migration edits or service starts.

## Classification and changes

| Path/symbol | Classification | Evidence / replacement | Deleted |
| --- | --- | --- | --- |
| `services/demo-dashboard/src/search/discoveryService.js` | DELETE_ACTIVE_CODE | No production import; old internal endpoints referenced undefined functions. MC07 uses `FrozenSearchPlanExecutor`, `PgFrozenSearchStore`, versioned plans and audited execution. | Yes |
| `services/demo-dashboard/src/search/queryGenerator.js` | DELETE_ACTIVE_CODE | Hardcoded pre-MC06 strategy arrays reached only by the retired discovery module and obsolete tests. Its country helper remained needed by company verification and was extracted without changing behavior. | Yes |
| `services/demo-dashboard/src/market/searchCountryCode.js` | KEEP_CURRENT | Country-code conversion used by company verification; independent of query strategies. | No |
| `/api/internal/research/jobs/:id/generate-queries`, `/api/internal/research/jobs/:id/discover` | RETIRE_TO_HISTORY | Main integration replaces broken legacy execution with authenticated HTTP 410 responses. No provider calls or query rewrites. | Handler logic removed; retirement response retained |
| `SearchPlanService`, `queryPlanner`, versioned planning registry | KEEP_CURRENT | Frozen registry expansion, scope identity, fingerprints and lane fairness remain unchanged. | No |
| `FrozenSearchPlanExecutor`, `PgFrozenSearchStore`, `CurrentCapacityRouter`, `SearchUsageAudit` | KEEP_CURRENT | Current worker execution, provider allowlist, response checkpoint recovery and usage dedupe. | No |
| Legacy `TAVILY_CREDIT_CAP` stored-error readers | KEEP_IMMUTABLE_HISTORY | Existing histories may contain the old code; readers do not enforce a quota. | No |

No stored search query, candidate, source, frozen plan, provider usage event or applied migration was removed. The old synchronous service contained destructive candidate replacement and pending-query deletion; those retired operations are no longer available through that module.

## Provider inventory

| Provider | Adapter / router | Current/future purpose | Decision |
| --- | --- | --- | --- |
| Tavily | `TavilySearchProvider`, purpose router and current-capacity router | Accepted current provider; frozen baseline reports CREDIT_EXHAUSTED, so execution remains paused | KEEP_CURRENT |
| Brave | `BraveSearchProvider`, purpose router and current-capacity router | Approved implemented provider; explicit order, credential, storage-right and confirmed capacity checks required | KEEP_CURRENT; no activation |
| DataForSEO | `DataForSeoSearchProvider`, configurable purpose factory, server credential keys and fixture tests | Previously requested adapter; excluded from current-capacity automatic allowlist. Not proven retired | REVIEW_REQUIRED / retained |
| Google Search / CSE | No separate production adapter | DataForSEO's Google organic endpoint is part of its adapter, not another Google adapter | No standalone file to delete |
| Bing | No production adapter found | None | No file to delete |

Credential values were neither output nor changed. Root `.env` key-presence checks alone do not establish deployed container credentials; baseline account state is retained and no external configuration probe was made. Adapter construction/tests use injected fixture responses only.

## Tavily budgets and safeguards

The former daily/run/company-profile quotas, purpose allocation caps, fixed attempt caps and seven-day cooldown enforcement are already absent from the current implementation. Existing `phase10-tavily-provider-only.test.js` proves ignored retired keys and 100 distinct fixture requests without application-quota rejection.

Retained deliberately:

- `TAVILY_USAGE_POLICY=PROVIDER_ACCOUNT_ONLY`: actively validated by `autoEvidenceConfig`; not a dead environment key.
- Actual provider-account exhaustion, authentication and rate-limit protection.
- NO_NEW_PAID_SPEND / explicit provider order and capacity confirmation.
- Request fingerprints, response recovery, concurrency claims and historical usage grouping (`budget_pool` is an audit column, not enforcement).
- Technical request count/page size and timeout bounds; these are not arbitrary daily quotas.
- Historical migration definitions and audit/error readers.

No `NOT_ACTIVATED_PENDING_CONFIG` or `live_brave_test` remains in active search runtime logic. Historical reports were not rewritten.

## Validation

Targeted command from `services/demo-dashboard`:

```text
node --test test/cleanup-search-provider.test.js test/search.test.js test/multiMarket.test.js test/phase5-v2-icp.test.js test/phase13-query-planner.test.js test/phase13-mc07-frozen-executor.test.js test/phase13-mc07-current-capacity.test.js test/phase10-tavily-provider-only.test.js test/phase10-provider-account-state.test.js
```

Result: 66 passed, 0 failed, 0 skipped.

After main integration, both actual server endpoint registrations were evaluated in a restricted VM with fake request/response objects and throwing database/provider hooks. Both retain `requireInternalToken`, return HTTP 410 / `RETIRED_SEARCH_PATH`, and invoke zero side effects. The expanded cleanup-specific file passes 6/6 tests (two endpoint checks added after the 66-test run); no production server startup was involved.

Coverage includes registry-driven multilingual frozen planning, all-scope expansion, provider construction, missing-plan fail-closed, capacity pause, no unapproved fallback, free replay, response recovery, ambiguous claim blocking, country conversion, normalization and adapter errors.

Retired tests removed only assertions for the deleted hardcoded strategies/synchronous discovery (including two old optional PostgreSQL discovery tests). Current frozen planner/executor regression remains and six cleanup-specific checks were added. This targeted run does not claim a live provider smoke test or full-repository acceptance.

Maintenance guard: execution services remain stopped, PostgreSQL running, persisted controls untouched. Stop after the user-authorized CL04–CL06 integration; no CL07 work.
