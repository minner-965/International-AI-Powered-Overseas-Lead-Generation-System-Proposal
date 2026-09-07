# Phase 12 — Browser visual QA and reference comparison

Current consolidation: WP-UI15/16 cleanup and post-cleanup browser results are recorded in PHASE12_UI_RESULT.md. The new performance allowances do not waive the reference/accessibility limitations described here.

Run: 2026-09-07, approximately 16:20–16:43 +08:00. Browser: Codex in-app browser, loopback dashboard. This is a bounded implementation audit, not complete accessibility certification or pixel-identical acceptance.

## 1. Page layout

Routes inspected: Overview, Opportunities, Email Review & Contact, Replies & Follow-up, Research, Jobs, Contact-ready, Companies, Customer Match, Evidence, Import, Export, Settings.

| Viewport override | Routes measured | Page overflow |
| --- | ---: | --- |
| 1440×900 | 13 | None |
| 1280×720 | 13 | None |
| 1024×768 | 13 | None |
| 768×900 | 13 | None |
| 390×844 | 13 | None |
| 375×667 | 13 | None |
| 844×390 | 13 | None |

The desktop scrollbar can reduce `documentElement.clientWidth` by 15px; compare scrollWidth with clientWidth, not the requested override width. Scrollable tab strips/tables are intentionally distinct from page overflow.

Screenshots are private under ignored `artifacts/phase12-ui-baseline/ui12-{route}-{width}x{height}-final.jpg`. Early captures that showed incomplete paint/loading were rejected and replaced after a settling interval. All thirteen routes were visually inspected across desktop and phone captures; other widths have measured layout checks and representative overview review. This is not a claim that every lower-page region was individually reviewed in every one of 91 combinations. Overview lower content, service status and landscape company detail were additionally inspected.

Repairs visible in final captures: full-width phone content, flat compact company rows, full-width settings selections, shorter overview metrics, separated research title/time, and preserved 44px primary controls. At phone width, secondary record detail remains accessible through disclosures/dialogs rather than expanding every desktop column.

## 2. Reference comparison

Sources: archived `docs/ui/reference/dpv-workspace-reference-dashboard.html` and user-supplied `C:/Users/ACER/Desktop/u1.png`. Actual overview capture: `ui13-reference-comparison-1890x918.jpg`. Both images were inspected together. Matching bitmap dimensions do not prove matching original browser zoom/CSS viewport; a fresh same-CSS-viewport reference capture remains open.

Measured actual desktop geometry: sidebar 256px; topbar 64px; outer content 1344px with 32px gutters; inner content 1280px; KPI gap 20px; analytical grid 837.328px / 418.656px with 24px gap, approximately 2:1. White rounded panels, gray canvas, dark navigation and white topbar belong to one shared family.

Explicit adaptations and differences:

- Two equally prominent language lines increase heading/card height. They are not replaced with smaller English to force the sample's height.
- Actual workflow has six stages rather than the sample's four. Bars represent the documented actual mixed scopes, not a fabricated conversion funnel.
- Current opportunity market data contains two companies in one market. The chart is consequently one real segment; sample 45/35/15/5 shares and 3.4k total are not copied.
- Sample trends, delivery rate, avatars, marketing labels, glow and fake time estimates are deliberately excluded according to user/project rules.
- Only an overview reference was supplied. Other routes extend its shared geometry; no unseen reference page is claimed as an exact clone.

Result: reference-family and geometry alignment reviewed; **strict pixel-identical/full reference acceptance not claimed**.

## 3. Keyboard, theme and states

| Interaction | Observed result |
| --- | --- |
| Phone sidebar open → desktop resize | Reproduced stuck `inert`; after repair open=false and inert=false |
| Research first close control → Shift+Tab | After repair focus lands on `research-step-next`, inside dialog |
| Research Escape | Zero open dialogs; `workspace-new-research` regains focus |
| Search first close control → Shift+Tab / Escape | Focus stays inside; `workspace-search-open` restored |
| Company detail first return → Shift+Tab / Escape | Focus stays inside; original visible `.lead-select` restored |
| Advanced filter first close → Shift+Tab / Escape | Wraps to View results; `opportunity-advanced-filter-open` restored |
| Mail review Escape | Original row action restored, data-outreach-index=0; zero dialogs |
| Mail send control | Disabled in observed runtime; never activated |
| Dark settings and mail dialog | Inspected at 390px, readable semantic surfaces and foregrounds |
| Standard/compact bilingual preference | Actual row-gap 2px/0px; language font hierarchy preserved |
| Nine states | Loading, empty, success, warning, error, disabled, stale, permission denied and degraded rendered in isolated fixture |

Evidence includes `ui12-settings-dark-390.jpg`, `ui12-email-dark-390.jpg`, `ui12-company-dialog-844x390.jpg`, `ui12-component-states-390.jpg`, `ui13-overview-bottom-768.jpg`, `ui13-services-bottom-844x390.jpg`.

Independent-browser supplement: native 200% zoom now passes in two window sizes (26 route checks), and reduced-motion preference/computed CSS behavior passes on desktop and phone (26 route checks). Four research-dialog keyboard checks also pass. See [actual supplement and evidence](PHASE12_UI14_BROWSER_SUPPLEMENT.md). Semantic contrast-pair tests pass; full composited text/non-text contrast, every link target and screen-reader navigation are not exhaustively certified. The button-height check excludes native radios/checkboxes and does not establish every hit area's width.

## 4. Availability and boundaries

Observed browser error log returned an empty list. Final read-only asset traversal fetched 47 dependency paths with no HTTP failures or external origins; source audit found no production Tailwind CDN, Google Fonts, Font Awesome or remote avatar use. This does not replace a full browser request trace and does not measure CSS font requests or compressed bytes.

No research was created, no draft saved, no approval granted, no mail sent, no import committed and no new export generated during browser inspection. Actual write paths were covered by regression/isolated tests instead. Browser preferences and viewport were restored; isolated fixture server stopped.

## Acceptance

Recorded checks and repairs are complete for the evidence above and the linked independent-browser supplement. **Overall acceptance remains PARTIAL**, pending assistive-technology/contrast checks, fresh reference rendering and resolution of the performance gate. Zoom and reduced-motion are no longer unexecuted items. See [execution result](PHASE12_UI12_UI14_RESULT.md) for business preservation and test totals, and [browser performance](PHASE12_UI14_BROWSER_PERFORMANCE.md) for actual measurements rather than a blanket performance PASS.
