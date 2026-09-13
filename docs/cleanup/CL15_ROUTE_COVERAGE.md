# CL15 route coverage — measured HTTP evidence

Date: 2026-09-13. This is a conservative coverage ledger, not a full route acceptance PASS.

CL09 inventories 160 declarations and 158 unique method/path identities. GET `/api/research/jobs` and GET `/api/research/jobs/:id` each have two declarations; this run exercises the research router, not both mounted-server declarations. `/jobs` success is tested with `view=inbox` only.

Actual localhost HTTP run: 17 tests PASS, zero failures/skips, using real Express routers with injected service results and fixture authentication. No SQL/provider/queue side effects. Authentication denial tests validate router middleware wiring and role enforcement with fixture identities, not deployment authentication configuration.

- 11 unique current method/path identities have successful and negative HTTP responses demonstrated.
- 2 retired manual-route identities have HTTP 410 demonstrated; reconcile additionally has 403.
- 145 other unique identities have no demonstrated HTTP execution in this focused run. Source references and ordinary service tests are not counted as HTTP coverage.
- Full server mounting, side-effecting writes, end-to-end database results, all service error variants and full per-route positive/negative acceptance remain separate evidence requirements.

Command: `node --test test/cleanup-cl15-research-http.test.js test/phase13-research-batch-router.test.js test/cleanup-cl09-api.test.js` from services/demo-dashboard.

Evidence keys: R = new `cleanup-cl15-research-http.test.js`; B = existing `phase13-research-batch-router.test.js`; D = existing `cleanup-cl09-api.test.js`. R provides 200/202, 401 and 403 on ten method/path identities; detail/results also 400 and 404. B adds creation replay 200, idempotency-header forwarding and maintenance 503. D covers draft 200/404 and retired routes.

| Method/path | Positive HTTP | Negative HTTP | Evidence / limitation |
| --- | --- | --- | --- |
| POST /api/auto-evidence/controlled-batch | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/auto-evidence/exceptions | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/auto-evidence/summary | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/auto-evidence/tasks | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/automation/control | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| PUT /api/automation/control | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/automation/reconcile | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/automation/status | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/category-procurement/jobs | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/category-procurement/jobs/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/category-procurement/jobs/:id/results | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/category-scopes/candidates | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/category-scopes/current | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/category-scopes/revisions | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/category-scopes/revisions | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/category-scopes/revisions/:id/approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/buyer-business-model | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/category-procurement-matches | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/commercial-product-fit | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/cooperation-feasibility | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/crm-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/customer-match | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/customer-match-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/lifecycle-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/product-opportunities | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/score | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/companies/:id/score-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/contact-queue | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/contacts/:id/hunter-verify | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/contacts/:id/verification-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/crm-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/crm-history/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/crm-history/import-summary | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/crm-sync-outbox | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/crm-sync-outbox/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/crm-sync-outbox/:id/process | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/data-exports | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/data-exports/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/data-exports/:id/download | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/data-imports/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/data-imports/:id/approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/data-imports/:id/commit | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/data-imports/:id/error-report | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/data-imports/:id/rows | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/data-imports/:id/submit | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/data-imports/dry-run | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/data-imports/templates/:type | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/enrichment/jobs | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/enrichment/jobs | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/enrichment/jobs/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/enrichment/jobs/:id/results | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/export/leads | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/health | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/icp/profiles | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/icp/profiles/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/import-batches | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/auto-evidence/events | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/auto-evidence/reconcile | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/category-procurement/jobs/:id/run | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| PATCH /api/internal/category-procurement/jobs/:id/status | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/customer-match/recalculate | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/internal/data-cleanup/batches/:batchId | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/data-cleanup/dry-run | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/enrichment/jobs/:id/run | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| PATCH /api/internal/enrichment/jobs/:id/status | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/icp/profiles/:id/activate | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/icp/rebuild | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/orchestrator/heartbeat | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/orchestrator/watchdog | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/internal/phase5/diagnostics | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/phase7/orchestrate | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/research/direct-dispatch/reconcile | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/research/jobs/:id/check-contacts | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/research/jobs/:id/discover | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/research/jobs/:id/generate-queries | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/research/jobs/:id/verify-companies | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/scoring/recalculate | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/internal/scoring/replay | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/leads | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/leads/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| PATCH /api/leads/:id/approval | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/leads/:id/contact-routes | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/leads/:id/decision-makers | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/live/collect | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/manual-official-routes | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/manual-official-routes/:id/actions | Retired 410 | Not demonstrated | D; not an active business operation |
| POST /api/manual-official-routes/reconcile | Retired 410 | 403 | D; not an active business operation |
| GET /api/markets | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/metrics | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/opportunities | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/opportunities/:id/decision-history | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/opportunities/:id/hold | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/opportunities/:id/management-approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/opportunities/:id/reopen | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/opportunities/:id/request-evidence | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/opportunity-pool/summary | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/orchestrator/status | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/controlled-tests | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/controlled-tests/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests/:id/crm-replay | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests/:id/drafts | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests/:id/drafts/:draftId/approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests/:id/drafts/:draftId/enqueue | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests/:id/management-approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/controlled-tests/inbound-sync | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/controlled-tests/runtime | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/drafts | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/drafts/:id | 200 | 404 | D |
| PATCH /api/outreach/drafts/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/drafts/:id/approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/drafts/:id/reject | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/drafts/:id/submit | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/drafts/:id/supersede | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/gmail/health | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/gmail/health-check | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/gmail/inbound-sync | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/inbound-sync | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/inbox | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/marketing-context | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/marketing-context/:id/approve | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/marketing-context/versions | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/messages/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/messages/:id/enqueue | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/messages/:id/events | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/messages/:id/retry-before-provider | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/operations-summary | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/smtp/health | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/smtp/health-check | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/threads/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/outreach/workbench | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/outreach/workbench/:companyId/prepare | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/reference-data/imports/:id | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/reference-data/imports/:id/commit | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/reference-data/imports/dry-run | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/batches | 200 | 401, 403 | R + B |
| POST /api/research/batches | 202; replay 200 | 401, 403 | R + B |
| GET /api/research/batches/:id | 200 | 401, 403 | R + B |
| GET /api/research/batches/options | 200 | 401, 403 | R + B |
| POST /api/research/batches/preview | 200 | 401, 403 | R + B |
| GET /api/research/candidates/:candidateId/contacts | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/candidates/:candidateId/verification | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/jobs | 200 | 401, 403 | R; research-router branch only |
| POST /api/research/jobs | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/jobs/:id | 200 | 401, 403, 400, 404 | R; research-router branch only |
| GET /api/research/jobs/:id/candidates | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/jobs/:id/queries | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/jobs/:id/results | 200 | 401, 403, 400, 404 | R; research-router branch only |
| GET /api/research/jobs/:id/search-plan | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| PATCH /api/research/jobs/:id/status | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/jobs/:id/verifications | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/provider-status | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/research/provider-status/refresh | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/research/tasks | 200 | 401, 403 | R; research-router branch only |
| GET /api/research/workbench-summary | 200 | 401, 403 | R; research-router branch only |
| POST /api/webhooks/email/corporate | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| POST /api/webhooks/email/resend | Not demonstrated | Not demonstrated | No HTTP claim from static references |
| GET /api/workspace/contact-queue | Not demonstrated | Not demonstrated | No HTTP claim from static references |
