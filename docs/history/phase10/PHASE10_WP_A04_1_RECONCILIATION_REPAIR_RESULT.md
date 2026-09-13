# Phase 10 WP-A04.1 Reconciliation Repair Result

## Verdict

- WP-A04.1: PASS
- WP-A04 rerun: PASS
- Boundary: STOP before WP-A05

## Root cause

- Immutable field: `leadgen.research_jobs.stop_reason_code`
- Guard: `leadgen.protect_phase9_research_job_request()` from migration 029
- Failing service/function: `AutoEvidenceRepository.resumeBudgetPaused()` and `autoResumeBudgetPaused()`
- Failing action: the prior implementation updated the historical ResearchJob and set `stop_reason_code=NULL`
- PostgreSQL SQLSTATE: `P0001`

## Chosen design

- Existing checkpoint replay reused: YES (`checkpoint_replay_count`, migration 038)
- New additive migration: `043_phase10_budget_resume_continuation.sql`
- Original ResearchJob mutated: NO
- Continuation model: the long-lived auto-evidence task keeps its strategy/checkpoint identity; each budget-window recovery creates or reuses one new ResearchJob linked by `resumed_from_research_job_id` and one transactional `auto_evidence_resume_outbox` row.
- Stable identity: original ResearchJob + resume stage + checkpoint replay number.
- Current suppression and historical-customer gates are rechecked before continuation creation.

## Repair

- Dry-run before: 4 paused tasks, 4 eligible checkpoints, 4 proposed continuations, 0 historical stop-reason changes.
- Apply: 4 unique continuations and 4 resume outbox rows created in total.
- Legacy classification: 3 older tasks had a persisted `PROVIDER_BUDGET_PAUSED` task checkpoint but no historical Job stop reason; the repair did not invent or alter a historical stop reason.
- Idempotent apply: second completed apply created 0 continuations and 0 outbox rows.
- Continuation links repaired after worker ownership validation: 3 still-paused tasks now point to their continuation; the fourth task advanced to a later strategy/checkpoint and legitimately no longer uses the prior continuation link.

## Runtime evidence

- Workflow ID/name: `dpvPhase10AutoEvidenceReconciliation` / `DPV Phase 10 Auto Evidence Reconciliation`
- Real scheduled execution: 94 at 2026-09-04 10:14:16 +08:00
- Execution result: success
- Heartbeat: HEALTHY at 2026-09-04 10:14:16 +08:00
- Resume outbox: 4 DISPATCHED
- Scheduled runtime P0001 after final deployment: 0
- Demo interval: temporarily 2 minutes for acceptance, restored to 30 minutes and workflow left active.
- Services: PostgreSQL, dashboard, category worker and data worker healthy; n8n active.

## Lineage and idempotency

- Original non-null `TAVILY_CREDIT_CAP` stop reasons retained: 2 before / 2 after.
- Historical stop reasons cleared or overwritten: 0.
- Continuation ResearchJobs: 4.
- Duplicate resume execution keys: 0.
- Duplicate resume outbox rows: 0.
- Second repair apply continuation delta: 0.
- Second repair apply outbox delta: 0.
- Business strategy attempt delta caused by resume dispatch: 0 (PostgreSQL regression assertion).
- Provider request fingerprints created during observed runtime: 6 events / 6 distinct fingerprints; duplicate charge delta: 0.
- Current-day budget may pause a task again; this is an expected new checkpoint and does not reopen the historical Job.

## Tests

- Repository suite: 668 total; 654 passed; 0 failed; 14 pre-existing conditional skips.
- WP-A04.1 PostgreSQL matrix: 6 passed; 0 failed; 0 skipped.
- Covered: immutable trigger, budget still exhausted, unique continuation, replay deduplication, concurrent schedulers, continuation worker ownership, suppression gate and zero provider side effects for blocked work.
- Migration 043 apply: APPLIED.
- Migration 043 replay: SKIPPED_ALREADY_APPLIED.
- Full migration replay 025–043: all SKIPPED_ALREADY_APPLIED with matching checksums.

## WP-A04 rerun

- Queued without dispatch diagnostic: 0.
- Stale running auto-evidence tasks: 0.
- Due research outbox rows: 0.
- Due resume outbox rows: 0.
- Stale active pg-boss jobs: 0.
- Stale provider reservations: 0.
- Budget-paused tasks without checkpoint: 0.
- Latest reconciliation heartbeat: HEALTHY.
- Workflow active: YES.
- Historical pg-boss failures remain as 15 prior `collect-category-buyer-evidence` records from 2026-09-03; no current active/stale failure was found.

## Zero send

- Outreach drafts delta: 0.
- Outbound messages delta: 0.
- Outbound attempts delta: 0.
- Inbound messages delta: 0.
- CRM outbox delta: 0.
- Email provider network calls: 0.
- Gmail/SMTP/OAuth/management approval performed: NO.

## Evidence

- Local evidence directory: `artifacts/phase10-wp-a04-1-20260904-094956`
- Includes pre-fix reproduction, sanitized P0001 record, migration apply/replay, repair dry-run/apply/replay, PostgreSQL matrix, full tests, scheduled execution, heartbeat, database baseline and stale-record checks.

## Git

- Branch: `phase10-recovery-rc1`
- Starting HEAD: `54ce996345c41777c9c5e0d50e6ed170aa66723d`
- Migration 043 SHA-256: `11a2bff129196b36ec04c32b6b4c593000e4bc955ece3d6af13a70b4cd130d14`
- Commit: not created in this work package because the repository already contained a broad pre-existing dirty Phase 10 working tree; the scoped repair is left reviewable without absorbing unrelated changes into one commit.
- Push: not performed.
