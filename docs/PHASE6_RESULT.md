# Phase 6 Result

## STATUS

**PASS — buyer/procurement enrichment, public contact routes and cooperation-feasibility review are implemented and verified with current AE/MX data.**

## SCOPE

```text
markets: AE, MX
hidden configured market: BD
product profiles: WOMENSWEAR, GENERAL_MERCHANDISE
final acceptance job: d86975c4-5815-4a43-a375-9ebd1adb178b
companies attempted: 7
AE attempted: 6
MX attempted: 1
WOMENSWEAR: 3
GENERAL_MERCHANDISE: 4
```

The eligible pool was below 20. Five bounded discovery runs, including one technical rerun, returned 25 public candidates; the failed run performed no candidate checks, so 20 candidates were checked and 9 companies were promoted. Evidence review produced 7 legitimate eligible opportunities; no synthetic target was added to reach a quota.

## DECISION MAKERS

```text
named people: 0
department/corporate routes: 7
VERIFIED: 0
REVIEW: 7
REJECTED: 0
role distribution: OTHER_RELEVANT 7
role relevance: MEDIUM 7
```

Public sources did not prove a named buyer or verified buying department. The system retained source-backed corporate contact routes for review instead of inventing identities. SEO headings and organization names are explicitly rejected as people.

## CONTACTABILITY

```text
BUSINESS_EMAIL / NOT_VERIFIED: 4
GENERIC_BUSINESS_EMAIL / NOT_VERIFIED: 5
VALID: 0
ACCEPT_ALL: 0
BUSINESS_PHONE / FORMAT_VALID: 5
BUSINESS_WHATSAPP / BUSINESS_WHATSAPP_OBSERVED: 5
CONTACT_FORM / PUBLICLY_OBSERVED: 14
SUPPLIER_PORTAL: 0
VENDOR_REGISTRATION: 0
total public business routes: 33
```

The maximum retained route count is 9 per company and the maximum distinct phone/WhatsApp number count is 3. No cap violations remain. Verification meanings stay separate from the displayed contact value.

## OPPORTUNITY READINESS

```text
feasibility scored companies: 7
HIGH: 2
MEDIUM: 5
LOW_MEDIUM: 0
LOW: 0

HIGH_FIT_HIGH_ACCESS: 0
HIGH_FIT_MEDIUM_ACCESS: 0
HIGH_FIT_LOW_ACCESS: 0
MEDIUM_FIT_HIGH_ACCESS: 1
MEDIUM_FIT_MEDIUM_ACCESS: 4
LOW_PRIORITY: 2

SALES_READY: 0
NEEDS_DECISION_MAKER: 7
NEEDS_CONTACT_ROUTE: 0
NEEDS_VERIFICATION: 0
HISTORICAL_REVIEW: 0
EXISTING_CUSTOMER: 0
SUPPRESSED: 0
REVIEW: 0
STRATEGIC_LONG_SHOT: 0

supplier portals: 0
vendor registration routes: 0
fixed-supplier barrier evidence: 0
unknown barrier: 7
```

All results preserve six dimension scores, reasons, evidence links, missing evidence and barrier signals. Company size is not a hidden score input. DPV Score, Management Baseline Match and Mexico Historical Match remain separate and unchanged.

## HISTORICAL CONTEXT

```text
relationship status: NEW_PROSPECT 7
strong OKKI links in attempted set: 0
confirmed existing-customer attempts: 0
suppressed-company attempts: 0
```

Confirmed existing customers remain excluded from the new-opportunity query. Historical leads remain contextual records rather than automatic opt-outs or converted customers.

## EVIDENCE

```text
official decision-maker evidence URLs: 7
official evidence state: REVIEW 7
reachable enrichment pages recorded by the job counter: 38
other public LinkedIn discovery URLs: 33
LinkedIn references: REVIEW / DISCOVERY_HINT 33
LinkedIn content fetched: 0
distinct public URLs across both sets: 40
company-specific search requests: 35
successful requests: 35
failed requests: 0
```

Source URLs, authority, capture time and evidence text are persisted. Five incorrect/non-target identity classes were excluded from the opportunity pool without deleting historical source rows.

## PROVIDER USAGE

```text
Tavily: 35 successful public-search requests in the final job
Hunter mode: DISABLED for the final acceptance run
Hunter calls: 0
Hunter reserved credits: 0
Hunter used credits: 0
LinkedIn mode: SEARCH_DISCOVERY_ONLY
```

Hunter's backend adapter, test mode, status mapping, idempotency and budget cap are covered by synthetic tests. LinkedIn content collection is absent.

## DATABASE COUNTS BEFORE / AFTER

The before count is the recorded Phase 5 V2.3.1 baseline. The increase in companies, sources and public contacts comes from the bounded real-company discovery required to build the Phase 6 acceptance pool.

| Entity | Before | After |
| --- | ---: | ---: |
| companies | 97 | 106 |
| sources | 137 | 205 |
| contacts | 31 | 52 |
| lead_reviews | 93 | 93 |
| collection_runs | 12 | 12 |
| research_jobs | 16 | 28 |
| decision_makers | — | 12 |
| decision_maker_sources | — | 15 |
| decision_maker_contacts | — | 76 |
| enrichment_public_references | — | 217 |
| cooperation_feasibility_results | — | 40 |

`collection_runs` was preserved. Phase 6 reuses `research_jobs` with a new job type and adds only the enrichment entities required by the contract. No raw business dataset is committed.

## UI

```text
Opportunities API rows: 7
desktop 1440 × 900: PASS
mobile 390 × 844: PASS
375 × 667: PASS
768 × 900: PASS
844 × 390: PASS
1024 × 768: PASS
light theme: PASS
dark theme: PASS
body-level horizontal overflow: none
company-detail Back / Close / Escape / focus restoration: PASS
equal-size Chinese-above-English display: PASS
BD hidden: PASS
```

The mobile opportunity view is a 2 × 2 management summary card; long contact/evidence details remain in an internally scrolling detail window. The enrichment button remains disabled while a job is active.

## TESTS

```text
command: npm test
tests: 238
passed: 235
failed: 0
conditionally skipped: 3
```

The three conditional skips are the existing PostgreSQL import replay probe and two mock live-discovery failure-path fixtures. They are not failed assertions. Phase 6 coverage includes role normalization, product relevance, evidence gates, contact semantics, Hunter disabled/test/budget/idempotency behavior, LinkedIn mode boundaries, cooperation dimensions, readiness, migration, Express contracts, n8n/queue boundaries, mobile structure and Phase 5 regression.

## BLOCKERS

There is no implementation blocker. The current public evidence does not verify a named buyer, procurement department or supplier onboarding route for the seven accepted companies, so all seven correctly remain `NEEDS_DECISION_MAKER`. This is an explicit data result, not a generated claim.

## GITHUB

```text
repository: https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal
branch: main
implementation_commit: pending final handoff
tag: phase6
push_status: pending final verification
pushed_at: pending
```

## READY FOR PHASE 7

```text
YES — Phase 6 acceptance passed; Phase 7 has not started.
```

STOP — Phase 7 not started.
