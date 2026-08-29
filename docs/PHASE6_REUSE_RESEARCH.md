# Phase 6 Reuse-First Implementation Record

## Decision

Phase 6 extends the existing adapters and pinned application dependencies. It does not introduce a second crawler, queue, scoring framework, phone parser, email parser or observability stack.

```text
formal review date: 2026-08-29
review scope: current installed versions, official upstream documentation/repositories, deployment fit, privacy, operating cost, maintenance and integration boundary
decision: reuse existing pinned components; add only Phase 6 semantic adapters
```

| Capability | Reused component | Version / mode | Phase 6 use |
| --- | --- | --- | --- |
| Registrable domains | `tldts` | 7.4.11 | Company-domain normalization and same-site boundaries |
| Email syntax | `validator` | 13.15.35 | Local syntax gate before any optional provider call |
| Phone normalization | `libphonenumber-js` | 1.13.12 | AE/MX public phone and WhatsApp normalization |
| HTML extraction | `cheerio` | 1.2.0 | Bounded official-site role, route and Organization-data extraction |
| Business rules | `@gorules/zen-engine` | 2.0.2 | Versioned cooperation-feasibility decision table |
| Background work | `pg-boss` | 12.28.0 | Bounded enrichment queue, retry and dead-letter behavior |
| Tracing | OpenTelemetry API / SDK | 1.9.1 / 2.10.0 | Non-sensitive operation telemetry |
| Search | Existing Tavily provider adapter | BASIC search | Company-specific public discovery through n8n |
| Orchestration | Existing n8n/PostgreSQL stack | n8n 2.36.7 | Persisted ResearchJob orchestration |
| UI | Existing Tabler CRM system | core 1.4.0, icons 3.46.0 | Opportunity filters, table/card and reusable detail dialog |

