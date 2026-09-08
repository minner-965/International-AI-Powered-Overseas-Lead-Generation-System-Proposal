# CL10 — Active UI copy and state cleanup

Date: 2026-09-08. Scope: CL10 application-owned UI wording only. Browser integration evidence is recorded below by the main acceptance run; unit checks are not a substitute for visual acceptance.

## Changes

| Surface | Before | Current |
| --- | --- | --- |
| Category evidence label | Target category procurement evidence | Target category evidence |
| Overview task label | Buyer & Procurement Evidence | Contact Evidence |
| Historical accessibility labels | Supplier access | Cooperation accessibility |
| Historical reason translation | Published supplier access reduces lock-in concern | Cooperation application channel available |
| Manual email gate | Generic Email contact authorization pending | Manual send approval required |
| Retry guidance | Internal mail-service execution explanation | Not sent. Ready to resubmit. |
| Contact queue empty state | Recommended-only explanatory narrative | Review business opportunities and contact details. |
| Operations panel | Raw provider-selection/pause narrative and redundant usage-policy paragraph | Provider, available capacity, paused state and short review action |

Chinese and English labels remain equivalent in the existing `.bi` structure. No CSS, DOM IDs, form values, business predicates, requests, database records, source evidence or message bodies were changed. Historical dictionary lookup keys remain intact to translate existing records. Manual approval checks are preserved and explicitly identified as manual-send controls; automatic first-touch policy is unchanged.

## Lexical policy and regression

- Added `config/ui/forbidden-active-copy.v1.json` covering the requested English/Chinese promotional vocabulary and obsolete business labels.
- Added `services/demo-dashboard/test/cleanup-active-copy.test.js`: recursively scans every app-owned HTML/JS file under public, rather than the previous four-file copy check. Non-rendered comments/dictionary keys are excluded; the policy does not alter original company/evidence/message content.
- The same test checks independent business/contact/email labels, preserved manual-send gates and exclusion of raw internal provider narratives.
- Focused run: 45 passed, 0 failed, 0 skipped (`cleanup-active-copy`, `phase13-mc07-automation-ui`, `frontend`, `phase10-1-b06-b08-cleanup-dispatch-ui`).
- App-owned forbidden-copy hits: 0 in this static scan. This is not a claim that arbitrary source evidence or customer correspondence contains none of these words.

## Boundaries and verification

The current V3 family, equal bilingual presentation, opportunity-pool semantics, Contact Readiness, Email Eligibility, suppression and immutable history are preserved. No live search, Hunter, SMTP or production writes were executed for this workstream. No wholesale renderer removal was attempted; reachability/CSS work belongs to CL11.

## Integrated browser evidence

`node scripts/cleanup-cl10-browser.cjs`: PASS, **169 route/state/viewport combinations** and 28 expanded-content/dialog checks. Tested all 13 existing routes at 1440×900, 1280×720, 1024×768, 768×900, 390×844, 375×667 and 844×390. Success fixtures at all sizes; empty/error fixtures at 1440/390/375; delayed-loading captures at all sizes. Company Detail, email review, Sales Actions/Activity and matched inbox were opened; Search Operations is the existing Overview/Research/Settings panel, not a new route. Filter Escape/opener focus, Back and reload passed at all seven sizes. Send remained disabled in the fixture. Zero page errors, unexpected requests, asset failures, success-console errors, rendered promotional-word hits or page-level horizontal overflow.

Evidence stays in ignored `test-artifacts/cleanup-cl10/browser/`: `result.json`, route viewport/full-page images, `company-detail-*`, `email-detail-*`, `sales-actions-inbox-*` and `overview-lower-*`. Main visual inspection covered every route family across the screenshots. First-screen and scrolled captures confirm sidebar and lazy chart rendering; full-page capture alone can omit fixed/lazy content, so it is not treated as sole visual evidence. Corrected the stretched Company Detail verification badge through CL11.

Compared the existing 1440px archived reference capture `artifacts/phase12-ui-baseline/reference-completion/2026-09-07T10-21-25-747Z/reference-1440.png` with the 1440px viewport: retained dark sidebar, white topbar, gray canvas, white cards and shared typography. Current authorized automation panel and bilingual/actual-state content intentionally differ from the sample; this is V3 preservation, not a new pixel-identical redesign claim. No new full screen-reader, native 200% browser zoom, contrast or timing certification is claimed by this cleanup.

All APIs in the browser harness were intercepted fixtures on a temporary random-port static server. No production reads/writes or external requests from that harness; import/export business persistence and real SMTP are not browser-tested here. This is scoped UI cleanup acceptance, not restoration/live E2E acceptance.

Full suite: **1,158 tests; 1,104 passed, 54 skipped, 0 failed**. All 147 business-table fingerprints, persisted controls and historical orchestration records remain unchanged; applied migrations/backups unchanged, 063 remains pending. Secret scan and current-state DB/runtime comparison PASS. STOP after CL11; no CL12, service restoration, push or tag.
