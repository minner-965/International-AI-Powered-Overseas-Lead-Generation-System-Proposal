# Version Changelog

## phase10 — 2026-09-01 — implementation complete, final acceptance incomplete

### Added and changed

- Completed WP-A04.2 and removed application-enforced Tavily daily, per-run, per-job, purpose-pool, company/profile, global and billing-window credit caps from the active runtime path.
- Research task creation is no longer limited by local numeric quotas. Confirmed Tavily account credit exhaustion is the only credit-based creation blocker; 429 rate limiting follows `Retry-After` and remains queueable.
- Preserved Provider usage auditing, request/query fingerprint idempotency, singleton dispatch, bounded worker concurrency, immutable historical stop reasons, checkpoint continuation and all email gates.
- Added migration 045 for sanitized Provider account state and append-only state transitions. Migration 044/045 preserve usage history while the current Tavily ledger has no local credit ceiling.
- Repaired continuation ownership during real reconciliation: canonical queued continuations are reused, a fresh checkpoint replay identity prevents historical pause replay, and existing outbox lineage remains exactly-once.
- Real validation recovered all four old `BUDGET_PAUSED` tasks, completed Research canary `bfb18f20-d726-4c15-9405-c5f7efaf7a7f`, observed a healthy n8n schedule, restarted the worker with zero duplicate request fingerprints, and kept every email business table at zero.
- Current full local verification is 681 tests: 666 passed, 0 failed and 15 environment-scoped skips. Isolated PostgreSQL continuation tests passed 7/7 and migration apply/replay tests passed 22/22.
- Executed the WP16 read-only DNS inspection. The live MX record is the supported Google Workspace target `smtp.google.com` at priority 1, and DMARC is present with `p=quarantine`, relaxed SPF/DKIM alignment and aggregate reporting.
- Confirmed through both Cloudflare `1.1.1.1` and Google `8.8.8.8` that the root domain publishes zero SPF records. DKIM remains unverified because the selector must come from Google Admin and was not guessed. No DNS record was modified.
- The Google sign-in surface currently ends on a rejected-login page, so the Gmail manual send/receive/reply and message-header checks were not represented as passed. WP16 remains blocked pending SPF, the real DKIM selector/activation state and a successful Workspace sign-in.
- Re-ran the complete 661-test suite, native dependency smoke, status validator, dependency audit, migration replay, deployed Gmail tests, disabled inbound queue, eight live business APIs and five browser assets. Automated checks passed with zero failures; the initially mistyped Workbench/Companies probe URLs were corrected to the actual frontend routes and returned 200.
- Implemented WP15 as a gated Gmail API Provider using OAuth 2.0 user authorization, with all Gmail and outbound feature flags closed by default and no OAuth credential exposed to the UI or logs.
- Added migration 042 for Gmail provider identity, stable RFC Message-ID/send execution lineage, mailbox history checkpoints and append-only ambiguous-send reconciliation audit. The migration applied and replayed successfully on the live PostgreSQL database.
- Reused the Phase 7 approval, suppression, outbound-attempt, inbound classification, CRM outbox and pg-boss paths. Gmail API acceptance maps only to `PROVIDER_ACCEPTED / ACCEPTED_BY_GMAIL`; it never fabricates delivery.
- Added Sent-mailbox reconciliation before any ambiguous retry, Gmail `historyId` polling, header-driven automatic-reply classification and structured DSN validation requiring recipient plus enhanced status code. Hard DSNs reuse append-only suppression; delivery-looking text alone is ignored.
- Full local verification now covers 661 tests: 653 passed, 0 failed and 8 environment-scoped skips. The rebuilt deployed image passed all 10 Gmail provider tests and all application/worker containers are healthy. Disabled live API checks made zero Gmail calls.
- Real controlled-address send/reply/CRM E2E remains pending because sender/Reply-To, OAuth client authorization and the controlled recipient have not yet been supplied. Prospect sending remains off.
- Completed WP14 with a real `@gorules/zen-engine` import/create/evaluate/dispose smoke command, clean `npm ci` verification, npm-cache-only CI configuration and Docker image packaging for the smoke script.
- Re-ran the three historical native-failure suites independently (42/42 passed), then the complete suite (650 tests: 642 passed, 0 failed, 8 environment-scoped skips). Both deployed application containers passed the native smoke; an isolated missing-module run returned the required exit code 1 without affecting the live installation.
- Removed the temporary management-token experience end to end: no token dialog, session storage, bearer header, management session endpoint or CSRF challenge remains in the browser/API flow. The server now attaches the configured workspace audit identity directly, while existing business-role checks and append-only audit attribution remain in place.
- Changed the dashboard port publication from loopback-only to `3000:3000` for the upcoming hosted deployment. Legacy management secret variables are explicitly blanked in the running dashboard container; public hosting still requires the planned company account/SSO layer rather than a shared token prompt.
- Completed WP13 with an append-only `MANUAL_OFFICIAL_ROUTE_READY` queue for verified official supplier portals, vendor registration pages, contact forms and procurement-department routes.
- Added migration 041, official-domain/source/freshness/suppression/history qualification, current queue projection, role-controlled read/action APIs and the bilingual Contact Queue section.
- Kept the user-approved company-contact opportunity rule: a qualifying company route may support `RECOMMENDED`, while the manual route queue remains independent and cannot create a named Buyer, management approval, draft, send or form submission.
- Reconciliation is idempotent and now runs after opportunity-decision refresh. The live acceptance created 44 current CONTACT_FORM tasks, replay created 0 duplicates, and one route completed a reversible READY → IN_PROGRESS → READY API exercise with two append-only audit revisions and zero outbound/approval side effects.
- WP13 verification completed with 648 tests: 640 passed, 0 failed and 8 environment-scoped tests skipped; dependency audit reported 0 vulnerabilities.
- Completed WP12 with an append-only Commercial Product Fit layer covering assortment relevance (25), commercial positioning/price band (20), attribute/specification fit (15), MOQ/order format (15), import/sourcing model (15) and recent product/buying signals (10).
- Clarified the management workflow: available public company facts may inform Commercial Product Fit, while absent price, specification and MOQ/order-format facts are skipped without enrichment and discussed by management only after prospect interest. DPV positioning is recorded as low-price to mass-market mid-range context, not a pre-contact gate.
- Revised business-opportunity contact qualification to v4: a verified named Buyer remains preferred, while an official company work email, business phone or public WhatsApp can independently make an otherwise fit company `RECOMMENDED`. This does not relax management approval, recipient verification, suppression or Gmail send gates.
- Kept Product Category Score as the opportunity hard gate and primary table score. Commercial Product Fit is shown only in Business Fit detail and never changes identity, Buyer/contact validity, management approval or send permission.
- Added migration 040, versioned score/coverage/dimension/evidence records and a current projection. Unknown dimensions remain `UNKNOWN`; the aggregate score is normalized only across evidence-backed dimensions and is always shown with coverage.
- Ran the first persisted result against Rizqé WOMENSWEAR public evidence: 72/100, MEDIUM, 50% coverage, with three supported and three unknown dimensions. A same-key replay returned the same result ID and added no row.

