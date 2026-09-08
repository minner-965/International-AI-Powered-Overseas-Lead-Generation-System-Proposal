# Phase13 Search Strategy Rules — MC06

Authority: supplied MC06 execution plan, 2026-09-08. Planning only; no MC07 activation.

## Version bindings

- `config/search/query-strategies.v2.json`: strategy version 2.0.0.
- `config/search/search-lanes.v1.json`: lane version 1.0.0.
- `config/search/domain-policy.v2.json`: domain version 2.0.0.
- Store complete configuration and resolved scope with immutable planned queries. Change a strategy/config by creating a new version, never rewriting an experiment's saved plan. Version conflicts fail explicitly.

## Input and planning

Only frozen market/category/buyer/language inputs participate. At new batch creation, active aliases from the approved scope revision and any configured active parent are copied into scope metadata under the existing creation transaction. Historical snapshots are not enriched from today's registry. Missing parent or vocabulary produces a recorded skip, not invented approval or an English-language substitution.

Expand each scope's full language list. Configured language vocabulary is lexical wording only, not an expansion of approved company product scope. Exact category and supported approved aliases feed Precision; configured parent and broad commercial strategies feed Coverage. Only applicable selected buyer types participate. No LLM is involved.

Normalize Unicode, quote style and whitespace; remove only safe adjacent duplicate tokens. Preserve original and normalized display text. Case folding is for fingerprint identity only. Fingerprints include strategy version/id, lane, market, category, language, normalized query and provider purpose. Identical scoped fingerprints collapse to one plan entry; different business scopes stay distinct.

Lane weights start at 1/1 with work-conserving fair round robin. These are not API percentage limits. Empty lanes do not stop the other lane, and there is no MAX_STRATEGIES business stop.

## Domain and provenance

BLOCK rejects configured platforms or explicit spam classifications. DEPRIORITIZE retains social, news, directory and unresolved-domain hints. PRIORITIZE requires a supplied verified official domain; policy alone never verifies identity. Use exact host/subdomain boundaries, not arbitrary string containment. Missing/invalid URLs do not become official sites.

Discovery corroboration records candidate/query/strategy/lane/provider/rank/scope/language and observed first/last timestamps. Replay and concurrent duplicates merge without incrementing a fictional quality score. Aggregate distinct query/strategy/lane/provider counts against existing company identity or unresolved domain/hint. It does not update MC04 membership, opportunity band, Contact Readiness or Email Eligibility.

## Runtime boundary

MC06 does not connect its planner or provenance recorder to live search execution. Existing single-scope execution, outbox/queue/checkpoints/provider idempotency remain in place. New batch creation can freeze plans atomically with the existing batch transaction; QA creates only in an isolated database. Legacy job previews use stored job inputs, not current registry values. A preview is PLANNED, never EXECUTED.

Future MC07 integration must consume saved fingerprints/configuration and reuse current execution idempotency. Candidate provenance with RESTRICT references must be appended/upserted, not removed and recreated. Second-pass contact search is deferred to MC10.
