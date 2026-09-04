# Phase 10 WP-U02 Ensure ResearchJob Continuation Result

## Verdict

- WP-U02: PASS
- Isolated PostgreSQL: 8/8 passed, 0 failed, 0 skipped
- Focused auto-evidence unit suite: 31/31 passed, 0 failed, 0 skipped
- Main database business-data changes: 0
- Provider calls caused by U02: 0
- Email side effects: 0

## Implementation

`AutoEvidenceRepository.ensureResearchJob` now performs the real PostgreSQL path inside one transaction:

1. lock the current auto-evidence task;
2. reuse a valid continuation already bound to the task;
3. resolve the canonical continuation by task, checkpoint replay count, resume stage, original job and stable resume execution key;
4. relink an incorrectly bound original job to that existing canonical continuation;
5. create a ResearchJob only when neither a continuation nor the strategy idempotency key already resolves one;
6. update the task binding in the same transaction.

The canonical resolver is exported as `findCanonicalCheckpointContinuation` and is reused by the U03 repair tool.

## Required scenarios

| Scenario | Result |
|---|---|
| First resume creates/gets B | PASS |
| Second resume reuses B | PASS |
| Worker restart reuses B | PASS |
| Concurrent calls converge on B | PASS |
| Correctly bound B stays unchanged | PASS |
| Task incorrectly bound to A while B exists | PASS; relinked to B |
| Existing continuation outbox | PASS; one row |
| Queue/outbox identity duplication | PASS; no new outbox |
| Strategy-attempt delta | 0 |
| Provider-usage delta | 0 |
| Email delta | 0 |
| Original immutable stop reason | preserved; mutation still rejected with `P0001` |
| Confirmed provider credit exhaustion | remains paused without continuation/outbox |
| Current suppression | blocks continuation |

## Test database

- Temporary database: `leadgen_wp_u02_20260904`
- Source: schema-only copy of the current main database
- Result: all eight PostgreSQL cases passed without skips
- Cleanup: temporary database deleted after verification

## Additional regression observation

A broad repository run selected during U02 reported one existing documentation-validator failure: `docs/CURRENT_PROJECT_STATUS.md` records implementation commit `9e4aae3...`, while the frozen branch HEAD is the later result commit `fa9f7fb...`. This is outside the U02 continuation invariant. The focused implementation suite and required isolated PostgreSQL suite both passed.

## Files changed by U02

- `services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js`
- `services/demo-dashboard/test/phase10-budget-resume-postgres.test.js`

No migration, workflow, environment file or main database row was changed.
