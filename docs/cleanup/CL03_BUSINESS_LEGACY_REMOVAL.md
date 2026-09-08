# CL03 — Legacy business semantics removal

Date: 2026-09-08. Scope: CL02–CL03 only. STOP before CL04.

## Result and deployment boundary

PASS for code and isolated/read-only acceptance below. This is not a production-service restart or final cleanup release. The maintenance guard remains active; production business tables and persisted automation controls are unchanged.

Migration `063_cleanup_optional_cohort_catalog_snapshot.sql` is implemented and verified in the isolated restored database. It is **pending in production**, and is registered in the existing startup migration runner for the later authorized restoration. Applied migration files 001–062 are unchanged. Do not start the execution services just to apply it: restoration can resume provider/outreach work and belongs to the later cleanup package.

## Changes

| Area | Current behavior | Preserved history / boundary |
| --- | --- | --- |
| Opportunity API | `display_opportunity_status` uses PRECISION, RELEVANT, GENERAL_RELEVANT, EXPLORATORY, NOT_SUITABLE; ACTIVE selects the positive bands | RECOMMENDED/EVIDENCE_REQUIRED URL parameters are read-only aliases, not newly generated current states |
| Old access/readiness fields | Moved into explicitly named `historical_compatibility` in current opportunity and category-result API projections | Original supplier/access assessments, sources and decision rows remain unchanged |
| Admission filters | Retired supplier/product-access, old readiness and matrix filters no longer exclude current opportunities | Existing score fields and category evidence remain supplemental; MC04 classifier is untouched |
| UI | Five business bands and ACTIVE aggregate; separate management/communication states; no old access-gate controls | Phase12 V3 styles, responsive cards, hooks and history mappers retained |
| Research cohort | Catalog snapshot is optional context, not a required SKU/catalog admission gate | Existing snapshot references/FKs remain; absent snapshot is NULL, never invented |
| Manual route queue | ACTIVE/READY/IN_PROGRESS reads return no retired tasks; writes already reject with RETIRED_POLICY | Explicit completed/dismissed history remains readable; 10 historical records retained |
| Export | Current bands, contact readiness and email eligibility remain independent; old access/readiness-blocker columns removed from current allowlist | Existing generated export files and their historical metadata are not rewritten |

Business Opportunity, Contact Readiness and Email Eligibility remain independent. A positive business band does not grant email authorization. No manual Opportunity Confirmation is added. Review flags remain nonblocking. Existing mailbox verification, suppression, prior-send, exactly-once, draft and current first-touch policy controls are unchanged.

The legacy Phase7 decision writer remains an internal compatibility dependency for immutable mail/approval references; it is not used as MC04 admission authority. Replacing that mail infrastructure belongs to later explicitly scoped cleanup, not a hidden scoring rewrite here. Historical category values such as `CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE` are only interpreted by compatibility readers; the current category engine emits the current category states. Existing auto-evidence reconciliation already resolves obsolete supplier/buying blockers without creating new manual procurement work, so that draining compatibility is retained.

## Verification

- Full dashboard suite: 1,136 tests; 1,080 passed, 56 skipped, 0 failed. Skips remain optional/environment-dependent tests; they are not counted passed.
- Database-backed query acceptance (`scripts/cleanup-cl03-readonly-api.mjs`): 153 current companies, 37 active opportunities. Actual distribution: PRECISION 4, RELEVANT 2, GENERAL_RELEVANT 31, EXPLORATORY 108, NOT_SUITABLE 8. This check intentionally reads all markets; production market visibility remains a separate unchanged endpoint predicate.
- Current-field checks and nonblocking retired-filter checks passed against those stored projections. SELECT-only transactions; no pool refresh/recalculation.
- Production fingerprint comparison: all 147 application tables unchanged; automation controls/policy unchanged; original 62 migration file hashes unchanged; only new file 063 added. Backup dump/schema hashes unchanged.
- Isolated migration: six cohort rows retained; snapshot column nullable; three FKs retained. A NULL-snapshot insert passed; an invalid nonnull snapshot failed its FK. Test inserts rolled back. Production still has six cohort rows and the original nonnullable column until restoration.
- Browser: isolated static V3 workspace with intercepted fixtures, not production data. 1440×900, 390×900, 375×900; nine success/empty/error captures. Five band filters plus ALL/ACTIVE, Back, refresh, advanced-filter Escape/focus restore passed. Page exceptions, unexpected successful-scenario console errors, static asset errors and external/write requests: zero. Page-level overflow: zero.
- Screenshots visually inspected at desktop and phone sizes. Existing dark sidebar, white topbar, gray canvas, cards and compact mobile layout retained. No CSS redesign. This scoped check is not the all-page/full-viewport CL15 acceptance.
- Found during verification: restored the independent Jobs `EVIDENCE_REQUIRED` wire value after an overly broad label replacement; it represents a task waiting for evidence, not an Opportunity band. Added regression coverage. Restored local vendor assets in the isolated browser harness and then reran it with asset/console checks.
- Updated obsolete static tests that enforced historical recommendation defaults/matrix filters; retained behavioral, scoring, history, layout and authorization assertions.

## Local evidence and commands

- `test-artifacts/cleanup-cl03/browser/result.json` and adjacent PNGs (ignored fixture screenshots).
- `artifacts/backups/cleanup-cl00-20260908/cl03-after.json` (ignored business fingerprints).
- `node scripts/cleanup-maintenance-guard.mjs`
- `node scripts/cleanup-baseline.mjs --after --label=cl03-after --allow-new-migrations`
- `node scripts/cleanup-cl03-readonly-api.mjs`
- `node scripts/cleanup-cl03-browser.cjs`
- `node scripts/generate-current-project-status.mjs`
- `node scripts/verify-current-project-status.mjs --database`
- `npm test` in `services/demo-dashboard`

No Search/Hunter/SMTP/WhatsApp/external CRM calls, no business history deletion, no production migration application, no push/tag. STOP after CL03.
