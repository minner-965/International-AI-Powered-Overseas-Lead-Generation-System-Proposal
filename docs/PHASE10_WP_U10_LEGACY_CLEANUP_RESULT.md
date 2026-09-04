# Phase 10 WP-U10 Legacy Cleanup Result

## Verdict

- WP-U10: PASS
- Scope: proven dead/superseded runtime paths only
- Email sends/provider calls caused by cleanup: 0

## Removed

- Mandatory n8n ResearchJob webhook workflow and `workflows/01-two-week-demo.json`.
- `N8N_RESEARCH_WEBHOOK_URL`, `N8N_RESEARCH_WORKFLOW_ACTIVE`, and `RESEARCH_DIRECT_QUEUE_DISPATCH` runtime/config branches.
- The superseded internal-budget repair script `scripts/repair-phase10-budget-paused-continuations.mjs`.
- Duplicate writes to `research_jobs.search_*`, `social_search_*`, and Hunter summary counters.
- UI/API fallback reads that treated legacy ResearchJob counters as current provider truth.
- The fixed social-search-per-job cap; each distinct Tavily request is now ledgered and deduplicated.
- Current-facing budget labels/fields; retained `BUDGET_PAUSED` is explicitly marked historical.

## Canonical paths after cleanup

- ResearchJob creation: transactionally insert ResearchJob + dispatch outbox, then direct pg-boss.
- Recovery: direct outbox reconciliation and pg-boss singleton identity.
- n8n: periodic reconciliation and reviewed non-ResearchJob orchestration only.
- Provider usage truth: `provider_usage_events` -> canonical projections -> API/UI/export.

## Retained after dependency proof

- Exact-SKU/catalog fields and product master remain for historical read compatibility and import/audit reconstruction; no current opportunity gate or catalog-maintenance task depends on them.
- Existing CSS/JS assets remain because current HTML and contract tests still reference them; no unreferenced bundle was proven safe to delete.
- Historical reports/migrations remain immutable. Active runbooks were corrected instead of deleting audit history.

## Validation

- Direct dispatch/orchestrator/provider projection/server contracts: 28/28 PASS, 0 skipped.
- Active source/config scan for retired dispatch flags and duplicate counter writes: 0 matches.
- Live n8n workflow state: `dpvPhase1TwoWeekDemo=false`; `dpvPhase10AutoEvidenceReconciliation=true`.

