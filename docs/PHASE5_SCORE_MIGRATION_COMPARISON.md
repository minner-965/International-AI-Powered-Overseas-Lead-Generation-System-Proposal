# DPV Phase 5 Score Migration Comparison

## Evaluation basis

Evaluation date: `2026-08-28`

Rule versions:

```text
DPV score: dpv-score-v1
Qualification: qualification-v1
Facts snapshot: dpv-score-facts-v1
```

The new engine preserves the eight DPV dimensions and their exact weights:

```text
Product Fit                         20
Market Fit                          15
Importer / Wholesaler Fit           15
Import & Chain-Supply Evidence       15
Distribution Scale                  10
Recent Buying Signal                10
Decision-Maker Quality              10
Contact Validity                     5
Total                              100
```

Tier boundaries remain `A = 75–100`, `B = 55–74`, `C < 55`.

## Initial verified-company run

The run evaluated all five companies currently marked `VERIFIED_BUSINESS`. It persisted one immutable facts snapshot, one versioned score run and one management-baseline match result per company.

| Company | Previous score | New score | Previous tier | New tier | Eligibility | Evidence coverage | Main evidence gap |
|---|---:|---:|:---:|:---:|---|---:|---|
| AFS General Trading LLC | — | 57 | — | B | ELIGIBLE | 75% | Scale has evidence but no supported band; recent signal, decision maker and contact evidence absent |
| Best Retail Company in Dubai & UAE | — | 58 | — | B | ELIGIBLE | 65% | Importer/wholesaler evidence, recent signal and decision maker absent |
| ELK Fashion Dubai | 45 | 80 | C | A | ELIGIBLE | 80% | Recent dated buying signal and decision maker absent |
| Rizqé | — | 74 | — | B | ELIGIBLE | 80% | Recent dated buying signal and decision maker absent |
| United General Trading FZCO | — | 47 | — | C | PARTIAL_EVIDENCE | 55% | Chain-supply, supported scale, recent signal and decision maker absent |

Tier distribution from the new run:

```text
Tier A: 1
Tier B: 3
Tier C: 1

ELIGIBLE: 4
PARTIAL_EVIDENCE: 1
INSUFFICIENT_EVIDENCE: 0
```

## Direct old/new comparison

Only `ELK Fashion Dubai` has both a legacy `lead_reviews` score and a current Phase 4 verification record. The other four promoted companies do not have a legacy score, so they are new-engine-only results and are not presented as old/new equivalents.

`ELK Fashion Dubai` changed from `45 / Tier C` to `80 / Tier A`.

The difference is explainable from the stored snapshot:

```text
Product Fit:                    20/20
Market Fit:                     15/15
Importer / Wholesaler Fit:      15/15
Chain-Supply Evidence:          15/15
Distribution Scale:             10/10
Recent Buying Signal:            0/10
Decision-Maker Quality:          0/10
Contact Validity:                5/5
```

The legacy score predates the later Phase 4 evidence set, so this is not a like-for-like same-snapshot replay. The new run links each contributing dimension to stored evidence and gives zero to the two unsupported dimensions. The difference is retained for management review rather than written back over the legacy score.

## Determinism and retry behavior

The acceptance command was executed twice with the same execution keys.

First execution:

```text
company_score_runs inserted: 5
customer_match_results inserted: 5
```

Second execution:

```text
score idempotent_replay: true for 5/5
match idempotent_replay: true for 5/5
company_score_runs remained: 5
customer_match_results remained: 5
```

Deliberate rescoring remains append-only by using a new execution key or omitting it.

## Cutover status

The new score is available through the versioned score-run API. The legacy `lead_reviews.lead_score` and `tier` values were not overwritten. This preserves rollback and allows the UI to identify the score as `dpv-score-v1` with its eligibility and evidence coverage.

## Post-repair scoring refresh

The Phase 4 evidence repair changed the current evidence snapshot, so a new append-only score and match run was calculated for the three companies attached to that ResearchJob. Historical rows were retained.

Current database totals:

```text
company_score_runs: 9
customer_match_results: 9
distinct companies with a latest score: 5
distinct companies with a latest match: 5
```

Latest result per company:

| Company | DPV score | Tier | Eligibility | Score coverage | Baseline match | Match coverage | Opportunity matrix |
| --- | ---: | :---: | --- | ---: | ---: | ---: | --- |
| ELK Fashion Dubai | 80 | A | ELIGIBLE | 80% | 35 | 65% | STRATEGIC_MANUAL_REVIEW |
| Rizqé | 67 | B | ELIGIBLE | 80% | 35 | 65% | STRATEGIC_MANUAL_REVIEW |
| Best Retail Company in Dubai & UAE | 58 | B | ELIGIBLE | 65% | 25 | 25% | STRATEGIC_MANUAL_REVIEW |
| AFS General Trading LLC | 57 | B | ELIGIBLE | 75% | 35 | 65% | STRATEGIC_MANUAL_REVIEW |
| United General Trading FZCO | 47 | C | PARTIAL_EVIDENCE | 55% | 35 | 55% | LOWER_PRIORITY |

Current distribution:

```text
Tier A: 1
Tier B: 3
Tier C: 1

ELIGIBLE: 4
PARTIAL_EVIDENCE: 1
INSUFFICIENT_EVIDENCE: 0
```

Rizqé changed from the initial Phase 5 result of `74 / B` to the current `67 / B` because its refreshed source set no longer supports a non-UNKNOWN company-size band. This is an evidence-driven append-only change, not a rule-weight change. The only valid direct legacy/new comparison remains ELK Fashion Dubai at `45 / C` versus `80 / A`.

The management UI now prefers the latest versioned score and match where available, while leaving legacy `lead_reviews` rows unchanged for rollback and audit.