- Added approved, versioned DPV company-category scope independent of concrete SKU completeness, with exact/similar/profile match bases and append-only dry-run/apply decisions.
- Released one real WOMENSWEAR opportunity from the legacy internal-catalog blocker while retaining 11 customer-evidence-limited decisions and both ineligible buyer-model decisions.
- Added automatic evidence task, attempt, scheduling, exception and provider-credit ledgers; stage leases, singleton deduplication, cooldown, retry, TTL reuse and recovery preserve idempotency.
- Added persistent Tavily per-run/day/billing budgets and sanitized usage audit; eight real Tavily calls consumed eight units. Hunter remained at zero because no verified named profile Buyer passed its gate.
- Added inactive-first n8n reconciliation, management-authenticated controlled scheduling and Workbench projections while keeping automatic production switches disabled by default.
- Refreshed the unified workspace responsive shell, mobile Company Directory/detail access, stacked mobile actions and export UX without changing the 14-record business truth.
- Unified new-customer opportunity surfaces around Product Category Score: customer procurement/operated categories are compared with approved DPV supply categories at same, similar or approved-profile level; no precise item-to-item match is required.
- Replaced the legacy catalog-maintenance branch with an approved-category-only opportunity rule: shared-folder product and customer-deal imports support category/profile baselines, historical ICP and scoring, while exact customer-SKU matching is not required.
- Stopped new Product Opportunity, Cooperation and Decision flows from creating `INTERNAL_CATALOG_UPLOAD_REQUIRED` or catalog-maintenance tasks; historical database fields and rows remain read-only for audit.
- Removed catalog-maintenance panels, actions, counters and export gates. Company Detail and ordinary exports now present category-level score, scope and match basis only; they do not expose concrete product candidates.
- Added migration 032 and a database contract for `CATEGORY_SCOPE_QUALIFIED`: every new category-level opportunity has zero candidates, no catalog task and `NO_EXACT_SKU`. Historical product-opportunity and candidate rows remain read-only.
- Kept product/customer-deal imports as independent inputs to approved category/profile, historical ICP and target-customer scoring; they are not read by the new-prospect opportunity calculator.
- Made `provider_usage_events` the canonical source for ResearchJob provider calls and credits. API, Workbench, job detail and the new provider-usage Excel dataset now read the same live projection.
- Added separate reserved, used and released-unit accounting, exact job/company aggregation, replay deduplication semantics and an idempotent projection-reconciliation record without rewriting historical provider events.
- Applied migrations 035 and 036 for the canonical provider-usage views, reconciliation audit and export-type database contract.
- Completed WP09 with ten versioned, blocker-applicable evidence strategies (`S01`–`S10`), deterministic sanitized query fingerprints and the required Mexico purchasing-role vocabulary.
- Separated `strategy_attempt_number`, Provider retry and worker/lease recovery counters. Budget resume and Provider/worker recovery preserve the same strategy number; only selection of a new unused strategy consumes the 10-attempt business limit.
- Added a non-attempt checkpoint replay sequence in migration 038 so a resumed budget checkpoint can execute the same strategy without replaying the prior `BUDGET_PAUSED` settlement or mislabelling it as a Provider/worker retry.
- Extended the existing append-only attempt ledger through migration 037 with strategy identity, locale/source class, evidence-yield counters, retry counters and terminal timestamps/reasons. The 80 historical mixed-pipeline rows remain unchanged and are not relabelled as new strategies.
- Repaired the five premature `EVIDENCE_EXHAUSTED` tasks to `RETRY_SCHEDULED / READY / 0 of 10`, removed their premature cooldown and added one reconciliation schedule event per task without starting Provider work.
- Added explicit resolved-blocker, suppression, historical-customer and Buyer-responsibility-conflict stops; all applicable strategies must be exhausted before the seven-day cooldown begins.
- Exposed strategy progress, Provider retry and worker recovery as separate API/UI fields with one compact bilingual status line.
- Historical WP10 record: it introduced a 25-unit global Tavily ceiling, 5 units per ResearchJob, daily purpose pools and a company/profile cap. WP-A04.2 now supersedes every one of those numeric enforcement paths with `PROVIDER_ACCOUNT_ONLY`.
- Added priority-first round-robin scheduling: each company/profile runs at most one strategy per reconciliation round, then yields; peers at the same priority are ordered by the oldest strategy start time.
- Added `budget_pool` and `product_profile` usage lineage plus fair-round and duplicate-prevention counters in migration 039 without rewriting the eight historical Provider events.
- Added the seven efficiency measures required by WP10 and four separate Workbench facts for Tavily units, companies, strategies and newly usable evidence.
- Historical WP10 record: discovery moved onto the canonical reservation ledger. WP-A04.2 retains this ledger for usage/idempotency audit but no longer uses it as a local credit ceiling.

