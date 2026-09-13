# Phase 12 WP-UI00 — Baseline freeze

Date: 2026-09-07. Scope: freeze/archive/screenshots/read-only facts. No production UI implementation.

## Version freeze

- Starting branch: `phase10-remove-internal-limits-20260904-112916`.
- Starting HEAD: `f3706d7765745fde02d7d77fe2d52eef60f87ba7`.
- Initial working tree: clean (`git status --short` empty); initial `git diff --check`: clean.
- Created branch: `phase12-workspace-ui-v3`, same HEAD. No commit, push or tag in this package; existing Phase11 tag unchanged.
- Production frontend/backend, dependency manifests/lockfile and migrations unchanged. New work consists of rules, docs, reference archive and read-only audit helper.

## Reference archive

Actual supplied source: `C:/Users/ACER/Downloads/saas_ui.html` (36,799 bytes). One HTML was received, so no second file or deduplication result is invented.

Archive: [dpv-workspace-reference-dashboard.html](../../ui/reference/dpv-workspace-reference-dashboard.html).

Source and archive SHA-256 both `e0a780180bbd444e962e8b0099a9a8fa5bbd3c725378ae9dddf36c243b237788`.

Byte-identical archival retains original sample labels, fictional values and CDN links for traceability; none is deployed. Source explicitly gives 256px sidebar, 64px header, 24/32px padding, four KPI cards, 2:1 analytical grid and two-column operations row. User exclusions override sample decorations. This is the sole visual direction, not a business-data source.

Browser direct local-file rendering was blocked by its URL policy; no workaround was attempted. Reference source was fully inspected. Rendered side-by-side visual comparison is NOT RUN and belongs to subsequent visual QA, not claimed as completed here.

## Old-page screenshot coverage

Private location: `artifacts/phase12-ui-baseline/screenshots/`. Files use `{width}x{height}-{surface}.jpg`; `manifest.json` records the capture inventory. Actual browser viewport sizes: **1440×900, 1280×720, 390×844**. The browser returns JPEG, with scrollbar exclusion/resizing (typically 1425×891, 1265×712, 375×812 image pixels respectively); filenames describe the tested CSS viewport, not a claim of pixel-exact full-screen image dimensions. Images are not artificially resized to conceal this difference.

| Surface | 1440×900 | 1280×720 | 390×844 |
| --- | --- | --- | --- |
| overview | Captured | Captured | Captured |
| opportunities | Captured | Captured | Captured |
| contact-queue | Captured | Captured | Captured |
| research | Captured | Captured | Captured |
| jobs | Captured | Captured | Captured |
| companies | Captured | Captured | Captured |
| customer-match | Captured | Captured | Captured |
| evidence | Captured | Captured | Captured |
| data-import | Captured | Captured | Captured |
| data-export | Captured | Captured | Captured |
| settings | Captured | Captured | Captured |
| company-detail | Captured | Captured | Captured |
| email-review | Captured | Captured | Captured |
| research-form | Captured | Captured | Captured |

42 real viewport screenshots: all 11 existing main routes plus 3 dialog surfaces. These are viewport baselines, not a claim of every scroll position or all component states. Company Detail was opened read-only; mail review uses existing sent content; research form was opened but not submitted. Contact-ready/Replies/System Status are not separate current routes and were not invented as baseline pages.

Old appearance remains evident: light sidebar, purple actions, excess vertical space and repeated card treatments. Captures preserve these defects rather than concealing them. Their redesign is expressly deferred to WP-UI03 onward.

## Business baseline

Actual SQL uses `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, `transaction_read_only=on` and rollback. Local before/after JSON contains aggregate counts/statuses and allowlisted flags, no recipients, email bodies or credentials.

Before: 2026-09-07 14:02:18 +08. After: 2026-09-07 14:07:14 +08.

| Entity | Before | After |
| --- | ---: | ---: |
| companies | 129 | 129 |
| sources | 364 | 364 |
| contacts | 113 | 113 |
| lead_reviews | 93 | 93 |
| collection_runs | 14 | 14 |
| research_jobs | 426 | 426 |
| current opportunities | 32 | 32 |
| outreach drafts | 3 | 3 |
| outreach approvals | 3 | 3 |
| outbound messages | 1 | 1 |
| outbound attempts | 2 | 2 |
| inbound messages | 3 | 3 |
| reply classifications | 3 | 3 |
| shared CRM outbox | 2 | 2 |
| shared CRM activities | 2 | 2 |
| shared CRM tasks | 1 | 1 |
| contact suppressions | 1 | 1 |
| company suppressions | 0 | 0 |
| outreach recipient suppressions | 0 | 0 |

Shared CRM rows are CONTROLLED (outbox 2/activity 2/task 1). Controlled application context 1/draft 1/approvals 2/message 1/attempt 1/inbound 2/activity 2/suppression 1 are unchanged. Prospect real provider calls 1 and controlled calls 1 remain unchanged: **new SMTP calls 0**. Prospect state remains SMTP_ACCEPTED / SENT_NO_REPLY / UNCONFIRMED, not delivered/replied.

Opportunity distribution: RECOMMENDED 2, EVIDENCE_REQUIRED 28, NOT_SUITABLE 2. Dashboard/outreach send flags remain DISABLED/false; controlled mode false/max0. Category/data workers do not expose those flags (null means absent, not false). All four application containers and PostgreSQL are healthy; n8n is running. No restart, new research, approvals, data edits or shared-source operations were performed.

## Outcome

WP-UI00 limited baseline scope: PASS. Screenshot manifest: 42 distinct captures validated. Browser console warning/error log during this baseline traversal: 0 captured entries; not a claim of a full network or business regression run. Full Phase12 visual acceptance: NOT STARTED. WP-UI03 and subsequent runtime implementation are outside this turn.
