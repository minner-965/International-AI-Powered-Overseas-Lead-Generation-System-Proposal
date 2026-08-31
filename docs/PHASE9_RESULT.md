# Phase 9 Result

Date: 2026-08-31

Plan: `DPV_PHASE9_REAL_OPPORTUNITY_AND_RESEARCH_WORKBENCH_CODEX_EXECUTION_PLAN_V1.md`

Baseline: peeled `phase8` commit `6b3073c10d3f9503f478f424eccf3408e1b5df82`

## Release decision

```text
PHASE 9 IMPLEMENTATION: PASS
REAL RECOMMENDED OPPORTUNITIES: 0
REAL SALES_READY OPPORTUNITIES: 0
REAL VERIFIED PROFILE BUYERS: 0
REAL HUNTER VALID ROUTES: 0
REAL PROSPECT SENDS: 0
PHASE 10 ELIGIBLE: NO
```

Phase 9 delivers a real, auditable research workflow and does not lower the business gate when evidence is incomplete. Phase 10 live contact, message sending, automatic follow-up and deal-loop work have not started.

## Delivered

### Controlled real-opportunity pipeline

- Added `REAL_OPPORTUNITY_RESEARCH` as a bounded ResearchJob path while preserving legacy/current job types.
- Persists actor, role, idempotency key, immutable request digest, research wave, run budget and stop reason.
- Freezes one product profile per company in a deterministic cohort.
- Wave A cap is 5; Wave B cap is 15 and requires a successful Wave A gate.
- Existing Tavily discovery/crawler, Buyer model, Category Procurement, Supplier Access, Buyer role, contact, deterministic decision and telemetry components are reused.
- Finder → Verifier is permitted only after a named, profile-relevant Buyer/Procurement role is proven.
- `VALID` inside TTL is required; `ACCEPT_ALL`, `UNKNOWN`, `NOT_VERIFIED` and temporary provider errors do not pass.
- Historical-customer and current suppression gates are applied before cohort selection and decision promotion.
- Management approval is not automated.

### Audit schema

Migration `029_phase9_real_opportunity_research_audit.sql` adds only the non-derivable Phase 9 audit facts:

- immutable Phase 9 fields on `research_jobs`;
- `research_job_cohort_items` for frozen company × profile selection;
- `research_job_stage_events` for append-only stage results and canonical references;
- `contact_verification_events` for an exact contact-to-settled-provider-event chain without storing a plaintext address.

Applied migration checksum:

```text
052cdf4bdbfe1a33ed024e228f1a5b8b78b2bab03b36356fec63949e41e59bdf
```

First apply, checksum replay and a final 025→029 runner replay all passed. Existing companies, sources, contacts, reviews, products, historical runs and decision revisions were not rewritten.

### Management APIs

The following management-authenticated read models return bounded public projections:

```text
GET /api/research/workbench-summary
GET /api/research/tasks
GET /api/research/jobs?view=inbox
GET /api/research/jobs/:id
GET /api/research/jobs/:id/results
```

Deployed checks returned HTTP 200 for all five endpoints. Responses contained no API key field, Authorization value, provider request ID, raw provider payload or stored internal error text. Enrichment/category readers and manual email-verification mutations now share the required management role boundary.

### Research Workbench and Jobs Inbox

- Replaced the old plain-text Research surface with four true metrics, at most three priority evidence tasks and six recent jobs.
- Added a native, accessible three-step New Research Job dialog while preserving the established POST payload and dispatch path.
- Rebuilt Jobs as a three-tab Inbox with filters, cursor pagination, seven operational columns and a seven-stage detail view.
- Added safe evidence links, blocker deep-links, URL state, browser Back and exact focus restoration.
- Completed jobs show deterministic `100%` progress.
- Long mobile job lists use an internal scroll region; long dialog content uses internal scrolling.
- Company-visible wording uses generic “邮箱核验 / Email verification”; provider details remain internal.
- No fake company, fake task, fake Buyer, fake email, fake KPI, fake gauge, gradient, external font or second icon family was added.

## Actual controlled execution

| Wave | Job | Selected / completed | Public references | Errors | Provider calls / units |
| --- | --- | ---: | ---: | ---: | ---: |
| A | `632e2372-41d2-4a65-bd78-b36c9878451c` | 5 / 5 | 15 | 0 | 0 / 0 |
| B | `62cf55c4-a8ab-4926-a6e4-5908ce03182b` | 1 / 1 | 5 | 0 | 0 / 0 |

