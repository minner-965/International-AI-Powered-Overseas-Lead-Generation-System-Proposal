# CL01 Runtime Reachability

Generated: 2026-09-08T09:49:09.751Z

This is a read-only reachability map. Classification is evidence for later review, not deletion authority. `UNUSED_CANDIDATE` means no caller was proven by this static scan; dynamic URLs, external clients, n8n instance state and operator tooling may still exist. Such rows require runtime logs and isolated regression before removal.

## Runtime topology

`Browser V3 UI → Express server.js/routers → services/repositories → PostgreSQL`

`Express/internal/n8n producers → pg-boss → category|outreach|data worker → handlers → services/repositories → PostgreSQL/provider`

Current automation path: `ResearchBatch → ResearchJob → execute-research-job → frozen SearchPlan executor → provider usage + candidate provenance → OpportunityPool → contact facts → first-touch reservation → send-auto-first-touch → SMTP → IMAP correlation → reply classifier → Activity/Sales Task/CRM outbox`.

## Route classification

| Method | Route | Source | Handler/service | DB/domain projection | UI refs | Other refs | Class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/auto-evidence/controlled-batch` | services/demo-dashboard/src/server.js:702 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/auto-evidence/exceptions` | services/demo-dashboard/src/server.js:671 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/auto-evidence/summary` | services/demo-dashboard/src/server.js:665 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/auto-evidence/tasks` | services/demo-dashboard/src/server.js:668 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/automation/control` | services/demo-dashboard/src/server.js:594 | inline/review | automation_controls, research_query_executions, first_touch_reservations | 1 | 2 | CURRENT |
| PUT | `/api/automation/control` | services/demo-dashboard/src/server.js:600 | inline/review | automation_controls, research_query_executions, first_touch_reservations | 1 | 2 | CURRENT |
| POST | `/api/automation/reconcile` | services/demo-dashboard/src/server.js:610 | inline/review | automation_controls, research_query_executions, first_touch_reservations | 0 | 0 | CURRENT |
| GET | `/api/automation/status` | services/demo-dashboard/src/server.js:597 | inline/review | automation_controls, research_query_executions, first_touch_reservations | 1 | 2 | CURRENT |
| POST | `/api/category-procurement/jobs` | services/demo-dashboard/src/server.js:2171 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 4 | UNUSED_CANDIDATE |
| GET | `/api/category-procurement/jobs/:id` | services/demo-dashboard/src/server.js:2194 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 3 | UNUSED_CANDIDATE |
| GET | `/api/category-procurement/jobs/:id/results` | services/demo-dashboard/src/server.js:2204 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 3 | UNUSED_CANDIDATE |
| GET | `/api/category-scopes/candidates` | services/demo-dashboard/src/server.js:632 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/category-scopes/current` | services/demo-dashboard/src/server.js:638 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/category-scopes/revisions` | services/demo-dashboard/src/server.js:635 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/category-scopes/revisions` | services/demo-dashboard/src/server.js:647 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/category-scopes/revisions/:id/approve` | services/demo-dashboard/src/server.js:654 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/companies/:id/buyer-business-model` | services/demo-dashboard/src/server.js:2138 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 3 | CURRENT |
| GET | `/api/companies/:id/category-procurement-matches` | services/demo-dashboard/src/server.js:2109 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 1 | 3 | CURRENT |
| GET | `/api/companies/:id/commercial-product-fit` | services/demo-dashboard/src/server.js:2149 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 1 | CURRENT |
| GET | `/api/companies/:id/cooperation-feasibility` | services/demo-dashboard/src/server.js:2085 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/companies/:id/crm-history` | services/demo-dashboard/src/server.js:2035 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/companies/:id/customer-match` | services/demo-dashboard/src/server.js:1971 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/companies/:id/customer-match-history` | services/demo-dashboard/src/server.js:1979 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/companies/:id/lifecycle-history` | services/demo-dashboard/src/server.js:1985 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/companies/:id/product-opportunities` | services/demo-dashboard/src/server.js:2154 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 1 | 3 | CURRENT |
| GET | `/api/companies/:id/score` | services/demo-dashboard/src/server.js:1957 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/companies/:id/score-history` | services/demo-dashboard/src/server.js:1965 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/contact-queue` | services/demo-dashboard/src/phase7/router.js:48 | listContactQueue | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 4 | CURRENT |
| POST | `/api/contacts/:id/hunter-verify` | services/demo-dashboard/src/phase7/router.js:87 | enqueueContactVerification | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 3 | UNUSED_CANDIDATE |
| GET | `/api/contacts/:id/verification-history` | services/demo-dashboard/src/phase7/router.js:88 | getContactVerificationHistory | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |
| GET | `/api/crm-history` | services/demo-dashboard/src/server.js:2018 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/crm-history/:id` | services/demo-dashboard/src/server.js:2027 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/crm-history/import-summary` | services/demo-dashboard/src/server.js:2010 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| POST | `/api/crm-sync-outbox` | services/demo-dashboard/src/phase7/router.js:111 | createCrmOutbox | runtime/operational projection; REVIEW exact SQL | 0 | 1 | TEST_ONLY |
| GET | `/api/crm-sync-outbox/:id` | services/demo-dashboard/src/phase7/router.js:112 | getCrmOutbox | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/crm-sync-outbox/:id/process` | services/demo-dashboard/src/phase7/router.js:113 | enqueueCrmOutbox | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/data-exports` | services/demo-dashboard/src/phase7/router.js:129 | createDataExport | data_export_jobs + business projections | 1 | 5 | CURRENT |
| GET | `/api/data-exports/:id` | services/demo-dashboard/src/phase7/router.js:130 | getExport | data_export_jobs + business projections | 1 | 3 | CURRENT |
| GET | `/api/data-exports/:id/download` | services/demo-dashboard/src/phase7/router.js:131 | downloadExport | data_export_jobs + business projections | 1 | 3 | CURRENT |
| GET | `/api/data-imports/:id` | services/demo-dashboard/src/phase7/router.js:120 | getImport | reference_data_*, data_import_* | 1 | 5 | CURRENT |
| POST | `/api/data-imports/:id/approve` | services/demo-dashboard/src/phase7/router.js:123 | approveImport | reference_data_*, data_import_* | 0 | 1 | CURRENT |
| POST | `/api/data-imports/:id/commit` | services/demo-dashboard/src/phase7/router.js:124 | enqueueImportCommit | reference_data_*, data_import_* | 0 | 1 | CURRENT |
| GET | `/api/data-imports/:id/error-report` | services/demo-dashboard/src/phase7/router.js:125 | importErrorReport | reference_data_*, data_import_* | 1 | 3 | CURRENT |
| GET | `/api/data-imports/:id/rows` | services/demo-dashboard/src/phase7/router.js:121 | getImportRows | reference_data_*, data_import_* | 1 | 3 | CURRENT |
| POST | `/api/data-imports/:id/submit` | services/demo-dashboard/src/phase7/router.js:122 | submitImport | reference_data_*, data_import_* | 0 | 1 | CURRENT |
| POST | `/api/data-imports/dry-run` | services/demo-dashboard/src/phase7/router.js:119 | createImportDryRun | reference_data_*, data_import_* | 1 | 5 | CURRENT |
| GET | `/api/data-imports/templates/:type` | services/demo-dashboard/src/phase7/router.js:115 | getTemplate | reference_data_*, data_import_* | 1 | 2 | CURRENT |
| GET | `/api/enrichment/jobs` | services/demo-dashboard/src/server.js:1498 | inline/review | runtime/operational projection; REVIEW exact SQL | 1 | 5 | CURRENT |
| POST | `/api/enrichment/jobs` | services/demo-dashboard/src/server.js:1424 | inline/review | runtime/operational projection; REVIEW exact SQL | 1 | 5 | CURRENT |
| GET | `/api/enrichment/jobs/:id` | services/demo-dashboard/src/server.js:1507 | inline/review | runtime/operational projection; REVIEW exact SQL | 1 | 3 | CURRENT |
| GET | `/api/enrichment/jobs/:id/results` | services/demo-dashboard/src/server.js:1516 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 2 | TEST_ONLY |
| GET | `/api/export/leads` | services/demo-dashboard/src/server.js:2436 | inline/review | data_export_jobs + business projections | 0 | 1 | TEST_ONLY |
| GET | `/api/health` | services/demo-dashboard/src/server.js:1186 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 4 | CURRENT |
| GET | `/api/icp/profiles` | services/demo-dashboard/src/server.js:1993 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/icp/profiles/:id` | services/demo-dashboard/src/server.js:1997 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| GET | `/api/import-batches` | services/demo-dashboard/src/server.js:2005 | inline/review | reference_data_*, data_import_* | 1 | 1 | CURRENT |
| POST | `/api/internal/auto-evidence/events` | services/demo-dashboard/src/server.js:674 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/internal/auto-evidence/reconcile` | services/demo-dashboard/src/server.js:677 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | CURRENT |
| POST | `/api/internal/category-procurement/jobs/:id/run` | services/demo-dashboard/src/server.js:2223 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 3 | CURRENT |
| PATCH | `/api/internal/category-procurement/jobs/:id/status` | services/demo-dashboard/src/server.js:2255 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 1 | CURRENT |
| POST | `/api/internal/customer-match/recalculate` | services/demo-dashboard/src/server.js:2319 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | TEST_ONLY |
| GET | `/api/internal/data-cleanup/batches/:batchId` | services/demo-dashboard/src/server.js:2373 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | TEST_ONLY |
| POST | `/api/internal/data-cleanup/dry-run` | services/demo-dashboard/src/server.js:2362 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 3 | TEST_ONLY |
| POST | `/api/internal/enrichment/jobs/:id/run` | services/demo-dashboard/src/server.js:1537 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | CURRENT |
| PATCH | `/api/internal/enrichment/jobs/:id/status` | services/demo-dashboard/src/server.js:1554 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | CURRENT |
| POST | `/api/internal/icp/profiles/:id/activate` | services/demo-dashboard/src/server.js:2352 | inline/review | companies, sources, contacts, ICP/history tables | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/internal/icp/rebuild` | services/demo-dashboard/src/server.js:2340 | inline/review | companies, sources, contacts, ICP/history tables | 0 | 1 | TEST_ONLY |
| POST | `/api/internal/orchestrator/heartbeat` | services/demo-dashboard/src/server.js:686 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | CURRENT |
| POST | `/api/internal/orchestrator/watchdog` | services/demo-dashboard/src/server.js:689 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | CURRENT |
| GET | `/api/internal/phase5/diagnostics` | services/demo-dashboard/src/server.js:2357 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| POST | `/api/internal/phase7/orchestrate` | services/demo-dashboard/src/phase7/router.js:137 | enqueueSharedImportDiscovery | runtime/operational projection; REVIEW exact SQL | 0 | 2 | CURRENT |
| POST | `/api/internal/research/direct-dispatch/reconcile` | services/demo-dashboard/src/server.js:693 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| POST | `/api/internal/research/jobs/:id/check-contacts` | services/demo-dashboard/src/server.js:1819 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| POST | `/api/internal/research/jobs/:id/discover` | services/demo-dashboard/src/server.js:1791 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| POST | `/api/internal/research/jobs/:id/generate-queries` | services/demo-dashboard/src/server.js:1769 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| POST | `/api/internal/research/jobs/:id/verify-companies` | services/demo-dashboard/src/server.js:1835 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 1 | TEST_ONLY |
| POST | `/api/internal/scoring/recalculate` | services/demo-dashboard/src/server.js:2299 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | TEST_ONLY |
| POST | `/api/internal/scoring/replay` | services/demo-dashboard/src/server.js:2330 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 1 | TEST_ONLY |
| GET | `/api/leads` | services/demo-dashboard/src/server.js:2406 | inline/review | companies, sources, contacts, ICP/history tables | 4 | 9 | CURRENT |
| GET | `/api/leads/:id` | services/demo-dashboard/src/server.js:2474 | inline/review | companies, sources, contacts, ICP/history tables | 3 | 5 | CURRENT |
| PATCH | `/api/leads/:id/approval` | services/demo-dashboard/src/server.js:2513 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 1 | CURRENT |
| GET | `/api/leads/:id/contact-routes` | services/demo-dashboard/src/server.js:2069 | inline/review | companies, sources, contacts, ICP/history tables | 2 | 3 | CURRENT |
| GET | `/api/leads/:id/decision-makers` | services/demo-dashboard/src/server.js:2043 | inline/review | companies, sources, contacts, ICP/history tables | 1 | 2 | CURRENT |
| POST | `/api/live/collect` | services/demo-dashboard/src/server.js:1195 | inline/review | runtime/operational projection; REVIEW exact SQL | 1 | 3 | CURRENT |
| GET | `/api/manual-official-routes` | services/demo-dashboard/src/phase7/router.js:49 | listManualOfficialRoutes | runtime/operational projection; REVIEW exact SQL | 0 | 1 | HISTORICAL_COMPAT |
| POST | `/api/manual-official-routes/:id/actions` | services/demo-dashboard/src/phase7/router.js:52 | recordManualOfficialRouteAction | runtime/operational projection; REVIEW exact SQL | 0 | 1 | HISTORICAL_COMPAT |
| POST | `/api/manual-official-routes/reconcile` | services/demo-dashboard/src/phase7/router.js:50 | reconcileManualOfficialRoutes | runtime/operational projection; REVIEW exact SQL | 0 | 1 | HISTORICAL_COMPAT |
| GET | `/api/markets` | services/demo-dashboard/src/server.js:1315 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | CURRENT |
| GET | `/api/metrics` | services/demo-dashboard/src/server.js:1205 | inline/review | runtime/operational projection; REVIEW exact SQL | 1 | 3 | CURRENT |
| GET | `/api/opportunities` | services/demo-dashboard/src/server.js:2270 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 4 | 16 | CURRENT |
| GET | `/api/opportunities/:id/decision-history` | services/demo-dashboard/src/phase7/router.js:43 | opportunityDecisionHistory | opportunity_pool_*, business_opportunity_*, category_* | 1 | 2 | CURRENT |
| POST | `/api/opportunities/:id/hold` | services/demo-dashboard/src/phase7/router.js:45 | manageOpportunity | opportunity_pool_*, business_opportunity_*, category_* | 0 | 1 | CURRENT |
| POST | `/api/opportunities/:id/management-approve` | services/demo-dashboard/src/phase7/router.js:44 | manageOpportunity | opportunity_pool_*, business_opportunity_*, category_* | 1 | 3 | CURRENT |
| POST | `/api/opportunities/:id/reopen` | services/demo-dashboard/src/phase7/router.js:47 | manageOpportunity | opportunity_pool_*, business_opportunity_*, category_* | 0 | 1 | CURRENT |
| POST | `/api/opportunities/:id/request-evidence` | services/demo-dashboard/src/phase7/router.js:46 | manageOpportunity | opportunity_pool_*, business_opportunity_*, category_* | 0 | 1 | CURRENT |
| GET | `/api/opportunity-pool/summary` | services/demo-dashboard/src/server.js:1209 | inline/review | opportunity_pool_*, business_opportunity_*, category_* | 0 | 1 | CURRENT |
| GET | `/api/orchestrator/status` | services/demo-dashboard/src/server.js:696 | inline/review | runtime/operational projection; REVIEW exact SQL | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/outreach/controlled-tests` | services/demo-dashboard/src/phase7/router.js:71 | listControlledApplicationContexts | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests` | services/demo-dashboard/src/phase7/router.js:73 | createControlledApplicationContext | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | HISTORICAL_COMPAT |
| GET | `/api/outreach/controlled-tests/:id` | services/demo-dashboard/src/phase7/router.js:74 | getControlledApplicationContext | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests/:id/crm-replay` | services/demo-dashboard/src/phase7/router.js:75 | replayControlledCrm | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests/:id/drafts` | services/demo-dashboard/src/phase7/router.js:77 | createControlledApplicationDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 1 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests/:id/drafts/:draftId/approve` | services/demo-dashboard/src/phase7/router.js:78 | approveControlledApplicationDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 1 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests/:id/drafts/:draftId/enqueue` | services/demo-dashboard/src/phase7/router.js:79 | enqueueControlledApplicationMessage | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 1 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests/:id/management-approve` | services/demo-dashboard/src/phase7/router.js:76 | approveControlledApplicationContext | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 1 | HISTORICAL_COMPAT |
| POST | `/api/outreach/controlled-tests/inbound-sync` | services/demo-dashboard/src/phase7/router.js:80 | inline/review | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | HISTORICAL_COMPAT |
| GET | `/api/outreach/controlled-tests/runtime` | services/demo-dashboard/src/phase7/router.js:72 | controlledApplicationRuntimeStatus | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | HISTORICAL_COMPAT |
| POST | `/api/outreach/drafts` | services/demo-dashboard/src/phase7/router.js:90 | createDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 2 | 4 | CURRENT |
| GET | `/api/outreach/drafts/:id` | services/demo-dashboard/src/phase7/router.js:91 | getDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 2 | 3 | CURRENT |
| PATCH | `/api/outreach/drafts/:id` | services/demo-dashboard/src/phase7/router.js:94 | reviseDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 2 | 3 | CURRENT |
| POST | `/api/outreach/drafts/:id/approve` | services/demo-dashboard/src/phase7/router.js:96 | approveDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |
| POST | `/api/outreach/drafts/:id/reject` | services/demo-dashboard/src/phase7/router.js:97 | rejectDraftApproval | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |
| POST | `/api/outreach/drafts/:id/submit` | services/demo-dashboard/src/phase7/router.js:95 | submitDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |
| POST | `/api/outreach/drafts/:id/supersede` | services/demo-dashboard/src/phase7/router.js:98 | supersedeDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 1 | UNUSED_CANDIDATE |
| GET | `/api/outreach/gmail/health` | services/demo-dashboard/src/phase7/router.js:59 | gmailHealth | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | HISTORICAL_COMPAT |
| POST | `/api/outreach/gmail/health-check` | services/demo-dashboard/src/phase7/router.js:60 | gmailHealth | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | HISTORICAL_COMPAT |
| POST | `/api/outreach/gmail/inbound-sync` | services/demo-dashboard/src/phase7/router.js:63 | inline/review | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | HISTORICAL_COMPAT |
| POST | `/api/outreach/inbound-sync` | services/demo-dashboard/src/phase7/router.js:67 | inline/review | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/outreach/inbox` | services/demo-dashboard/src/phase7/router.js:109 | listInbox | outreach_*, inbound_messages, suppressions, opportunity_activities | 2 | 4 | CURRENT |
| GET | `/api/outreach/marketing-context` | services/demo-dashboard/src/phase7/router.js:55 | getMarketingContext | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 2 | UNUSED_CANDIDATE |
| POST | `/api/outreach/marketing-context/:id/approve` | services/demo-dashboard/src/phase7/router.js:85 | approveMarketingContext | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 1 | UNUSED_CANDIDATE |
| POST | `/api/outreach/marketing-context/versions` | services/demo-dashboard/src/phase7/router.js:84 | createMarketingContext | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 1 | UNUSED_CANDIDATE |
| GET | `/api/outreach/messages/:id` | services/demo-dashboard/src/phase7/router.js:102 | getOutboundMessage | outreach_*, inbound_messages, suppressions, opportunity_activities | 2 | 4 | CURRENT |
| POST | `/api/outreach/messages/:id/enqueue` | services/demo-dashboard/src/phase7/router.js:100 | enqueueMessage | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 3 | CURRENT |
| GET | `/api/outreach/messages/:id/events` | services/demo-dashboard/src/phase7/router.js:105 | getOutboundEvents | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |
| POST | `/api/outreach/messages/:id/retry-before-provider` | services/demo-dashboard/src/phase7/router.js:101 | retryBlockedMessage | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 1 | CURRENT |
| GET | `/api/outreach/operations-summary` | services/demo-dashboard/src/phase7/router.js:57 | getOutreachOperationsSummary | outreach_*, inbound_messages, suppressions, opportunity_activities | 2 | 3 | CURRENT |
| GET | `/api/outreach/smtp/health` | services/demo-dashboard/src/phase7/router.js:61 | smtpHealth | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | CURRENT |
| POST | `/api/outreach/smtp/health-check` | services/demo-dashboard/src/phase7/router.js:62 | smtpHealth | outreach_*, inbound_messages, suppressions, opportunity_activities | 0 | 0 | UNUSED_CANDIDATE |
| GET | `/api/outreach/threads/:id` | services/demo-dashboard/src/phase7/router.js:106 | getThread | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |
| GET | `/api/outreach/workbench` | services/demo-dashboard/src/phase7/router.js:56 | getOutreachWorkbench | outreach_*, inbound_messages, suppressions, opportunity_activities | 4 | 7 | CURRENT |
| POST | `/api/outreach/workbench/:companyId/prepare` | services/demo-dashboard/src/phase7/router.js:58 | prepareWorkbenchDraft | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 1 | CURRENT |
| GET | `/api/reference-data/imports/:id` | services/demo-dashboard/src/server.js:2398 | inline/review | reference_data_*, data_import_* | 0 | 1 | TEST_ONLY |
| POST | `/api/reference-data/imports/:id/commit` | services/demo-dashboard/src/server.js:2393 | inline/review | reference_data_*, data_import_* | 0 | 1 | TEST_ONLY |
| POST | `/api/reference-data/imports/dry-run` | services/demo-dashboard/src/server.js:2381 | inline/review | reference_data_*, data_import_* | 0 | 1 | TEST_ONLY |
| GET | `/api/research/batches` | services/demo-dashboard/src/research/researchBatchRouter.js:11 | list | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 5 | CURRENT |
| POST | `/api/research/batches` | services/demo-dashboard/src/research/researchBatchRouter.js:13 | create | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 5 | CURRENT |
| GET | `/api/research/batches/:id` | services/demo-dashboard/src/research/researchBatchRouter.js:12 | get | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 3 | CURRENT |
| GET | `/api/research/batches/options` | services/demo-dashboard/src/research/researchBatchRouter.js:9 | options | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 2 | CURRENT |
| POST | `/api/research/batches/preview` | services/demo-dashboard/src/research/researchBatchRouter.js:10 | preview | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 3 | CURRENT |
| GET | `/api/research/candidates/:candidateId/contacts` | services/demo-dashboard/src/server.js:1634 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| GET | `/api/research/candidates/:candidateId/verification` | services/demo-dashboard/src/server.js:1750 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 1 | CURRENT |
| GET | `/api/research/jobs` | services/demo-dashboard/src/server.js:1397 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 2 | 10 | CURRENT |
| GET | `/api/research/jobs` | services/demo-dashboard/src/research/router.js:17 | assertReadRole | research_jobs, research_batches, research_query_plans, research_candidates | 2 | 11 | CURRENT |
| POST | `/api/research/jobs` | services/demo-dashboard/src/server.js:1340 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 2 | 10 | CURRENT |
| GET | `/api/research/jobs/:id` | services/demo-dashboard/src/server.js:1410 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 2 | 6 | CURRENT |
| GET | `/api/research/jobs/:id` | services/demo-dashboard/src/research/router.js:28 | assertReadRole | research_jobs, research_batches, research_query_plans, research_candidates | 2 | 7 | CURRENT |
| GET | `/api/research/jobs/:id/candidates` | services/demo-dashboard/src/server.js:1584 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 1 | TEST_ONLY |
| GET | `/api/research/jobs/:id/queries` | services/demo-dashboard/src/server.js:1572 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 1 | TEST_ONLY |
| GET | `/api/research/jobs/:id/results` | services/demo-dashboard/src/research/router.js:21 | assertReadRole | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 2 | CURRENT |
| GET | `/api/research/jobs/:id/search-plan` | services/demo-dashboard/src/server.js:617 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| PATCH | `/api/research/jobs/:id/status` | services/demo-dashboard/src/server.js:1889 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 0 | 0 | CURRENT |
| GET | `/api/research/jobs/:id/verifications` | services/demo-dashboard/src/server.js:1667 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 1 | CURRENT |
| GET | `/api/research/provider-status` | services/demo-dashboard/src/server.js:1322 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 2 | CURRENT |
| POST | `/api/research/provider-status/refresh` | services/demo-dashboard/src/server.js:1331 | inline/review | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 1 | CURRENT |
| GET | `/api/research/tasks` | services/demo-dashboard/src/research/router.js:14 | assertReadRole | research_jobs, research_batches, research_query_plans, research_candidates | 1 | 2 | CURRENT |
| GET | `/api/research/workbench-summary` | services/demo-dashboard/src/research/router.js:11 | assertReadRole | research_jobs, research_batches, research_query_plans, research_candidates | 3 | 4 | CURRENT |
| GET | `/api/workspace/contact-queue` | services/demo-dashboard/src/phase7/router.js:41 | listWorkspaceContactQueue | outreach_*, inbound_messages, suppressions, opportunity_activities | 1 | 2 | CURRENT |