### Verification and real-result boundary

- Applied migrations 030 through 039; the current full suite is 625 tests with 618 pass, 0 fail and 7 environment-only skips. Migration 039 was applied and replay-verified on the live PostgreSQL database.
- Executed the fixed four-quadrant manifest: 13/13 manifest contracts and 93/93 referenced tests passed with no skip, todo or warning downgrade.
- Verified desktop/mobile browser layouts, theme/density, dialog focus, zero horizontal overflow, zero console errors and a real 14-row/36-column XLSX export containing Product Category Score and its category evidence context.
- Current business truth remains 12 Evidence Required, 2 Not Suitable, 0 Recommended, 0 Management Approved and 0 live sends. All outreach, webhook, reply and CRM side-effect tables remain empty.
- Both representative historical category jobs now project 4 ledger calls and 4 used units despite their obsolete cached counters being 0. A deployed 45-row provider-usage XLSX export completed with a valid workbook signature, and the dependency audit reports 0 vulnerabilities.
- Real PostgreSQL rollback probes verified strategy selection and the extended attempt insert contract. Migration 037 preserved 80 historical attempt rows, created 0 new strategy rows and caused 0 Provider events; dependency audit remains at 0 vulnerabilities.
- A real PostgreSQL rollback probe verified WP10 Tavily reservation and settlement with `EVIDENCE` pool and exact product-profile lineage. Migration 039 caused 0 Provider events, and the dependency audit remains at 0 vulnerabilities.
- Phase 10 code/migration/UI/automated validation passes, but V1.1 final `Implementation PASS` remains `INCOMPLETE` and `Business-result PASS=NO`: Provider is `NONE`, and controlled live send/reply/CRM plus an approved opportunity pilot have not occurred.
- Detailed result: `docs/PHASE10_RESULT.md`.

