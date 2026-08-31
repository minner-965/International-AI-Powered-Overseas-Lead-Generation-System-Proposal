# Phase 6.1 V3 Product Match Result

## Status

```text
STATUS: PASS
phase: Phase 6.1 only
release: phase6.1
official ResearchJob: 97dfcf5e-374b-41a5-a214-f00681c13fd1
job status: COMPLETED
started: 2026-08-31T13:09:03+08:00
completed: 2026-08-31T13:15:32+08:00
companies: 7
product profiles: 2
company × profile results: 14
errors: 0
timeouts: 0
Phase 7: not started
```

The accepted V3 result uses real persisted database rows and public-web evidence. This report intentionally contains aggregate results only: it does not list company IDs, internal product IDs or names, prices, orders, customers, source paths or raw payloads.

## Frozen versions

```text
Buyer Business Model: buyer-business-model-v1
Category Procurement Match: category-procurement-match-v1
Product Opportunity: product-opportunity-v1
Supplier Access / Readiness: cooperation-feasibility-v3
Product taxonomy: product-taxonomy-v1
Catalog snapshot: product-profile-catalog-snapshot-v1
Migration: 024_phase6_1_category_procurement_match.sql
Migration checksum prefix: f468b82796e4
```

Migration 024 was applied by the explicit checksum-ledger runner and replayed without a checksum conflict. It is additive and retains the Phase 5/6 entities and historical results.

## Business model distribution

| Buyer Business Model | Count |
| --- | ---: |
| `DIRECT_END_BUYER` | 1 |
| `DISTRIBUTION_BUYER` | 0 |
| `UNCLEAR_INTERMEDIARY` | 10 |
| `EXCLUDED_INTERMEDIARY` | 2 |
| `UNKNOWN` | 1 |

The live set contains no company that simultaneously meets the V3 distribution-buyer category, procurement/import/external-sourcing, and stock/B2B/distribution-network evidence gates. Trading or distributor wording alone did not create a qualified buyer model. `UNCLEAR_INTERMEDIARY` results publish no numeric Product Match score.

## Category Procurement Match distribution

| Match status | Count |
| --- | ---: |
| `CATEGORY_PROCUREMENT_MATCH` | 0 |
| `CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE` | 0 |
| `WEAK_CATEGORY_MATCH` | 0 |
| `PRODUCT_MISMATCH` | 0 |
| `NEEDS_PRODUCT_EVIDENCE` | 6 |
| `NEEDS_INTERNAL_CATALOG_EVIDENCE` | 7 |
| `INELIGIBLE_BUYER_MODEL` | 1 |

All 14 results have a null published score. Coverage ranges from 0% to 100%, but coverage alone does not bypass the two mandatory core gates or the score threshold. Absence of evidence was not converted into `PRODUCT_MISMATCH`.

The ResearchJob progress counter conservatively reports 14 unknown/non-pass results and 0 passes. The more precise persisted status distribution above is the acceptance result.

## DPV catalog snapshot

| Product profile | Eligible | Classified | Unknown | Excluded | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| `WOMENSWEAR` | 0 | 0 | 109 | 0 | 0.00% |
| `GENERAL_MERCHANDISE` | 13 | 13 | 5 | 0 | 72.22% |

The source database still contains 366 `product_master` rows. The V3 taxonomy process retained 345 rows as `UNKNOWN`, 8 as `REVIEW` and 13 as confirmed for catalog use; it did not overwrite raw product facts or force unknown products into a category. The lack of confirmed Womenswear catalog rows correctly produces `NEEDS_INTERNAL_CATALOG_EVIDENCE` instead of a fabricated match.

## Product Opportunity

```text
NOT_RUN_GATE_FAILED: 14
READY: 0
PARTIAL_INTERNAL_CATALOG: 0
NO_REAL_CANDIDATE: 0
real product candidates: 0
```

Product Opportunity remained a second-stage recommendation layer. Because no Category Procurement Match passed, all 14 rows correctly record `NOT_RUN_GATE_FAILED`; zero candidates did not reverse or rewrite a Category Procurement Match result.

## Supplier Access, Matrix V3 and Readiness V3

Supplier Access band:

```text
HIGH: 2
MEDIUM: 4
UNKNOWN: 8
```

Product Access Matrix V3:

```text
INELIGIBLE_BUYER_MODEL: 2
UNKNOWN_PRODUCT: 12
```

Readiness V3:

```text
INELIGIBLE_BUYER_MODEL: 2
NEEDS_INTERNAL_CATALOG_EVIDENCE: 6
NEEDS_PRODUCT_EVIDENCE: 6
SALES_READY: 0
```

Supplier Access stayed independent from Product Match. A higher access band did not manufacture a category match, and named buyer/contact readiness remained an independent gate.

