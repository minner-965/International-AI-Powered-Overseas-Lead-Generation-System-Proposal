# Phase 6.1 V3 — Reuse-First Research

Date: 2026-08-31
Scope: Phase 6.1 only
Decision: reuse the installed local stack; add no runtime dependency and no external matching service.

## Baseline facts

- Application: Node.js/Express with PostgreSQL 17, Cheerio, GoRules ZEN, pg-boss, n8n and the existing Tabler CRM shell.
- `pg_trgm` 1.6 is installed in the running database.
- The preflight catalog contains 366 real `product_master` rows: 109 `WOMENSWEAR`, 18 `GENERAL_MERCHANDISE`, and 239 `UNKNOWN`.
- No `product_master.category` or MOQ value is populated. Phase 6.1 therefore preserves `UNKNOWN` unless explicit source text supports a controlled assignment.
- The fixed Phase 6 acceptance input is the seven companies recorded by `docs/PHASE6_RESULT.md`; Phase 6.1 evaluates both profiles for every company.
- V3 separates Category Procurement Match, Buyer Business Model, Product Opportunity, Supplier Access and Decision Maker/Contactability. No reused score is allowed to collapse these layers into a single probability.

## Decisions

| Capability | Candidate | License / maintenance | Deployment, privacy and cost fit | Integration boundary | Decision |
| --- | --- | --- | --- | --- | --- |
| Local fuzzy candidate recall | PostgreSQL `pg_trgm` | PostgreSQL license; maintained with PostgreSQL | Already installed, local, no per-call cost, no product data leaves PostgreSQL | Recall only. Trigram similarity is never classification or final scoring evidence. | Reuse |
| HTML parsing | Cheerio 1.2.0 | MIT; installed and maintained | Local parsing, no additional request or service cost | Parse already bounded markup from `WebsiteReachabilityChecker`; extract text/JSON-LD only and never render raw markup | Reuse |
| Deterministic scoring | GoRules ZEN 2.0.2 | MIT; installed Node binding | Local, versioned, reproducible, no external payload | Add `buyer-business-model/v1`, `category-procurement-match/v1` and `cooperation-feasibility/v3`; keep all prior rules immutable | Reuse |
| Domain normalization | `tldts` 7.4.11 and `DomainService` | MIT; installed | Local and already covers registrable-domain logic | Same-site and redirect boundary only | Reuse |
| Public search | Existing Tavily Basic adapter | Existing contracted API; usage-based operating cost | Payload stays on the public side: company name, public domain, market and controlled public taxonomy aliases only | Search results are discovery hints; snippets alone never create a verified product observation | Reuse |
| Bounded crawling | `WebsiteReachabilityChecker` | Repository code plus installed dependencies | Existing SSRF, robots, redirect, media-type, response-size and timeout controls | Extend same-site product/category/catalog link discovery; no second crawler | Reuse and extend |
| Queue and retry | pg-boss 12.28.0 | MIT; active project | Runs on the existing PostgreSQL service; no new infrastructure | Add five bounded company×profile queues with singleton keys and safe ID-only payloads | Reuse |
| Orchestration | n8n 2.36.7 | Existing self-hosted deployment terms | Already deployed; no product rows or prices enter workflow payloads | Add a credential-free category-procurement workflow that calls internal Express endpoints | Reuse |
| UI | Existing local Tabler CRM | MIT; already pinned | No new CDN, service or package | Extend the existing token, `.bi`, table, dialog, theme and density system | Reuse |
| PDF catalogs | Existing PDF tooling | Existing local tooling | A PDF may be large and page location is required for traceability | Disabled by default for V1 live run. Process only a public, bounded document when the normal checker records an acceptable type/size and the extractor can record page/structure location. | Evaluate per source; no new dependency |
| Browser verification | Codex in-app browser and current manual matrix | Existing workspace capability | No package or production footprint | Verify 1440, 1024, 768, 390, 375 and landscape after tests | Reuse; reject Playwright dependency for this phase |

## Primary-source findings

- PostgreSQL documents that `pg_trgm` supplies similarity operations plus GiST/GIN index classes. It is suitable for bounded local recall, but its similarity threshold is not a business match threshold: <https://www.postgresql.org/docs/17/pgtrgm.html>.
- Cheerio documents that it parses markup without browser rendering or JavaScript execution. Its security guidance also notes that parsing cost scales with input size and that parsed markup is not sanitized, reinforcing the existing response-size bound and text-only output: <https://cheerio.js.org/docs/intro/> and <https://cheerio.js.org/docs/advanced/security/>.
- GoRules ZEN is an open-source cross-language rules engine with a Node binding, suitable for the repository's existing versioned decision files: <https://github.com/gorules/zen>.
- pg-boss documents singleton queue policies, bounded retry and PostgreSQL-backed workers. Company×profile singleton keys fit Phase 6.1 replay behavior without a new broker: <https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md>.

## Rejected alternatives

- External LLM, vector database, hosted embedding, or product-matching API: rejected because the V3 buyer/category gates are deterministic, evidence-backed decisions and external matching would add privacy, cost and deployment boundaries.
- A second crawler/parser: rejected because it would duplicate tested SSRF, robots, redirect, timeout and response-size controls.
- Live FX conversion: rejected for V1 because price semantics, unit, commercial level and currency must already be comparable before scoring.
- Automatic classification of all 239 `UNKNOWN` rows: rejected because recall is not source evidence and cross-profile conflicts must remain `REVIEW`.

## Data boundary

Only these fields may reach a public search provider: bounded query text built from prospect company name, official public domain, market, language and controlled public taxonomy aliases, plus count/country metadata. `product_master` rows, internal product names/descriptions, prices, orders, customers, supplier facts, hashes and paths remain local. Queue/n8n/telemetry payloads contain IDs, versions and aggregate counters only.

## Final preflight decision

ADOPT the current stack with versioned taxonomy, a product-profile catalog snapshot and GoRules additions. ADD no runtime dependency. Buyer classification and category procurement facts remain traceable to public sources; Product Opportunity runs only after the category gate and every candidate remains foreign-keyed to a real `product_master` row.
