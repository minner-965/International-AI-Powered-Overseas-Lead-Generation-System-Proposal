# CL01 Repository Inventory

Generated: 2026-09-08T09:49:09.751Z

Read-only static inventory. It records references; it does not authorize deletion. Generated files, dynamic class names, runtime reflection and external consumers remain a caveat and are marked REVIEW where proof is incomplete. No environment values or secrets are included.

## Scope summary

- Tracked files: 818
- Repository JS/MJS modules: 376
- Repository static import edges: 529
- Runtime source JS modules: 135
- Static runtime entrypoints: 4
- Statically reachable runtime modules: 112
- Runtime modules outside the static entrypoint graph: 24 (review candidates, not deletion proof)
- Express routes: 158
- Declared queues: 43
- Tracked workflow JSON files: 4
- Public UI files: 51
- Package runtime dependencies: 16
- Named env/config keys inventoried: 155

## Tracked files by top-level area

| Area | Files |
| --- | --- |
| services | 353 |
| docs | 167 |
| .agents | 78 |
| database | 62 |
| scripts | 59 |
| rules | 23 |
| doc_assets | 11 |
| n8n_edit_build | 7 |
| tests | 7 |
| workflows | 5 |
| management_demo | 4 |
| outputs | 4 |
| config | 3 |
| .codex_cost_workbook | 2 |
| deliverables | 2 |
| demo_build | 2 |
| final | 2 |
| final_updated | 2 |
| final_updated_v2 | 2 |
| final_updated_v3 | 2 |
| .dockerignore | 1 |
| .env.example | 1 |
| .env.phase7-api.example | 1 |
| .env.phase7-outreach.example | 1 |
| .gitattributes | 1 |
| .github | 1 |
| .gitignore | 1 |
| AGENTS.md | 1 |
| DPV_PHASE10_AUTOMATED_EVIDENCE_AND_CATEGORY_OPPORTUNITY_CODEX_EXECUTION_PLAN_V1_1.md | 1 |
| DPV_PHASE6_1_PRODUCT_MATCH_CODEX_PLAN_V2.md | 1 |
| DPV_PHASE6_1_PRODUCT_MATCH_CODEX_PLAN_V3.md | 1 |
| DPV_PHASE7_CODEX_EXECUTION_PLAN_V1.md | 1 |
| DPV_PHASE8_UI_UX_CODEX_EXECUTION_PLAN_V1.md | 1 |
| DPV_PHASE9_REAL_OPPORTUNITY_AND_RESEARCH_WORKBENCH_CODEX_EXECUTION_PLAN_V1.md | 1 |
| README.md | 1 |
| SECURITY.md | 1 |
| build_dpv_proposals.py | 1 |
| compose.yaml | 1 |
| requirements.txt | 1 |
| runbooks | 1 |
| skills.lock.json | 1 |

## Tracked files by extension

| Extension | Files |
| --- | --- |
| .js | 317 |
| .md | 252 |
| .sql | 65 |
| .mjs | 59 |
| .json | 37 |
| .css | 21 |
| .cjs | 12 |
| .docx | 10 |
| .png | 10 |
| (none) | 7 |
| .txt | 5 |
| .html | 4 |
| .xlsx | 4 |
| .example | 3 |
| .py | 3 |
| .pptx | 3 |
| .pdf | 2 |
| .yml | 1 |
| .yaml | 1 |
| .jpeg | 1 |
| .ps1 | 1 |

## Runtime entrypoints

- `services/demo-dashboard/src/categoryProcurement/migrationRunner.js`
- `services/demo-dashboard/src/phase7/migrationRunner.js`
- `services/demo-dashboard/src/productMatch/productTaxonomyCli.js`
- `services/demo-dashboard/src/server.js`

Compose adds the same dashboard image in four roles: HTTP dashboard (no job processing), category worker, outreach worker and data worker. PostgreSQL, n8n and the one-shot runtime-volume initializer are separate services.

## Import graph

Repository graph: 529 internal edges across 376 JS/MJS modules. Runtime source subgraph: 232 edges. Dynamic construction and non-JS process calls are not inferred.

### Modules outside the static server/CLI graph — REVIEW

