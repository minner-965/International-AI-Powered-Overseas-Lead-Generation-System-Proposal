# Phase 13 — MC06 Search Plan UI Result

Status: PASS for MC06 UI scope. Date: 2026-09-08. Phase12 V3 remains the visual authority; STOP after MC06.

The Research scope review and ResearchBatch detail now render the read-only `search_plan` contract: scope count, Precision/Coverage strategy counts, languages, planned totals and strategy version. Every displayed count is labeled as planned, not executed. Native disclosure shows at most five escaped query examples per lane. No query execution or extra provider call is added by the interface.

The badge is **已规划 / Planned**, not queued or executed. Missing plan values remain unknown rather than zero. Preview loading and error states are local to the Search Plan section, with an explicit read-only retry. No MC04 business classification, MC05 frozen-scope membership or email eligibility rule is altered.

## Actual preview values

| Field | Value |
| --- | --- |
| Frozen scopes | 26: 2 markets × 13 approved categories |
| Search strategy version | 2.0.0 |
| Precision strategies | 7 |
| Coverage strategies | 8 |
| Planned queries | 579 |
| Precision planned | 273 |
| Coverage planned | 306 |
| Languages | en, es |
| Planner skipped items | 6; backend result documents missing-parent reasons |

These are planned queries, not executed searches, provider calls, cost or discovered companies. No such executed metrics are inferred from the plan.

## Browser evidence

Harness: `scripts/phase13-mc06-browser.cjs`. Final evidence timestamp: 2026-09-08T04:51:36.320Z. Evidence is private/ignored at `artifacts/phase13-mc06/browser/`, including `result.json`, seven `plan-WIDTHxHEIGHT.png` and seven `samples-WIDTHxHEIGHT.png` captures.

Actual registry GET and read-only `/api/research/batches/preview` POST responses were used. Parent detail uses a **browser-only parent response carrying that actual plan**, because production batch creation solely for QA is out of scope. Loading timing and one temporary-error response are browser-only fixtures. No production Create request was submitted.

| Browser check | Result |
| --- | --- |
| Actual preview, both lanes, strategy version | PASS |
| 1440×900 | PASS |
| 1280×720 | PASS |
| 1024×768 | PASS |
| 768×900 | PASS |
| 390×844 | PASS |
| 375×667 | PASS |
| 844×390 | PASS |
| Sample disclosure, at most five per lane | PASS at all seven sizes |
| Parent planned counts, no executed claim | PASS with browser-only parent |
| Escape and exact opener focus | PASS |
| Browser Back/Forward and visible route | PASS |
| Loading state | PASS |
| Temporary error, disabled Create and successful retry | PASS |
| 200% equivalent layout reflow | PASS at 720×450 CSS viewport, corresponding to 1440×900 at 200% |
| Native visual page zoom 200% | PASS; Chromium CDP reports `visualViewport.scale = 2` |

Final harness: **15 checks PASS**, **0 page errors**, **0 unexpected HTTP failures/404**, **0 remote UI asset requests**, **0 blocked business-write attempts**. The intentional preview 503 fixture is recorded separately from unexpected HTTP failures.

The zoom check is precise about its scope: headless Chrome's Control-plus shortcut did not change browser zoom. Native visual page scale and equivalent layout reflow were therefore tested separately, without CSS/document-scale hacks in production. This report does not claim a desktop browser-menu zoom interaction or full screen-reader certification.

## Visual comparison and fix

The accepted reference was reviewed both as source and as the archived actual 1440px reference screenshot at `artifacts/phase12-ui-baseline/reference-completion/2026-09-07T10-26-16-861Z/reference-1440.png`. The new feature extends its dark-sidebar, white-topbar, gray-canvas, white-card hierarchy. The reference has no Search Plan screen, so no pixel-identical unseen-page claim is made.

Actual desktop, 390px mobile, 844×390 landscape and zoom captures were inspected. The first landscape run found that the fixed dialog header, scope counts and sticky footer consumed the available height and obscured the sample control. A scoped short-height rule now makes the dialog one scrollable surface with a nonsticky footer. The final landscape run reaches and operates the sample control successfully.

The `dpv-workspace-ui` skill kept the existing V3 geometry and semantic tokens. `ui-ux-pro-max` informed the compact native disclosure and long-query wrapping; it did not introduce a new style or dependency. Chinese/English labels remain equal-sized within their roles. Query content is escaped, direction-aware, and capped to five examples per lane rather than rendering the whole matrix.

Key captures: `plan-1440x900.png`, `samples-390x844.png`, `samples-844x390.png`, `batch-planned.png`, `reflow-200-equivalent.png`, `native-page-zoom-200.png`.

## Regression and boundary

Eleven targeted MC05/MC06 and Research/Jobs tests passed, including planned-only values, missing-versus-zero values, sample caps and retained form hooks. Full-suite, database immutability and provider settings evidence belongs to `PHASE13_MC06_QUERY_MATRIX_RESULT.md`.

No new provider endpoint is called by this UI. No Brave activation, live search, Hunter request, SMTP send, production ResearchBatch creation or MC07 work was performed by this UI workstream. Existing background activity is accounted for separately by the main data audit.
