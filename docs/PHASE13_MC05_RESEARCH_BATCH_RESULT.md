# Phase 13 V2.1 — MC05 ResearchBatch

Status: PASS (scoped acceptance: isolated database execution and browser verification). Scope: MC05 only; STOP before MC06.

## Checkpoint

Accepted MC04 local working tree preserved in commit `69b55bcb247459b085ca6e784207d6616692eac7` (`checkpoint: accepted MC04 opportunity pool and V3 integration`). The checkpoint contained all 50 changed/new implementation and documentation files. Private environment files, backups and screenshots remain ignored locally. No reset, clean, restore, discard, push or tag was performed.

## Execution plan

1. Preserve checkpoint and read-only database/migration/MC04 fingerprints.
2. Resolve active searchable markets and active approved category scopes from authoritative registries; freeze the resolved selection, buyer types and languages at creation.
3. Implement additive parent Batch and transactionally create/reuse existing single-scope jobs/outboxes, with concurrent duplicate protection.
4. Integrate V3 selection, preview, parent/child navigation and retained form state.
5. Verify isolated real PostgreSQL transactions, browser scenarios and unchanged MC04/provider/mail evidence; apply only the additive migration to the local runtime.
6. Record actual results here and in PHASE13_MC05_UI_RESULT.md, then STOP.

Default collaboration mode is active; this written plan supplies the execution structure. Backend, frontend and independent verification work are delegated in parallel; main agent owns integration and final acceptance.

## Reuse decision

Reuse existing Express, PostgreSQL, native/Tabler V3 form controls, ResearchDirectDispatchService, pg-boss and ResearchJobDirectExecutor. No new package or alternative queue is required. The parent layer must not redefine existing single-scope job semantics or MC04 business rules.

## Results

Backend, database and browser verification: PASS. Browser details and test boundaries are recorded in `PHASE13_MC05_UI_RESULT.md`.

### Registry and frozen scope

- Current database selection: 2 markets (AE, MX), 13 unique active approved category scopes, 26 combinations. BD remains HIDDEN with search disabled.
- Markets are read from `research_market_registry`; categories are read from the current active, approved `dpv_product_category_scope_current` revision. Neither product-master SKUs nor historical customer profiles supply target categories.
- Creation persists immutable `research_scope_snapshot`, including resolved market/category revisions, buyer types, languages and per-scope settings. Later registry changes leave old snapshots untouched.
- Current single-scope execution still uses its frozen `preferred_language`. The complete language list is preserved in the snapshot; expansion into a multi-language query matrix belongs to MC06 and was not implemented.

### Parent and existing pipeline

- Added `ResearchBatchService` and `/api/research/batches` options, preview, create, list and detail routes. Existing authentication, management creation permissions and creation maintenance controls remain enforced.
- Parent creation, children, request aliases and existing ResearchJob/outbox inserts commit in one transaction. New jobs dispatch through existing direct dispatch, pg-boss, worker and checkpoints. Existing active scopes are reused without another enqueue or provider charge.
- The shared single-job creation entry also uses canonical scope dedupe. It retains the existing ResearchJob payload and response contract. Buyer/language/result-limit differences do not cause duplicate active scope execution; reused jobs retain their original execution settings, disclosed separately from requested scope.
- Parent lifecycle updates follow child status changes. Immutable snapshot and request alias protections cover retries and reloads.

### Migration and preservation

- Applied only `059_phase13_research_batches.sql`; SHA-256 `0255ae85545d71e8c59a076c0cb5aaaf1beb3ad6cb3875f48da9dc8fd7ed342e`. Reapplication returns ALREADY_APPLIED.
- All migrations 001–058, MC04 rule fingerprints, opportunity-pool history and distribution remained unchanged.
- Production batch count remains zero: acceptance creates were performed in a restored disposable PostgreSQL database, not the business database. Existing research jobs, provider usage and outbound mail were unchanged. The migration ledger and normal IMAP checkpoint timestamps changed as expected.
- Private local database backup: 9,782,033 bytes, SHA-256 `1d6e979c42f86c21a1c48e49e464343a1fc8b431fd0a228005fa1dc3c103178e`. Backup and evidence remain ignored, outside Git delivery.

### Executed checks

- Isolated PostgreSQL: 19 PASS, including six concurrent duplicate creates, all-scope reuse, old single-job reuse, transaction rollback after a forced child-insert failure, immutable snapshots after registry changes, concurrent child completion, request replay, checkpoint replay and actual pg-boss enqueue with workers off.
- Full dashboard regression: 1,052 tests; 998 PASS, 54 skipped, zero failures. Skipped checks are not represented as passed.
- HTTP router tests cover unauthenticated access, read-only sales access, creator permissions, maintenance mode and idempotency key handling.
- Local dashboard and category worker rebuilt and restarted using existing configuration. No Brave activation, continuous search or email sending was performed.
- Browser: 19 checks passed, covering all required selection combinations, six viewport sizes, reload, Back/Escape focus, browser Back/Forward, error/retry and empty registry. Options and preview use actual local API data; create/detail responses are intercepted browser fixtures. Actual persistence/concurrency is verified separately in isolated PostgreSQL. This does not claim a production search end-to-end run.

### Final runtime audit

After deployment and browser checks: 0 batches, 0 batch children, 461 existing research jobs, 842 provider usage events, 2 outbound records and 276 MC04 decision history rows. Existing job, usage, outbound and MC04 hashes remain identical to the checkpoint baseline.

The final comparison additionally flagged `provider_account_states`. Investigation found only `checked_at`/`updated_at` changed during the existing STARTUP_PROBE account-usage refresh; account status and usage values remained identical. An existing provider metadata GET occurred on application startup, so zero **search** calls and zero emails is the accurate statement, not zero provider HTTP requests of every kind. The raw comparison flag is retained for audit rather than silently ignored.

### Evidence and delivery boundary

Local evidence: `artifacts/phase13-mc04/mc05-baseline-2026-09-08T04-15-17-418Z/isolated-result.json` and `artifacts/phase13-mc04/mc05-baseline-2026-09-08T04-23-07-353Z/comparison.json`.

Final post-deployment audit: `artifacts/phase13-mc04/mc05-baseline-2026-09-08T04-26-34-066Z/`; browser evidence: `artifacts/phase13-mc05/browser/`.

MC05 changes remain in the local working tree after the preserved MC04 checkpoint. No push or tag. STOP at MC05; MC06 is not started.
