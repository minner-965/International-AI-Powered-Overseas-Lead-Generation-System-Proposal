# Phase 6 Decision-Maker and Cooperation-Feasibility Data Contract

## Purpose and boundary

Phase 6 enriches an already verified company prospect with traceable public buying-side evidence. It resolves named buyers, buying/procurement departments and published business contact routes, then evaluates whether cooperation appears practically accessible.

Phase 6 does not discover synthetic companies, alter Phase 5 scoring, rebuild an ICP profile, merge Customer Match with DPV Score, or send outreach. It does not submit a contact form, supplier registration, email, WhatsApp message or LinkedIn message.

The Phase 6 schema is introduced by `database/migrations/023_phase6_decision_maker_enrichment.sql`.

## ResearchJob contract

Phase 6 reuses `leadgen.research_jobs` with:

```text
job_type = DECISION_MAKER_ENRICHMENT
market_codes[]
product_profiles[]
requested_company_ids[]
max_results
```

Lifecycle states are persisted:

```text
QUEUED
DISCOVERING
RESOLVING
VERIFYING
PERSISTING
COMPLETE
PARTIAL
FAILED
```

The job stores bounded execution counters without embedding provider credentials or raw source documents:

```text
companies_attempted
decision_makers_found
verified_departments
contact_routes_found
enrichment_sources_found
sales_ready_count
strategic_long_shot_count
hunter_calls
hunter_credits_used_units
enrichment_timeouts
search_api_requests
search_successful_requests
search_failed_requests
error_count
last_error
```

`leadgen.enrichment_job_companies` records each selected company, market, product profiles, per-company lifecycle, query/source/contact counters, provider calls, timeouts and a bounded error message. `(research_job_id, company_id)` is unique.

`enrichment_sources_found` and the per-company `sources_found` field are execution counters for reachable pages/references observed during the run. They are not evidence-verification counts. Accepted decision-maker evidence is counted from `decision_maker_sources` after the evidence-quality gate.

Only `VERIFIED + ACTIVE` companies in the requested AE/MX and product scope are eligible. Confirmed internal existing customers, active suppressions and explicit exclusions are not new-customer enrichment targets.

## Search-query identity

`leadgen.research_search_queries.company_id` distinguishes company-specific Phase 6 queries from Phase 3 company-discovery queries.

```text
company discovery: unique (research_job_id, query_text) where company_id is null
Phase 6 enrichment: unique (research_job_id, company_id, query_text) where company_id is not null
```

This preserves query ownership when two companies generate similar text and keeps the earlier discovery contract intact.

## Decision-maker entity

`leadgen.decision_makers` stores either a named person or a department route; at least one is required.

```text
company_id
research_job_id nullable
person_name / person_name_normalized nullable
department_name / department_name_normalized nullable
raw_title
normalized_role
role_relevance
market_code
verification_status
lifecycle_status
evidence_strength
last_verified_at
source_count
created_at / updated_at
```

Allowed normalized roles are:

```text
BUYER
SENIOR_BUYER
HEAD_OF_BUYING
PURCHASING
PROCUREMENT
CATEGORY_MANAGEMENT
MERCHANDISING
SOURCING
IMPORT
COMMERCIAL
BUYING_DEPARTMENT
PROCUREMENT_DEPARTMENT
OTHER_RELEVANT
UNKNOWN
```

Role verification is explicit: `VERIFIED`, `REVIEW` or `REJECTED`. Lifecycle is independent: `ACTIVE`, `STALE`, `SUPERSEDED`, `DUPLICATE`, `INVALID` or `ARCHIVED`.

Canonical identity is unique within a company across normalized person, normalized department, normalized role and raw title. Repeated collection updates the canonical record and adds or refreshes evidence instead of creating an unbounded duplicate list.

`leadgen.decision_maker_product_relevance` stores separate `WOMENSWEAR` and `GENERAL_MERCHANDISE` relevance (`HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`) with a reason. Product relevance is not a replacement for Customer Match.

## Evidence sources

`leadgen.decision_maker_sources` is the traceability record:

```text
decision_maker_id
research_job_id nullable
source_url
source_type
source_authority
captured_at / published_at nullable
evidence_text
evidence_hash
evidence_status
is_primary
content_fetched
```

Allowed authorities are:

