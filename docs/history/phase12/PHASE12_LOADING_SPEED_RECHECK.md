# Loading speed recheck — 2026-09-07

## Actual measurements

Measured at 17:27 China Standard Time against local overview, desktop Chrome, 1440 × 900. No network or CPU throttling. No business writes or email sending. All figures below are medians of five navigations per condition.

Live application with actual API responses (HTTP cache disabled by read-only request guard):

| Measurement | Time |
| --- | ---: |
| First contentful paint | 220 ms |
| Document load event | 276.6 ms |
| Last observed initial API response completed | 427.3 ms |

These are repeated navigations in one isolated context, not five fresh process starts. API completion is not a semantic assertion that every business widget is ready. This is a local desktop measurement, not a public-server or mobile-network prediction.

## Controlled version comparison

Frozen commit: f3706d7765745fde02d7d77fe2d52eef60f87ba7. Frozen and current frontend use the same in-memory snapshot of genuine read-only API responses, excluding database latency. Five alternating cold/warm pairs per version, 20 measured navigations in total. Cold uses fresh browser contexts; warm reloads in the same context with cache enabled.

| Metric | Frozen | Current | Change |
| --- | ---: | ---: | ---: |
| Cold load event | 208.6 ms | 233.2 ms | +11.79% / +24.6 ms |
| Warm load event | 48.4 ms | 52.9 ms | +9.30% / +4.5 ms |
| Cold observed LCP | 272 ms | 256 ms | −5.88% |
| Resource entries | 50 | 66 | +32% |
| API entries | 16 | 19 | +18.75% |
| Cold transfer bytes | 2,364,269 | 2,432,438 | +2.88% |

No page errors, failed requests, HTTP error responses, or blocked write attempts were observed in measured runs. Live console error count: zero. Resource entries include cached entries and do not equal newly downloaded files. Production adds a favicon entry relative to the comparison server.

## Original proposal and subsequent approval

- Prefer resource counts as advisory, not an independent release failure.
- If a numerical allowance is required, propose +40% against the fixed frozen baseline: 50 → maximum 70 entries. This covers the observed 66 without a rolling per-release allowance.
- Separately review API growth and purpose; do not conceal redundant requests under the resource allowance.
- For loading-time regression, propose review when the median increases more than 20% AND more than 100 ms. This is a project proposal, not an industry standard. Repeat measurements before deciding; five samples do not support precise statistical claims.
- Public deployment and low-end/mobile performance still require separate tests. An absolute performance budget should be agreed for those environments.

The proposal above records the original recommendation. The user subsequently approved resource growth 40% and loading-time growth 20%. The operative rule is now [UI_VISUAL_QA_PROTOCOL.md](../../UI_VISUAL_QA_PROTOCOL.md), rule 9. The additional 100ms exemption and advisory-only treatment were not adopted. Historical measurements are unchanged; approval does not close unrelated visual/accessibility gaps.

## Evidence

Raw results: `artifacts/phase12-ui-baseline/browser-performance/2026-09-07T09-26-42-948Z/result.json`.

Reproduction: `node scripts/phase12-browser-performance.cjs`. Results now use timestamped folders to preserve prior evidence. Script changes only add measurement fields/repeats and unique output locations; no application configuration or production code changes.
