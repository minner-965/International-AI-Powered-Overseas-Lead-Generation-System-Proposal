# DPV Phase 1 — Current State Assessment

Assessment date: 2026-08-27
Scope: Phase 0 inspection only. No business workflow or application behavior was changed during this assessment.

## 1. Executive summary

The current repository contains a working local prototype with three Docker services:

```text
Browser
  -> Express static frontend and JSON API (:3000)
       -> PostgreSQL leadgen schema
       -> public company websites
       -> Emirates Online directory
       -> OpenStreetMap / Overpass

n8n (:5678)
  -> POST /api/live/collect
  -> GET /api/metrics
  -> human-review summary
```

The dashboard, API, PostgreSQL database and n8n instance are running. The current database contains 93 company records and 97 source records. All 93 companies have at least one stored source URL under the current metric definition.

This is not yet the job-based pipeline described in the two-week execution plan. The dashboard calls a synchronous Express collection endpoint directly. The imported n8n workflow has four nodes, is inactive, and does not implement search-query generation, search-provider discovery, website resolution, multi-page crawling, structured evidence extraction, job progress, qualification orchestration or audit logging.

## 2. Current architecture

### Runtime services

| Service | Implementation | Runtime status | Role |
|---|---|---|---|
| Dashboard/API | Node.js 24, Express 5.2.1, vanilla HTML/CSS/JavaScript | Running and healthy on `127.0.0.1:3000` | Serves the UI, runs collectors, scores records and reads/writes PostgreSQL |
| Database | PostgreSQL 17 | Running and healthy | Stores both n8n tables and the separate `leadgen` schema |
| Workflow engine | n8n 2.36.7 | Running; health endpoint returns 200 | Contains one imported four-node manual workflow |

Docker Compose uses named volumes `postgres_data` and `n8n_data`, so stopping or recreating containers preserves local data unless volumes are explicitly removed.

### Frontend-to-backend communication

The frontend is served by the same Express application as the API and calls relative `/api/*` endpoints with browser `fetch`. There is no separate frontend framework, build step or client-side router.

The current update button calls `POST /api/live/collect` directly and waits for the entire operation to finish. It does not create a research job and does not trigger n8n.

### External collection path

`services/demo-dashboard/src/server.js` currently combines four collectors:

1. A fixed list of 11 company domains whose homepages are fetched during collection.
2. Six fixed public business-profile records whose names, descriptions, company sizes and LinkedIn URLs are stored in source code.
3. The Emirates Online clothing-wholesalers category page.
4. OpenStreetMap data obtained from public Overpass endpoints.

The Express process performs collection, normalization, deduplication, evidence-text selection, contact extraction, MX-domain checks, deterministic scoring and database upserts in one synchronous function.

## 3. Existing frontend functionality

Available now:

- Bilingual Chinese/English management page.
- Current target fixed to the UAE/Dubai women’s-apparel market.
- Cumulative company metrics.
- Tier and company-size filters.
- Lead list sorted by score and company name.
- A/B/C tier plus numeric score display.
- Company detail panel with company size, qualification indicators, public business contact fields, social-profile links, eight score components and clickable source URLs.
- Manual approval and rejection actions.
- Button to update the company directory.

Not present:

- Market, city, product-category, buyer-type or maximum-result input form.
- Research-job creation and job identifier.
- Asynchronous progress polling or real stage counters.
- Candidate, qualified, review and rejected funnel views matching the plan.
- Dedicated source-traceability page.
- Correct/Incorrect/Unsure validation labels, reviewer notes and precision calculation.
- Acceptance dashboard at `/demo-validation`.

## 4. Existing backend functionality

### API endpoints

| Method | Route | Current behavior |
|---|---|---|
| GET | `/api/health` | Confirms PostgreSQL connectivity |
| POST | `/api/live/collect` | Runs all collectors synchronously; accepts only a clamped `limit` from 10 to 100 |
| GET | `/api/metrics` | Returns current aggregate counts and the most recent collection summary |
| GET | `/api/leads` | Returns stored companies; filters by tier, approval and size |
| GET | `/api/export/leads` | Returns the complete current lead dataset as JSON |
| GET | `/api/leads/:id` | Returns one company, review, contact and source collection |
| PATCH | `/api/leads/:id/approval` | Updates approval status while keeping sending disabled |

The planned routes `POST /api/research/jobs` and `GET /api/research/jobs/{job_id}` do not exist.

### Implemented collection behavior

- Public pages are fetched with a 15-second timeout.
- Collector failures are recorded in a collection-run error array and the remaining collectors continue.
- Companies are deduplicated within a run by website hostname or a normalized company name.
- Existing companies are updated through an upsert; previous companies are not cleared.
- Source URLs, capture times and a raw JSON payload containing a short evidence value are retained.
- Emails and UAE phone numbers are extracted from available page text.
- Email domains are checked for DNS MX records; no mailbox-level test is performed.
- Scores are calculated deterministically with eight components totaling 100 points.
- Sending remains disabled.

### Important limitations

