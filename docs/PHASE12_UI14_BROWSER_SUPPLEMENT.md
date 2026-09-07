# WP-UI12–14 — independent browser supplement

Date: 2026-09-07. User explicitly approved independent Playwright testing. This supplement supersedes the earlier NOT RUN entries for native zoom and reduced-motion emulation only; it is not full Phase 12 acceptance.

## Executed checks

Script: `scripts/phase12-browser-accessibility.cjs`. Fresh temporary Chrome profiles, no user profile/session access. HTTP is restricted to GET/HEAD on `http://127.0.0.1:3000`; other requests and WebSockets are blocked, service workers disabled. No business mutation control is clicked. Only the research dialog is opened and dismissed without submission.

| Configuration | Actual content viewport | Routes | Result |
| --- | --- | ---: | --- |
| Native 200%, window 1440×900 | 712×402 CSS px | 13 | PASS: zoom verified, no document overflow |
| Native 200%, window 1280×720 | 632×312 CSS px | 13 | PASS: zoom verified, no document overflow |
| Reduced motion, desktop | 1440×900 CSS px | 13 | PASS: preference and computed durations verified |
| Reduced motion, phone | 390×844 CSS px | 13 | PASS: preference and computed durations verified |

All thirteen current workspace routes are covered. The four configurations also passed research-dialog Shift+Tab containment and Escape/opener restoration. Dialog widths were 696, 616, 780 and 374 CSS px respectively, within their viewports. At short zoomed heights, dialog content scrolls while cancel/continue remain visible.

Native zoom is selected through Chrome's own `chrome://settings/appearance` `#zoomLevel` control, label **200%**. At 100%, the first window had a 1424px content width and DPR 1; at 200%, width became 712px and DPR 2. The second changed 1264→632px. `visualViewport.scale` and root CSS zoom remained 1. No CSS document scaling, device-scale override or pinch emulation is used to claim zoom. The launch's fixed device scale of 1 is identical in baseline and zoom observations.

Reduced-motion uses the browser preference emulator. `matchMedia('(prefers-reduced-motion: reduce)')` returned true; maximum computed visible-element transition and animation durations were **0.01ms** across all 26 route observations. This confirms the CSS motion policy, not a claim that every Web Animation object is absent or that assistive technology was tested.

Final run: `artifacts/phase12-ui-baseline/browser-accessibility/2026-09-07T08-57-45-364Z/result.json`. **52/52 page checks, 4/4 dialog checks; zero page exceptions, HTTP errors or blocked request attempts.** Screenshots are private in the same directory. Representative zoom overview/dialog and phone captures were inspected; the measurement matrix is not an assertion that every full-scroll region was visually reviewed.

Two calibration directories are not final screenshot evidence: `08-55-21-900Z` used a screenshot helper that clipped native-zoom captures; `08-56-58-947Z` used a headless capture mode that produced blank images and was interrupted. Final screenshots use the browser's surface capture with no clipping rectangle. No production UI change was made to address these test-harness issues.

## Remaining boundaries

Business preservation was rechecked with `business-wp14-browser-before.json` (08:53:37.766Z) and `business-wp14-browser-after.json` (09:02:05.436Z). All collected database aggregates and runtime flags compare deeply equal after excluding observation time. Companies/sources/contacts remain 129/364/113; research jobs 426; opportunities 32; drafts/approvals 9/9; outbound messages/attempts 1/2; real prospect/controlled provider calls 1/1. The 9/9 draft/approval starting count was already present before this supplement, rather than the previous turn's 8/8; this test did not create that difference. This is aggregate preservation evidence, not every-row checksum. Syntax checks for both browser scripts and `git diff --check` passed.

- Performance and production network results are in [the separate browser performance report](PHASE12_UI14_BROWSER_PERFORMANCE.md). Exceeding the project's 15% gate is not waived by permission to test.
- Fresh same-CSS-viewport rendering of the archived reference and exhaustive composited contrast/screen-reader assessment remain open from the preceding report.
- This turn adds test tooling and reports only. No production frontend, backend, database schema or dependency version is changed. No email, approval, research task, import or export is initiated. Temporary browsers are closed and the user's browser settings are untouched.
- STOP remains WP-UI14; no WP-UI15/16, commit, push or tag.