## post-phase9-full-workspace-ui-refresh — 2026-09-01 — completed locally

### Changed

- Extended the visual refresh from Opportunities to all 11 application views: Overview, Opportunities, Contact Queue, Research, Jobs, Companies, Customer Match / ICP, Evidence, Data Import, Data Export and Settings.
- Added one unified B2B workspace layer for page headers, navigation, cards, KPI panels, tables, forms, empty states, settings and responsive behavior.
- Adopted the user-provided classic data-dashboard composition across all modules: compact title/action headers, white KPI cards with top status accents, calm data panels, formal evidence-task lists and neutral table headers.
- Replaced the solid-purple evidence block with a white operational task panel, removed decorative page icons, simplified the Overview zero state and normalized Research/Jobs error states.
- Converted medium-width Company and Opportunity tables into labelled record cards and rebuilt Company Detail around available-only metrics, a stable snapshot grid and fixed review actions.
- Fixed the overlapping Opportunity status navigation: bilingual labels are stacked, the 1200 px layout uses three columns by two rows, mobile uses two or one column, and no status label overlaps another.
- Reworked Overview into four full-width KPI cards, made the Company Directory table readable through bounded horizontal scrolling and changed six-step import/export progress to a responsive 3 × 2 layout.
- Removed page-level explanatory copy, AI-style guidance, user-facing decision narration, product-match management summaries and generated “why / difficulty” prose. Formal business states, evidence, filters and actions remain.
- Renamed user-facing decision terminology to formal workspace, opportunity status, eligibility status, status history and buying-contact language while preserving backend field names and API contracts.
- Kept the released opportunity API, 20 query parameters, six status states, seven table columns, Hunter enrichment trigger and management gates unchanged.

### Current data truth

- The dashboard still reports 14 real opportunity records: 12 Evidence Required, 2 Not Suitable, 0 Recommended and 0 Management Approved.
- The three priority rows are selected from the current Evidence Required records; the chart and every KPI value are rendered from `/api/opportunities`.
- No company, opportunity, contact, outreach or provider data was changed by this presentation refresh.

### Verification

- Added three unified workspace UI contract tests in addition to the two Opportunity Workspace tests.
- Full suite: 484 tests, 480 passed, 0 failed and 4 conditionally skipped.
- Rebuilt the local dashboard container and visually checked all 11 page views; page-level and view-level horizontal overflow are both zero at the current 1208 px desktop viewport.
- Detailed implementation report: `docs/POST_PHASE9_FULL_UI_REFRESH_RESULT.md`.

## phase9 — 2026-08-31 — released

### Added

- Added immutable Phase 9 cohort, stage-event and contact-verification audit contracts through migration 029.
- Added bounded Wave A/Wave B real-opportunity enrichment with deterministic selection, one frozen profile per company, budget/stop controls and strict history/suppression gates.
- Added the real-data Research Workbench, three-step New Research Job dialog, Jobs Inbox, seven-stage detail and opportunity-blocker deep links.
- Added management-authenticated summary/task/job projections while keeping provider payloads, credentials and internal errors out of client responses.