```text
OFFICIAL
OFFICIAL_DOCUMENT
APPROVED_PROVIDER
REGISTRY
INDUSTRY_SOURCE
SEARCH_DISCOVERY
OTHER_PUBLIC
```

A role or department is `VERIFIED` only when supported by strong, traceable evidence such as an official company page, official procurement/vendor page, official document or approved provider result with provenance. A search-result title or snippet alone remains `REVIEW / DISCOVERY_HINT`.

`(decision_maker_id, evidence_hash)` is unique. Source URLs and authority labels retain their real origin; a third-party page is not relabelled as an official company page.

## Public business contact routes

`leadgen.decision_maker_contacts` stores business-published routes associated with a decision-maker or department:

```text
BUSINESS_EMAIL
GENERIC_BUSINESS_EMAIL
DEPARTMENT_EMAIL
BUSINESS_PHONE
BUSINESS_WHATSAPP
CONTACT_FORM
SUPPLIER_PORTAL
VENDOR_REGISTRATION
PUBLIC_PROFILE_URL
OTHER_BUSINESS_ROUTE
```

Every route retains raw and normalized values, evidence origin, verification state/provider/score, last verification time and source URL. Evidence origin is one of:

```text
OFFICIAL_SITE_OBSERVED
PROVIDER_FOUND
PATTERN_CANDIDATE
OTHER_PUBLIC_OBSERVED
```

Contact verification states remain distinct:

```text
VALID
ACCEPT_ALL
UNKNOWN
INVALID
TEMPORARY_ERROR
NOT_VERIFIED
PUBLICLY_OBSERVED
FORMAT_VALID
BUSINESS_WHATSAPP_OBSERVED
```

`ACCEPT_ALL` is not promoted to `VALID`; DNS/MX or format validity does not prove mailbox reachability. Guessed personal emails are not marked verified. Only public business routes are in scope.

## LinkedIn contract

The Phase 6 default is:

```text
LINKEDIN_DISCOVERY_MODE = SEARCH_DISCOVERY_ONLY
```

Public search may discover a LinkedIn profile or company URL. `leadgen.enrichment_public_references` stores its URL, public search title/snippet hint, discovery provider, capture time and `REVIEW / DISCOVERY_HINT`, with:

```text
content_fetched = false
```

Phase 6 does not request LinkedIn member pages or search-result HTML, automate login, scrape authenticated content or use a LinkedIn reference by itself to verify a person, role or contact. `OFFICIAL_API` and `PERMITTED_CRAWL` are configuration gates for separately approved future capabilities; their presence does not enable LinkedIn HTML collection in Phase 6.

## Hunter provider and credit budget

Hunter is optional. Without an API key it operates as `DISABLED`; with an approved key it may run in `FREE_FIRST`. Phase 6 uses Hunter only after public evidence has narrowed the company and a verified named person is available.

Internal credit units use one thousand units per Hunter credit:

```text
1 credit = 1000 units
MAX_HUNTER_CREDITS_PER_RUN_UNITS = 20000
default per-run cap = 20 credits
MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS = 20000
default billing-period cap = 20 credits
```

The billing-period cap is separately configurable and is enforced together with the per-run cap. `leadgen.provider_credit_ledger` persists provider, UTC billing period, limit, reserved units and used units. Its database check requires:

```text
reserved_units + used_units <= credit_limit_units
```

`leadgen.provider_usage_events` records job/company, endpoint, billing period, deterministic request fingerprint, state, reserved/used units, before/after balances, provider request identifier, bounded error code and normalized result payload. `(provider, request_fingerprint)` is unique for idempotent replay. Reservations and settlements are transactional; stale reservations are released before a new reservation is assessed.

The API key is backend-only and is never stored in these tables, returned by the Express APIs or placed in telemetry.

## Cooperation feasibility

`leadgen.cooperation_feasibility_results` is an independent decision layer. It stores a deterministic 0–100 cooperation-feasibility score and does not rewrite or average the Phase 5 DPV Score, Management Baseline Match or Mexico Historical Reference Match.

The six evidence-bearing dimensions are:

| Dimension | Maximum |
|---|---:|
| External Supplier Openness | 25 |
| Supplier Onboarding Accessibility | 20 |
| Buying / Procurement Accessibility | 15 |
| Product-Category Buying Fit | 15 |
| Commercial / Operational Feasibility | 15 |
| Supplier Lock-In Barrier | 10 |
| Total | 100 |

