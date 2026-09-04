# Phase 10 WP-U11 Database Compatibility and Historical Read Result

## Verdict

- WP-U11: PASS
- Applied migrations edited: 0
- Historical rows rewritten/deleted: 0
- Destructive schema changes: 0

## Compatibility decision

The historical `budget_state`, `max_attempts`, `cooldown_until`, legacy provider summary columns, provider credit ledger, and old status values remain in the schema. They have historical/audit and reconstruction references, so the U11 DROP preconditions are not met. Current production code no longer writes or uses them as provider truth.

Current state is projected from:

- canonical continuation identity;
- latest append-only decisions/tasks;
- `provider_account_states`;
- `provider_usage_events` and its ResearchJob/company projections;
- direct dispatch outbox state.

Historical `BUDGET_PAUSED` values are read-only compatibility facts and are labelled historical in the UI. They do not control provider capacity or current continuation execution.

## Evidence

- Migrations 001-045 Git diff: 0 files.
- Duplicate continuation execution keys: 0.
- Orphan ResearchJob dispatch outbox rows: 0.
- Current `BUDGET_PAUSED` tasks: 0.
- Main provider state: AVAILABLE.
- Current Tavily internal ledger ceilings: 0.