- `services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js`
- `services/demo-dashboard/src/autoEvidence/executors.js`
- `services/demo-dashboard/src/autoEvidence/queueHandlers.js`
- `services/demo-dashboard/src/autoEvidence/strategyCatalog.js`
- `services/demo-dashboard/src/autoEvidence/stuckTaskMonitor.js`
- `services/demo-dashboard/src/categoryProcurement/phase10DryRun.js`
- `services/demo-dashboard/src/dataExchange/exportPolicy.js`
- `services/demo-dashboard/src/dataExchange/importStateMachine.js`
- `services/demo-dashboard/src/dataExchange/xlsxWorkbook.js`
- `services/demo-dashboard/src/market/sourceRegistry.js`
- `services/demo-dashboard/src/matching/dualMatchAcceptanceCli.js`
- `services/demo-dashboard/src/matching/mxHistoricalIcpCli.js`
- `services/demo-dashboard/src/outreach/events.js`
- `services/demo-dashboard/src/outreach/gmailApiProvider.js`
- `services/demo-dashboard/src/outreach/inbound.js`
- `services/demo-dashboard/src/outreach/providers.js`
- `services/demo-dashboard/src/outreach/suppression.js`
- `services/demo-dashboard/src/referenceData/okkiHistoryImportCli.js`
- `services/demo-dashboard/src/referenceData/sharedHistoryBundle.js`
- `services/demo-dashboard/src/referenceData/sharedHistoryImportCli.js`
- `services/demo-dashboard/src/referenceData/sharedHistoryParser.js`
- `services/demo-dashboard/src/research/providerUsageProjection.js`
- `services/demo-dashboard/src/scoring/phase5Acceptance.js`
- `services/demo-dashboard/src/search/discoveryService.js`

## Package dependency reachability

| Dependency | Version | Runtime imports | Public asset refs | Classification |
| --- | --- | --- | --- | --- |
| @gorules/zen-engine | 2.0.2 | 1 | 0 | CURRENT |
| @opentelemetry/api | 1.9.1 | 1 | 0 | CURRENT |
| @opentelemetry/sdk-trace-base | 2.10.0 | 1 | 0 | CURRENT |
| @tabler/core | 1.4.0 | 1 | 0 | CURRENT |
| @tabler/icons-webfont | 3.46.0 | 1 | 0 | CURRENT |
| cheerio | 1.2.0 | 7 | 0 | CURRENT |
| csv-parse | 7.0.2 | 2 | 0 | CURRENT |
| exceljs | 4.4.0 | 1 | 0 | CURRENT |
| express | 5.2.1 | 5 | 0 | CURRENT |
| imapflow | 1.2.10 | 1 | 0 | CURRENT |
| libphonenumber-js | 1.13.12 | 1 | 0 | CURRENT |
| nodemailer | 7.0.6 | 1 | 0 | CURRENT |
| pg | 8.23.0 | 26 | 3 | CURRENT |
| pg-boss | 12.28.0 | 1 | 0 | CURRENT |
| tldts | 7.4.11 | 1 | 0 | CURRENT |
| validator | 13.15.35 | 1 | 0 | CURRENT |

## Config key inventory (names only)

