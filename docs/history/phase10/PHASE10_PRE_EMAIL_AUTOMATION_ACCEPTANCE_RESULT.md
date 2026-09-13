# DPV Phase 10 Pre-email Automation Acceptance Result

## Current result

`WP-A05 = PASS`

`WP-A06 = PASS`

`WP-A07 = PASS`

`WP-A08 = PASS`

`WP-A09 = PASS`

`WP-A10 = PASS`

`WP-A11 = PASS`

`WP-A12 = PASS`

`WP-A13 = PASS`

`WP-A14 = PASS`

`WP-A15 = PASS`

`WP-A16 = PASS`

Validated on 2026-09-04. This document records the completed WP-A05 through WP-A16 acceptance sequence. Outbound email, Gmail inbound synchronization, outreach and CRM mail effects remained disabled and at zero.

## WP-A05 — category-driven acceptance Runner

The pre-email Runner now supports all required arguments:

```text
--target-category
--category-scope-id
--market
--scope-limit
--timeout-minutes
--poll-seconds
--run-label
--allow-live-search
--output-dir
--resume-run-id
```

`--product-profile` remains optional compatibility input and has no hidden default. Stage 0 now checks the target category, Research queue, search Provider and disabled email paths. Reports include category match, named Buyer, official route and business opportunity outcomes. The deployed output default uses the writable private runtime export volume. The Runner waits for post-discovery category and decision results instead of declaring success when only the root discovery Job completes.

Focused Runner result: 12 passed, 0 failed, 0 skipped.

## WP-A06 — real one-action category canary

- root ResearchJob: `75ad2b8c-bd62-46d8-8204-8015bc330719`
- market: `AE`
- approved target category: `DRESSES`
- approved scope: `572b8f0f-e329-40a6-9799-737d6f8e4aee`
- requested optional product profile: `NULL`
- internally derived legacy compatibility profile: `WOMENSWEAR`
- root terminal: `COMPLETED`
- manual stage intervention: `NO`
- company/source/contact delta: `+1 / +8 / +1`
- Provider usage delta: `+5`
- category job: `ea4c1ce2-ffc7-45c6-a042-498879415af5`, `COMPLETED`
- category match: `CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE`
- business opportunity: `EVIDENCE_REQUIRED`
- named Buyer ready: `NO`
- official route ready: `NO`
- email/CRM delta: `0`

The deployed Jobs UI was inspected read-only after the run. It displayed the same root ID, market `AE`, target category `DRESSES`, `Completed` status, `100%` progress, one selected company and five Provider calls/used units, matching the public API and database projection.

The opportunity result is honestly `EVIDENCE_REQUIRED`: the company and Dresses evidence were processed, while buying evidence and a verified Buyer/official route remain incomplete. No exact SKU or user-supplied product profile blocked execution.

## WP-A07 — event and reconciliation paths

The live event used company `fbf10c54-a0d4-4fb1-aa0e-443bb69c2923`, the approved Dresses scope, blocker `CATEGORY_EVIDENCE` and evidence revision `29`.

- first event: `SCHEDULED`
- exact event replay: `DEDUPLICATED`
- both responses referenced task `99e2bcc9-c328-4671-b8f9-cc3b15b012ee`
- persisted execution scope key: `APPROVED:f39c1190-7c67-4ff4-b35f-5da8674da2ed:572b8f0f-e329-40a6-9799-737d6f8e4aee`
- distinct strategies advanced: `3`
- final projection after the A10 worklist check: `EVIDENCE_EXHAUSTED`, with all three eligible distinct strategies terminal and no remaining query

The event run exposed and repaired a double-resolution defect that collapsed an approved scope key into a category fallback. The repository now preserves an incoming approved scope key. A dedicated regression test covers this boundary.

Periodic reconciliation evidence:

- real n8n Schedule Trigger execution `106`: `success`
- end heartbeat: `HEALTHY` at `2026-09-04T16:00:16.290+08:00`
- targeted reconciliation: `COMPLETED`, selected `5`, fairness-resumed `4`, scheduled `1`, errors `0`

| Final assertion | Result |
|---|---:|
| stale active task | 0 |
| active task without schedule audit | 0 |
| duplicate company + scope + blocker + revision | 0 |
| stale/retrying Research dispatch outbox | 0 |
| Provider usage projection drift | 0 |
| purged orphan Job restored | 0 |
| outbound/email/CRM records | 0 |

