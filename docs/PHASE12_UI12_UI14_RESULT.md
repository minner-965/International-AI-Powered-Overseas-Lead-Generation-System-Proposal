# Phase 12 — WP-UI12–14 execution result

Historical checkpoint. Later user authorization includes WP-UI15/16 and revised resource/loading thresholds (40%/20%). See PHASE12_UI_RESULT.md for current handoff status; measurements and unverified accessibility/reference items below remain historical evidence, not automatically converted to PASS.

Date: 2026-09-07. Authorized boundary: WP-UI12, WP-UI13, WP-UI14 only.

## Outcome

Responsive and keyboard defects were repaired and deployed to the local dashboard. Functional regression passes. After explicit permission, independent browser testing verified native 200% zoom and reduced-motion behavior (52 route checks and four dialog checks). **Full WP-UI12–14 acceptance remains incomplete**: performance gates and the remaining reference/accessibility assessment are not all accepted. No Phase 12 final PASS, WP-UI15 cleanup, commit, push or tag is claimed. See [browser supplement](PHASE12_UI14_BROWSER_SUPPLEMENT.md) and [actual performance comparison](PHASE12_UI14_BROWSER_PERFORMANCE.md).

The project UI skill governed the reference geometry and preservation of business behavior. UI/UX guidance informed focus and touch checks, not a new visual direction. Three parallel workstreams covered keyboard defects, regression/security, and performance/chart sources; the primary agent integrated fixes and operated the browser.

## Repairs

1. Mobile sidebar closes at the desktop breakpoint and releases `inert`; opening it at 390px then resizing to 1440px was reproduced before the repair and retested afterward.
2. Shared native-dialog Tab boundaries cover research, company details, search and filters. Respect existing prevented events and the mail dialog's own guard. Escape now affects the event's owning dialog rather than accidentally dismissing a lower dialog.
3. Mail review restores focus to a visible company-row action instead of a hidden mobile sidebar button. No approval/send request changed.
4. Dark-theme brand foreground uses its semantic contrast pair.
5. Desktop topbar corrected from 77px rendered height to 64px including border. Content allows a 1280px inner area with 32px gutters, matching the reference geometry.
6. Removed inherited page-body width reduction. Mobile company rows no longer nest individual cards inside another padded card and a capped vertical scroll region.
7. Mobile settings use full-width selections so current bilingual choices remain legible. Bilingual standard/compact preferences now change row spacing only, retaining equal Chinese/English font size and weight.
8. Mobile overview suppresses repeated explanatory KPI captions; labels and actual values remain. Research title/time and company heading/context occupy separate rows. Adjacent category labels in the overview task list now have spacing and wrap.
9. Research's English channel label no longer displays the raw `VALID` enum. Source values, scores, evidence and request payloads are unchanged.
10. Current status scope/schema/checker updated to UI12–14 and the actual latest implementation commit. Historical Phase 11 release identifiers were preserved.

## Verification summary

| Check | Actual result |
| --- | --- |
| Seven viewport sizes × thirteen routes | 91 layout observations, no page-level horizontal overflow |
| Visible button/summary/select/input heights | No sub-44px results in initial 91 observations; radios/checkboxes excluded from this height query |
| Dialog keyboard | Research, global search, company detail, advanced filters and mail focus checks passed |
| Theme/preferences | Light/dark and standard/compact changes observed; original preferences restored |
| Nine component states | Rendered in isolated fixture outside production static root |
| Full test suite | **913 total: 859 passed, 0 failed, 54 skipped**, 4,830.6261ms |
| Phase 10/11 focused suite | 340 total: 290 passed, 0 failed, 50 skipped |
| PostgreSQL isolated regression | **18/18 passed**, 57 migrations applied to temporary DB, 34 production ledger checks matched |
| Isolated regression external provider calls | **0** |
| Current status validator / diff whitespace check | PASS |
| Final static HTTP traversal | 47 paths, 1,629,428 decoded text bytes, 0 failures, 0 external origins in traversal |
| Browser error log | Empty error list in observed session |

Skipped test counts are not passes. Isolated DB regression additionally exercised real SQL concurrency, UID idempotency, classification replay, CRM effects, opt-out task closure and scope constraints. It did not send SMTP mail or call an external CRM. Its temporary database was dropped and absence verified; the operational database connection was read-only. The 18 checks are separate from the 913-test suite.

## Business preservation

Read-only snapshots: `artifacts/phase12-ui-baseline/business-wp12-before.json` at 08:22:34.847Z and `business-wp14-final.json` at 08:42:52.552Z. All collected database aggregates and runtime flags compare deeply equal after removing observation time.

| Entity | Before | After |
| --- | ---: | ---: |
| companies | 129 | 129 |
| sources | 364 | 364 |
| contacts | 113 | 113 |
| lead_reviews | 93 | 93 |
| collection_runs | 14 | 14 |
| research_jobs | 426 | 426 |
| business_opportunity_current | 32 | 32 |
| outreach_drafts / outreach_approvals | 8 / 8 | 8 / 8 |
| outbound_messages / attempts | 1 / 2 | 1 / 2 |
| inbound_messages / reply_classifications | 3 / 3 | 3 / 3 |
| crm_sync_outbox / activities / sales_tasks | 2 / 2 / 1 | 2 / 2 / 1 |
| contact_suppressions | 1 | 1 |

Prospect provider calls remain 1; controlled provider calls remain 1. Controlled rows and CRM scope counts are unchanged. Zero task-originated emails, approvals, research creation or operational data writes. Only the dashboard container was rebuilt; existing worker configuration and shared-folder source files were left unchanged. This is aggregate preservation evidence, not a byte-level checksum of every business row.

The 8 drafts/8 approvals were already present at this task's baseline. Do not substitute the preceding task's 6/6 snapshot as this task's starting state.

## Remaining acceptance gates

- Native 200% browser zoom: **now PASS** in two independent browser window sizes, using Chrome's native setting and verified DPR/layout changes. The previous ineffective keyboard attempt is not used as evidence.
- Reduced-motion browser emulation: **now PASS**, 26 route observations with actual preference and computed duration checks. Assistive-technology and exhaustive contrast assessment remain open; this report is not a WCAG conformance certificate.
- Reference comparison uses the user-provided screenshot plus archived HTML dimensions. A fresh live HTML render at a proven identical CSS viewport was not captured; visual results are detailed separately.
- Independent cold/warm reconstructed comparison and a production cold network trace are documented in the linked browser performance report. The earlier static availability traversal is not substituted for these measurements.
- Historical timing evidence remains unavailable; reconstructing frozen code now is explicitly distinguished from historical measurements. The measured resource growth exceeds 15%; no performance waiver or blanket PASS is implied.

Detailed browser results: [PHASE12_UI_VISUAL_QA_RESULT.md](PHASE12_UI_VISUAL_QA_RESULT.md). Supporting audits: [regression](PHASE12_UI14_REGRESSION_AUDIT.md), [performance](PHASE12_UI14_PERFORMANCE_AUDIT.md).

STOP after WP-UI14. Resolve the named verification gates before declaring these packages fully accepted. WP-UI15 and WP-UI16 were not started.
