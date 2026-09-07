# Phase 12 WP-UI14 — Read-only performance and chart audit

Initial measurement: 2026-09-07, approximately 16:20–16:22 +08:00. Final static remeasurement: **2026-09-07 16:46:51 +08:00** after final deployment. The tables below contain the final measurements. Scope: static source/HTTP reads and isolated unit tests. No browser, business mutation, email, search, deployment or source change was performed by this audit.

## Actual static measurements

`node scripts/phase12-static-assets-check.mjs` against `http://127.0.0.1:3000/` returned:

| Measurement | Actual result |
| --- | ---: |
| HTML-linked assets and recursively identified local JS modules | 47 |
| Decoded static text bytes | 1,629,428 |
| Failed asset responses | 0 |
| External asset origins in this traversal | 0 |

This traversal follows HTML script/link references and local JS imports, including literal dynamic imports. It does not execute the page. It does not follow CSS font URLs, reproduce browser caching/compression, count API traffic, or measure layout/paint. Therefore 47 is a static dependency-path count, **not** an observed browser cold-load request count. The zero-external finding is limited to this traversal, not every possible browser request.

## Reproducible source comparison

Freeze commit: `f3706d7765745fde02d7d77fe2d52eef60f87ba7`, documented by WP-UI00. Read `public/index.html` and follow the same script/link/module graph from Git objects versus the working tree; normalize relative paths and strip query suffixes before reading bytes. Deduplicate paths. Sum raw UTF-8 file bytes, not character counts. No checkout or file rewrite is required.

| Source graph | Freeze | Working tree | Change |
| --- | ---: | ---: | ---: |
| Available application text bytes | 754,703 | 798,710 | +44,007 / **+5.83%** |
| Referenced paths, including runtime vendor paths | 34 | 47 | +13 / **+38.24%** |

Both source measurements exclude the same three runtime-provided vendor files, which are absent from Git/public on disk: Tabler CSS, Tabler Icons CSS and Tabler JS. They succeed in the deployed HTTP traversal. Package manifest and lockfile have no diff against the freeze commit. This supports a like-for-like comparison of application-owned text, not a reconstructed historic compressed transfer size.

Application text growth is below the 15% threshold. The dependency graph adds 13 paths due to V3 page/component modules and styles. **Full performance PASS is withheld:** path-count growth is above 15%, and there is no captured baseline browser request/timing trace establishing its runtime impact. Reducing or approving the runtime impact requires a comparable browser measurement, not treating module splitting as automatically harmless.

## Missing baseline and explicit NOT RUN checks

The baseline folder contains screenshots and business-count snapshots; its manifest does not supply navigation/resource timing. The earlier result report expressly deferred full performance acceptance. No original FCP/LCP/render-duration measurement was found in the reviewed Phase 12 baseline/results.

- Render-time degradation versus freeze: **NOT RUN / missing comparable timing baseline**.
- Compressed bytes, font downloads and cold/warm-cache browser request count: **NOT RUN**.
- Slow-network/mobile CPU performance: **NOT RUN**.
- Final worktree-versus-deployed byte identity: **NOT ASSERTED**; concurrent implementation may change files after this point-in-time audit.

## Chart truth and unavailable-value checks

Executed from `services/demo-dashboard`:

`node --test test/phase12-chart-states.test.js test/phase12-overview.test.js test/phase12-overview-chart.test.js`

Result: **12 passed, 0 failed, 0 skipped**. These confirm null/undefined/empty-string are unknown rather than zero, inconsistent market totals fail closed, valid zero remains an empty state, controlled counters are excluded, and actual legend percentages derive from supplied counts. Chart decoration waits for visibility while text remains available.

Source review confirms `verified_active` is not replaced by total companies; sent-no-reply reads the dedicated prospect field rather than all SMTP acceptance; market scope deduplicates company IDs in current returned opportunities. `loadMetrics` passes failed source responses as null, preserves independent successful sources and displays partial availability. Full endpoint/field/window detail is in `PHASE12_CHART_DATA_CONTRACT.md`.

The market view is scoped to the existing capped opportunity response and visible markets, not the entire company database. The development bars have mixed units and a current/cumulative caption; no conversion rate is claimed. Database aggregate correctness was not re-queried in this audit; existing isolated repository tests are evidence of query-contract behavior, not a new live-database reconciliation.

## Reduced motion

Source inspection: V3 foundation's `prefers-reduced-motion: reduce` forces automatic scrolling, one brief animation iteration, and near-zero transition duration. Sidebar also explicitly disables its transition. The chart renderer contains no animation loop, timer, shimmer or tween. Shell's single `requestAnimationFrame` schedules focus/scroll with `behavior:'auto'`, not a continuing animation.

Reduced-motion source contract: **present**. Actual OS/browser emulation and screenshot behavior: **NOT RUN by this audit**; root browser QA owns that result. No claim of full accessibility acceptance is made from CSS inspection alone.

## Outcome

Static availability and focused chart tests pass. Final application-owned bytes increased **5.83%** (initial measurement was 5.52%). Final HTTP traversal confirms 47 paths, 1,629,428 decoded bytes, zero failures and zero external origins in that traversal. Full WP-UI14 performance acceptance remains open pending the browser timing/request comparison and disposition of dependency-count growth.

## Subsequent user-approved browser testing

The source-only limits above describe the original audit. Actual native zoom and reduced-motion checks are now recorded in [the independent browser supplement](PHASE12_UI14_BROWSER_SUPPLEMENT.md). Cold/warm reconstructed comparison and a live production cold network trace are recorded in [the browser performance report](PHASE12_UI14_BROWSER_PERFORMANCE.md). Measured resource entries grew 50→66 (+32%), so the 15% gate remains unresolved; successful asset loading is not overall performance acceptance.
