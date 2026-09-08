# CL11 CSS, assets and icons cleanup

Scope: CL11 only. Production execution containers stay stopped. No provider, Hunter, SMTP, database write or external asset request was made by this work package.

## Selector inventory

`node scripts/cleanup-cl11-css-audit.mjs` emits the complete reproducible selector manifest: file, line, selector, class/id names, HTML/JS/test reference files and classification for every authored CSS selector. CSS is parsed with the already-installed css-tree parser; no dependency was installed. The parser is diagnostic only, never part of production startup.

After cleanup: 21 authored stylesheets, 2,116 selectors: 1,984 `KEEP_CURRENT_REFERENCED`, 114 `KEEP_CURRENT_STRUCTURAL`, 17 `KEEP_CURRENT_DYNAMIC`, 1 `KEEP_CURRENT_VENDOR_COMPAT`, 0 unresolved zero-reference candidates. Lexical reference presence is conservative ownership evidence, not a claim that every selector matched in the browser. Dynamic data and pseudo-states are not purged on screenshot coverage alone.

Dynamic families reviewed: `tier-*`, `verification-*`, `business-*`, `level-*` from app.js; `p11-runtime-*` from controlled-email-verification.js; `v3-automation-*` from automation-control.js. The `btn-danger` selector remains a local Tabler-compatible action style. Vendor distribution and licenses are retained intact, not selector-purged.

## Removed code

| Candidate | Classification | Evidence and action |
|---|---|---|
| contact-result-table in contact-results.css | DELETE_ACTIVE_CODE | No HTML, JS, test, server or script caller; removed desktop/mobile wide-table blocks (36 lines), including obsolete green header styling |
| dpv-panel/head/body, dpv-button/primary/danger, dpv-field aliases | DELETE_DUPLICATE | No generated markup uses aliases; retained actual crm-panel, btn and form-control/form-select styles with identical declarations |
| dpv-actions/filter-bar, dpv-table/wrap, dpv-pagination/timeline, dpv-skeleton | DELETE_ACTIVE_CODE | Unused preparatory component scaffold; retained actual table-responsive and current component renderers |
| dpv-dialog__body/foot, dpv-badge--tone, dpv-meta | DELETE_ACTIVE_CODE | No current emitted markup; kept current dpv-dialog adapter/test hooks, dpv-state and business badges |
| Reference dashboard HTML | KEEP_CURRENT | scripts/phase12-reference-completion.cjs reads it for reference comparison; deletion condition is not met |
| Phase-named CSS/JS | KEEP_CURRENT | All retained public scripts are reachable through HTML/module imports; all 21 CSS files are linked. Names alone do not identify obsolete styles |
| Vendor icons and document images | KEEP_CURRENT | Local pinned icon distribution is a runtime dependency; doc_assets are not served frontend assets. No asset file or license was deleted |

No duplicate active V2/V3 renderer was demonstrated by the retained module graph. Phase-named modules remain current behavior adapters and were not deleted on naming alone. No production Tailwind, Font Awesome, Google Fonts or avatar CDN source was found in served HTML/CSS. Archived reference remote links are outside the static root and were not requested.

## Visual regression correction

The isolated browser check identified a company-detail verification badge stretched vertically beside the three independent business dimensions. Added `align-self:flex-start` only to direct badges in `.v3-company-detail .crm-detail-meta`; this keeps the existing V3 appearance and content-sized status, without changing data or actions. Main-task browser rerun owns visual confirmation; this report does not claim screenshot equivalence before that rerun.

## Verification

Integrated regression: 1,158 tests, 1,104 passed, 54 skipped, 0 failed. Browser PASS: 169 route/state/viewport combinations, seven viewport sizes, 28 expanded/dialog checks, no page/asset/console errors, unexpected requests or page-level overflow. See CL10_UI_DEAI_RESULT.md for screenshots and limitations. Actual company-detail-390.png now shows a compact verification badge, rather than stretching beside the dimensions. No claim of newly certifying full contrast/native zoom/live business E2E.

Authored tracked HTML/JS/CSS comparison against CL08 `7036048`: 51 files, 849,019 → 846,029 bytes, a reduction of 2,990 bytes. This byte measurement is not a new load-time benchmark. No dependency or asset file added; local vendor capability reused under the UI skill. All 147 business tables, controls, applied migrations and historical orchestration remain unchanged. Prior 063 stays pending. Maintenance remains active; local checkpoint only, no push/tag, STOP after CL11.

Focused tests: 10 passed, 0 failed, 0 skipped (`cleanup-cl11-assets`, `phase12-components`, `phase12-legacy-cleanup`). They check complete selector inventory, removed selectors, preserved dialog/contrast contracts, module/style reachability, and the content-sized badge regression. Whole-application browser and full-suite results are recorded by the main CL09–CL11 handoff. No production restoration or CL12 work is included.