Primary project references for the reused libraries are [Tavily's official JavaScript project](https://github.com/tavily-ai/tavily-js), [validator.js](https://github.com/validatorjs/validator.js), [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js), [Cheerio](https://github.com/cheeriojs/cheerio), [pg-boss](https://github.com/timgit/pg-boss), [OpenTelemetry JavaScript](https://github.com/open-telemetry/opentelemetry-js) and [GoRules ZEN](https://github.com/gorules/zen).

## Formal adoption review

| Component / boundary | License or service model | Deployment fit | Data privacy | Operating cost | Maintenance / release check | Integration boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `tldts` 7.4.11 | MIT | Local pinned Node dependency | Domain strings remain in the application | No per-call fee | Official upstream reviewed 2026-08-29; upgrades require domain-regression tests | Registrable-domain normalization only |
| `validator` 13.15.35 | MIT | Local pinned Node dependency | Email syntax is checked locally | No per-call fee | Official upstream reviewed 2026-08-29 | Syntax gate; no deliverability claim |
| `libphonenumber-js` 1.13.12 | MIT | Local pinned Node dependency | Public business numbers stay local | No per-call fee | Official upstream reviewed 2026-08-29 | Normalization and format only |
| Cheerio 1.2.0 | MIT | Local pinned Node dependency | Processes bounded public pages already fetched by the application | No per-call fee | Official upstream reviewed 2026-08-29 | HTML/Organization extraction; no browser automation |
| GoRules ZEN 2.0.2 | MIT | Local pinned rules engine | Decision facts remain local | No per-call fee | Official upstream reviewed 2026-08-29 | Versioned cooperation-feasibility rule only |
| pg-boss 12.28.0 | MIT | Uses the existing PostgreSQL deployment | Job payloads are bounded internal IDs/counters | Existing database infrastructure | Official upstream reviewed 2026-08-29 | Enrichment queue, retry and dead letter |
| OpenTelemetry 1.9.1 / 2.10.0 | Apache-2.0 | Existing local instrumentation | Attributes exclude SQL, contacts, secrets and raw source text | No Phase 6 provider fee | Official upstream reviewed 2026-08-29 | Bounded operation telemetry only |
| PostgreSQL `pg_trgm` | PostgreSQL License | Existing PostgreSQL extension | Company-name recall runs locally | Existing database infrastructure | Existing Phase 5 deployment rechecked 2026-08-29 | Review recall only; never sole merge authority |
| Tavily Search API | Hosted service terms; no Tavily SDK added | Existing provider adapter and n8n flow | Receives public company/search terms, not OKKI rows or private notes | Current official docs list Basic Search as 1 credit per request; final job used 35 Basic requests | Official docs and JavaScript project reviewed 2026-08-29 | Public discovery only; results still pass local verification |
| Tabler core/icons 1.4.0 / 3.46.0 | MIT | Existing locally built CRM assets | No business data leaves the browser through Tabler | No per-call fee | Official [Tabler license](https://tabler.io/license) reviewed 2026-08-29 | Presentation components and icons only |
| n8n 2.36.7 | Sustainable Use License / existing deployment terms | Existing self-hosted orchestrator | Internal job control stays within the project network; only configured provider calls leave it | Existing infrastructure | Official n8n documentation reviewed 2026-08-29 | Orchestration only; scoring remains in versioned application rules |
| Hunter API | Hosted service terms; no SDK added | Optional backend adapter | Only necessary public company/person/email identifiers may be sent | Plan input referenced a 50-credit monthly allowance; runtime does not assume it. Current per-run and billing caps are each 20 credits. Official API docs list Domain Search, Email Finder and Email Verifier costs separately | Official API documentation reviewed 2026-08-29 | Disabled fallback, test mode, budgeted lookup/verification only |
| LinkedIn reference boundary | LinkedIn service/API/crawling terms | No LinkedIn runtime client | Stores only a publicly discovered URL/title/snippet hint | 0 LinkedIn calls in Phase 6 | Official crawling and API terms reviewed 2026-08-29 | Search reference only; `content_fetched=false` |

Tavily's current official credit documentation is recorded at [Credits & Pricing](https://docs.tavily.com/documentation/api-credits). Pricing and account allowances can change, so the runtime enforces request bounds and records actual requests instead of embedding a monetary assumption.

## New thin adapters

Only Phase 6 semantics were added:

- `roleNormalizer.js` for bilingual buyer/procurement role mapping.
- `decisionMakerQueryGenerator.js` for MarketProfile-owned AE/MX role and supplier-access vocabulary.
- `procurementExtractor.js` for bounded public role and business-route extraction.
- `LinkedInDiscoveryAdapter.js` for `SEARCH_DISCOVERY_ONLY`, gated `OFFICIAL_API` and gated `PERMITTED_CRAWL` modes.
- `HunterProvider.js` for optional credit-bounded Domain Search, Email Finder and Email Verifier calls.
- `cooperationFeasibilityEngine.js` for the separate six-dimension evidence decision.
- `EnrichmentService.js` for selection, persistence and idempotent replay.

These adapters reuse shared domain, email, phone, HTML, crawler, provider and database services. No provider SDK was added because the existing backend `fetch` boundary already provides the required timeout, normalization, error and secret-handling behavior.

## Privacy, cost and maintenance review

### Hunter

- Optional and backend-only.
- Disabled operation is fully supported.
- Default per-run and billing-period caps are 20 credits, stored as 20,000 internal units.
- Public company/person identifiers are the only permitted request inputs.
- OKKI history, order data, customer prices, internal notes and shared-folder content are excluded.
- The final acceptance run made 0 calls and used 0 credits.
- Hunter's official API guide confirms the supported finding/verification endpoints and their separate credit rules: [Hunter API](https://help.hunter.io/en/articles/1970956-hunter-api).

### LinkedIn

- Default is `SEARCH_DISCOVERY_ONLY`.
- The adapter stores public search references as review hints and does not fetch LinkedIn content.
- `OFFICIAL_API` requires its own configured access and credentials.
- `PERMITTED_CRAWL` requires a current permission record and allowlist.
- LinkedIn's published crawling terms require express permission for automated crawling: [LinkedIn Crawling Terms](https://www.linkedin.com/legal/crawling-terms).

### GLEIF

GLEIF was not adopted in Phase 6 because the acceptance problem was buying/contact accessibility rather than LEI resolution. The provider remains a possible later legal-entity verification adapter and is not treated as a contact provider.

## Upgrade and rollback

All runtime packages remain pinned in `services/demo-dashboard/package.json`. Provider-specific behavior is isolated behind adapters, so Hunter can remain disabled and LinkedIn can remain discovery-only without changing the public API or stored opportunity schema. The Phase 6 migration is additive; `collection_runs`, Phase 5 scoring, Customer Match and Mexico Historical Match remain intact.
