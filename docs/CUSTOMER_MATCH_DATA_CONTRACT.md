# Customer Match / ICP Data Contract

## Purpose

`Customer Match` is an independent 0–100 measure of how closely a company matches a versioned DPV ideal-customer profile. It is stored and displayed separately from the DPV lead score, company size, SME relevance and partnership accessibility.

Phase 5 supports two profile types and keeps their results separate:

- `MANAGEMENT_BASELINE`: management-defined target patterns. Production profile `baseline-v1` is active without claiming to be learned from order history.
- `HISTORICAL_CUSTOMER_ICP`: aggregated patterns from committed internal reference data. A build creates a `DRAFT`; activation is an explicit, audited operation.

## Versioned profile

`leadgen.icp_profiles` stores:

```text
id
name
profile_type
version
status
market_scope[]
product_scope[]
source_import_ids[]
sample_size_wins
sample_size_losses
sample_size_orders
feature_coverage
calculation_version
created_at / activated_at / retired_at
```

`leadgen.icp_profile_features` stores one structured value per feature, with its own coverage, sample size and calculation version. Supported feature keys include:

```text
buyer_types
product_categories
markets
channels
company_sizes
distribution_patterns
commercial_moq
historical_win_similarity
```

Only one active profile is allowed for the same profile type and exact market/product scope. Activating a historical profile retires only the previous historical profile for that scope; it does not overwrite the management baseline.

## Customer facts input

`CustomerMatchEngine.evaluate({ companyFacts, profile, dpvScore })` receives a complete in-memory facts snapshot. Rule definitions contain no SQL.

Categorical company facts use:

```json
{
  "values": ["IMPORTER", "WHOLESALER"],
  "evidence_ids": ["uuid"]
}
```

Commercial/MOQ facts use:

```json
{
  "numeric_value": 500,
  "evidence_ids": ["uuid"]
}
```

Historical similarity facts use:

```json
{
  "similarity": 0.82,
  "evidence_ids": ["uuid"]
}
```

A value without an evidence identifier is treated as unavailable. Missing commercial or historical facts receive zero points and reduce coverage; they are not replaced with defaults.

## Dimensions and coverage

| Dimension | Maximum |
|---|---:|
| Buyer / Business Model Fit | 20 |
| Product / Category Fit | 20 |
| Market / Channel Fit | 15 |
| Commercial / MOQ Fit | 15 |
| Company Scale Fit | 10 |
| Distribution Pattern Fit | 10 |
| Historical Win Similarity | 10 |
| Total | 100 |

For each dimension:

```text
points = maximum × deterministic fit (0–1)
covered weight = maximum × profile feature coverage
```

Only an available company fact contributes covered weight. Scores are not renormalized to 100 when evidence is missing. A strong baseline match can therefore produce `75/100, coverage 75%` while Commercial/MOQ and Historical Win remain unavailable.

For `HISTORICAL_CUSTOMER_ICP`, a profile with overall feature coverage below 60% suppresses the numeric result:

```text
match_score = null
display_status = INSUFFICIENT_PROFILE_DATA
reason = HISTORICAL_PROFILE_COVERAGE_BELOW_60
```

Normal single-profile selection prefers an active historical profile only when its coverage is at least 60%; otherwise it selects the active management baseline. The V2.3 dual-match path deliberately selects one active management profile and the active Mexico historical profile and persists both independently.

## Persisted result

`leadgen.customer_match_results` stores:

```text
company_id
research_job_id nullable
execution_key nullable
reference_profile_id
reference_profile_type
profile_version
match_score nullable
coverage_percent
display_status
opportunity_matrix
dimension_scores
reason_codes
evidence_ids
trace
calculated_at
```

The table is append-only. A new profile version or deliberate recalculation creates a new row. A queue retry supplies the same `executionKey`; `(company_id, reference_profile_id, execution_key)` is unique and the existing result is returned with `idempotent_replay: true`. Including `reference_profile_id` allows the management and historical calculations for one company to use related execution keys without colliding.

## Opportunity matrix

The DPV score and Customer Match are not averaged. The transparent matrix is:

```text
DPV >= 55 and Match >= 60  -> PRIORITY_OPPORTUNITY
DPV >= 55 and Match < 60   -> STRATEGIC_MANUAL_REVIEW
DPV < 55 and Match >= 60   -> EVIDENCE_GAP_REVIEW
DPV < 55 and Match < 60    -> LOWER_PRIORITY
```

## Historical reference-data imports

CSV data is staged through `reference_data_imports` and `reference_data_import_rows`. The sequence is:

```text
dry run
-> header/schema validation
-> row validation
-> within-file and database duplicate checks
-> persisted error report
-> explicit commit
-> audited insert into an INTERNAL_BUSINESS table
```

Supported import types and required CSV columns:

| Import type | Required columns |
|---|---|
| `HISTORICAL_CUSTOMERS` | `external_customer_id, company_name, country_code` |
| `HISTORICAL_ORDERS` | `external_order_id, external_customer_id, order_date` |
| `HISTORICAL_LEAD_OUTCOMES` | `external_lead_id, company_name, country_code, outcome` |
| `HISTORICAL_CUSTOMER_CHANNELS` | `external_customer_id, channel_type` |

