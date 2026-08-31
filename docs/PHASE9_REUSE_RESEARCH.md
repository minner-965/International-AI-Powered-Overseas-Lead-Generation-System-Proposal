# Phase 9 Reuse-First Research

Date: 2026-08-31

Baseline: `phase8` peeled commit `6b3073c10d3f9503f478f424eccf3408e1b5df82`

Decision: reuse the existing stack; add no framework, UI library, search SDK, provider proxy, chart library, font service or animation package.

## Scope and selection criteria

Phase 9 needs a deterministic research workbench, a bounded evidence queue and controlled Buyer / Procurement enrichment. Reuse candidates were evaluated against:

- current project fit and existing production data;
- license and deployment boundary;
- privacy and secret handling;
- provider cost and budget controls;
- maintenance activity and current package release;
- integration effort and risk of duplicating business rules.

The browser remains a client of local Express APIs. PostgreSQL stays the business system of record. Search, crawl and Hunter calls remain server-side and bounded. No internal product price, customer price, supplier cost, margin, private path, raw provider payload or credential is projected to the browser or a public provider.

## Reviewed reusable modules

| Capability | Reviewed module / actual project version | License / service terms | Deployment, privacy and cost | Phase 9 decision and integration boundary |
| --- | --- | --- | --- | --- |
| Dashboard foundation | `@tabler/core` `1.4.0` | MIT; current npm release rechecked 2026-08-31 | Already bundled locally; no CDN, telemetry or external font request | Reuse existing layout and control foundation. Do not adopt a second design system. |
| Icons | `@tabler/icons-webfont` `3.46.0` | MIT; official release `3.46.0` rechecked 2026-08-31 | Bundled locally; no remote asset request | Reuse one icon family. Visible text remains the primary meaning; icon-only controls require an accessible name. |
| Persistent queues | `pg-boss` `12.28.0` | MIT; npm latest observed as `12.29.0` on 2026-08-31 | Self-hosted in current PostgreSQL; no third-party queue transfer; maintenance is active | Keep the pinned project version for Phase 9. Reuse bounded retry, singleton/idempotency and worker separation. A dependency upgrade is outside this phase. |
| Telemetry | `@opentelemetry/api` `1.9.1`, `@opentelemetry/sdk-trace-base` `2.10.0` | Apache-2.0; official JS release `2.10.0` rechecked 2026-08-31 | Current local exporter boundary; attributes remain bounded and exclude values, SQL, credentials and message content | Reuse current instrumentation for job/company opaque IDs, action enum, duration, result enum and unit counts. |
| Research orchestration | Existing n8n `2.36.7` workflows and Express internal endpoints | Existing self-hosted deployment terms | Internal orchestration network; credentials stay server-side | Preserve current behavior. Phase 9 does not activate workflow 04 and does not add an outbound workflow. |
| Discovery | Existing `TavilySearchProvider`, bounded query generator and local crawler | Hosted Tavily service terms; Basic Search is currently documented as one credit | Only public company identity, domain, market, language and controlled public taxonomy aliases leave the server | Reuse. Search results are discovery hints until an evidence page is fetched and persisted with URL and capture time. |
| Contact enrichment | Existing `HunterProvider` and `HunterCreditBudget` | Hosted Hunter service terms; official Domain Search, Email Finder and Email Verifier endpoints | Key stays in server environment. Every request reserves budget and persists a provider usage event. Current official pricing states Domain Search is charged by returned results, Email Finder when found and Email Verifier at half a credit | Reuse the existing thin adapter. `VALID` inside TTL is the only provider status that can satisfy the contact gate; `ACCEPT_ALL`, `UNKNOWN`, `NOT_VERIFIED` and temporary errors remain Evidence Required. |
| Evidence and business rules | `EnrichmentService`, `decisionMakerQueryGenerator`, `roleNormalizer`, `procurementExtractor`, `CooperationFeasibilityEngine`, `CategoryProcurementService`, `ProductTaxonomyService`, Phase 7/8 opportunity decision V2 | Project-owned deterministic code | Runs locally against versioned evidence and product catalog snapshots | Extend read models and orchestration around these services; do not copy their formulas into UI code or n8n. |
| Modal and table semantics | Native HTML `<dialog>`, `<form>`, `<table>`, URL/hash history | Web platform standards; no package | Browser-native top-layer/inert behavior; no data transfer or package maintenance | Reuse native semantics. Follow W3C APG focus containment, visible close, Escape and trigger-focus restoration. |
| UI implementation | Existing vanilla HTML/CSS/JavaScript Phase 8 modules | Project-owned | Fully local, no runtime framework or remote asset | Add dedicated Phase 9 workbench modules while preserving stable IDs, field names, payloads and navigation hooks. |

## Official sources rechecked

- Tabler repository and MIT license: <https://github.com/tabler/tabler>
- Tabler Icons releases and MIT license: <https://github.com/tabler/tabler-icons/releases>
- pg-boss repository and MIT license: <https://github.com/timgit/pg-boss>
- OpenTelemetry JavaScript releases: <https://github.com/open-telemetry/opentelemetry-js/releases>
- Hunter API reference: <https://hunter.io/api-documentation/>
- Tavily Search API reference: <https://docs.tavily.com/documentation/api-reference/endpoint/search>
- MDN native dialog: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog>
- W3C modal dialog pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>

## UI/UX Pro Max review

The required local design-system search used approximately `variance 4`, `motion 2`, `density 8`. Targeted searches covered task dashboard, form feedback, mobile workbench, heading hierarchy and the detected vanilla HTML/CSS/JavaScript stack.

Applied verified guidance:

- sequential heading levels and a consistent type scale;
- visible form labels;
- explicit multi-step progress;
- submit states from validating through loading, success and recoverable error;
- mobile-first composition and 44 × 44px touch targets;
- no hover-only primary action;
- stable loading geometry;
- accessible names for icon-only controls;
- native dialog focus containment, Escape, visible close and trigger restoration.

The task-dashboard search returned no verified dataset match after the required narrower retry. Task priority therefore follows the Phase 9 deterministic business rules, not an unverified UI-search result.

Explicitly not adopted:

- landing-page hero, conversion sections, security-logo carousel or marketing CTA;
- generated navy/blue palette, because Phase 8 semantic tokens remain authoritative;
- Calistoga, Google Fonts or any external font request;
- GSAP, scroll reveal or decorative motion;
- gradients, glow, glassmorphism, fake gauges, fake KPI trends, fake avatars or illustration walls;
- a second table library, frontend framework or icon family.

## Package and schema decision

No new package is required. The project already contains the required API, queue, evidence, contact, scoring, telemetry, dialog, table and responsive primitives.

The completed Gate 1 audit proved that migration 029 is required. Existing tables preserve current business facts, but they do not preserve four non-derivable audit facts: the immutable request/budget identity of a controlled run; the exact company × single-profile cohort; deterministic per-stage outcomes and stop reasons; and an exact contact-to-settled-verification-event chain. Migration `029_phase9_real_opportunity_research_audit.sql` therefore adds only those fields and append-only entities. It does not rewrite existing companies, sources, contacts, reviews, products, jobs or opportunity snapshots, and it continues to reuse the existing provider credit ledger and canonical result tables.

The applied migration checksum is `052cdf4bdbfe1a33ed024e228f1a5b8b78b2bab03b36356fec63949e41e59bdf`. First apply and checksum replay both passed. Existing business row counts remained unchanged; the three new audit tables began at their truthful zero state.

## Phase boundary

This research authorizes reuse and bounded Phase 9 enrichment only. Management approval is not automated. Provider sends and prospect messages remain zero. Phase 10 live contact is not started.
