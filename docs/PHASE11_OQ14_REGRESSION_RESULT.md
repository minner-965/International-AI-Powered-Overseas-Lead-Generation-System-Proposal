# WP-OQ14 Regression and Safety Audit

Audit date: 2026-09-07. Scope: regression, database isolation, concurrency, replay and release safety. This audit made no SMTP or CRM-provider calls and did not change operational business rows.

## Result

The isolated PostgreSQL regression passed 18 of 18 checks after repairing previously untested database/runtime defects and adding the scoped shared CRM path. Four new provider fault tests passed. This is not a claim that every external-provider crash scenario or the complete Phase 11 acceptance has passed. Final integrated test, browser and export results belong in `PHASE11_RESULT.md`.

## Defects found and resolved

1. `applyInboundCrmEffects` used `ON CONFLICT(effect_key)` without the predicate of the partial unique index. PostgreSQL raised `42P10` whenever the reply effect included a follow-up task. The statement now includes `WHERE effect_key IS NOT NULL`. The real isolated database test first failed, then passed with concurrent and restarted replay.
2. An IMAP `UIDVALIDITY` reset retained the old high UID in the new mailbox checkpoint. A retired UID of 200 incorrectly survived a new mailbox containing UID 5, potentially skipping later messages. Checkpoint calculation now begins within the new UID namespace; an empty new mailbox begins at zero.
3. A CRM outbox item left `PROCESSING` after a worker interruption previously remained there indefinitely. After the bounded processing interval it now enters a reconciliation-required hold, with no new provider claim or attempt. External CRM idempotency is not assumed. This is safe failure handling, not proof of automatic external CRM recovery.
4. A completed IMAP checkpoint mapped its state to ACTIVE but tested for COMPLETED when writing `last_success_at`. The success timestamp now advances on ACTIVE and remains unchanged after a failed synchronization.
5. Connection resets, broken pipes or unknown exceptions after SMTP send initiation could be labeled retryable failure. They now enter ambiguity hold unless pre-DATA failure is explicitly known. The regression injects ECONNRESET, EPIPE and unknown errors without making network calls.

## Executed database checks

Runner: `scripts/phase11-oq14-isolated-regression.mjs`.

| Check | Result |
|---|---|
| Empty isolated database applies migrations 001–057 | PASS |
| Operational migration ledger matches checked-out files | 33 / 33 |
| Replay 049–050 and 052–057 leaves ledger unchanged | PASS |
| Successful IMAP checkpoint records success time; failed sync preserves it | PASS |
| Eight simultaneous identical inbound operations create one row | PASS |
| Same provider Message-ID on a later UID retains inbound identity | PASS |
| Eight simultaneous classification operations create one revision | PASS |
| Concurrent reply effects create one Activity, one task and two distinct outbox operations | PASS |
| New repository instance replays the same effect without duplicates | PASS |
| Eight simultaneous CRM claims grant one worker | PASS |
| Retry reuses outbox identity; completed outbox is not reclaimed | PASS |
| Stale uncertain processing enters reconciliation hold with attempt count unchanged | PASS |
| Temporary database removed and absence verified | PASS |

The first ten runner assertions cover migration replay and persistence/fault handling. Eight additional assertions exercise the 057 shared CRM controlled scope:

- Eight concurrent enqueue operations persist exactly two source-bound outbox identities.
- Opt-out-first execution and eight simultaneous human-effect executions retain a single cancelled historical task with recorded owner and original-receipt-based due date.
- A new repository instance replays synced effects without changing their stored rows.
- Human/opt-out ordering cannot reopen a stopped follow-up.
- Composite foreign keys reject cross-context inbound references; scope checks reject mixed prospect/control records.
- Interrupted local controlled processing resumes atomically once, without external calls.
- Automatic/out-of-office replies create Activities, not positive follow-up tasks.
- Prospect-scope counts remain unchanged; no fake company is created.

The final isolated run completed at `2026-09-07T04:07:57.014Z`. The operational ledger still contained 33 rows at that time; migration 057 was applied only to the temporary test database by this audit. Actual operational migration and existing-message replay are separately recorded in the final result. No fixture was inserted into the operational database. Repository code was copied to separate diagnostic modules for the run, then those modules were removed; the running application's loaded modules were not replaced.

Subsequent independent readback at `2026-09-07T04:09:53.965Z` confirmed the primary agent applied 057 after a database backup: 34 ledger hashes matched deployed migration files, including all 33 prior 024–056 entries. Existing real controlled replies created two shared SYNCED outbox entries, two shared Activities and one cancelled owner/due task, all CONTROLLED-scoped. Prospect-scoped CRM counts remained zero and outgoing message/attempt counts stayed unchanged. The primary agent restarted the actual outreach worker and repeated replay; it created zero new entries and retained the same effect IDs. This closes the previous application CRM/restart gap without additional mail.

New executable provider tests: `services/demo-dashboard/test/phase11-oq14-fault-regression.test.js`.

- UIDVALIDITY reset from old UID 200 to new UID 5 and subsequent UID 6: PASS.
- Empty new mailbox resets checkpoint to zero: PASS.
- Mid-fetch disconnect discards partial results, exposes no advanced cursor, releases lock and logs out: PASS.
- SMTP reset/broken-pipe/unknown post-initiation errors become AMBIGUOUS rather than retryable failure: PASS.

## Coverage boundaries

Existing automated tests cover exact approval binding, disabled send gates, controlled allowlist, stable Message-ID, SMTP timeout ambiguity, unique exact Sent reconciliation, controlled replay and suppression races, automatic replies, structured DSN and category/contact regression. They use adapter/repository fixtures where indicated by their test source; they are not live server-crash experiments.

The earlier full-suite baseline was 843 tests: 789 passed, 54 skipped, zero failed. New faults were deliberately reproduced and fixed after that baseline. The subsequent integrated suite reported 851 tests: 797 passed, 54 skipped, zero failed. During integration the old label and status contracts were updated to the implemented behavior. No `lint` or `build` package script exists in the dashboard package, so neither is represented as an executed script.

Not proven by this audit:

- A process kill immediately after a real SMTP `DATA` acceptance or a real database failure after a send. Existing ambiguous-hold behavior was exercised with fixtures; no additional external email was sent.
- A live external CRM API's exactly-once guarantee. Controlled source events now use shared application CRM entities with explicit CONTROLLED scope. This is real application CRM closure, not a claim of external-vendor delivery or real prospect response.
- A newly paid Phase 10 research canary. Existing Phase 10 tests and recorded historical canaries remain evidence, but no new research task was launched by this audit.
- New provider delivery evidence or a prospect reply. SMTP acceptance alone is not delivery or commercial success.

## Git and sensitive-data checks

- Starting HEAD: `44f5b65753c4d32008c6637684afb2be1da342b1`.
- Migrations 001–051: 51 exact byte comparisons to starting HEAD, zero mismatches. No historical migration was rewritten.
- `scripts/phase11-secret-audit.mjs` scanned 620 tracked and non-ignored candidate files against eight configured sensitive values: zero hits. No non-example environment file is tracked. This exact-value scan is not a mathematical guarantee against every possible unknown secret.
- Local `.env`, `.env.phase2`, `.env.phase7-outreach` and `.env.phase7-api` are ignored.
- Remote was reachable; its active branch matched starting HEAD at audit time. The requested Phase 11 acceptance tag did not exist at audit time. Commit, push and tag are the primary agent's release steps, not actions taken by this audit.

Before push, rerun the sensitive-data audit against the final candidate set. Do not publish a success-named acceptance tag as evidence of unperformed tests.
