# CL15 direct server write HTTP acceptance

2026-09-13. Run `node scripts/cleanup-cl15-server-writes.mjs` from repository root. Actual result: **81 HTTP cases PASS**, zero failed assertions. Detailed case status is retained locally at ignored `artifacts/cl15-server-writes/result.json`.

The runner created its own internal Docker network and PostgreSQL tmpfs database, applied migrations, mounted current source read-only and started an isolated application using fixture-only credentials. No production database, real provider credential, SMTP/IMAP account or published host port was used. Workers were disabled. All fixture containers/network were removed afterward. Application validation fixes are documented below; the fixture runner does not alter production data.

## Exercised behavior

- Missing internal token: HTTP 401 across all 20 direct internal/status write routes identified in current server source. This is actual HTTP middleware execution, not a static authorization assertion.
- Invalid automation input 400; control pause 200; empty reconciliation and dispatch outbox 202.
- Research creation maintenance boundary 503.
- Invalid approval status 400, missing company 404.
- Fixture company approval: approved, repeated approved, rejected, needs_changes, pending all 200. PostgreSQL readback confirmed final `pending:disabled`, including preservation of disabled email status.
- Authenticated retired generation/discovery endpoints 410.
- Internal token controlled-batch escalation rejected 403.
- Research invalid status 400 and missing job 404.
- Scoring, customer match and score replay reject absent scope 400 and accept scoped queue submissions 202; ICP rebuild accepted 202. Workers remain disabled: this certifies HTTP queue submission, not asynchronous score completion.
- Category draft creation 201, duplicate 200, approval 201 and duplicate approval 200. PostgreSQL confirmed exactly two fixture revisions (draft/approved), not four.
- Historical customer import: invalid type 400, valid CSV dry run 201, commit 200, repeated commit 200. PostgreSQL confirmed exactly one imported fixture customer.
- Enrichment creation 202 and replay 200, invalid market 400; category procurement creation 202 and malformed UUID 400. Their webhook dispatch targets a disposable internal HTTP stub returning 202, not live n8n or a search provider.
- Controlled batch missing approval reference 403 and empty eligible cohort 202.
- Cleanup dry-run invalid batch 400 and persisted valid dry-run 201; fixture ICP activation 200.
- Internal enrichment/category execution accepts queue submission 202; workers are disabled. Their invalid statuses return 400 and fixture FAILED updates return 200. Contact checking/company verification on a job with zero candidates returns 200; this is an empty-candidate boundary, not verified contact evidence.

## Limits

The source declares 33 direct write routes. These 81 cases cover 32 identities but do **not** mean all routes have complete business coverage. Live collection is excluded; research creation remains maintenance-blocked, and retired discovery/generation correctly return 410. Enriched worker execution, actual Hunter/contact evidence and nonempty controlled batch execution are not claimed. Scoring/ICP queue acceptance is not asynchronous completion; stub dispatch is not n8n execution. Role-denial permutations remain outside this runner.

Final supplementary cases: research transition to FAILED returns 200 and reverse transition to QUEUED returns 409; heartbeat valid/invalid requests return 202/400; watchdog with no overdue jobs returns 202. Auto-evidence event and reconciliation return 202 with the configured DISABLED outcome (not a claim that enabled scheduling executed). Exa provider-status refresh returns 200 by reading local/persisted state only, with no provider request.

## Defect correction verified

Three newly executed category input cases initially returned 500. CategoryScopeService now assigns explicit codes/statuses for its existing validation failures: empty draft `CATEGORY_SCOPE_FACTS_REQUIRED` returns 400, invalid revision `CATEGORY_SCOPE_REVISION_INVALID` returns 400, and absent draft `CATEGORY_SCOPE_DRAFT_NOT_FOUND` returns 404. The rerun verified all three while existing draft/approval/replay successes stayed green. Database/unexpected errors are not broadly relabeled as input errors.

This report is partial HTTP acceptance evidence and must not be presented as complete route-by-route positive and negative certification.
