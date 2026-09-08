# MC06 Domain Policy and Corroboration Result

Status: PASS — policy and isolated corroboration acceptance; live execution is not enabled.

Domain configuration: `config/search/domain-policy.v2.json` (2.0.0). Pure evaluation does not call providers or alter existing company identities.

- BLOCK: configured marketplace/content domains and explicit scrape/SEO-spam source classifications.
- DEPRIORITIZE: social/news/directory/unresolved hints remain available; this is not DROP.
- PRIORITIZE: previously verified official corporate domain and supported company page roles. Domain policy never independently certifies identity.

Corroboration extends existing `research_candidates` provenance with `research_search_hit_provenance`; no second company table. Distinct query/strategy/lane/provider projections remain separate from business scoring. First/last timestamps require supplied observations. Concurrent replay preserves one logical hit and monotonic observation history.

Policy/planner unit tests: 14 PASS, including exact/subdomain boundaries, retained third-party hints, official-domain priority, explicit spam classification, deterministic planning and serialization. MC06 isolated PostgreSQL: 11 PASS; simultaneous duplicate hits collapse, distinct query/strategy/lane/provider projections agree, cross-job candidates resolve to the existing verified company, conflicting immutable dimensions reject with 409. Business opportunity history remains unchanged.

Migration 060 adds no second company registry and performs no historical hit backfill. Unresolved social/directory references remain URL-level hints rather than merging every company on the same social host. New provenance foreign keys preserve evidence; future execution integration must use append/upsert rather than deleting referenced candidates.

No real search, Hunter, SMTP, LLM or production QA company/hit insertion is part of this work. Domain policy is available as a tested planning/data-contract module; wiring the new plan and hit recorder into live provider execution is deferred beyond MC06. Existing provider filters are not silently replaced during this phase.
