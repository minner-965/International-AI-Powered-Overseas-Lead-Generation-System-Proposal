# Phase 12 accessibility completion

Date: 2026-09-07. Result: **PASS for the automated and supplemental visual assessment described below**. This is not a full WCAG conformance certificate or a claim of human screen-reader testing.

## Executed scope

Fresh independent Chrome contexts visited 13 routes and five existing dialogs (research, company detail, email review, advanced filters, company search), in light/dark themes at 1440×900 and 375×900: **72 view assessments**. Only application-origin GET/HEAD requests were permitted; writes, other origins and WebSockets were blocked by the harness. The audit did not send mail, approve records, submit research or change business data. Other background workers and user activity were not frozen by this read-only audit.

The engine was pinned QA-only `axe-core 4.10.3`, testing WCAG 2 A/AA, WCAG 2.1 AA and best-practice rule sets. Chromium `Accessibility.getFullAXTree` independently checked exposed interactive names. Computed colors checked enabled text fields, selects and textareas against their surrounding backgrounds at 3:1. Source regression covers semantic text/focus/boundary pairs in both themes. Native checkbox/radio appearance, every possible future data state and every third-party assistive technology are outside that boundary.

## Actual final results

Private evidence: `artifacts/phase12-ui-baseline/contrast-completion/2026-09-07T10-18-15-416Z/result.json` and adjacent screenshots. Run: 10:18:15.416–10:22:12.686 UTC (18:18–18:22 local).

| Check | Actual result |
|---|---|
| Route/dialog/theme/viewport assessments | 72/72 completed |
| Definite axe violations | 0 |
| Exposed interactive AX nodes inspected | 1,494 observations; 0 unnamed (repeated controls included) |
| Enabled input/select/textarea boundary observations | 214; all ≥3:1 by border or fill boundary |
| Initial contrast checks requiring follow-up | 348 node observations |
| Scroll-into-view individual axe retests | 330 passed; 0 definite failures |
| Remaining contrast indeterminate observations | 18, reviewed with computed colors and screenshots below |
| JavaScript page errors / prohibited network attempts | 0 / 0 |
| Focused source regression | 5 tests passed, 0 failed |

## Repairs covered

- Removed reduced opacity on English bilingual text; both languages now retain the same color.
- Darkened the secondary-text token so it passes against the gray canvas as well as white panels.
- Mapped the Customer Match approved profile badge to theme-aware success tokens instead of an insufficient-contrast vendor green.
- Gave both pagination surfaces native navigation elements; corrected named groups and modal landmark semantics.
- Made noninteractive scrolling job/status/progress regions keyboard-reachable without adding a business action.
- Preserved existing dialog buttons, API identifiers, approval/send restrictions and real data.

Regression: `services/demo-dashboard/test/phase12-accessibility-completion.test.js`. Browser harness: `scripts/phase12-contrast-completion.cjs`. Earlier failed and interrupted runs remain in private artifacts; they are not counted as successful assessments.

## Indeterminate checks: explicit disposition

The harness retains original `incomplete` findings; it does not silently remove them. It scrolls each affected node into view, repeats the contrast rule and records its foreground and ancestor background chain. Screenshot inspection confirmed the remaining text uses the solid backgrounds below rather than the obscured/overlapping background inferred by the engine.

| Remaining family | Computed light / dark ratio | Review |
|---|---|---|
| Overview ring center number | 17.85 / 14.88 | Large number on the unpainted solid card center; not on the chart stroke |
| Overview ring center bilingual caption | 5.12 / 8.07 | Solid card center, visually separate from ring |
| Company table seventh-column English heading | 4.90 / 7.24 | Horizontally scrollable table heading; computed text/background passes |
| Email body textarea, desktop/mobile | 17.85 / 14.88 | Native multiline field; foreground/background passes, screenshot preserves readable content |
| Mobile research active-step English | 5.17 / 9.04 | Active step retains its solid background and full-opacity text |
| Mobile company exclusion English | 6.47 / 8.59 | Solid button background; readable contrast |
| Mobile company confirmation English | 5.17 / 9.90 | Primary fill with contrasting foreground |

Four advanced-filter `aria-controls` findings were marked indeterminate while the dialog was not exposed. Opening the actual referenced dialog in each theme/viewport succeeded and its audit had zero definite violations. Four company website `link-in-text-block` findings were overlap-related: screenshot inspection shows a standalone icon-and-label website action, not an inline prose link distinguished by color alone.

This supplemental review closes these specific automated indeterminate findings, not all conceivable visual states. The screenshots in this contrast audit can retain scroll positions from node-by-node retesting; use the separate same-viewport reference captures for visual layout comparison, not these as pixel-match evidence.

## Assistive-technology assessment boundary

Chromium accessibility-tree inspection was actually executed, including accessible names for buttons, links, form controls, tabs and dialogs exposed in these views. Existing keyboard/focus tests provide separate navigation evidence. **No person listened to Narrator/NVDA/VoiceOver output during this audit.** Reading order quality, speech pronunciation, braille output and compatibility with particular screen-reader/browser versions therefore remain unverified. The original generic “assessment not performed” gap is now replaced with this concrete completed assessment and its explicit limits; do not describe it as comprehensive assistive-technology certification.

The [official axe documentation](https://github.com/dequelabs/axe-core/tree/v4.10.3) itself distinguishes automated detection from incomplete checks requiring review. Its reuse/license boundary is recorded in `REUSE_CANDIDATE_REGISTRY.md`. No new production dependency was added.
