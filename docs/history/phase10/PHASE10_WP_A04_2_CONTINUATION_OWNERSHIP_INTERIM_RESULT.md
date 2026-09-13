# Phase 10 WP-A04.2 Continuation Ownership Interim Result

## Verdict

- Isolated PostgreSQL continuation tests: PASS
- Main database ownership dry-run: PASS
- Old immutable stop reasons changed: 0
- Repair-time Provider calls, strategy attempts and email side effects: 0

## Main database diagnosis

The diagnostic examined the four previously reported `BUDGET_PAUSED` tasks. At this work package's before snapshot, all four canonical ownership links had already been repaired by WP-A04.1, so the factual result was:

| Check | Result |
|---|---:|
| Task links examined | 4 |
| Incorrect links before WP-A04.2 | 0 |
| Links repaired by WP-A04.2 | 0 |
| Incorrect links after | 0 |
| Old stop reasons mutated | 0 |
| Strategy-attempt delta during repair | 0 |
| Provider-call delta during repair | 0 |
| Email side-effect delta during repair | 0 |

The apply script was run even with an empty repair set and returned an idempotent zero-change result. A second dry-run again returned zero incorrect links.

## Runtime defect found and repaired

The first real reconciliation revealed a separate continuation-runtime defect: tasks that already pointed at a queued continuation were treated as if that continuation were the stopped original job. That produced `AUTO_EVIDENCE_RESUME_STOP_REASON_REQUIRED`. A second replay could also collide with the historical `(task_id, checkpoint_replay_count)` outbox identity.

The repository now:

1. recognizes the linked queued/active continuation as canonical;
2. reuses the same continuation and outbox identity;
3. assigns a fresh checkpoint replay number so a historical settled `BUDGET_PAUSED` stage is not replayed as the current outcome;
4. allocates the next free checkpoint identity when older resume lineage already exists;
5. leaves the original job's immutable stop reason and audit history unchanged.

## Evidence

- Repeated `ensureResearchJob` calls returned one continuation ID.
- Concurrent resume schedulers produced one continuation and one outbox.
- Reusing a queued continuation produced no additional ResearchJob.
- Worker restart left ownership intact and duplicate Provider request fingerprints at zero.
