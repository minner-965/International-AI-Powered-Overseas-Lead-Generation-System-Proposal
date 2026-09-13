# CL15 backend acceptance

Date: 2026-09-13. Scope: isolated PostgreSQL and injected provider fixtures; no production execution service startup, paid search, Hunter, SMTP, IMAP or external CRM request.

## Executed results

| Verification | Actual result |
| --- | --- |
| Maintenance guard | PASS; execution containers stopped, PostgreSQL running |
| Empty PostgreSQL rebuild | PASS; migrations 001–063 applied in fresh disposable database |
| Production migration checksum comparison | PASS; 39 tracked ledger entries match source bytes |
| Migration replay | PASS; 049–050 and 052–063 skipped as already applied; ledger unchanged |
| IMAP/reply/CRM database cases | 18 PASS; UID/Message-ID dedupe, concurrent classification, outbox claims, retry/restart reconciliation, controlled/prospect scope isolation, opt-out cancellation, OOO and automatic-reply task exclusion |
| Search ledger database cases | 5 PASS; concurrent unique claim, restart replay, page/language identity, provider retry accounting, ResearchJob FK |
| Enabled PostgreSQL test suites | 46 PASS, 0 FAIL, 0 SKIP; empty research purge safeguards, provider capacity continuation, usage/replay, retired-limit migration replay, shared-history import idempotency |
| Disposable database cleanup | PASS; each created database dropped and absence verified |
| Current opportunity SELECT projection | PASS; 153 companies, 37 active; PRECISION 4, RELEVANT 2, GENERAL_RELEVANT 31, EXPLORATORY 108, NOT_SUITABLE 8; retired filters nonblocking; zero writes |

Run: `node scripts/cleanup-cl15-backend-runner.mjs`. Detailed local evidence is in ignored `artifacts/cleanup-cl15-backend/`: three harness logs and `result.json`. The runner mounts current source/tests read-only into a short-lived test container; it does not restart the operational dashboard/workers. PostgreSQL credentials are passed through process environment, never printed.

## Defects found and corrected

Activating formerly skipped database tests initially produced 45 failures. Root causes were test setup drift, not a production schema change:

1. Three Phase 10 fixture builders omitted `target_category_scope_key` and `target_category_code`, required since migration 048. Fixtures now supply their explicit WOMENSWEAR profile scope.
2. A newly rebuilt application database has no pg-boss schema until pg-boss starts. The isolated runner initializes and stops pg-boss before queue-related tests.
3. The migration 047 test expected first application even on a fully rebuilt latest-schema database. It now checks the existing ledger and validates the correct first-apply or replay outcome.

All 46 database tests then passed. Applied migration files and production schema/data were not changed.

## Fixture coverage and limitations

The complete ordinary Node suite was also executed: 1,161 tests, 1,105 PASS, 54 SKIP and two current-status-document failures while the parent task was updating phase boundaries. Final regenerated-document suite results belong in the consolidated CL15 result; this interim count is not a final PASS claim.

Passing ordinary fixture tests cover frozen query execution/capacity/resume/domain policy/corroboration, contact extraction and Hunter outcomes, first-touch A/B/C templates and Simon identity, SMTP accepted/ambiguous/hard-failure/dedupe, reply classification and exports. These are injected service tests, not evidence of live provider delivery.

This backend report does not claim full per-route positive/negative HTTP coverage, every operational worker restart, n8n import/health, browser screenshots, or actual production restoration. Those checks require the parent task's separate runtime/browser/release evidence. A full CL15 PASS must include those results rather than treating this report or `npm test` as a substitute.
