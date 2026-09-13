# DPV Phase 10 Stale Task Classification Result

## Result

`WP-A15 = PASS`

Validated on 2026-09-04 against the deployed PostgreSQL, pg-boss workers and n8n reconciliation workflow.

## Required health states

The runtime contract now distinguishes `HEALTHY_LONG_RUNNING`, `STALE_LEASE`, `PROVIDER_WAIT`, `CHECKPOINT_RECOVERABLE`, `PROJECTION_DRIFT`, `NON_RETRYABLE_INPUT_ERROR`, `ORPHAN_DISPATCH` and `AMBIGUOUS_LINEAGE`. Automatic actions are respectively observe, create a unique continuation, delayed retry, resume from checkpoint, rebuild projection, terminalize without retry, restore/purge an empty orphan, and alert/hold ambiguous ownership.

Mandatory alerts cover a stage without heartbeat, repeated non-retryable outbox errors, queued/dispatched work without an outbox, two active continuations and Provider use without ledger evidence.

## Ten historical stalled tasks

The ten WP-A04 tasks were all `STALE_RECOVERABLE_CONTINUATION`. Each resumed from its unique S05 checkpoint and ended as `EVIDENCE_EXHAUSTED`; none was deleted and their Provider/business lineage was retained. The per-task IDs and actions remain recorded in `PHASE10_WP_A04_CATEGORY_DRIVEN_AUTOMATION_CONVERGENCE_RESULT.md`.

## Projection drift found during A15

Browser and database inspection found four old `CATEGORY_PROCUREMENT_ENRICHMENT` ResearchJob projections that had remained active since 2026-09-02 although no live pg-boss owner existed. Three were linked to already-terminal tasks; one retained category evidence and an old Provider error. Their downstream companies already had current business decisions:

| ResearchJob | Rebuilt terminal projection | Downstream business result |
|---|---|---|
| `14e68227-5be9-4588-b52e-95172a536e4a` | `PARTIAL / STALE_JOB_PROJECTION_RECONCILED` | Alanic Clothing `NOT_SUITABLE`; ELK Fashion Dubai `EVIDENCE_REQUIRED` |
| `0f292a77-db1c-4437-8148-69b7cb81ff0c` | `PARTIAL / DUPLICATE_TASK_PROJECTION_RECONCILED` | ELK Fashion Dubai `EVIDENCE_REQUIRED` |
| `605008dd-e442-4320-9447-ae8fbae6c208` | `PARTIAL / DUPLICATE_TASK_PROJECTION_RECONCILED` | ELK Fashion Dubai `EVIDENCE_REQUIRED` |
| `5c65bc38-270e-4852-8569-043d2bb7995f` | `PARTIAL / EVIDENCE_EXHAUSTED` | ELK Fashion Dubai `EVIDENCE_REQUIRED` |

This was an automation defect, not a successful long-running state. Reconciliation now detects the same queue-free, terminal-task-backed projection drift and closes it automatically. The normal category executor already completes modern jobs at the final category-match stage.

## Live convergence proof

- first A15 reconciliation: 8 fairness continuations resumed, 2 new tasks scheduled, 0 errors
- projection-repair reconciliation: 4 projections rebuilt, 7 fairness continuations resumed, 3 new tasks scheduled, 0 errors
- final active ResearchJobs: 0
- expired `RUNNING` auto-evidence tasks: 0
- orphan dispatches: 0
- duplicate active continuations: 0
- Provider ledger/projection drift: 0
- `RETRY_SCHEDULED` tasks are healthy next-strategy work owned by the 30-minute reconciliation schedule, not abandoned running work

## Data preservation

- empty ResearchJobs deleted under immutable purge policy: 8
- auto-evidence tasks deleted: 0
- ten historical stalled tasks retained: 10
- tasks with Provider or business output deleted: 0
- current Opportunities retained: 20