## Public evidence

```text
source rows: 198
distinct public URLs: 116
fetched and verified public pages: 110
search-result discovery hints, not fetched: 88
structured observations: 131
verified observations: 73
review observations: 58
WOMENSWEAR observations: 59
GENERAL_MERCHANDISE observations: 14
unresolved-profile observations: 58
```

Source-type distribution:

```text
SEARCH_RESULT_HINT: 88
OFFICIAL_STOREFRONT: 45
OFFICIAL: 42
PHASE4_PRODUCT_CATEGORY: 12
OFFICIAL_DOCUMENT: 11
```

Search snippets remain discovery hints and do not become verified product facts. Public provider payloads contain only prospect identity, public domain, market/language and controlled public category/procurement terms; internal product rows, prices, orders and private paths remain local.

## Missing evidence and blockers

Category-match missing-evidence counts across applicable results:

```text
target_category_procurement_evidence: 11
buyer_business_model_fit: 11
assortment_depth: 11
external_sourcing_import: 11
recent_category_activity: 11
```

Readiness blockers:

```text
NEEDS_DECISION_MAKER: 14
REVIEW: 11
NEEDS_INTERNAL_CATALOG_EVIDENCE: 7
NEEDS_PRODUCT_EVIDENCE: 6
INELIGIBLE_BUYER_MODEL: 2
NEEDS_VERIFICATION: 2
```

These are evidence gaps, not generated claims of closed procurement or confirmed mismatch.

## Queue and service verification

```text
collect-category-buyer-evidence: 14 completed
classify-buyer-business-model: 14 completed
calculate-category-procurement-match: 14 completed
calculate-product-opportunities: 14 completed
recalculate-cooperation-v3: 14 completed
total queue steps: 70 completed
failed: 0
retry: 0
active: 0
queued: 0
```

Express created the persisted `QUEUED` ResearchJob before n8n dispatch. n8n invoked the internal endpoint, pg-boss processed bounded company × profile work, and PostgreSQL retained every final layer. The dashboard/API container and the queue worker run separately so live page access remains responsive during collection.

The ResearchJob progress query was rewritten as independent scalar aggregates after the previous multi-table join was found to create a large PostgreSQL temporary spill. The accepted run recorded 0 PostgreSQL temporary bytes/files.

## Historical preservation

```text
companies: 106
sources: 205
contacts: 52
lead_reviews: 93
collection_runs: 12
product_master: 366
Phase 6 fixed acceptance-job cooperation rows: 7
```

The Phase 6 acceptance job `d86975c4-5815-4a43-a375-9ebd1adb178b`, its seven rows, Phase 6 feasibility v1, DPV Score, Management Baseline Match, Mexico Historical Reference Match and decision-maker evidence history remain intact.

## Tests

```text
command: npm test
tests: 325
passed: 322
failed: 0
conditionally skipped: 3
```

The three conditional skips are the existing PostgreSQL import replay probe and two mock live-discovery failure-path fixtures. Phase 6.1 coverage includes buyer-model evidence gates, nullable/coverage scoring, Product Opportunity separation, supplier-access independence, matrix/readiness precedence, taxonomy, data isolation, migration replay, queues, API contracts, bilingual UI and regressions.

## Browser acceptance

| Viewport / mode | Result |
| --- | --- |
| 1440 × 900 | PASS — 11 desktop business columns, component-level horizontal scrolling |
| 1024 × 768 | PASS |
| 768 × 900 | PASS |
| 390 × 844 | PASS — six decision-critical fields retained, one-column mobile cards |
| 375 × 667 | PASS |
| 844 × 390 | PASS |
| Light / dark | PASS |
| Comfortable / compact | PASS |
| Browser zoom / responsive reflow | PASS |
| Detail Back / Close / focus restoration | PASS |
| Product Match detail profiles | PASS — WOMENSWEAR and GENERAL_MERCHANDISE |
| Page-level horizontal overflow | none |
| Long bilingual status clipping | none |
| Browser console errors | 0 |
| Bangladesh market visibility | hidden |

Desktop detail was measured at 960 × 774 inside a 1440 × 900 viewport; mobile detail was 359 × 828 inside 390 × 844. Both keep one internally scrolling body, a visible Back action and a separate Close action.

## GitHub handoff

```text
repository: https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal
branch: main
implementation_commit: 858a8554d743c4b2984d36960987da6eb5754982
implementation_push_status: pushed and remote-verified
implementation_pushed_at: 2026-08-31T13:26:04+08:00
handoff_commit: the documentation commit referenced by annotated tag phase6.1
tag: phase6.1
```

The implementation commit was verified against `refs/heads/main` before this documentation-only handoff commit was created.

STOP — Phase 7 not started.
