# Phase 12 WP-UI01 — UI capability inventory

WP-UI16 consolidation: the inventory below is the historical starting audit. The final runtime retains native HTML/CSS/JS, local Tabler and Tabler Icons, with thin V3 adapters and semantic HTML/CSS charts. No production dependency or framework was added in Phase 12. Current cleanup reachability is documented in PHASE12_UI15_CLEANUP_RESULT.md; final handoff is PHASE12_UI_RESULT.md.

Date: 2026-09-07. Scope: read-only code/dependency audit; no UI implementation, dependency installation, database write, approval or mail send in this workstream.

## Decision

Reuse business and interaction capabilities, not the Phase 8/post-Phase 9 appearance. `saas_ui.html` supplied by the user is the sole new visual reference. Sidebar, topbar, palette, cards, KPI, tables and every detail/workspace view require one coherent visual replacement in later authorized work packages. This inventory is not a visual acceptance or screenshot completion claim.

## Entry points and CSS cascade

All paths below are repository-relative. Frontend root: `services/demo-dashboard/public/`.

`index.html:9–24` currently loads two local vendor stylesheets plus 14 application stylesheets, in this order:

1. `/vendor/tabler/css/tabler.min.css`, `/vendor/tabler-icons/tabler-icons.min.css`
2. `styles.css`, `bilingual.css`, `contact-results.css`, `phase5.css`, `phase7.css`
3. `ui/phase8-tokens.css`, `ui/phase8-foundation.css`, `ui/phase8-components.css`, `ui/phase8-pages.css`, `ui/phase8-responsive.css`
4. `ui/phase9-research-workbench.css`, `ui/opportunity-workspace.css`, `ui/workspace-system.css`, `ui/phase10-workbench.css`

`index.html:279` onward loads local Tabler JS, then modules `crm-shell.js`, `app.js`, `ui/shell.js`, `ui/filters.js`, `ui/contact-queue.js`, `ui/outreach-workbench.js`, `ui/phase9-research-workbench.js`, `ui/controlled-email-verification.js`, `ui/workspace-system.js`. `app.js:1–66` imports verification, opportunity, product-match, Phase 7 and opportunity-workspace helpers. These are live dependencies, not safe-to-delete files merely because their phase number is old.

`crm-shell.js:6` owns hash navigation, view visibility, focus and `crm:viewchange`. `ui/workspace-system.js` currently decorates page headings and sets `data-workspace-ui`; this is predominantly obsolete visual enhancement and a later removal candidate once equivalent new behavior and imports are verified.

## Page → renderer → API → state → test map

API entries are representative actual call sites, not permission to execute mutations. Test names are under `services/demo-dashboard/test/`; presence is not a claim that this audit reran them.

| `data-app-view` / surface | Renderer (public/) | Actual API family | Preserved state / hooks | Existing regression anchors |
|---|---|---|---|---|
| overview | `app.js:569`, `renderOverviewCompanies:711`; `ui/outreach-workbench.js:106` operations summary | `/api/metrics`, `/api/opportunities`, `/api/outreach/operations-summary`, `/api/research/workbench-summary` | API-derived KPI; selected view; no example counts | `phase8-ui-contract`, `phase11-outreach-workbench-ui`, `phase11-operations-export` |
| research | `ui/phase9-research-workbench.js` renderSummary, renderPriorityTasks, renderRecentJobs; `app.js:2342` submit | `/api/research/workbench-summary`, `/api/research/tasks`, `/api/research/jobs` | job id, scope, provider status, dialog; `#research-new-job-open` | `phase9-ui-contract`, `phase9-research-workbench`, `phase10-research-direct-queue` |
| companies | `app.js:696` renderCompanyTable, `:1229` load | `/api/leads` | `#leads`, `#company-pagination`, filter/page selection, company id | `frontend`, `phase8-ui-contract`, `phase11-company-review-entry` |
| opportunities | `app.js:910` renderOpportunityTable; `ui/opportunity-workspace.js:131` | `/api/opportunities` | category profile, status, counts, auto/human workstream; `data-opw-status`, `#opportunity-status-chart` | `phase9-opportunity-workspace`, `phase10-ui-contract`, `phase10-commercial-product-fit` |
| contact-queue | `ui/contact-queue.js:33`; `ui/outreach-workbench.js:52,59` | `/api/workspace/contact-queue`, `/api/outreach/workbench`, draft/approval/message endpoints | selected company/profile, current draft, dirty state, send_allowed/retry_allowed, `crm:openoutreach` | `phase11-outreach-workbench-ui`, `phase11-approved-draft-revision`, `phase11-blocked-before-provider-retry` |
| customer-match | `app.js:1359` renderIcpProfiles | `/api/icp/profiles`, `/api/icp/profiles/:id` | `#icp-profile-content`, approved profile semantics | `phase5-v2-icp`, `phase5-matching`, `phase6-1-ui-contract` |
| evidence | `index.html:197` directory entry; company detail renderers | company/detail evidence and verification endpoints | `data-open-view="companies"`, evidence payload unchanged | `phase8-ui-contract`, `verification` |
| jobs | `ui/phase9-research-workbench.js:624,728` renderJobs/renderJobDetail | `/api/research/jobs?...`, `/:id`, `/:id/results`; `app.js` enrichment jobs | cursor, selected job, polling, error/empty/loading, URL job parameter | `phase9-api-contract`, `phase9-research-workbench`, `phase10-orchestrator-observability` |
| data-import | `phase7-ui.js:190,212`; `app.js:1056,1150,1171` | `/api/data-imports`, `/api/import-batches`, `/api/crm-history` | dry-run/confirm distinction, import id, row errors | `phase7-data-exchange-import`, `phase7-ui-contract`, `shared-folder-readonly` |
| data-export | `phase7-ui.js:279` renderExportResult | `/api/data-exports`, `/:id`, `/:id/download` | export id/token/status, binary response, XLSX/CSV type | `phase7-data-exchange-export`, `phase7-data-exchange-xlsx`, `phase11-operations-export` |
| settings | `ui/shell.js`, `crm-shell.js`, `ui/controlled-email-verification.js:61–170` | controlled-tests runtime/list/detail; research summary/provider refresh | local preferences; controlled context/draft/confirmation; `#controlled-mail-panel` | `phase11-controlled-email-ui`, `phase11-controlled-application`, `workspace-system-ui` |
| Company Detail | `app.js:1959` showLead; `phase7-ui.js` attachPhase7CompanyDetail | `/api/leads/:id`; company score/match/history/fit; contact routes; inbox/thread/events | `#detail`, company_id vs lead_review_id, `crm:opencompany`, close/focus, separate company vs management approval | `phase11-company-review-entry`, `phase7-ui-contract`, `phase6-1-ui-contract` |
| Verification Detail | `app.js:462` renderVerificationDetail | `/api/research/candidates/:id/verification` | `#verification-detail`, `#verification-detail-close`, evidence | `verification`, `phase8-ui-contract` |
| Mail Review dialog | `ui/outreach-workbench.js:52` | prepare, submit, approve/reject, enqueue/retry | `#outreach-review-form`, subject/body, approval/version, dirty guard, separate send action | `phase11-outreach-workbench-ui`, `phase11-outreach-workbench` |