The immutable purge audit for Job `9ad717d3-468f-4e4d-a978-9096391f26a8` remains `EMPTY_NEVER_STARTED / STRICT_EMPTY_JOB_POLICY`, while the deleted Job remains absent.

## WP-A08 — idempotency, repeated actions and Provider deduplication

Two concurrent Create requests used the same HOMEWARE category request and idempotency key `wp-a08-double-create-homeware-20260904`.

- both responses resolved to ResearchJob `33e251c8-412d-4412-9b38-eee796a05ca7`
- first response: `202`, created and dispatched
- concurrent replay: `200`, idempotent replay
- persisted ResearchJobs: `1`
- business dispatch executions: `1`, terminal `COMPLETED`
- result: `COMPLETED`, one candidate found and one company qualified
- Provider calls / used units: `5 / 5`
- duplicate auto-evidence execution keys: `0`
- duplicate charged query fingerprints: `0`
- optional input product profile: `NULL`; category scope remained the execution identity
- email/CRM delta: `0`

The same-category replay and scheduler assertions retained one active execution. Provider retry and worker retry tests confirm that technical retries do not consume an additional business strategy.

## WP-A09 — worker restart, lease and checkpoint recovery

A live failure injection interrupted the category worker while task `c249d418-8af8-4d5b-aa34-89eca80a9dce` was `RUNNING / DISCOVERING_SOURCES` on `S05_OFFICIAL_PRESS_PDF`. Targeted reconciliation after the one-minute acceptance lease reported:

- `stale_stage_redispatched = 1`
- recovered task ID: unchanged
- strategy attempt: unchanged at `3`
- query fingerprint: unchanged
- completed S05 stage chain: `DISCOVERING_SOURCES` through `REFRESHING_DECISION`
- final S05 outcome: `NO_NEW_EVIDENCE`
- duplicate charged Provider fingerprints: `0`
- duplicate current Opportunity for the same company/profile: `0`
- expired `RUNNING` tasks after recovery: `0`

The run also exposed a retry-dispatch defect: an event replay against `RETRY_SCHEDULED` sent the old attempt number, causing `STALE_ATTEMPT`. `scheduleEvent` now dispatches `strategy_attempt_count + 1` for a due fairness retry. The new regression test verifies the exact queue payload, and a live replay progressed through S05 after the repair.

Actual pg-boss S05 jobs use a 900-second execution timeout and a 60-second heartbeat. Lease tests verify active-lease duplicate suppression and stale-stage recovery without a Provider retry or extra strategy. The deployment was restored to the normal 15-minute lease after fault injection.

## WP-A10 — Provider capacity, no internal task quota and distinct strategies

Production Tavily account state after the run:

- status: `AVAILABLE`
- real plan usage: `297 / 1000`
- retry-after: none
- local credit ceiling: `NULL`
- reserved local units: `0`

The isolated PostgreSQL acceptance suite executed 30 distinct Provider-ledger calls for one company and one Job. It confirmed that the retired daily, per-Job, per-company and fixed-ten gates do not stop work; replaying an identical query fingerprint did not call the Provider again. All 20 database assertions passed, including 429 `Retry-After`, distinct real credit exhaustion, pre-insert create blocking, checkpoint-preserving recovery, stable unique continuation keys and zero email effects.

Live task `bcc02fc3-0f31-42ad-a629-9a5fdf20dc8c` reached `EVIDENCE_EXHAUSTED` only after these enabled category strategies were terminal with no new evidence:

1. `S01_OFFICIAL_CATEGORY`
2. `S02_OFFICIAL_ASSORTMENT`
3. `S05_OFFICIAL_PRESS_PDF`

Its three strategies produced three distinct query fingerprints and three distinct strategy ResearchJobs. The terminal blocker is `NO_REMAINING_DISTINCT_STRATEGY`; it is not a numeric attempt cap or cooldown result. Tasks `c249d418-8af8-4d5b-aa34-89eca80a9dce` and `cf36a2e6-34ee-44cd-991c-f4fd2a713235` independently converged to the same correct terminal rule.

## WP-A11 — category evidence, contact routes and Opportunity decision