- `ALLOW_ACCEPT_ALL_SEND`
- `APP_INTERNAL_BASE_URL`
- `AUTO_EVIDENCE_BATCH_SIZE`
- `AUTO_EVIDENCE_ENABLED`
- `AUTO_EVIDENCE_HUNTER_ENABLED`
- `AUTO_EVIDENCE_OPERATOR_OVERRIDE_ENABLED`
- `AUTO_EVIDENCE_RECONCILE_MINUTES`
- `AUTO_EVIDENCE_SOURCE_TTL_DAYS`
- `AUTO_EVIDENCE_STAGE_LEASE_MINUTES`
- `AUTO_EVIDENCE_TAVILY_ENABLED`
- `BRAVE_SEARCH_API_KEY`
- `CATEGORY_PROCUREMENT_MAX_DISCOVERY_DEPTH`
- `CATEGORY_PROCUREMENT_MAX_PAGES_PER_COMPANY`
- `CATEGORY_PROCUREMENT_MAX_QUERIES_PER_COMPANY`
- `CATEGORY_PROCUREMENT_MAX_QUERIES_PER_PROFILE`
- `COMPANY_VERIFY_DELAY_MS`
- `COMPANY_VERIFY_MAX_PAGES`
- `COMPANY_VERIFY_MAX_RESPONSE_BYTES`
- `COMPANY_VERIFY_TIMEOUT_MS`
- `CONTACT_CHECK_MAX_PAGES_PER_CANDIDATE`
- `CONTACT_FETCH_DELAY_MS`
- `CONTACT_FETCH_TIMEOUT_MS`
- `CONTACT_MAX_RESPONSE_BYTES`
- `CONTACT_USER_AGENT`
- `CONTACT_VERIFICATION_TTL_DAYS`
- `CONTROLLED_TEST_MAX_MESSAGES`
- `CONTROLLED_TEST_MODE`
- `CONTROLLED_TEST_RECIPIENT_ALLOWLIST`
- `CORPORATE_EMAIL_WEBHOOK_SECRET`
- `CRM_API_KEY`
- `CRM_BASE_URL`
- `CRM_TIMEOUT_MS`
- `DATAFORSEO_LOGIN`
- `DATAFORSEO_PASSWORD`
- `DATA_EXCHANGE_EXPORT_DIR`
- `DATA_EXCHANGE_STAGING_DIR`
- `DATA_EXPORT_DOWNLOAD_TTL_SECONDS`
- `DATA_EXPORT_FILE_TTL_SECONDS`
- `DATA_IMPORT_MAX_CELL_CHARS`
- `DATA_IMPORT_MAX_COLUMNS`
- `DATA_IMPORT_MAX_FILE_BYTES`
- `DATA_IMPORT_MAX_ROWS`
- `DPV_WORKSPACE_ACTOR`
- `DPV_WORKSPACE_ROLE`
- `ENRICHMENT_API_KEY`
- `ENRICHMENT_MAX_COMPANIES`
- `ENRICHMENT_MAX_PAGES_PER_COMPANY`
- `ENRICHMENT_MAX_QUERIES_PER_COMPANY`
- `GENERIC_TIMEZONE`
- `GMAIL_AMBIGUOUS_WAIT_SECONDS`
- `GMAIL_API_ENABLED`
- `GMAIL_CONTROLLED_RECIPIENT_ALLOWLIST`
- `GMAIL_CONTROLLED_TEST_MODE`
- `GMAIL_INBOUND_SYNC_ENABLED`
- `GMAIL_INBOUND_SYNC_INTERVAL_MINUTES`
- `GMAIL_MESSAGE_ID_DOMAIN`
- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_OAUTH_REFRESH_TOKEN`
- `GMAIL_REPLY_TO_EMAIL`
- `GMAIL_SENDER_EMAIL`
- `GMAIL_UNSUBSCRIBE_EMAIL`
- `GMAIL_USE_CASE_APPROVED`
- `HUNTER_API_ENDPOINT`
- `HUNTER_API_KEY`
- `HUNTER_MODE`
- `HUNTER_REQUEST_TIMEOUT_MS`
- `IMAP_HOST`
- `IMAP_INBOX`
- `IMAP_PASSWORD`
- `IMAP_PORT`
- `IMAP_SENT_MAILBOX`
- `IMAP_TLS`
- `IMAP_UIDVALIDITY_RESCAN_WINDOW`
- `IMAP_USER`
- `INBOUND_EMAIL_PROVIDER`
- `INBOUND_EMAIL_SYNC_INTERVAL_MINUTES`
- `INTERNAL_API_TOKEN`
- `LINKEDIN_CRAWL_ALLOWED_PATHS`
- `LINKEDIN_CRAWL_PERMISSION_EXPIRES_AT`
- `LINKEDIN_CRAWL_PERMISSION_ID`
- `LINKEDIN_DISCOVERY_MODE`
- `LINKEDIN_OFFICIAL_API_APPROVED`
- `LINKEDIN_OFFICIAL_API_TOKEN`
- `LIVE_PROSPECT_SEND_APPROVED`
- `LLM_API_KEY`
- `LLM_MODEL`
- `MAIL_PROVIDER_VENDOR`
- `MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS`
- `MAX_HUNTER_CREDITS_PER_DAY_UNITS`
- `MAX_HUNTER_CREDITS_PER_RUN_UNITS`
- `N8N_AUTO_EVIDENCE_WORKFLOW_ACTIVE`
- `N8N_CATEGORY_PROCUREMENT_WEBHOOK_URL`
- `N8N_ENCRYPTION_KEY`
- `N8N_ENRICHMENT_WEBHOOK_URL`
- `N8N_HOST`
- `N8N_PORT`
- `N8N_PROTOCOL`
- `N8N_WEBHOOK_TIMEOUT_MS`
- `OQUMAIL_SMOKE_MESSAGE_ID`
- `ORCHESTRATOR_QUEUED_THRESHOLD_MINUTES`
- `ORCHESTRATOR_RETRY_DELAY_MINUTES`
- `OTEL_ENABLED`
- `OUTBOUND_EMAIL_PROVIDER`
- `OUTBOUND_EMAIL_TIMEOUT_MS`
- `OUTREACH_ALLOWED_MARKETS`
- `OUTREACH_ENABLED`
- `OUTREACH_MAX_SENDS_PER_COMPANY_30D`
- `OUTREACH_MAX_SENDS_PER_DAY`
- `OUTREACH_MAX_SENDS_PER_MINUTE`
- `OUTREACH_PROVIDER_MAX_ATTEMPTS`
- `OUTREACH_SEND_SCOPE`
- `OUTREACH_VERIFICATION_TTL_DAYS`
- `PGBOSS_ENABLED`
- `POSTGRES_DB`
- `POSTGRES_HOST`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `PRODUCT_OPPORTUNITY_MAX_CANDIDATES`
- `RESEARCH_CREATION_MAINTENANCE`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_FROM_NAME`
- `RESEND_REPLY_TO`
- `RESEND_USE_CASE`
- `RESEND_WEBHOOK_SECRET`
- `SEARCH_API_KEY`
- `SEARCH_DUAL_ROUTING_ENABLED`
- `SEARCH_PROVIDER`
- `SEARCH_REQUEST_TIMEOUT_MS`
- `SEARCH_STORAGE_RIGHTS_CONFIRMED`
- `SMTP_CONTROLLED_RECIPIENT_ALLOWLIST`
- `SMTP_CONTROLLED_TEST_MODE`
- `SMTP_ENABLED`
- `SMTP_FROM_EMAIL`
- `SMTP_FROM_NAME`
- `SMTP_HOST`
- `SMTP_IMAP_INBOUND_SYNC_ENABLED`
- `SMTP_MESSAGE_ID_DOMAIN`
- `SMTP_PASSWORD`
- `SMTP_PORT`
- `SMTP_REPLY_TO`
- `SMTP_REQUIRE_TLS`
- `SMTP_SECURE`
- `SMTP_UNSUBSCRIBE_EMAIL`
- `SMTP_USER`
- `SMTP_USE_CASE_APPROVED`
- `TAVILY_API_KEY`
- `TAVILY_SEARCH_DEPTH`
- `TAVILY_SEARCH_ENDPOINT`
- `TAVILY_USAGE_ENDPOINT`
- `TAVILY_USAGE_POLICY`
- `TAVILY_USAGE_REFRESH_INTERVAL_MS`
- `TZ`

