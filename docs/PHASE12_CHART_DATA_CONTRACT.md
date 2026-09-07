# Phase 12 WP-UI11 chart and data contract

Date: 2026-09-07. Implementation scope: presentation only. Browser acceptance is recorded separately by the integrating agent.

| Visual | Endpoint and fields | Window and scope | Empty/error behavior |
| --- | --- | --- | --- |
| Recommended KPI | `/api/opportunities?status=ALL&limit=500`, existing status adapter = RECOMMENDED | Current projection, visible markets; returned opportunity rows, not entire directory | Valid empty response = 0; unavailable = — |
| Verified KPI | `/api/metrics`, `verified_active` | Current verified-active companies, endpoint scope | Missing = —; never substitute total companies |
| Sent awaiting reply KPI | `/api/outreach/operations-summary`, `prospect.sent_no_reply` | Cumulative prospect messages; exact existing effective reply/CRM status | Missing = —, not SMTP-accepted count |
| Pending KPI | Same endpoint `prospect.pending_management`, `pending_drafts`, `pending_followups`, `pending_contacts`; `monitoring.alerts.length` | Current action counts plus alert-type count; not unique company count | Any missing component = —; breakdown preserves units |
| Development stage bars | Metrics `verified_active`; opportunities `category_procurement_match_status` and existing management status; `/api/research/workbench-summary` `contact_ready_opportunities`; operations `prospect.smtp_accepted`, `prospect.replies` | Mixed current company/opportunity counts and cumulative mail/reply counts, explicitly captioned | Missing stage = — with no zero-width bar; no conversion percentage inferred |
| Market ring and text legend | Current opportunity rows `company_id`, `country_code`/`market`, after existing visible-market filter | Unique company IDs in returned current opportunity scope, not all directory companies; no time-series window | Successful zero = empty state; unavailable or inconsistent totals = retry message; no sample slices |
| Task summary | `/api/research/workbench-summary` `active_jobs`; `/api/research/jobs?view=inbox&limit=4` persisted fields | Current inbox response and persisted timestamps | Missing task response differs from valid empty jobs |
| Customer profile coverage bars | `/api/icp/profiles`; original renderer's `feature_coverage`, product/repeat-order/channel coverage fields | Current management/historical profile snapshots and their original sample scope; independent of DPV Score | Only an existing numeric percentage within 0–100 draws a bar; missing values keep original text, no inferred score |

## Controlled-record exclusion

The operations repository uses prospect `outbound_messages`, `inbound_messages`, approval joins and `sales_tasks.record_scope='PROSPECT'`; controlled application counters are queried separately from `controlled_application_*` tables and returned under `controlled`. The frontend reads only `operations.prospect` for mail KPIs. Controlled counters are never added. Shared monitoring alerts remain operational alert types, not prospect records.

## Implementation and explicit plan adaptation

The pre-existing native SVG ring is retained instead of adding ApexCharts or Chart.js. The stage bars remain HTML/CSS. This is an intentional adaptation of the plan's “existing library or local Chart.js” wording, not a claim that a chart library was installed. No new dependency, CDN request or synthetic trend is introduced. The small `v3/charts.js` adapter validates counts and delays decorative geometry with IntersectionObserver; text counts and percentages are immediately available independently of the SVG. Without observer support, rendering proceeds directly.

The bars show relative magnitudes, not cohort conversion: verified companies, category opportunities and messages have different units. SMTP acceptance is not presented as delivery. No historical comparison or delivery-rate line is invented.

## Remaining scope limits

- Opportunity summaries remain limited to the existing endpoint request (500) and its backend cap. This phase does not invent an all-record aggregate or change API semantics.
- Overview refresh failure handling is integrated by the main agent; unknown sources must be passed as null rather than empty arrays.
- Browser captures and full-page loading/error tests are integration acceptance, not asserted by these unit tests.

## Executed unit checks

Isolated browser fixture: `/test/fixtures/phase12-chart-states.html` on the existing loopback component lab (port 3099). Four buttons invoke the production overview renderer with valid empty responses, missing responses, partial availability, and an in-progress refresh. There are no sample company records and network connections are blocked by the fixture server CSP. Refresh switches to a valid empty response without an API call. Geometry remains governed by the actual lazy chart adapter; unit tests cover the positive-series geometry separately. The server allowlist serves only explicitly named fixture/modules/styles, not a directory. Its inline-style allowance supports production chart geometry in this isolated lab; production headers are unchanged.

`node --test test/phase12-chart-states.test.js test/phase12-overview.test.js test/phase12-overview-chart.test.js`: 12 passed, 0 failed, 0 skipped. Covers missing-versus-zero, invalid totals, lazy geometry, no-observer fallback, controlled counter exclusion and exact stage-source model contracts.
