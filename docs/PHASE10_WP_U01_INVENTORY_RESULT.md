# Phase 10 WP-U01 Inventory Result

## Verdict

- WP-U01: PASS (inventory completed)
- Deletions performed: 0
- Business-code edits: 0
- Database mutations: 0
- Migration edits: 0
- Workflow edits: 0
- Tavily/Hunter/email calls: 0

Full classified evidence: `docs/PHASE10_INTERNAL_LIMIT_AND_LEGACY_INVENTORY.md`.

## Planned removal in later authorized work packages

### Configuration

- Seven advertised internal Tavily/max-attempt/cooldown keys in `.env.example`.
- Dormant internal-cap parsing and server wiring.
- Old-policy test configuration and CI fixtures that activate those limits.

### Functions and branches

- Run/daily/purpose/company/profile/billing limit checks inside `TavilyCreditBudget`.
- Internal credit reservation balance as an enforcement gate; usage-event audit and fingerprint replay remain.
- Budget-window eligibility/reset branches in auto-evidence reconciliation.
- Fixed numeric max-attempt and time-based cooldown blocking branches.
- Duplicate ResearchJob summary-counter writes after canonical ledger consumers are verified.

### Rules and tests

- Old internal daily/per-company/per-run cap expectations.
- “10 attempts exhausted” and “7-day cooldown blocks work” expectations.
- Internal daily-window pause/resume expectations.
- Replacement coverage must prove provider-native credit state, Retry-After, distinct-strategy exhaustion, dedupe and immutable continuation behavior.

### UI

- DPV internal daily/remaining/purpose/company budget presentation.
- Budget reset time and internal budget resume affordances.
- Ordinary exact-SKU/catalog-maintenance exposure already superseded by category scope.
- Provider status, last check, rate-limit-until and true credit exhaustion remain.

### File-level candidates

- `scripts/repair-phase10-budget-paused-continuations.mjs`, after U03/U04 replacement and preserved evidence.
- Old-policy-only test files may be removed only as part of equal-or-stronger replacement coverage.
- No production file is approved for physical deletion at U01.

## Required retention

- All applied migrations, especially 039, 043, 044 and 045.
- `provider_usage_events` and provider account transition audit.
- Query/request fingerprints, execution keys and persisted result replay.
- Transactional ResearchJob outbox, pg-boss singleton behavior, locks, leases and stale recovery.
- Checkpoint replay and canonical continuation lineage.
- Provider 429 Retry-After, account-credit exhaustion, auth/config and temporary-failure handling.
- Historical stop reasons, task events, cohorts and decision revisions.
- Gmail provider code, approvals, suppression and outbound gates, all remaining closed.

## Items requiring later proof

1. n8n Research webhook fallback: still referenced by server and an active workflow; resolve before U10-C deletion.
2. Whole-file removal of legacy product opportunity code: production imports/UI/tests remain; separate historical projection first.
3. Database drops for `provider_credit_ledger` or historical budget/cooldown/max-attempt columns: runtime and audit references remain; U11 proof is required.

## Stop line

WP-U00 and WP-U01 are complete. The next allowed package is WP-U02. No U02 implementation, repair, deletion or provider call was started.