## n8n workflow inventory

| File | Name | Active in JSON | Nodes | Classification |
| --- | --- | --- | --- | --- |
| workflows/02-phase6-enrichment.json | DPV Phase 6 Buyer and Cooperation Enrichment | true | 6 | CURRENT |
| workflows/03-phase10-auto-evidence-reconciliation.json | DPV Phase 10 Auto Evidence Reconciliation | false | 10 | REVIEW |
| workflows/03-phase6_1-category-procurement-match.json | DPV Phase 6.1 Category Procurement Match | false | 6 | REVIEW |
| workflows/04-phase7-controlled-outreach-and-data-exchange.json | DPV Phase 7 Controlled Outreach and Data Exchange | false | 5 | REVIEW |

## Public CSS/JS/assets reference inventory

| File | Bytes | Filename refs | Classification |
| --- | --- | --- | --- |
| services/demo-dashboard/public/app.js | 206502 | 26 | CURRENT |
| services/demo-dashboard/public/bilingual.css | 5567 | 7 | CURRENT |
| services/demo-dashboard/public/contact-results.css | 14613 | 5 | CURRENT |
| services/demo-dashboard/public/crm-shell.js | 7098 | 16 | CURRENT |
| services/demo-dashboard/public/index.html | 89582 | 30 | CURRENT |
| services/demo-dashboard/public/market-visibility.js | 1926 | 12 | CURRENT |
| services/demo-dashboard/public/opportunity-ui.js | 15851 | 7 | CURRENT |
| services/demo-dashboard/public/phase5.css | 26536 | 11 | CURRENT |
| services/demo-dashboard/public/phase7-ui.js | 56650 | 19 | CURRENT |
| services/demo-dashboard/public/phase7.css | 5144 | 9 | CURRENT |
| services/demo-dashboard/public/product-match-ui.js | 20297 | 9 | CURRENT |
| services/demo-dashboard/public/styles.css | 11452 | 7 | CURRENT |
| services/demo-dashboard/public/ui/communication-sync.js | 3010 | 8 | CURRENT |
| services/demo-dashboard/public/ui/contact-progress.js | 1193 | 6 | CURRENT |
| services/demo-dashboard/public/ui/contact-queue.js | 6122 | 9 | CURRENT |
| services/demo-dashboard/public/ui/controlled-email-verification.js | 16646 | 4 | CURRENT |
| services/demo-dashboard/public/ui/filters.js | 7604 | 8 | CURRENT |
| services/demo-dashboard/public/ui/opportunity-workspace.css | 16998 | 12 | CURRENT |
| services/demo-dashboard/public/ui/opportunity-workspace.js | 12623 | 10 | CURRENT |
| services/demo-dashboard/public/ui/outreach-workbench.js | 35248 | 11 | CURRENT |
| services/demo-dashboard/public/ui/phase10-workbench.css | 3816 | 4 | CURRENT |
| services/demo-dashboard/public/ui/phase8-components.css | 5240 | 8 | CURRENT |
| services/demo-dashboard/public/ui/phase8-pages.css | 7908 | 8 | CURRENT |
| services/demo-dashboard/public/ui/phase8-responsive.css | 2740 | 8 | CURRENT |
| services/demo-dashboard/public/ui/phase9-research-workbench.css | 16574 | 6 | CURRENT |
| services/demo-dashboard/public/ui/phase9-research-workbench.js | 62630 | 14 | CURRENT |
| services/demo-dashboard/public/ui/shell.js | 855 | 18 | CURRENT |
| services/demo-dashboard/public/ui/status.js | 1794 | 5 | CURRENT |
| services/demo-dashboard/public/ui/v3/automation-control.css | 4791 | 2 | CURRENT |
| services/demo-dashboard/public/ui/v3/automation-control.js | 9909 | 2 | CURRENT |
| services/demo-dashboard/public/ui/v3/automation-model.js | 3556 | 2 | CURRENT |
| services/demo-dashboard/public/ui/v3/charts.js | 1347 | 6 | CURRENT |
| services/demo-dashboard/public/ui/v3/companies.css | 15126 | 5 | CURRENT |
| services/demo-dashboard/public/ui/v3/companies.js | 13760 | 8 | CURRENT |
| services/demo-dashboard/public/ui/v3/components.css | 7605 | 14 | CURRENT |
| services/demo-dashboard/public/ui/v3/components.js | 3474 | 9 | CURRENT |
| services/demo-dashboard/public/ui/v3/foundation.css | 2495 | 13 | CURRENT |
| services/demo-dashboard/public/ui/v3/opportunity-dimensions.js | 4787 | 7 | CURRENT |
| services/demo-dashboard/public/ui/v3/outreach.css | 9376 | 2 | CURRENT |
| services/demo-dashboard/public/ui/v3/overview.css | 7872 | 5 | CURRENT |
| services/demo-dashboard/public/ui/v3/overview.js | 16109 | 11 | CURRENT |
| services/demo-dashboard/public/ui/v3/records.css | 9913 | 3 | CURRENT |
| services/demo-dashboard/public/ui/v3/records.js | 10032 | 2 | CURRENT |
| services/demo-dashboard/public/ui/v3/replies.js | 10669 | 3 | CURRENT |
| services/demo-dashboard/public/ui/v3/research-batch.js | 23379 | 5 | CURRENT |
| services/demo-dashboard/public/ui/v3/research-jobs.js | 1954 | 2 | CURRENT |
| services/demo-dashboard/public/ui/v3/responsive.css | 2514 | 10 | CURRENT |
| services/demo-dashboard/public/ui/v3/shell.css | 6792 | 4 | CURRENT |
| services/demo-dashboard/public/ui/v3/shell.js | 3676 | 17 | CURRENT |
| services/demo-dashboard/public/ui/v3/tokens.css | 6482 | 14 | CURRENT |
| services/demo-dashboard/public/verification-ui.js | 13968 | 5 | CURRENT |

## Detailed local evidence

`test-artifacts/cleanup-cl01/runtime-inventory.json` retains the complete baseline file list, import edges, script references and structured route/queue inventory. This generated evidence is ignored by Git. Database metadata is documented separately in `CL01_DATABASE_ORCHESTRATION_INVENTORY.md`. CL01 is inventory only: no removal is authorized by a static candidate classification.