Missing evidence remains explicit in `missing_evidence`; it is not rewritten as proof of a closed procurement route.

Feasibility bands are:

```text
HIGH: 80–100
MEDIUM: 60–79
LOW_MEDIUM: 40–59
LOW: 0–39
```

`access_opportunity_matrix` combines the separately supplied management target-fit band with the independently calculated access band:

```text
HIGH_FIT_HIGH_ACCESS
HIGH_FIT_MEDIUM_ACCESS
HIGH_FIT_LOW_ACCESS
MEDIUM_FIT_HIGH_ACCESS
MEDIUM_FIT_MEDIUM_ACCESS
LOW_PRIORITY
```

This matrix is a transparent classification, not a conversion probability and not a hidden combined score.

`opportunity_readiness` is a workflow state:

```text
SALES_READY
NEEDS_DECISION_MAKER
NEEDS_CONTACT_ROUTE
NEEDS_VERIFICATION
HISTORICAL_REVIEW
EXISTING_CUSTOMER
SUPPRESSED
REVIEW
STRATEGIC_LONG_SHOT
```

Existing-customer, suppression and historical-review relationships take precedence over sales readiness. `SALES_READY` requires an eligible verified active company, a verified named person or department, a usable public business route and traceable evidence. It authorizes review by the sales team; it does not send outreach.

`leadgen.cooperation_feasibility_sources` links each result to the decision-maker source and the specific supported dimension. `(research_job_id, company_id, product_profile)` makes a result idempotent within a job and preserves separate product-profile outcomes.

## API boundary

Phase 6 exposes management-facing summaries through Express:

```text
POST /api/enrichment/jobs
GET  /api/enrichment/jobs
GET  /api/enrichment/jobs/:id
GET  /api/enrichment/jobs/:id/results
GET  /api/leads/:id/decision-makers
GET  /api/leads/:id/contact-routes
GET  /api/companies/:id/cooperation-feasibility
GET  /api/opportunities
```

Internal run/status endpoints require the internal service token. Browser code calls Express; it does not call Hunter, LinkedIn or n8n directly.

## Privacy and output controls

Phase 6 does not expose an original OKKI contact list, shared-folder source rows, private activity bodies, provider API keys or full provider responses. Public APIs return only the normalized, source-linked business fields required for management review. Provider usage details remain in backend tables.

Documents, logs, exported spreadsheets and UI labels must not reproduce a raw internal contact list. Any future export must use the same normalized public-business-route contract, preserve verification labels and source URLs, and exclude internal-only historical notes and private contact fields.

## Relationship to Phase 5

Phase 5 remains authoritative for:

```text
DPV deterministic score and tier
Management Baseline Customer Match
Mexico Historical Reference Match
ICP profile versions and activation
historical-customer linkage and existing-customer exclusion
```

Phase 6 reads those outputs as separate context fields and adds decision-maker evidence, contact-route quality, cooperation feasibility, access matrix and readiness. Migration 023 does not change the Phase 5 score components, match thresholds, profile calculation or stored Phase 5 results.

## Phase 6.1 V3 independence contract

Phase 6.1 adds five separately persisted decision layers; none may substitute for another:

```text
Category Procurement Match
Buyer Business Model
Product Opportunity
Supplier Access
Decision Maker / Contactability
```

Product Match in the management UI means Category Procurement Match. A named buyer is not required for this category-level result, but remains independently required for `SALES_READY`. Product Opportunity candidates are optional recommendations backed by real `product_master.id` rows; zero candidates do not reverse a confirmed category match.

`supplier_access_score`, `supplier_access_band` and `product_access_matrix` are separate from the Category Procurement Match score and from the legacy `access_opportunity_matrix` and Customer Match `opportunity_matrix`. Phase 6.1 stores its category-match result reference on the V3 cooperation row without rewriting Phase 6 history.

The V3 browser API surface is:

```text
POST /api/category-procurement/jobs
GET  /api/category-procurement/jobs/:id
GET  /api/category-procurement/jobs/:id/results
GET  /api/companies/:id/category-procurement-matches
GET  /api/companies/:id/buyer-business-model
GET  /api/companies/:id/product-opportunities
GET  /api/opportunities
```

Search-provider payloads contain only public prospect identity and controlled market/category terms. Internal product rows, prices, customer/order records and private source paths stay inside PostgreSQL.