- Company, approved category, Buyer model/history/suppression, and contact-route gates remain independent.
- `RECOMMENDED` accepts a verified named Buyer route or a verified official company route; a person name is not mandatory.
- Channel readiness is projected separately as `NAMED_BUYER_READY`, `EMAIL_ROUTE_READY`, `MANUAL_PHONE_READY`, `MANUAL_WHATSAPP_READY`, `MANUAL_FORM_READY`, or `SUPPLIER_PORTAL_READY`.
- Current live result: 20 opportunities — 1 `RECOMMENDED`, 16 `EVIDENCE_REQUIRED`, 3 `NOT_SUITABLE`.
- The live recommended record has an approved category match and official email, phone and WhatsApp routes without being mislabeled as a named Buyer.
- Browser inspection found historical false-positive Contact Form rows. The active-route boundary now accepts only explicit contact/support/enquiry/inquiry/supplier/vendor/procurement/register/apply paths. The visible manual queue reduced from 48 noisy rows to 6 explicit `contact-us` routes without deleting source history.

## WP-A12 — management demonstration path

- Research Create now follows Market + Target Category → Buyer/Company Target → optional Product Profile/advanced filters → Scope Review → Create.
- Product Profile remains optional and no Product Profile retry gate is present.
- Opportunities now shows the eight business decision columns required by the plan.
- Contact routes are displayed as separate capabilities and are not collectively labeled as a verified Buyer.
- Real browser positive path displayed the recommended company, approved category match, company verification, direct-buyer model, official routes, status and manual next action.
- Real browser reverse paths displayed category mismatch and excluded intermediary as `NOT_SUITABLE / No follow-up`; clearing all Buyer targets blocked progression with a specific validation message.

## WP-A13 — XLSX acceptance export

- Export Job `8128bc8a-50ea-4206-a989-ff82f092434b`: `READY`, 20 rows.
- Workbook: `outputs/phase10-wp-a13/DPV_Phase10_WP_A13_Opportunity_Acceptance.xlsx`.
- Required business columns: all present.
- Forbidden internal/secret/raw-provider columns: absent.
- Formula cells: 0; UTF-8 company names preserved; header row frozen; AutoFilter applied; header and wrapped-row formatting verified.
- Product Profile remains an optional secondary column; blank values do not block export.

## Regression result

- A08-A10 focused unit suite: 13 passed, 0 failed, 0 skipped.
- A10 isolated PostgreSQL suite: 20 passed, 0 failed, 0 skipped.
- Full repository suite after WP-A14–A16: 753 tests; 701 passed, 0 failed, 52 environment-scoped skips.
- `git diff --check`: no whitespace error; only existing Windows line-ending notices.
- deployed Dashboard, category worker, PostgreSQL and n8n: healthy/running.

## WP-A14 — zero-send and reverse safety

The deployed runtime kept `OUTBOUND_EMAIL_PROVIDER=NONE`, `GMAIL_API_ENABLED=false`, `GMAIL_INBOUND_SYNC_ENABLED=false`, `OUTREACH_ENABLED=false` and `LIVE_PROSPECT_SEND_APPROVED=false`. One current Opportunity is `RECOMMENDED`, while Management Approved, draft, approval, outbound attempt/message, webhook, inbound, CRM outbox and ambiguous Gmail rows all remain zero. The final live canary produced zero delta for all eight mail/CRM tables.

## WP-A15 — monitoring and automatic convergence

The required eight health classifications, five automatic action classes and five mandatory alert conditions are executable and covered by focused tests. Two real reconciliation rounds resumed normal next-strategy work with zero errors. Four historical ResearchJob projection drifts discovered through the browser were automatically rebuilt after confirming no live queue owner and preserved downstream Opportunities. Final active ResearchJobs, stale running tasks, orphan dispatches and duplicate continuations were all zero.

## WP-A16 — final release acceptance

- final canary ResearchJob: `5eb3d496-4422-4e4f-899e-d44dbf682a5b`
- target category / market: `Dresses / AE`
- optional Product Profile: `NULL`
- terminal status: `COMPLETED`
- company/source/contact/path delta: `0 / 0 / 0 / 0` because this run found no new promotable company
- Opportunity delta: `0`; the result was not fabricated
- Provider calls / used units: `5 / 5`
- email/CRM delta: `0`
- earlier business-producing canary retained: `75ad2b8c-bd62-46d8-8204-8015bc330719`, company/source/contact `+1 / +8 / +1`, one `EVIDENCE_REQUIRED` Opportunity
- isolated PostgreSQL: migrations 025–048 applied after 001–024, then replayed as `SKIPPED_ALREADY_APPLIED`
- browser: positive Opportunity/contact detail and reverse empty-Buyer validation passed
- offline dependency audit: 0 vulnerabilities

## Stop boundary

STOP after WP-A16. The Phase 10 pre-email category-driven automation plan is complete. Gmail/outbound activation remains a separate future deployment decision.