### Actual controlled result

- Wave A completed 5/5 companies; Wave B completed the only remaining strict eligible candidate, 1/1.
- Persisted 20 public references, 6 decision-person source records, 6 immutable cohort items and 42 stage events with 0 job errors.
- All six identities were ready, but no named profile Buyer or current VALID business email was proven.
- Provider calls/units, contact-verification events, recommendations, sales-ready opportunities, approvals, sends and outbound messages all remained 0.
- Current opportunity truth remains 12 Evidence Required and 2 Not Suitable; Phase 10 eligibility is `NO`.

### Verification

- Migration checksum `052cdf4bdbfe1a33ed024e228f1a5b8b78b2bab03b36356fec63949e41e59bdf` applied and replayed successfully.
- Five deployed Workbench API reads returned 200 without sensitive projection fields.
- Seven browser viewports, light/dark, comfortable/compact, dialog/back/focus, mobile internal scroll and safe evidence links passed.
- Deployed export produced a verified 14-row, 31-column XLSX with a recorded download audit.
- Full suite: 477 tests, 473 passed, 0 failed and 4 conditionally skipped.
- Exact release ref hashes are reported by the post-push handoff verification; `docs/PHASE9_RESULT.md` records why a commit does not embed its own hash.

## phase8 — 2026-08-31 — released

### Added to the working tree

- Added migration 028 and the V2 opportunity-decision contract so product/business fit remains separate from contact readiness; missing Buyer responsibility or a current VALID contact route cannot become Recommended.
- Hardened management approval against stale revisions, non-contact-ready decisions, missing eligibility, recipient mismatch and current suppressions before any queue or recipient side effect.
- Rebuilt the management workspace around Opportunities, a Recommended-only Overview, Evidence Required routing, an independent Contact Queue and a simplified Company Directory.
- Replaced the 11-column default opportunity surface and 15 equal-weight detail tabs with a seven-column decision table and four-section detail workspace while retaining the accepted Product Match, reference matching and Phase 7 lazy records.
- Added explicit six-step Import/Export presentation, modular Phase 8 tokens/components/pages/responsive assets and persistent display preferences.
- Added Phase 8 reuse research, visual audit, design system, result report and UI contracts.

### Data integrity and release boundary

- Preserved 106 companies, 366 product-master records and every Phase 7 decision revision; the V2 refresh added 14 append-only revisions.
- Current business fit is 12 Evidence Required and 2 Not Suitable. Current Recommended and Management Approved remain 0.
- Kept management events, Contact Queue, outreach recipients, outbound messages, provider calls and email events at 0.
- Did not start a Hunter batch, Phase 9 enrichment, prospect message or Phase 10 live-contact pilot.

### Verification status

- Full suite: 449 tests, 446 passed, 0 failed and 3 conditionally skipped; Phase 8 UI contracts pass 17/17.
- Migration 028 applied with SHA-256 `c45f4d3be0e97583fd1b05a76120cec8b9d78b937f268f6f8150c9149c6252f4`; replay of 025 through 028 returned `SKIPPED_ALREADY_APPLIED`.
- Six browser dimensions passed with no page-level horizontal overflow; mobile sidebar, dialog/detail focus return, theme/density and equal-size/equal-weight bilingual rendering were checked in the deployed UI.
- The deployed export workflow generated and downloaded a 14-row, 31-column XLSX with a valid ZIP header and a recorded download audit.
- PostgreSQL and the dashboard remained healthy; category, data and outreach workers remained running; n8n behaviour was unchanged.
- `npm audit --omit=dev` still reports the two tracked moderate ExcelJS/uuid findings; no incompatible forced downgrade was applied.
- Implementation commit: `6579d57f79fbc2646a03e219923fef6d570fd105`.

## phase7 — 2026-08-31 — released

### Added to the working tree