- Discovery is not driven by generated search queries or a replaceable `SearchProvider` interface.
- The fixed company-domain list means some candidate discovery is hard-coded.
- The six social-profile records use hard-coded descriptions and are not fetched from LinkedIn at collection time.
- Official website collection fetches the homepage only; it does not resolve and crawl up to eight relevant pages.
- There is no robots.txt evaluation or explicit per-domain rate limiter.
- Evidence is not a first-class entity with evidence type, exact excerpt, confidence and stable evidence ID.
- Qualification is keyword/rule based; no structured evidence-grounded AI qualification is implemented.
- The whole collection request is synchronous and has no persisted stage status.

## 5. Existing n8n workflow

Running database record:

- ID: `dpvPhase1TwoWeekDemo`
- Name: `DPV Phase 1 - Live Public Data Demo`
- Active: no
- Nodes: 4
- Historical executions: 3 successful, 0 failed

### Node map

| Order | Node | Type | Function |
|---:|---|---|---|
| 1 | Manual Trigger | Manual Trigger | Starts a manual execution |
| 2 | Collect Cumulative Real Data | HTTP Request | Calls `POST http://demo-dashboard:3000/api/live/collect` with `{"limit":50}` |
| 3 | Load Acceptance Metrics | HTTP Request | Calls `GET http://demo-dashboard:3000/api/metrics` |
| 4 | Human Review Handoff | Code | Produces a short summary for human review |

The workflow does not currently receive market/category parameters from the frontend, create a job, branch by stage, persist progress, or implement the 14 planned business-process nodes. The frontend does not call this workflow.

## 6. Existing database

### `leadgen` tables

| Table | Current role | Current rows |
|---|---|---:|
| `companies` | Company/lead master | 93 |
| `sources` | Source URL and coarse evidence payload | 97 |
| `contacts` | Public business contact data and domain-level email status | 15 |
| `lead_reviews` | Qualification, component scores, tier and approval | 93 |
| `collection_runs` | Summary of each completed synchronous collection | 12 |

### Current dataset profile

| Measure | Current value |
|---|---:|
| Companies | 93 |
| Companies with at least one stored source | 93 (100%) |
| Companies with a website URL | 19 |
| Companies without a website URL | 74 |
| Companies with 2+ stored sources | 4 |
| Companies with social-profile data | 11 |
| Contacts with business email | 10 |
| Contacts with business phone | 10 |
| Named decision makers | 0 |
| Qualified | 1 |
| Needs review | 21 |
| Rejected | 71 |
| Tier A / B / C | 3 / 12 / 78 |
| Duplicate normalized-domain rows | 0 |
| Send-enabled records | 0 |

Source distribution:

- OpenStreetMap: 72 source records, including corroborating listings.
- Emirates Online: 10 source records, including one corroborating listing.
- Company websites: 9 source records.
- LinkedIn public company profiles: 6 source records.

The current `source_traceability_pct` metric means “has at least one source row.” It does not mean that the source is an official website, that the factual conclusion is supported by an exact excerpt, or that a second independent source exists.

### Gap against the planned entity model

- No `ResearchJob` entity.
- No `research_job_id` on companies/leads.
- No planned job statuses or progress counters.
- No first-class `Evidence` table.
- No separate `LeadScore` entity with evidence IDs per component.
- `collection_runs` stores only a completed summary and cannot represent queued/running/failed job stages.
- `data_origin` currently supports `manual` and `public_web`, not the planned `live`, `seed`, `manual`, `imported` values.
- `normalized_domain` is an internal identity such as `live:<hostname-or-name>`, not a clean root-domain field.

## 7. Existing static, mock and live-data behavior

### Database findings

- No `synthetic` records exist in the running database.
- All 93 current companies are labeled `public_web`.
- No `.example` domains were observed by the existing acceptance test.
- There is no SQL seed insert in the current migrations.

### Source-code findings

The current implementation mixes live fetching with fixed candidate definitions:

- `verifiedCompanySources` is a hard-coded list of 11 company names and websites. The pages are fetched during each run, but discovery is not live search.
- `publicBusinessProfiles` contains six hard-coded company descriptions, categories, size bands and LinkedIn URLs. Those profile pages are not fetched or re-extracted during collection.
- Emirates Online and OpenStreetMap/Overpass are queried during each collection.

Therefore, the current database is free of the former synthetic dataset, but `data_origin='public_web'` does not distinguish dynamically discovered records from fixed public-source candidates. This must be corrected in Phase 1 before management interprets every row as equivalent live research output.

### Sample source availability check

Eight sampled URLs across company websites, Emirates Online, LinkedIn and OpenStreetMap returned HTTP 200 during this assessment. This confirms that the stored links are currently openable, but Phase 0 did not validate every stored factual statement against the page content.

## 8. Environment and integrations

Configured locally:

- Docker runtime and service ports.
- n8n encryption key.
- PostgreSQL connection.

Not configured:

- LLM provider key/model.
- Search API key.
- Contact-enrichment provider key.
- Corporate SMTP account.
- CRM endpoint and key.

The current collectors do not require these deferred credentials.

## 9. Existing tests and observed results

### Read-only runtime checks performed in Phase 0