Supported optional concepts include buyer type, company size, address, website domain, category, SKU, quantity, MOQ, revenue, currency, Incoterm, lead time, source, qualification, contactability, reply, quotation, loss reason, sales-cycle duration and channel/market.

Production migration 017 inserts no customer, order, lead-outcome or channel rows. Automated tests use in-memory CSV fixtures marked `TEST_ONLY`; these fixtures are never activated as a production historical profile.

## Privacy and isolation

All four historical tables enforce:

```text
data_classification = INTERNAL_BUSINESS
```

Internal rows are not Tavily inputs, evidence URLs, query parameters or telemetry attributes. ICP construction stores aggregated distributions and sample counts. Normal traces keep identifiers, profile/rule versions, duration and status; they do not contain raw customer/order rows.

## Service interfaces

```js
const matching = new CustomerMatchService({ pool });

await matching.evaluate({ companyFacts, profile, dpvScore });
await matching.evaluateAndPersist({
  companyId,
  researchJobId,
  profileId,
  companyFacts,
  dpvScore,
  executionKey
});
await matching.getLatest(companyId);
await matching.getHistory(companyId, { limit: 50 });

const profiles = new IcpProfileService({ pool });
await profiles.listProfiles();
await profiles.buildHistoricalDraft({ name, marketScope, productScope, actor });
await profiles.activateProfile(profileId, { actor });

const imports = createReferenceDataImportService({ pool });
await imports.dryRun({ importType, sourceFilename, csvText, createdBy });
await imports.commit(importId, { actor });
await imports.getImport(importId);
```

These services are suitable for Express handlers, n8n application-service calls and bounded pg-boss workers.

## V2.3 shared-history contract

Migration 020 extends the internal reference model with import batches, source-file hashes, row-level provenance, customer aliases, product master records, order lines, existing-customer links and order source versions.

The deterministic source identity is based on source hash, sheet and normalized row key. Re-importing unchanged files reuses the batch and row identities. A changed file receives a new hash and source version; prior provenance is retained.

Order identity uses:

```text
source_system + external_order_id + source_version
```

Order status is explicit: `CONFIRMED`, `CANCELLED`, `REVIEW` or `UNKNOWN`. Supplier price, customer sales price and downstream retail price are separate fields. Currency is explicit or `UNKNOWN`.

The active historical reference has these actual production values:

```text
profile = DPV Mexico Historical Customer ICP
version = mx-historical-v2
reference_market = MX
application_markets = MX, AE
sample_size_customers = 5
sample_size_orders = 13
feature_coverage = 63.21%
win_loss_coverage = NONE
```

`mx-historical-v1` is retained as `RETIRED`. Version 2 corrects the derivation contract: null customer prices are excluded, price bands use only explicit currency, order quantity is not MOQ, and each feature contributes its actual coverage to the documented weighted total.

Actual version-2 coverage includes 68 of 70 latest-confirmed order lines with quantity (97.14%), 17 of 70 lines with explicit USD customer sales price (24.29%), 5 of 5 customers with repeat-order counts (100%), and no explicit MOQ sample (0%).

The company API returns both current match types:

```json
{
  "management_baseline": {},
  "mx_historical_reference": {}
}
```

The Opportunities endpoint exposes the two scores as separate fields and excludes only a public company with a `CONFIRMED` historical-customer link. Fuzzy or ambiguous name similarity remains review-only and does not silently remove a prospect.

## Phase 6 cooperation-feasibility boundary

Phase 6 does not change this Customer Match contract. The active `MANAGEMENT_BASELINE` and `HISTORICAL_CUSTOMER_ICP` results remain versioned, append-only Phase 5 outputs. Decision-maker enrichment does not rebuild a profile, activate a draft, overwrite a prior match, change a Phase 5 threshold or recalculate the deterministic DPV score.

`leadgen.cooperation_feasibility_results` may retain the latest applicable values as separate context fields:

```text
management_match
mexico_historical_match
dpv_score
```

Those values remain individually visible and are not averaged into `cooperation_feasibility_score`. The Phase 6 score measures supplier access and cooperation feasibility from its own evidence dimensions. `access_opportunity_matrix` combines a documented management target-fit band with the independent feasibility band; it is a transparent classification rather than a new Customer Match score or conversion probability.

The management opportunity ordering keeps the signals separate:

```text
1. Cooperation Feasibility band
2. Access Opportunity Matrix
3. Management Baseline Match
4. Mexico Historical Reference Match
5. DPV Score
6. Role relevance
7. Contact quality
8. Evidence recency
```

Historical CRM linkage remains a relationship and exclusion signal. A confirmed internal existing customer is not treated as a new-customer opportunity; an ambiguous similarity remains review-only. Phase 6 stores readiness such as `HISTORICAL_REVIEW` or `EXISTING_CUSTOMER` without exposing raw historical contact rows, private activity bodies or the original OKKI contact list.

The complete Phase 6 entity, evidence, LinkedIn, Hunter-budget and readiness contract is documented in `docs/PHASE6_DECISION_MAKER_DATA_CONTRACT.md`.
