# Version Changelog

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