Test anchors above omit the common `.test.js` suffix.

## Reusable components and boundaries

- Native tables: semantic headings/captions, `tbody` renderers, scroll wrappers, filters and pagination. No independent data-grid dependency found in package/lock/public searches. Restyle or restructure presentation; preserve query/filter/paging semantics and event bindings.
- Native `<dialog>`: existing close, focus, busy/error, long-content and approval interactions remain capabilities to preserve. Visual drawer dimensions and old styling are not retained by default.
- Tabler core `1.4.0` and icons-webfont `3.46.0` are installed locally and declared exactly. Local vendor routing is at `src/server.js:516–518`. Retain mature interaction/icon capability while overriding obsolete visual defaults to V3.
- Important chart finding: no standalone Chart.js/ApexCharts/ECharts package entry or live public chart-script usage was found, **but Tabler bundles ApexCharts `3.54.1` locally** in `node_modules/@tabler/core/dist/libs/apexcharts/`. Its actual JS banner and local LICENSE state MIT. Current opportunity chart is semantic HTML/CSS (`ui/opportunity-workspace.js:115`), not that library. Evaluate bundled ApexCharts before adding Chart.js; do not equate “unused” with “absent.”
- Browser tests: repository has Node test contracts (including UI source contracts), not a declared Playwright/Puppeteer runtime dependency. Live browser evidence is a separate acceptance responsibility. Existing source assertions that encode obsolete styling must be revised when their surface migrates, while business/hook assertions remain.
- State helpers: preserve `.bi` bilingual structure, `ui/status.js`, market visibility, filters, local preference persistence, keyboard navigation and native zoom behavior. CSS values and layout hierarchy are replaceable.

## Skill inventory

This agent has no executable `/skills` UI command; no command success is claimed. The session skill catalog and read-only local inventory show `ui-ux-pro-max`, `design-taste-frontend`, `garment-quote-master`, `lineas-order-finalizer` under `C:/Users/ACER/.codex/skills`, plus system/plugin skills supplied in the session. Repository `.agents/skills/dpv-b2b-outreach/SKILL.md` also exists; `.agents/vendor/marketingskills` holds vendored reference skills, not proof of runtime activation. `dpv-workspace-ui` installation belongs to WP-UI02; this audit did not install or activate it.

## Future deletion gate

For each replaced stylesheet/module: enumerate static HTML links, ESM imports, runtime selectors/events, generated markup and test assertions; migrate its still-needed interaction logic; verify every page and dialog under V3; demonstrate zero remaining references; remove the obsolete file and import together; rerun business/hook contracts and browser checks. Never remove all phase-named JS/CSS wholesale. During WP-UI00–02 leave production assets untouched. The old UI system is historical context only after V3 supersession, not a competing design authority.

## Outcome

WP-UI01 inventory and reuse registry drafted from actual source/package evidence. No production assets or dependencies changed by this workstream. Full visual replacement, new charts and browser screenshot acceptance remain outside this workstream.