- `docker compose ps`: PostgreSQL and dashboard healthy; n8n running.
- `GET /api/health`: 200, database status `ok`.
- `GET /api/metrics`: 200, 93 companies and 100.0% current source-row coverage.
- `GET /api/leads`: 200, 93 rows.
- n8n `/healthz`: 200, status `ok`.
- Running n8n database: 3 successful executions for the imported DPV workflow.
- Eight sampled stored source URLs: all returned HTTP 200.

### Existing automated acceptance test

`tests/live_acceptance.mjs` performs two new collection runs and asserts:

- at least ten records;
- multiple providers;
- source-row coverage of 100%;
- cumulative preservation of existing records;
- no example domains;
- at least one website;
- source URL and capture time on the sampled detail record;
- sending disabled;
- no legacy `not_checked` email status.

It does not test ResearchJob behavior, frontend-to-n8n triggering, search-query generation, official-site resolution rate, exact evidence-to-page matching, qualification precision, second-source coverage, named decision makers, async progress, or failure recovery by job stage. It also changes the database because it runs collection twice.

## 10. What must be modified after Phase 0

Follow the execution-plan order rather than extending the interface first:

1. Add a real ResearchJob model and origin tracking that distinguishes dynamic live output from fixed/manual/imported records.
2. Add `research_job_id` linkage and job lifecycle/status counters.
3. Create asynchronous research-job APIs and connect the frontend to n8n.
4. Make n8n the visible workflow orchestrator rather than a wrapper around one synchronous backend call.
5. Implement generated queries and a replaceable search provider.
6. Resolve official company websites and store a clean root domain.
7. Add bounded multi-page crawling, content cleaning and structured evidence records.
8. Add exact evidence excerpts, evidence types, confidence and IDs used by qualification and scoring.
9. Improve contact extraction and keep domain checks clearly separate from mailbox verification.
10. Expand deduplication beyond the current hostname/name key while preserving attached evidence.
11. Add structured qualification, evidence-linked deterministic scoring, manual validation and precision metrics.
12. Add job audit logs, failure paths and the acceptance page.

## 11. What can be retained

- Docker Compose layout and persistent local volumes.
- Express service as the current API host, if kept modular during later phases.
- PostgreSQL `leadgen` schema as the migration base.
- Existing company, source, contact and review data after origin reclassification.
- Cumulative upsert behavior and the rule that previous records are not cleared.
- Current deterministic eight-component score as a starting implementation.
- Human approval control and disabled sending.
- Bilingual page structure, tier/score display, filters and detail panel.
- Source URL/capture-time retention.
- Collector error isolation concept.
- Existing n8n container and workflow ID.

## 12. Risks and blockers

### High priority

1. **Origin ambiguity:** fixed candidate records and dynamically fetched records share `public_web`.
2. **No job model:** the system cannot prove which records came from a specific user-initiated research run.
3. **n8n is not connected to the frontend:** the required frontend → backend → n8n flow is absent.
4. **Synchronous processing:** one request performs the whole collection and can time out without persisted progress.
5. **Evidence model is too coarse:** one raw payload is not equivalent to typed, exact, independently reviewable evidence.
6. **Official website coverage is low:** 19 of 93 records have a website URL.
7. **Second-source coverage is low:** only 4 of 93 companies have two or more stored sources.

### Data-quality risks

1. Most current records are OpenStreetMap retail/shop entries, not confirmed importers, wholesalers or distributors.
2. Six social-profile descriptions are fixed in source code and can become stale.
3. Three Tier A records exist while only one company has `qualification_status='qualified'`; tier and qualification gates are not fully aligned.
4. There are no named decision makers, so the decision-maker component is always zero.
5. MX/domain checks do not prove mailbox deliverability or ownership by the intended company.
6. Keyword scoring can award business-fit points without evidence IDs tied to the exact score component.

### Operational risks

1. Public HTML and Overpass endpoints can change or rate-limit requests.
2. No configured search API currently exists for Phase 4.
3. No LLM or enrichment credentials exist for later qualification/contact stages.
4. `docs/PROJECT_CONTEXT.md` contains an older “not yet implemented” status and should be reconciled later; it is not reliable as a current-state record.
5. The working tree already contains many pre-existing uncommitted/untracked project files. Later implementation must preserve those changes and avoid broad cleanup operations.

## 13. Phase 0 checkpoint

```text
Frontend framework: Vanilla HTML/CSS/JavaScript served by Express
Backend framework: Node.js with Express 5.2.1
Database: PostgreSQL 17; leadgen schema plus n8n public-schema tables
n8n connection: Running, one inactive four-node workflow, three successful historical executions
Current workflow: Manual trigger -> synchronous collection API -> metrics API -> human-review summary
Mock/static data discovered: no synthetic DB rows; 11 fixed company-domain candidates and 6 fixed social-profile records in server source
Working live functionality: public endpoint collection, cumulative upsert, source links/timestamps, contact extraction, MX-domain checks, deterministic scoring, dashboard review
Missing functionality: ResearchJob, frontend-to-n8n trigger, async status, search provider, official-site resolver, multi-page crawler, structured evidence, AI qualification, audit log and acceptance dashboard
```

Phase 0 is complete. No Phase 1 implementation has been started.