- Added the Phase 7 controlled-outreach contracts, versioned Marketing Context rules, deterministic draft/approval/provider boundaries, inbound-event handling, suppression rules, sales tasks and CRM outbox foundations.
- Added CSV/XLSX lead, product and customer-deal import/export contracts, product revisions, import approval guardrails, short-lived export downloads and shared-folder three-hash verification foundations.
- Added a credential-free n8n orchestration workflow that accepts only `OUTREACH_RECHECK`, `IMPORT_DISCOVER`, `EXPORT_PROCESS` and `CRM_SYNC`, and delegates to the Express internal API.
- Added isolated, HTTP-less category, outreach and data workers with explicit pg-boss queue allowlists; the dashboard process does not execute background jobs.
- Pinned selected Marketing Skills and Resend Skills by repository commit, version, license and directory SHA-256; pinned ExcelJS 4.4.0 for the Node XLSX runtime.

### Safety and data integrity

- Kept `OUTREACH_ENABLED=false`, `LIVE_PROSPECT_SEND_APPROVED=false`, `OUTBOUND_EMAIL_PROVIDER=NONE` and `RESEND_USE_CASE=DISABLED` as defaults.
- Blocked Resend cold-outreach use according to its current AUP; Phase 7 does not start a live prospect pilot.
- Preserved the Phase 6/6.1 decision gates, existing company/source/contact history, product master IDs and the two restored Phase 6.1 V2/V3 plan documents.
- Kept source/shared paths, raw messages, provider payloads, credentials, internal costs and unapproved commercial claims outside ordinary API/UI/export contracts.

### Verification status

- The current full suite recorded 427 tests: 424 passed, 0 failed and 3 conditionally skipped.
- Migrations 025, 026 and 027 applied to the existing PostgreSQL database; final replay returned `SKIPPED_ALREADY_APPLIED` for all three. All recorded pre-Phase-7 business-table counts remained unchanged.
- Current Phase 6.1 facts produced 14 decision snapshots and 14 `BLOCKED` eligibility snapshots, with 0 eligible recipients.
- Database zero-send proof recorded 0 outbound messages, 0 Provider call starts, 0 outbound events and 0 real prospect sends.
- Workflow JSON and documentation static checks are covered by a Phase 7 documentation test.
- `npm audit` reports 2 moderate findings in ExcelJS 4.4.0 transitive dependencies. The proposed forced remediation would downgrade ExcelJS to 3.4.0, outside the pinned and tested runtime, so no forced downgrade was applied; the transitive findings remain tracked pending an upstream-compatible resolution.
- Browser matrix, real XLSX/CSV export and download audit, template endpoints, and shared-folder final three-hash runtime proof passed.
- Implementation commit `3ffcdb613d9ea4a3b0fc1990774c1d189d204fa5`, documentation handoff, and annotated tag `phase7` were pushed and verified against the remote repository.

## phase6.1 — 2026-08-31

### Added

- Added buyer-first Category Procurement Match using independent target-category and Buyer Business Model evidence gates.
- Added versioned product-profile catalog snapshots, bilingual taxonomy, prospect category/channel evidence, Product Opportunity recommendations and real-product foreign-key boundaries.
- Added Supplier Access V3, Product Access Matrix V3 and deterministic Readiness V3 without redefining Phase 5/6 matrices or scores.
- Added a dedicated ResearchJob type, five pg-boss queues, an n8n workflow, Express APIs and fresh-discovery integration at company × product-profile granularity.
- Extended Opportunities and Company Detail with bilingual Buyer Model, Product Match, Product Opportunity, Supplier Access, matrix and readiness views.

### Data integrity

- Completed the official 7-company × 2-profile run with 14 unique results and 70/70 queue steps completed.
- Retained all unknown evidence as unknown; trading/distributor wording alone did not qualify a company and excluded intermediary evidence remained ineligible.
- Kept Product Opportunity secondary to the category gate and returned 0 real candidates without padding or changing customer match facts.
- Preserved the Phase 6 fixed acceptance job, historical evidence, `collection_runs`, raw `product_master`, DPV Score and both historical/reference matches.
- Kept internal products, prices, orders, customers and private paths out of public provider payloads, ordinary APIs, UI and Git reports.

### Verification