The DB/domain column is a derived preliminary ownership map. Exact per-handler SQL/FK read-write proof remains REVIEW until the DB inventory is joined. Dynamic browser URL construction is counted by ordered static route fragments.

## Route authentication and caller evidence

| Method | Route | Auth | Handler | Caller evidence |
| --- | --- | --- | --- | --- |
| POST | `/api/auto-evidence/controlled-batch` | AUTHENTICATED | inline/review | NONE_PROVEN |
| GET | `/api/auto-evidence/exceptions` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/auto-evidence/summary` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/auto-evidence/tasks` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/automation/control` | AUTOMATION_READ | inline/review | UI_STATIC_OR_DYNAMIC |
| PUT | `/api/automation/control` | AUTOMATION_WRITE | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/automation/reconcile` | AUTOMATION_WRITE | inline/review | NONE_PROVEN |
| GET | `/api/automation/status` | AUTOMATION_READ | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/category-procurement/jobs` | AUTHENTICATED | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/category-procurement/jobs/:id` | AUTHENTICATED | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/category-procurement/jobs/:id/results` | AUTHENTICATED | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/category-scopes/candidates` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/category-scopes/current` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/category-scopes/revisions` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| POST | `/api/category-scopes/revisions` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| POST | `/api/category-scopes/revisions/:id/approve` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/companies/:id/buyer-business-model` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/category-procurement-matches` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/commercial-product-fit` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/cooperation-feasibility` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/crm-history` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/customer-match` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/customer-match-history` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/lifecycle-history` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/product-opportunities` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/score` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/companies/:id/score-history` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/contact-queue` | AUTHENTICATED_READ | listContactQueue | UI_STATIC_OR_DYNAMIC |
| POST | `/api/contacts/:id/hunter-verify` | DATA_WRITE | enqueueContactVerification | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/contacts/:id/verification-history` | AUTHENTICATED_READ | getContactVerificationHistory | UI_STATIC_OR_DYNAMIC |
| GET | `/api/crm-history` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/crm-history/:id` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/crm-history/import-summary` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/crm-sync-outbox` | DATA_WRITE | createCrmOutbox | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/crm-sync-outbox/:id` | AUTHENTICATED_READ | getCrmOutbox | NONE_PROVEN |
| POST | `/api/crm-sync-outbox/:id/process` | DATA_WRITE | enqueueCrmOutbox | NONE_PROVEN |
| POST | `/api/data-exports` | EXPORT_WRITE | createDataExport | UI_STATIC_OR_DYNAMIC |
| GET | `/api/data-exports/:id` | AUTHENTICATED_READ | getExport | UI_STATIC_OR_DYNAMIC |
| GET | `/api/data-exports/:id/download` | INTERNAL_TOKEN | downloadExport | UI_STATIC_OR_DYNAMIC |
| GET | `/api/data-imports/:id` | AUTHENTICATED_READ | getImport | UI_STATIC_OR_DYNAMIC |
| POST | `/api/data-imports/:id/approve` | DATA_WRITE | approveImport | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/data-imports/:id/commit` | DATA_WRITE | enqueueImportCommit | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/data-imports/:id/error-report` | AUTHENTICATED_READ | importErrorReport | UI_STATIC_OR_DYNAMIC |
| GET | `/api/data-imports/:id/rows` | AUTHENTICATED_READ | getImportRows | UI_STATIC_OR_DYNAMIC |
| POST | `/api/data-imports/:id/submit` | DATA_WRITE | submitImport | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/data-imports/dry-run` | DATA_WRITE | createImportDryRun | UI_STATIC_OR_DYNAMIC |
| GET | `/api/data-imports/templates/:type` | AUTHENTICATED_READ | getTemplate | UI_STATIC_OR_DYNAMIC |
| GET | `/api/enrichment/jobs` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/enrichment/jobs` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/enrichment/jobs/:id` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/enrichment/jobs/:id/results` | AUTHENTICATED | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/export/leads` | AUTHENTICATED | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/health` | PUBLIC_OR_INLINE | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/icp/profiles` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/icp/profiles/:id` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/import-batches` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/internal/auto-evidence/events` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/auto-evidence/reconcile` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/category-procurement/jobs/:id/run` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| PATCH | `/api/internal/category-procurement/jobs/:id/status` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/customer-match/recalculate` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/internal/data-cleanup/batches/:batchId` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/data-cleanup/dry-run` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/enrichment/jobs/:id/run` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| PATCH | `/api/internal/enrichment/jobs/:id/status` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/icp/profiles/:id/activate` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/icp/rebuild` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/orchestrator/heartbeat` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/orchestrator/watchdog` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/internal/phase5/diagnostics` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/phase7/orchestrate` | INTERNAL_TOKEN | enqueueSharedImportDiscovery | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/research/direct-dispatch/reconcile` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/research/jobs/:id/check-contacts` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/research/jobs/:id/discover` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/research/jobs/:id/generate-queries` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| POST | `/api/internal/research/jobs/:id/verify-companies` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/scoring/recalculate` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/internal/scoring/replay` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/leads` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/leads/:id` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| PATCH | `/api/leads/:id/approval` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/leads/:id/contact-routes` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/leads/:id/decision-makers` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/live/collect` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/manual-official-routes` | AUTHENTICATED_READ | listManualOfficialRoutes | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/manual-official-routes/:id/actions` | DATA_WRITE | recordManualOfficialRouteAction | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/manual-official-routes/reconcile` | DATA_WRITE | reconcileManualOfficialRoutes | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/markets` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/metrics` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/opportunities` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/opportunities/:id/decision-history` | AUTHENTICATED_READ | opportunityDecisionHistory | UI_STATIC_OR_DYNAMIC |
| POST | `/api/opportunities/:id/hold` | MANAGEMENT_APPROVE | manageOpportunity | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/opportunities/:id/management-approve` | MANAGEMENT_APPROVE | manageOpportunity | UI_STATIC_OR_DYNAMIC |
| POST | `/api/opportunities/:id/reopen` | MANAGEMENT_APPROVE | manageOpportunity | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/opportunities/:id/request-evidence` | MANAGEMENT_APPROVE | manageOpportunity | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/opportunity-pool/summary` | PUBLIC_OR_INLINE | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/orchestrator/status` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/outreach/controlled-tests` | AUTHENTICATED_READ | listControlledApplicationContexts | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/controlled-tests` | MANAGEMENT_APPROVE | createControlledApplicationContext | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/controlled-tests/:id` | AUTHENTICATED_READ | getControlledApplicationContext | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/controlled-tests/:id/crm-replay` | DATA_WRITE | replayControlledCrm | NONE_PROVEN |
| POST | `/api/outreach/controlled-tests/:id/drafts` | DRAFT_WRITE | createControlledApplicationDraft | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/controlled-tests/:id/drafts/:draftId/approve` | OUTREACH_APPROVE | approveControlledApplicationDraft | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/controlled-tests/:id/drafts/:draftId/enqueue` | OUTREACH_SEND | enqueueControlledApplicationMessage | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/controlled-tests/:id/management-approve` | MANAGEMENT_APPROVE | approveControlledApplicationContext | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/controlled-tests/inbound-sync` | DATA_WRITE | inline/review | NONE_PROVEN |
| GET | `/api/outreach/controlled-tests/runtime` | AUTHENTICATED_READ | controlledApplicationRuntimeStatus | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/drafts` | DRAFT_WRITE | createDraft | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/drafts/:id` | AUTHENTICATED_READ | getDraft | UI_STATIC_OR_DYNAMIC |
| PATCH | `/api/outreach/drafts/:id` | DRAFT_WRITE | reviseDraft | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/drafts/:id/approve` | OUTREACH_APPROVE | approveDraft | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/drafts/:id/reject` | OUTREACH_APPROVE | rejectDraftApproval | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/drafts/:id/submit` | DRAFT_WRITE | submitDraft | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/drafts/:id/supersede` | DRAFT_WRITE | supersedeDraft | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/outreach/gmail/health` | AUTHENTICATED_READ | gmailHealth | NONE_PROVEN |
| POST | `/api/outreach/gmail/health-check` | DATA_WRITE | gmailHealth | NONE_PROVEN |
| POST | `/api/outreach/gmail/inbound-sync` | DATA_WRITE | inline/review | NONE_PROVEN |
| POST | `/api/outreach/inbound-sync` | DATA_WRITE | inline/review | NONE_PROVEN |
| GET | `/api/outreach/inbox` | AUTHENTICATED_READ | listInbox | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/marketing-context` | AUTHENTICATED_READ | getMarketingContext | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/outreach/marketing-context/:id/approve` | OUTREACH_APPROVE | approveMarketingContext | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/outreach/marketing-context/versions` | OUTREACH_APPROVE | createMarketingContext | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/outreach/messages/:id` | AUTHENTICATED_READ | getOutboundMessage | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/messages/:id/enqueue` | OUTREACH_SEND | enqueueMessage | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/messages/:id/events` | AUTHENTICATED_READ | getOutboundEvents | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/messages/:id/retry-before-provider` | OUTREACH_SEND | retryBlockedMessage | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/operations-summary` | AUTHENTICATED_READ | getOutreachOperationsSummary | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/smtp/health` | AUTHENTICATED_READ | smtpHealth | NONE_PROVEN |
| POST | `/api/outreach/smtp/health-check` | DATA_WRITE | smtpHealth | NONE_PROVEN |
| GET | `/api/outreach/threads/:id` | AUTHENTICATED_READ | getThread | UI_STATIC_OR_DYNAMIC |
| GET | `/api/outreach/workbench` | AUTHENTICATED_READ | getOutreachWorkbench | UI_STATIC_OR_DYNAMIC |
| POST | `/api/outreach/workbench/:companyId/prepare` | DRAFT_WRITE | prepareWorkbenchDraft | UI_STATIC_OR_DYNAMIC |
| GET | `/api/reference-data/imports/:id` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/reference-data/imports/:id/commit` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| POST | `/api/reference-data/imports/dry-run` | INTERNAL_TOKEN | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/research/batches` | AUTHENTICATED_READ | list | UI_STATIC_OR_DYNAMIC |
| POST | `/api/research/batches` | MANAGEMENT_OR_DATA_ADMIN | create | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/batches/:id` | AUTHENTICATED_READ | get | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/batches/options` | AUTHENTICATED_READ | options | UI_STATIC_OR_DYNAMIC |
| POST | `/api/research/batches/preview` | AUTHENTICATED_READ | preview | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/candidates/:candidateId/contacts` | PUBLIC_OR_INLINE | inline/review | NONE_PROVEN |
| GET | `/api/research/candidates/:candidateId/verification` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/jobs` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/jobs` | AUTHENTICATED_READ | assertReadRole | UI_STATIC_OR_DYNAMIC |
| POST | `/api/research/jobs` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/jobs/:id` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/jobs/:id` | AUTHENTICATED_READ | assertReadRole | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/jobs/:id/candidates` | PUBLIC_OR_INLINE | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/research/jobs/:id/queries` | PUBLIC_OR_INLINE | inline/review | INTERNAL_TEST_OR_WORKFLOW |
| GET | `/api/research/jobs/:id/results` | AUTHENTICATED_READ | assertReadRole | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/jobs/:id/search-plan` | AUTHENTICATED | inline/review | NONE_PROVEN |
| PATCH | `/api/research/jobs/:id/status` | INTERNAL_TOKEN | inline/review | NONE_PROVEN |
| GET | `/api/research/jobs/:id/verifications` | PUBLIC_OR_INLINE | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/provider-status` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| POST | `/api/research/provider-status/refresh` | AUTHENTICATED | inline/review | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/tasks` | AUTHENTICATED_READ | assertReadRole | UI_STATIC_OR_DYNAMIC |
| GET | `/api/research/workbench-summary` | AUTHENTICATED_READ | assertReadRole | UI_STATIC_OR_DYNAMIC |
| GET | `/api/workspace/contact-queue` | PUBLIC_OR_INLINE | listWorkspaceContactQueue | UI_STATIC_OR_DYNAMIC |

## Route review summary

| Class | Count |
| --- | --- |
| UNUSED_CANDIDATE | 25 |
| CURRENT | 102 |
| TEST_ONLY | 15 |
| HISTORICAL_COMPAT | 16 |

Known compatibility groups are Gmail, controlled-test and retired manual-official-route endpoints. They remain wired today and are classified HISTORICAL_COMPAT, not removable. Routes with no proven static caller are UNUSED_CANDIDATE and must be treated as REVIEW until access logs, n8n live workflow state and operator consumers are checked.

## Queue producer/consumer map

| Queue | Static producer hits | Handler refs | Compose allowlisted | Class |
| --- | --- | --- | --- | --- |
| score-company | 0 | 1 | false | CURRENT |
| score-all-eligible | 0 | 1 | false | CURRENT |
| recalculate-customer-match | 1 | 1 | false | CURRENT |
| rebuild-icp-profile | 1 | 1 | false | CURRENT |
| replay-rule-version | 1 | 1 | false | CURRENT |
| enrich-decision-makers | 3 | 2 | true | CURRENT |
| collect-category-buyer-evidence | 2 | 1 | true | CURRENT |
| classify-buyer-business-model | 1 | 1 | true | CURRENT |
| calculate-category-procurement-match | 1 | 1 | true | CURRENT |
| calculate-product-opportunities | 1 | 1 | true | CURRENT |
| recalculate-cooperation-v3 | 1 | 1 | true | CURRENT |
| recalculate-business-opportunities | 0 | 1 | true | CURRENT |
| refresh-opportunity-exception-queue | 0 | 1 | true | CURRENT |
| verify-outreach-contact | 1 | 1 | true | CURRENT |
| generate-outreach-draft | 0 | 1 | true | CURRENT |
| validate-outreach-draft | 0 | 1 | true | CURRENT |
| send-outreach-email | 2 | 1 | true | CURRENT |
| send-auto-first-touch | 0 | 1 | true | CURRENT |
| process-email-provider-event | 0 | 1 | true | CURRENT |
| process-inbound-message | 2 | 1 | true | CURRENT |
| gmail-inbound-sync | 1 | 1 | true | HISTORICAL_COMPAT |
| inbound-email-sync | 2 | 1 | true | CURRENT |
| send-controlled-application-email | 1 | 1 | true | HISTORICAL_COMPAT |
| controlled-application-inbound-sync | 1 | 1 | true | HISTORICAL_COMPAT |
| process-controlled-application-inbound | 1 | 1 | true | HISTORICAL_COMPAT |
| reconcile-gmail-ambiguous-send | 2 | 1 | true | HISTORICAL_COMPAT |
| classify-inbound-reply | 1 | 1 | true | CURRENT |
| create-sales-followup | 1 | 1 | true | CURRENT |
| sync-outreach-to-crm | 3 | 1 | true | CURRENT |
| discover-shared-import-files | 1 | 1 | true | CURRENT |
| parse-reference-import | 0 | 1 | true | CURRENT |
| commit-reference-import | 1 | 1 | true | CURRENT |
| export-business-data | 1 | 1 | true | CURRENT |
| recalculate-after-import | 0 | 1 | true | CURRENT |
| schedule-auto-evidence | 4 | 1 | true | CURRENT |
| discover-opportunity-evidence | 0 | 2 | true | CURRENT |
| normalize-opportunity-category | 0 | 2 | true | CURRENT |
| refresh-category-scope-match | 0 | 2 | true | CURRENT |
| find-profile-buyer | 0 | 2 | true | CURRENT |
| verify-profile-buyer-email | 0 | 2 | true | CURRENT |
| refresh-business-opportunity-v3 | 0 | 2 | true | CURRENT |
| refresh-auto-evidence-exception | 0 | 1 | true | CURRENT |
| execute-research-job | 1 | 1 | true | CURRENT |

Queue producer counting is conservative because many producers use `PHASE5_QUEUES.*` constants rather than string literals. A zero is REVIEW, not proof of an orphan. Compose allowlisting plus a registered handler is stronger current-runtime evidence.

## Route → service → DB ownership

- Automation: server automation routes → `Phase13AutomationFacade` / `AutomationControlService` → automation controls/events, research execution and first-touch reservation projections.
- Research: research and batch routers plus direct endpoints → `ResearchWorkbenchService`, `ResearchBatchService`, `ResearchDirectDispatchService`, `SearchPlanService` → jobs, batches, frozen plans, candidates, provenance and provider usage.
- Opportunity: server opportunity routes → `OpportunityPoolService`, category services and scoring/matching services → immutable opportunity decisions and current views.
- Contact/outreach: Phase7 router → `Phase7Service` / `Phase7Repository` and first-touch service → recipients, drafts/approvals compatibility history, outbound/inbound, suppressions, activities, tasks and CRM outbox.
- Data exchange: Phase7 routes/workers → import/export services and repository → import manifests/rows/effects and export jobs/files.
- Operational: health, metrics and orchestrator routes → queue health, runtime state and read-only aggregate projections.

## Worker roles

- `demo-dashboard`: HTTP/API/UI producer; `PGBOSS_PROCESS_JOBS=false`.
- `category-worker`: research execution, evidence/category/opportunity and contact discovery stages.
- `outreach-worker`: verification, first-touch, SMTP/IMAP, reply, suppression and CRM handlers; Gmail/controlled handlers remain compatibility-wired.
- `data-worker`: shared import discovery/parse/commit, exports and post-import recalculation.
- `n8n`: persisted orchestration workflows; repository JSON inventory above does not prove live-instance activation.

## Safety conclusion

CL01 made no business-code change and removed nothing. The graph proves a large compatibility surface remains reachable from registered routes and queue allowlists. Static non-reachability alone is insufficient for deletion; runtime logs, live n8n state, database FK/history checks and isolated regression are mandatory in later CL packages.
