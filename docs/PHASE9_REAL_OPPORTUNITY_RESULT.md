# Phase 9 Real Opportunity Result

Date: 2026-08-31

Baseline: peeled `phase8` commit `6b3073c10d3f9503f478f424eccf3408e1b5df82`

Scope: controlled AE/MX real-opportunity evidence refresh; no outreach and no Phase 10 work.

## Executive result

```text
PHASE 9 IMPLEMENTATION: PASS
REAL RECOMMENDED OPPORTUNITIES: 0
REAL SALES_READY OPPORTUNITIES: 0
REAL VERIFIED PROFILE BUYERS: 0
REAL HUNTER VALID ROUTES: 0
REAL PROSPECT SENDS: 0
PHASE 10 ELIGIBLE: NO
```

The implementation passed because the controlled pipeline retained uncertainty instead of promoting incomplete evidence. No threshold was relaxed to manufacture a positive result.

## Controlled cohorts

| Wave | ResearchJob | Frozen cohort | Completed | Errors | Stop reason | Provider calls / units |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| A | `632e2372-41d2-4a65-bd78-b36c9878451c` | 5 | 5 | 0 | none | 0 / 0 |
| B | `62cf55c4-a8ab-4926-a6e4-5908ce03182b` | 1 | 1 | 0 | none | 0 / 0 |

Wave B began only after Wave A completed without a gate violation, secret exposure, error or budget overrun. Only one remaining candidate satisfied the strict deterministic selection rules, so the cohort was not padded to the cap of 15.

| Wave | Company | Market | Frozen profile | Public references found | Decision routes | Contact routes |
| --- | --- | --- | --- | ---: | ---: | ---: |
| A | Apparel Group | AE | GENERAL_MERCHANDISE | 5 | 1 | 5 |
| A | Bismi Group | AE | GENERAL_MERCHANDISE | 2 | 1 | 1 |
| A | ELK Fashion Dubai | AE | GENERAL_MERCHANDISE | 6 | 1 | 3 |
| A | Home Design México® | MX | GENERAL_MERCHANDISE | 1 | 1 | 4 |
| A | Right Face General Trading LLC | AE | GENERAL_MERCHANDISE | 1 | 1 | 3 |
| B | Rizqé | AE | GENERAL_MERCHANDISE | 5 | 1 | 5 |

Aggregate public evidence persisted for these jobs:

- 20 `enrichment_public_references` rows;
- 6 `decision_maker_sources` rows;
- 29 existing canonical Buyer-model evidence links reused by the frozen stage results;
- 1 existing canonical Category Procurement evidence link reused by the frozen stage results;
- 42 immutable Phase 9 stage events: seven stages for each of six cohort companies.

Counts above are direct database results. A reused canonical evidence row is not presented as a newly discovered source.

## Seven-stage result distribution

| Stage | Actual result |
| --- | --- |
| Identity | 6 `IDENTITY_READY` |
| Buyer Model | 5 `UNCLEAR_INTERMEDIARY / NEEDS_EVIDENCE`; 1 `UNKNOWN / NEEDS_EVIDENCE` |
| Category Procurement Match | 6 `GENERAL_MERCHANDISE / NEEDS_PRODUCT_EVIDENCE` |
| Supplier Access | 3 `SUPPLIER_ACCESS_SUPPORTED`; 3 `EVIDENCE_REQUIRED_SUPPLIER_ACCESS` |
| Buyer / Procurement | 6 `EVIDENCE_REQUIRED_BUYER_ROLE` |
| Business Email | 6 `EVIDENCE_REQUIRED_EMAIL` |
| Decision Refresh | 6 `EVIDENCE_REQUIRED` |

All six observed decision-person records are non-named corporate contact routes with `OTHER_RELEVANT`, `MEDIUM`, `REVIEW`. A corporate contact label is not counted as a person and does not satisfy the named profile Buyer gate.

The 21 persisted contact routes created or reused by the two Phase 9 jobs are:

| Contact evidence status | Count |
| --- | ---: |
| Business email, not verified | 2 |
| Generic business email, not verified | 4 |
| Business phone, format valid | 6 |
| Business WhatsApp observed | 3 |
| Public contact form observed | 6 |

These are public company contact routes, not verified named-buyer addresses. They remain Evidence Required.

## Email-verification and budget audit

The required Finder → Verifier chain was not started because no profile-relevant named Buyer or Procurement person passed the preceding gate.

```text
provider_usage_events for Wave A/B: 0
contact_verification_events for Wave A/B: 0
VALID: 0
ACCEPT_ALL: 0
UNKNOWN: 0
INVALID: 0
TEMPORARY_ERROR: 0
used units: 0
```

`ACCEPT_ALL`, `UNKNOWN` and temporary errors are covered by deterministic tests and never project as contact ready. No credential, email value, provider payload or request ID is recorded in this report.

## Opportunity and exclusion audit

Current latest opportunity distribution after both waves remains:

| Business fit | Recommendation | Contact readiness | Count |
| --- | --- | --- | ---: |
| EVIDENCE_REQUIRED | EVIDENCE_REQUIRED | EVIDENCE_REQUIRED | 12 |
| NOT_SUITABLE | NOT_SUITABLE | BLOCKED | 2 |

Phase 9 created six append-only decision-refresh events, each referencing the current canonical decision revision. It did not rewrite the existing eight-component score, DPV Score, historical/reference match or earlier decision history.

Selected cohort exclusions remained truthful:

```text
historical-customer links in selected cohort: 0
active company suppressions in selected cohort: 0
active contact suppressions in selected cohort: 0
management approvals created: 0
provider sends: 0
outbound messages: 0
outbound attempts: 0
email events: 0
```

## Current persisted counts

| Entity | Count |
| --- | ---: |
| companies | 106 |
| sources | 205 |
| contacts | 52 |
| lead_reviews | 93 |
| collection_runs | 12 |
| research_jobs | 33 |
| enrichment_job_companies | 70 |
| decision_makers | 12 |
| decision_maker_contacts | 78 |
| provider_usage_events | 0 |
| product_master | 366 |
| business_opportunity_decision_snapshots | 28 |
| research_job_cohort_items | 6 |
| research_job_stage_events | 42 |
| contact_verification_events | 0 |

The two older queued company-discovery jobs remain historical/current state and were not rewritten by Phase 9.

## Remaining evidence queue and next bounded batch

The Workbench truthfully reports 12 Evidence Required opportunities and ranks at most three current tasks. The dominant blockers are:

1. confirm whether the company buys and resells the selected DPV product profile;
2. obtain company-specific category procurement evidence;
3. identify a real named Buyer/Procurement person and prove role relevance;
4. only then run the bounded Finder → Verifier chain for a current business email.

A future batch should prioritize companies nearest to contact readiness, keep AE/MX and the frozen catalog profile explicit, preserve current history/suppression gates, and stop before any send. Phase 10 remains outside this release.
