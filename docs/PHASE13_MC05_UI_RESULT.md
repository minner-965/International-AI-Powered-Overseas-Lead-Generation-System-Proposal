# Phase 13 V2.1 — MC05 UI Result

Status: PASS — MC05 UI scope. Date: 2026-09-08. Phase12 V3 remains the visual authority. STOP after MC05.

## Implemented

- Research offers single/multiple/all active searchable markets and single/multiple/all approved active target categories. Options come from the registries, not product SKU records or historical profiles. Current actual registry: 2 markets (AE/MX), 13 approved categories, 26 all × all scopes; hidden BD is absent.
- Before Create, the dialog continuously displays selected market count, selected category count and their product. Scope review displays server-resolved buyer types and languages. A selection change invalidates the prior preview immediately; Create remains disabled until the replacement preview succeeds.
- City/region apply only to a single market and clear on market changes. The old profile override is excluded from the batch request. Existing single-scope ResearchJob API remains unchanged.
- Create submits one parent batch request, with a persistent idempotency key and in-flight double-click guard. Retrying the same request preserves its key. Session selection survives reload; changing selection creates a new request identity.
- Parent detail displays the creation-time scope, linked child jobs, lifecycle state and refresh. Reused child configuration is explicitly labeled as the existing execution scope rather than implying changed requested settings were executed.
- Selection uses explicit current registry IDs; newly added registry entries are not silently selected between preview and Create. The server revalidates those IDs before creation. The historical parent view uses its saved scope rather than current registry options.

## Browser evidence

Harness: `scripts/phase13-mc05-browser.cjs`. Local evidence: ignored `artifacts/phase13-mc05/browser/result.json` and PNG captures in that folder.

**Actual application GET registry/list and POST preview were exercised.** Preview is read-only. Parent Create and parent detail responses were intercepted inside the test browser; no production research batch/job was created by browser QA. Persisted batch creation, immutable scope, replay and concurrent reuse are verified separately against isolated PostgreSQL and documented in the companion ResearchBatch result. Browser-only error/empty fixtures never enter the database.

| Check | Outcome |
| --- | --- |
| Single market + single category | PASS: 1 × 1 |
| Multiple markets | PASS: 2 × 1 |
| Multiple categories | PASS: 1 × 2 |
| All markets | PASS: 2, hidden/disabled markets absent |
| All categories / all + all | PASS: 13 / 26 scopes |
| Live counts and read-only scope preview | PASS |
| Double click Create | PASS: one intercepted parent POST |
| Reload parent and saved selection | PASS; parent response is a browser fixture |
| Back button and Escape opener focus | PASS |
| Browser Back/Forward parent route | PASS |
| 1440×900, 1280×720, 1024×768, 768×900 | PASS |
| 390×844, 375×667, 844×390 | PASS; no document overflow |
| Registry error/retry, empty registry | PASS; disabled Create, no invented options |
| Browser page errors / prohibited business writes | 0 / 0 |

Final browser harness: 19 checks PASS. No provider activation, paid search, SMTP send or production batch creation was performed by this UI verification.

## Visual review and corrections

Actual desktop and 375/390px screenshots were inspected, not accepted on overflow checks alone. An inherited fieldset grid span initially left half the desktop form blank; this was corrected to two aligned market/category panels. Category enums were replaced with existing bilingual business labels while retaining the exact registry IDs. Back initially lost focus to the shell navigation scheduler; focus now restores after the view transition. An additional browser Back/Forward check exposed a route/view mismatch; explicit popstate view restoration corrected it. Both final checks pass.

The design retains the reference's dark sidebar, white topbar, gray canvas, white rounded cards, compact business hierarchy and V3 controls. The reference has no ResearchBatch screen; the new dialog therefore extends its shared component language rather than claiming a pixel-identical reference page. Mobile uses a bounded dialog body with scrollable category choices, equal-size bilingual labels, native zoom and at least 44px selection targets. Reduced motion was enabled throughout the browser checks.

Key captures: `desktop-selection.png`, `desktop-preview.png`, `selection-390x844.png`, `selection-375x667.png`, `mobile-preview.png` under the ignored evidence folder. Whole-application screen-reader certification, new 200% zoom/performance baselines and full Phase12 recertification are not claimed by this MC05-specific run.

## Regression and boundary

Targeted frontend tests passed, including the new MC05 contract checks and retained Research/Jobs, market visibility and Phase12 hook checks. Existing MC04 rules, business opportunity decisions, email approvals and provider settings were not modified by the UI work. See `PHASE13_MC05_RESEARCH_BATCH_RESULT.md` for the complete suite and data-preservation evidence. No MC06 work was started.
