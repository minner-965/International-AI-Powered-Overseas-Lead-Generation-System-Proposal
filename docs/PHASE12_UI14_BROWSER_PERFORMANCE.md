# Phase 12 — Isolated browser performance comparison

Historical checkpoint: the 15% gate interpretation below was superseded by user approval on 2026-09-07 of resource-entry growth 40% and loading-time growth 20%. See current rule 9 in [UI_VISUAL_QA_PROTOCOL.md](UI_VISUAL_QA_PROTOCOL.md) and [final result](PHASE12_UI_RESULT.md). Original measurements remain unchanged.

Measured: 2026-09-07 09:00:42 UTC / 17:00:42 +08:00. Chrome 152.0.7977.76. **Overall performance gate remains FAIL/open: resource entries increased 32%, API resource entries increased 18.75%.** This developer report does not authorize or claim a performance waiver.

## Method and boundaries

- Script: `scripts/phase12-browser-performance.cjs`.
- Frozen public files are read directly from Git commit `f3706d7765745fde02d7d77fe2d52eef60f87ba7`; current files are read from the working tree. Neither version runs a backend. Both use identical locally pinned Tabler resources.
- Independent loopback static servers on ports 3141 and 3142; independent headless Chrome, no user profile, cookies, browser session or management credentials.
- Exactly five alternating cold/warm pairs per version, 20 measured navigations total, at 1440 × 900. A new browser context establishes each cold run; reload in that context establishes its warm run. No Playwright routing is used because it would disable the HTTP cache.
- The allowlisted genuine API GET responses are fetched once into memory during warm-up and replayed identically by URL for both versions. No API response bodies are saved. Private output includes response hashes, status, byte sizes and aggregate browser measurements only.
- Server rejects every non-GET request and any unlisted API. CSP permits same-origin assets/connections only. Service workers are disabled. No control that creates jobs, approvals or messages is clicked.
- This reconstructs frozen code in the **current** environment with current data. It is not a historical timing measurement of the original release.
- Static transport is intentionally identical and **uncompressed** for both versions. Results are not production gzip/Brotli transfer measurements. API/database/provider latency is excluded by replay. No mobile CPU/network throttling was applied.
- FCP, LCP, DOMContentLoaded and load come from native browser performance entries. LCP is the last observed entry before the fixed post-idle measurement cutoff. `metricsTextPresent` is only a DOM presence diagnostic, not a business-ready timestamp. No business-ready timing is claimed.
- Resource count excludes the main HTML navigation and includes API resource entries; cached resources still have entries and may have zero transfer size. Resource counts are not all actual wire transactions.

## Calibration

An initial allowlist calibration intentionally returned 403 for two unlisted controlled-test read endpoints. Source review confirmed the endpoints are read-only; they were added before the clean measured run. That initial run is not accepted evidence.

The next calibration ran concurrently with other browser QA and its timings are not final evidence. After the primary agent confirmed other browser tests had exited, the final run below executed without other task browser/test load. The final instrumentation includes failed-request events as well as HTTP statuses. All 20 measured navigations had zero page errors, zero failed requests, zero HTTP error responses and no blocked write/API requests.

## Final reconstructed comparison

Medians of five observations per cell; times in milliseconds. Positive change means growth/slower.

| Metric | Frozen cold | Current cold | Change | Frozen warm | Current warm | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DOMContentLoaded | 194.0 | 211.0 | +8.76% | 43.3 | 42.4 | -2.08% |
| Load event | 203.5 | 231.5 | +13.76% | 48.9 | 52.6 | +7.57% |
| FCP | 192 | 204 | +6.25% | 56 | 52 | -7.14% |
| Observed LCP | 268 | 256 | -4.48% | 84 | 76 | -9.52% |
| Resource entries | 50 | 66 | **+32.00%** | 50 | 66 | **+32.00%** |
| API resource entries | 16 | 19 | **+18.75%** | 16 | 19 | **+18.75%** |
| Transfer bytes | 2,364,236 | 2,431,258 | +2.83% | 395,926 | 416,964 | +5.31% |
| Decoded bytes | 2,348,936 | 2,411,158 | +2.65% | 2,348,936 | 2,411,158 | +2.65% |

There are 13 additional static resource entries and three additional API entries. Shared startup calls mean this is not simply the four new calls visible in the Overview loader. Timing and byte medians remain below 15% regression in this specific desktop replay test; resource-count gates do not. Five local observations are not field performance, confidence intervals, a low-end-device assessment or a guarantee against slower deployments. The near-threshold load result should not be rounded down into broad acceptance.

## Actual production cold network observation

A separate new Chrome context loaded `http://127.0.0.1:3000/#overview`. A Playwright route guard admitted only same-origin GET/HEAD and rejected other origins/methods; this deliberately disables cache, so this is a **single cold network observation**, not a warm benchmark or a comparison with the replay timings. Actual production APIs were read, not replayed.

- Observed response records: 67; browser resource entries: 67 (including a zero-byte browser favicon entry, not a confirmed extra wire response). These counters have different definitions.
- Encoded body bytes: **2,411,158**; decoded body bytes: **2,411,158**; transfer bytes including browser-reported overhead: **2,431,258**.
- Every observed response omitted `Content-Encoding` (`identity`): the local deployment was **not using gzip/Brotli** in this observation. No compressed-size saving is invented.
- Local icon font: `/vendor/tabler-icons/fonts/tabler-icons.woff2`, HTTP 200, `font/woff2`, **462,200 bytes**, identity encoding. No external font request was admitted or observed.
- External/method guard interceptions: 0; failed requests: 0; HTTP error responses including 404: 0; page errors: 0; console errors: 0.
- This network evidence covers initial Overview startup resources, including initialized hidden modules. It is not a claim that every interaction's lazy resource was exercised.

All test browsers and both temporary loopback servers exited after measurements. The test did not submit a business write, send email, approve a draft or modify production files. API response contents stayed in memory; saved evidence contains measurements and hashes rather than mailbox bodies or credentials.

Private evidence: `artifacts/phase12-ui-baseline/browser-performance/result.json`.

## Acceptance interpretation

More than 15% regression in any named acceptance metric must remain a failed/open gate, even if absolute times are short or other metrics improve. Added business summaries explain some resource growth but do not constitute user approval of it. No blanket Phase 12 performance PASS is asserted.