All six identities were ready. Buyer-model and category evidence remained incomplete; three companies had supported Supplier Access and three required more supplier-access evidence. All six lacked a verified named profile Buyer and a current valid business email. The safe result is six Evidence Required refresh outcomes, zero promotions and zero provider charge.

Detailed actual distributions are in [PHASE9_REAL_OPPORTUNITY_RESULT.md](./PHASE9_REAL_OPPORTUNITY_RESULT.md).

## Verification

### Automated and deployed checks

- Full Node test suite: 477 tests, 473 passed, 0 failed and 4 conditionally skipped.
- Migration 029 isolated apply/replay and actual PostgreSQL replay passed.
- Five deployed Workbench API reads returned 200 and passed a sensitive-field projection scan.
- Dashboard health check passed; PostgreSQL remained healthy; n8n, category, data and outreach workers remained running.
- Environment projection confirms the email-verification credential is available only to the dashboard and bounded workers that require it; its value was never printed or committed.
- Existing n8n Phase 6 enrichment workflow now accepts the new bounded job type and delegates business rules to Express.
- Deployed browser matrix passed at seven viewports, light/dark and comfortable/compact.
- Browser Back/focus, dialog Escape/close, internal scroll and safe-link behavior passed.
- Deployed XLSX export passed: 14 rows × 31 columns, valid worksheet/table, no blank headers, no formula errors, and a recorded download audit.
- `git diff --check` and compose validation are part of the release command set.
- `npm audit --omit=dev` retains the two already tracked moderate ExcelJS/uuid findings. The only offered remediation is an incompatible ExcelJS downgrade, so no forced dependency regression was applied in Phase 9; high and critical findings remain 0.

### Runtime integrity after Wave A/B

```text
companies=106
sources=205
contacts=52
lead_reviews=93
collection_runs=12
research_jobs=33
enrichment_job_companies=70
decision_makers=12
decision_maker_contacts=78
provider_usage_events=0
product_master=366
business_opportunity_decision_snapshots=28
research_job_cohort_items=6
research_job_stage_events=42
contact_verification_events=0
outbound_messages=0
outbound_message_attempts=0
email_message_events=0
```

## PASS checklist

- [x] Baseline equals peeled `phase8`.
- [x] Existing user changes preserved.
- [x] Schema audit completed; migration limited to proven audit gaps.
- [x] No new package, framework, font, icon family or unnecessary service.
- [x] Cohort selection deterministic and one profile per company.
- [x] Wave A bounded and audited.
- [x] Wave B started only after the Wave A gate; no cohort padding.
- [x] Product Match uses the real 366-row product database and frozen catalog snapshots.
- [x] Distribution buyers require procurement-and-resale evidence.
- [x] Named profile Buyer and role evidence required.
- [x] Current `VALID` email required; ambiguous statuses do not pass.
- [x] Historical-customer and suppression gates hold.
- [x] Decision revisions and stage events remain append-only.
- [x] Management approval not automated.
- [x] Provider sends, outbound messages and email events remain 0.
- [x] Research Workbench and Jobs Inbox use real metrics and records.
- [x] Three-step dialog, blocker deep-link, browser Back and focus contracts pass.
- [x] Seven viewport matrix and mobile internal scrolling pass.
- [x] Migration replay, API, Docker, n8n and deployed Excel regressions pass.
- [x] Result, reuse and visual-audit documents complete.
- [ ] Phase 10 business eligibility; current verified truth is `NO`.

## Documents

- [PHASE9_REUSE_RESEARCH.md](./PHASE9_REUSE_RESEARCH.md)
- [PHASE9_REAL_OPPORTUNITY_RESULT.md](./PHASE9_REAL_OPPORTUNITY_RESULT.md)
- [PHASE9_VISUAL_AUDIT.md](./PHASE9_VISUAL_AUDIT.md)
- [PHASE8_DESIGN_SYSTEM.md](./PHASE8_DESIGN_SYSTEM.md)
- [UI_SYSTEM.md](./UI_SYSTEM.md)
- [VERSION_CHANGELOG.md](./VERSION_CHANGELOG.md)

The final handoff records the exact `HEAD`, `origin/main`, peeled `phase9` and tag-object hashes after push, because a commit cannot truthfully contain its own final hash.
