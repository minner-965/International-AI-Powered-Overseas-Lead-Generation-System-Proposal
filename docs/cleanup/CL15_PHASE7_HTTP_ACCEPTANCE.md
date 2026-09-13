# CL15 Phase 7 HTTP acceptance

Date: 2026-09-13.

Actual run: **65 tests, 65 PASS, 0 FAIL, 0 SKIP** using `node --test test/cleanup-cl15-phase7-http-all.test.js`.

Coverage: all 62 method/path declarations registered by `createPhase7Router`, plus both raw webhook declarations (resend and corporate): **64 unique method/path identities**. Two manual write boundaries retain fixture 410 responses; the separate CL09 tests exercise their actual retired service behavior. No source-reference-only declaration is counted as an HTTP pass: the source inventory constructs cases, each case then sends real localhost HTTP requests through the actual Express router and asserts response status and dependency invocation.

For every router route, a positive expected HTTP status (200/201/202, or retired 410) and a forced service/queue 422 are exercised. Authenticated routes additionally reject missing identity with 401 before dependency invocation; write routes reject an unauthorized role with 403. Internal orchestration checks its internal token. Workspace contact queue intentionally has no auth middleware in this router; it is tested for success/error only and is not falsely reported as an authenticated route. Downloads assert attachment headers. Webhooks exercise provider name and raw Buffer forwarding and service error propagation; signatures are injected service outcomes, not cryptographic signature verification.

Fixtures return JSON records/lists, download bytes and queue identifiers according to the router's consumed contracts. The tests do not claim database persistence, external send acceptance, Hunter validity or import file correctness. Those are covered by separate service/isolated database tests. Zero providers, SQL or real queue workers are invoked.

| Method/path | HTTP evidence |
| --- | --- |
| GET /api/workspace/contact-queue | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/opportunities/:id/decision-history | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/opportunities/:id/management-approve | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/opportunities/:id/hold | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/opportunities/:id/request-evidence | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/opportunities/:id/reopen | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/contact-queue | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/manual-official-routes | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/manual-official-routes/reconcile | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/manual-official-routes/:id/actions | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/marketing-context | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/workbench | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/operations-summary | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/workbench/:companyId/prepare | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/gmail/health | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/gmail/health-check | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/smtp/health | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/smtp/health-check | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/gmail/inbound-sync | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/inbound-sync | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/controlled-tests | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/controlled-tests/runtime | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/controlled-tests/:id | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests/:id/crm-replay | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests/:id/management-approve | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests/:id/drafts | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests/:id/drafts/:draftId/approve | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests/:id/drafts/:draftId/enqueue | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/controlled-tests/inbound-sync | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/marketing-context/versions | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/marketing-context/:id/approve | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/contacts/:id/hunter-verify | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/contacts/:id/verification-history | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/drafts | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/drafts/:id | Success/retired boundary + injected service error; actual Express HTTP |
| PATCH /api/outreach/drafts/:id | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/drafts/:id/submit | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/drafts/:id/approve | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/drafts/:id/reject | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/drafts/:id/supersede | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/messages/:id/enqueue | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/outreach/messages/:id/retry-before-provider | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/messages/:id | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/messages/:id/events | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/threads/:id | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/outreach/inbox | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/crm-sync-outbox | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/crm-sync-outbox/:id | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/crm-sync-outbox/:id/process | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/data-imports/templates/:type | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/data-imports/dry-run | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/data-imports/:id | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/data-imports/:id/rows | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/data-imports/:id/submit | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/data-imports/:id/approve | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/data-imports/:id/commit | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/data-imports/:id/error-report | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/data-exports | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/data-exports/:id | Success/retired boundary + injected service error; actual Express HTTP |
| GET /api/data-exports/:id/download | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/internal/phase7/orchestrate | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/webhooks/email/resend | Success/retired boundary + injected service error; actual Express HTTP |
| POST /api/webhooks/email/corporate | Success/retired boundary + injected service error; actual Express HTTP |
