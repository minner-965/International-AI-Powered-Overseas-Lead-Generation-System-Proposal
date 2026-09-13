# CL15 route coverage — measured HTTP evidence

Date: 2026-09-13. This is a conservative coverage ledger, not a full route acceptance PASS.

Final evidence spans 157 of 158 unique method/path identities with at least one actual HTTP response. This is **not** 157 fully positive/negative-certified business flows. The sole untouched identity is POST `/api/live/collect`; maintenance, retired, disabled, empty-work and queue-accepted outcomes are distinguished below. Direct server reads: 53 identities / 114 requests; direct writes: 32 identities / 81 requests; router-isolated tests: 82. These sets overlap and must not be summed as unique routes.

CL09 inventories 160 declarations and 158 unique method/path identities. GET `/api/research/jobs` and GET `/api/research/jobs/:id` each have two declarations; this run exercises the research router, not both mounted-server declarations. `/jobs` success is tested with `view=inbox` only.

Initial router-isolated HTTP runs: 82 tests PASS (17 research/CL09 plus 65 Phase7), zero failures/skips, using real Express routers with injected service results and fixture authentication. No SQL/provider/queue side effects. Authentication denial tests validate router middleware wiring and role enforcement with fixture identities, not deployment authentication configuration.

- 72 unique current method/path identities have successful and negative HTTP responses demonstrated (research plus Phase7; service/queue fixtures, not DB end-to-end).
- 2 retired manual-route identities have HTTP 410 demonstrated; both also exercise 401/403 and injected service rejection in Phase7 HTTP tests.
- The initial runs left 84 identities without HTTP evidence. The server/database GET run below extends coverage; use the updated per-route table, not this initial subtotal, for current evidence.
- Full server mounting, side-effecting writes, end-to-end database results, all service error variants and full per-route positive/negative acceptance remain separate evidence requirements.

Command: `node --test test/cleanup-cl15-research-http.test.js test/phase13-research-batch-router.test.js test/cleanup-cl09-api.test.js` from services/demo-dashboard. Additional run: `node --test test/cleanup-cl15-phase7-http-all.test.js` (65 PASS).

Evidence keys: R = new `cleanup-cl15-research-http.test.js`; B = existing `phase13-research-batch-router.test.js`; D = existing `cleanup-cl09-api.test.js`. R provides 200/202, 401 and 403 on ten method/path identities; detail/results also 400 and 404. B adds creation replay 200, idempotency-header forwarding and maintenance 503. D covers draft 200/404 and retired routes. P = `cleanup-cl15-phase7-http-all.test.js`: all 62 Phase7 router declarations and both raw webhook routes execute through Express with injected service/queue outcomes. Download attachment headers and webhook raw Buffer forwarding are asserted. P validates error propagation, not actual database mutation or cryptographic webhook verification. Workspace contact queue is unguarded in this router and has no claimed auth check.

W = `scripts/cleanup-cl15-server-writes.mjs`: 81 actual HTTP requests against the mounted current server and a separate disposable PostgreSQL, all expected responses passed. It covers 32 normalized method/path identities. Positive approval/category/import cases include persistence and replay checks. Scoring/match/replay/ICP 202 means queue acceptance, not worker completion. Twenty internal/status routes have 401 evidence; no positive success is inferred from that denial. Category empty/invalid-revision/missing-draft regressions now return 400/400/404 after a typed validation-error fix. No external provider or production database was used. Detailed evidence: CL15_SERVER_WRITES_HTTP_ACCEPTANCE.md. Rows below combine evidence sources without claiming all business branches.

