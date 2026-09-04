# Phase 10 WP-A04.2 Provider-Only Unlimited Research Result

## Verdict

- WP-A04.2: PASS
- WP-A04 overall: PASS

## User policy implemented

- Local research job count limits: disabled
- Local Tavily credit budgets: disabled
- Provider account credit exhaustion gate: enabled
- Rate-limit retry: enabled

The application accepts valid research work without daily, total, per-job, per-run, company/profile, purpose-pool, global or billing-window quantity budgets. This does not remove exact duplicate protection, query fingerprints, singleton execution, queue backpressure or bounded worker concurrency.

## Enforcement inventory

| Former control | Previous active locations | Current behavior |
|---|---|---|
| Daily/run/job Tavily units | auto-evidence config, Tavily ledger reservation | Compatibility keys ignored in `PROVIDER_ACCOUNT_ONLY`; no create/run rejection |
| Discovery/evidence purpose pool | Tavily budget pool accounting | Usage purpose remains audited; no cap enforcement |
| Company/profile cycle | candidate scheduling and usage reservation | No numeric or cooldown rejection; exact revision execution still deduplicates |
| Global/billing window | provider credit ledger | Historical usage retained; Tavily local `credit_limit_units` is null |
| Numeric max attempts | strategy scheduler | Environment value ignored; completion is versioned distinct-strategy exhaustion |
| Company cooldown | candidate selection/schedule | No blocking effect; new evidence revision can schedule immediately |
| Batch size | reconciliation scan | Retained as queue/backpressure batch size, not a lifetime/daily rejection |
| Worker concurrency | pg-boss queue configuration | Retained and bounded |

## Continuation ownership

- Incorrect links before: 0 of 4 examined (WP-A04.1 had already repaired them)
- Links repaired in WP-A04.2 repair script: 0
- Incorrect links after: 0
- `ensureResearchJob` repeated-call result: same continuation ID
- Concurrent-call result: one continuation and one dispatch outbox
- Old stop reasons mutated: 0

## Previously local-budget-paused tasks

- Count: 4
- Repair strategy-attempt delta: 0
- Repair Provider-call delta: 0
- Runtime result: all four left erroneous `BUDGET_PAUSED`; continuation replay used preserved checkpoints and then resumed the versioned strategy flow
- Runtime defect repaired: canonical continuation reuse now uses a fresh checkpoint replay identity, preventing replay of a historical settled pause

## Removed enforcement paths

- Daily: disabled
- Per run: disabled
- Per job: disabled
- Company/profile: disabled
- Purpose pool: disabled
- Global/billing: disabled
- Numeric attempts: disabled as a scheduling gate
- Cooldown: disabled as a scheduling gate

## Provider state handling

- 429: `RATE_LIMITED`, honors `Retry-After`, creation remains allowed
- 432/plan limit: `CREDIT_EXHAUSTED`, new provider-dependent jobs return `created=false`
- PAYGO limit: `CREDIT_EXHAUSTED`
- 401/403 or missing credential: `AUTH_ERROR`, distinct from credit exhaustion
- 5xx/timeout: `DEGRADED`/temporary retry, creation remains allowed
- Usage endpoint refresh: startup plus at most once per ten minutes per unchanged credential; management refresh is available
- Worker isolation: non-search workers without a Tavily key do not overwrite the shared account state

## Tests

- Isolated PostgreSQL continuation suite: 7/7 PASS
- Isolated migration apply/replay suite: 22/22 PASS
- Provider-state/infrastructure focused suite: 17/17 PASS
- Auto-evidence/strategy focused suite: 40/40 PASS
- Full local suite: 681 total, 666 passed, 0 failed, 15 environment-scoped skips
- Stub unlimited queue: 100 unique tasks accepted, 0 local quota rejection
- Migration 045 apply: PASS
- Migration 045 replay: `SKIPPED_ALREADY_APPLIED`
- Phase 9 immutable stop-reason trigger: still returns `P0001` on mutation attempt

## Runtime

- Provider policy: `PROVIDER_ACCOUNT_ONLY`
- Provider state: `AVAILABLE`
- Local Tavily ledger limit: null; historical usage preserved
- Research canary ID: `bfb18f20-d726-4c15-9405-c5f7efaf7a7f`
- Canary final status: `COMPLETED`
- Canary Provider result: 5 audited calls / 5 used units
- Local budget pause observed in canary: no
- Previously paused tasks remaining in `BUDGET_PAUSED`: 0
- n8n heartbeat: `HEALTHY` at 2026-09-04 11:00:16 +08:00
- Worker restart: PASS; ownership did not regress
- Duplicate Provider request fingerprints after restart: 0
- P0001 runtime errors after repair: 0

## Zero-email proof

- Draft delta: 0
- Outbound delta: 0
- Attempt delta: 0
- Email webhook delta: 0
- Inbound delta: 0
- CRM delta: 0
- Gmail calls: 0

All outbound providers and Gmail automation remained closed during this work package.

## Git

- Branch: `phase10-recovery-rc1`
- Ownership repair commit: `acbdb5cce3eb07e69dbe7a619bf28174d303fa42`
- Provider-only implementation commit: `9e4aae3c2c3c5f73402ed5896bf21bbfdb5a37f5`
- Documentation evidence commit: `98a95717224c1471c46f3aa7420c70a434785c23`
- Remote verification: performed after the result commit; the verified remote HEAD is reported in the final handoff
- Tag: none; no final Phase 10 tag was created
