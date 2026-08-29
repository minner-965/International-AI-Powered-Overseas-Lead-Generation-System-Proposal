# Version Changelog

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