| Method/path | Positive HTTP | Negative HTTP | Evidence / limitation |
| --- | --- | --- | --- |
| POST /api/auto-evidence/controlled-batch | 202 | 403 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/auto-evidence/exceptions | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/auto-evidence/summary | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/auto-evidence/tasks | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/automation/control | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| PUT /api/automation/control | 200 | 400 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/automation/reconcile | 202 | Not demonstrated | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/automation/status | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/category-procurement/jobs | 202 | 400 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/category-procurement/jobs/:id | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/category-procurement/jobs/:id/results | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/category-scopes/candidates | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/category-scopes/current | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/category-scopes/revisions | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/category-scopes/revisions | 200, 201 | 400 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/category-scopes/revisions/:id/approve | 200, 201 | 404 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/companies/:id/buyer-business-model | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/category-procurement-matches | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/commercial-product-fit | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/cooperation-feasibility | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/crm-history | 200, populated isolated PostgreSQL fixture | 400, 404 | S: full mounted server + disposable PostgreSQL; actual stored frozen plan/verification/CRM fixture; earlier missing-evidence responses retained as negative evidence |
| GET /api/companies/:id/customer-match | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/customer-match-history | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/lifecycle-history | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/product-opportunities | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/score | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/companies/:id/score-history | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/contact-queue | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/contacts/:id/hunter-verify | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/contacts/:id/verification-history | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/crm-history | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/crm-history/:id | 200, populated isolated PostgreSQL fixture | 400, 404 | S: full mounted server + disposable PostgreSQL; actual stored frozen plan/verification/CRM fixture; earlier missing-evidence responses retained as negative evidence |
| GET /api/crm-history/import-summary | 200, populated isolated PostgreSQL fixture | 404 | S: full mounted server + disposable PostgreSQL; actual stored frozen plan/verification/CRM fixture; earlier missing-evidence responses retained as negative evidence |
| POST /api/crm-sync-outbox | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/crm-sync-outbox/:id | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/crm-sync-outbox/:id/process | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/data-exports | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/data-exports/:id | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/data-exports/:id/download | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/data-imports/:id | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/data-imports/:id/approve | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/data-imports/:id/commit | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/data-imports/:id/error-report | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/data-imports/:id/rows | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/data-imports/:id/submit | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/data-imports/dry-run | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/data-imports/templates/:type | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/enrichment/jobs | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/enrichment/jobs | 200, 202 | 400 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/enrichment/jobs/:id | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/enrichment/jobs/:id/results | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/export/leads | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/health | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/icp/profiles | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/icp/profiles/:id | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/import-batches | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/internal/auto-evidence/events | 202 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/auto-evidence/reconcile | 202 | 401, 403 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/category-procurement/jobs/:id/run | 202 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| PATCH /api/internal/category-procurement/jobs/:id/status | 200 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/customer-match/recalculate | 202 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/internal/data-cleanup/batches/:batchId | 200, isolated PostgreSQL fixture/current-list | 401, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/internal/data-cleanup/dry-run | 201 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/enrichment/jobs/:id/run | 202 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| PATCH /api/internal/enrichment/jobs/:id/status | 200 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/icp/profiles/:id/activate | 200 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/icp/rebuild | 202 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/orchestrator/heartbeat | 202 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/orchestrator/watchdog | 202 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/internal/phase5/diagnostics | 200, isolated PostgreSQL fixture/current-list | 401 | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/internal/phase7/orchestrate | Expected 200/201/202 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/internal/research/direct-dispatch/reconcile | 202 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/research/jobs/:id/check-contacts | 200 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/research/jobs/:id/discover | Not demonstrated | 401, 410 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/research/jobs/:id/generate-queries | Not demonstrated | 401, 410 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/research/jobs/:id/verify-companies | 200 | 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/scoring/recalculate | 202 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/internal/scoring/replay | 202 | 400, 401 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/leads | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/leads/:id | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| PATCH /api/leads/:id/approval | 200 | 400, 404 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/leads/:id/contact-routes | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/leads/:id/decision-makers | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/live/collect | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/manual-official-routes | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/manual-official-routes/:id/actions | 410 retired boundary | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/manual-official-routes/reconcile | 410 retired boundary | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/markets | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/metrics | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/opportunities | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/opportunities/:id/decision-history | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/opportunities/:id/hold | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/opportunities/:id/management-approve | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/opportunities/:id/reopen | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/opportunities/:id/request-evidence | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/opportunity-pool/summary | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/orchestrator/status | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/outreach/controlled-tests | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/controlled-tests/:id | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests/:id/crm-replay | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests/:id/drafts | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests/:id/drafts/:draftId/approve | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests/:id/drafts/:draftId/enqueue | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests/:id/management-approve | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/controlled-tests/inbound-sync | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/controlled-tests/runtime | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/drafts | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/drafts/:id | 200 | 422 injected service/queue error, 401, 404 (D) | P + D; real router HTTP, injected dependencies only |
| PATCH /api/outreach/drafts/:id | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/drafts/:id/approve | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/drafts/:id/reject | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/drafts/:id/submit | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/drafts/:id/supersede | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/gmail/health | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/gmail/health-check | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/gmail/inbound-sync | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/inbound-sync | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/inbox | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/marketing-context | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/marketing-context/:id/approve | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/marketing-context/versions | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/messages/:id | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/messages/:id/enqueue | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/messages/:id/events | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/messages/:id/retry-before-provider | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/operations-summary | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/smtp/health | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/smtp/health-check | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/threads/:id | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| GET /api/outreach/workbench | 200 | 422 injected service/queue error, 401 | P; real router HTTP, injected dependencies only |
| POST /api/outreach/workbench/:companyId/prepare | Expected 200/201/202 | 422 injected service/queue error, 401, 403 | P; real router HTTP, injected dependencies only |
| GET /api/reference-data/imports/:id | 200, isolated PostgreSQL fixture/current-list | 400, 401, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/reference-data/imports/:id/commit | 200 | Not demonstrated | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| POST /api/reference-data/imports/dry-run | 201 | 400 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/research/batches | 200 | 401, 403 | R + B |
| POST /api/research/batches | 202; replay 200 | 401, 403 | R + B |
| GET /api/research/batches/:id | 200 | 401, 403 | R + B |
| GET /api/research/batches/options | 200 | 401, 403 | R + B |
| POST /api/research/batches/preview | 200 | 401, 403 | R + B |
| GET /api/research/candidates/:candidateId/contacts | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/research/candidates/:candidateId/verification | 200, populated isolated PostgreSQL fixture | 400, 404 | S: full mounted server + disposable PostgreSQL; actual stored frozen plan/verification/CRM fixture; earlier missing-evidence responses retained as negative evidence |
| GET /api/research/jobs | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response; prior: R; research-router branch only |
| POST /api/research/jobs | Not demonstrated | 503 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/research/jobs/:id | 200, isolated PostgreSQL fixture/current-list | 400, 404 | S: full mounted server + disposable PostgreSQL; actual database response; prior: R; research-router branch only |
| GET /api/research/jobs/:id/candidates | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/research/jobs/:id/queries | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/research/jobs/:id/results | 200 | 401, 403, 400, 404 | R; research-router branch only |
| GET /api/research/jobs/:id/search-plan | 200, populated isolated PostgreSQL fixture | 400, 404, 422 | S: full mounted server + disposable PostgreSQL; actual stored frozen plan/verification/CRM fixture; earlier missing-evidence responses retained as negative evidence |
| PATCH /api/research/jobs/:id/status | 200 | 400, 401, 404, 409 | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/research/jobs/:id/verifications | 200, isolated PostgreSQL fixture/current-list | 400 | S: full mounted server + disposable PostgreSQL; actual database response |
| GET /api/research/provider-status | 200, isolated PostgreSQL fixture/current-list | No applicable denial case in this run | S: full mounted server + disposable PostgreSQL; actual database response |
| POST /api/research/provider-status/refresh | 200 | Not demonstrated | W: fixture server/DB; queue, disabled or empty-work boundaries specified in write report |
| GET /api/research/tasks | 200 | 401, 403 | R; research-router branch only |
| GET /api/research/workbench-summary | 200 | 401, 403 | R; research-router branch only |
| POST /api/webhooks/email/corporate | 202 | 422 injected service/queue error | P; real router HTTP, injected dependencies only |
| POST /api/webhooks/email/resend | 202 | 422 injected service/queue error | P; real router HTTP, injected dependencies only |
| GET /api/workspace/contact-queue | 200 | 422 injected service/queue error | P; real router HTTP, injected dependencies only |

## Full-server GET supplement

S = scripts/cleanup-cl15-server-get-cases.mjs through cleanup-cl15-runtime.mjs. Actual: 53 GET identities, 114 HTTP requests, 53 identities with HTTP 200 on fixture/current-list requests, 0 HTTP 5xx. Missing-record responses are negative evidence, even when a collection returns an empty HTTP 200. Internal routes were also tested without the fixture token. The 12 malformed-ID failures found earlier were fixed by the coordinator and now return 400; batchId remains a text key. No external service was reachable; production data was not used. Router-mounted duplicate research jobs routes retain the initial dispatch limitation. Raw webhooks belong to Phase7 evidence P, not this GET supplement.