- 325 tests executed: 322 passed, 0 failed and 3 conditionally skipped.
- The official ResearchJob completed with 198 source rows, 116 distinct public URLs, 131 observations and 0 job errors/timeouts.
- Migration 024 applied and replayed through the explicit advisory-lock/checksum ledger.
- Six browser viewport checks, light/dark, comfortable/compact, detail navigation, focus restoration and long bilingual status wrapping passed with no page-level horizontal overflow.
- Fixed a progress-aggregation join that could create an excessive PostgreSQL temporary spill; the accepted run recorded zero temporary bytes/files.

### Current evidence result

- Buyer models: 1 direct end buyer, 0 distribution buyers, 10 unclear intermediaries, 2 excluded intermediaries and 1 unknown.
- Category Procurement Match: 0 pass, 6 customer-evidence required, 7 internal-catalog evidence required and 1 ineligible buyer-model result.
- All 14 Product Opportunity rows are `NOT_RUN_GATE_FAILED`; Supplier Access remains an independent axis.
- No outreach, form submission, supplier registration or Phase 7 work was added.

## phase6 — 2026-08-29

### Added

- Added ResearchJob-based buyer/procurement enrichment for active AE and MX opportunities.
- Added normalized decision-maker/department roles, product-specific relevance, public business contact routes and traceable evidence.
- Added a separate six-dimension cooperation-feasibility score, access matrix and explainable readiness state without changing Phase 5 scores or matches.
- Added optional Hunter integration with persistent credit controls and a LinkedIn discovery-only reference boundary.
- Added Phase 6 n8n orchestration, pg-boss work, Express APIs, opportunity filters and bilingual company-detail views.

### Data integrity

- Completed the final acceptance job for 7 eligible companies: AE 6 and MX 1.
- Persisted 7 conservative department-level routes, 33 public business contact routes, 7 official evidence rows and 33 LinkedIn discovery references.
- Retained LinkedIn references as review hints with no LinkedIn content fetched.
- Preserved `collection_runs`, DPV Score, Management Baseline Match, Mexico Historical Match and all historical source rows.
- Excluded non-target and unsupported company identities without fabricating replacements.

### Verification

- 238 tests executed: 235 passed, 0 failed and 3 conditionally skipped.
- The final job completed 35/35 company-specific search requests with 0 errors and 0 timeouts.
- Desktop, mobile, light/dark, native zoom, detail-dialog and focus-restoration checks passed.
- PostgreSQL, the management dashboard and both Phase 5 and Phase 6 n8n workflows remained operational.
- No outreach, form submission, supplier registration or LinkedIn content collection was added.

### Current limitations

- The accepted public evidence set contains no verified named buyer or verified buying/procurement department.
- No public supplier portal or vendor-registration route was found in the final set.
- Hunter remained disabled and used 0 credits in the final run.

## phase5-v2.3.1 — 2026-08-29

### Added

- Added the OKKI CRM historical-data import pipeline.
- Imported 46 historical CRM customer/lead records, 248 historical contacts and 83 historical activities.
- Added internal historical CRM summaries, read-only APIs and management-workspace views.
- Added UAE historical CRM context without classifying historical leads as converted customers.

### Data integrity

- Source exports remain external to Git and are processed through ignored local staging.
- Import replay is idempotent and does not duplicate historical customers, contacts or activities.
- Historical CRM contacts remain separate from public-web contact-verification evidence.
- Mexico Historical ICP remains unchanged at 5 converted-customer samples, 13 order samples, 11 features and 63.21% coverage.
- Win/loss coverage remains `NONE`; CRM workflow statuses are not interpreted as commercial outcomes.

### Verification

- 172 tests executed: 169 passed, 0 failed and 3 conditionally skipped.
- PostgreSQL, the management dashboard and n8n remained operational.
- Existing public research data counts and scoring behavior remained unchanged.
- Desktop and mobile management-workspace checks passed.

### Known limitations

- The imported CRM history contains no explicit won/lost outcome dataset.
- Historical CRM contacts are not treated as independently verified public contacts.
- Historical lead activity does not establish an order, quotation acceptance or conversion.
- At the time of this Phase 5 release, Phase 6 had not started; see the newer `phase6` entry above.
