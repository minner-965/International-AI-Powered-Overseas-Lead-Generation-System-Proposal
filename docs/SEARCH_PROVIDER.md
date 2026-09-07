# Search Provider and Contact Check Configuration

Reviewed: 2026-09-07

## Phase 13 MC01–MC02 rollout

`SEARCH_DUAL_ROUTING_ENABLED=true` selects the centralized purpose router:

| Purpose | Provider |
|---|---|
| COMPANY_DISCOVERY | Brave |
| COMPANY_VERIFICATION / CATEGORY_EVIDENCE / CONTACT_DISCOVERY / OFFICIAL_CONTACT_VERIFICATION | Tavily Advanced, with the existing website crawler |
| SHADOW_BENCHMARK | Explicit Brave + Tavily Basic plan only; no automatic execution in MC02 |

The running environment remains in explicit legacy mode (`SEARCH_DUAL_ROUTING_ENABLED` absent/false): Tavily Basic remains available. Brave credentials were absent from the running service and `SEARCH_STORAGE_RIGHTS_CONFIRMED=false` at the MC00 check. This is not an automatic fallback: enabling dual mode without the requirements fails closed. No live Brave result or cost is claimed.

Use the dual-routing switch for the supported Brave rollout, not legacy `SEARCH_PROVIDER=brave` across all purposes. The old global-Brave evidence/contact path predates this release and bypasses the Tavily-specific ledger; it is not activated or covered by the new dual-route audit guarantee. The supported route keeps evidence/contact on audited Tavily Advanced.

Put configuration in the existing private `.env.phase2` backend environment file, used by the dashboard and workers. Set `BRAVE_SEARCH_API_KEY`, confirm the API plan permits result storage, set `SEARCH_STORAGE_RIGHTS_CONFIRMED=true`, then set `SEARCH_DUAL_ROUTING_ENABLED=true`. Keep `TAVILY_API_KEY` configured. Recreate the affected services after checking active jobs; changing a host file alone does not change running containers. Never commit credentials.

Brave uses its official web search endpoint, country/language and page offset 0–9. Unsupported search markets such as AE map to provider `ALL`; the original market and country-specific query remain intact. MX is supported directly. Retries are bounded to three attempts, honor short Retry-After values, and defer longer waits rather than blocking the worker. Authentication failures do not retry.

The existing `provider_usage_events` table stores Brave request fingerprints and per-attempt records. `result_payload.audit.attempt_count` counts provider-call intents, with finished HTTP/error outcomes retained; ledger row count is logical requests, not retry count. Brave billing units are unknown, not free: `billing_units_known=false`. Cached results support replay across process restarts. Unfinished or failed ledger entries require review rather than silent repeated billing.

Tavily Basic historical fingerprints remain unchanged; Advanced has a distinct identity. `include_usage=true` requests actual usage, and `credits_source` distinguishes provider usage from depth estimates and unspecified historical values. No new application quantity hard limits or database migration were added. Existing emergency/credential/storage/rate-limit boundaries remain.

Official references: [Brave web search](https://api-dashboard.search.brave.com/api-reference/web/search/get), [Tavily search parameters](https://docs.tavily.com/documentation/api-reference/endpoint/search).

The older single-provider configuration below describes the retained legacy mode, not the new dual route.

## Active search provider

```text
provider: Tavily
API: Tavily Search
endpoint: POST https://api.tavily.com/search
authentication: Authorization: Bearer <TAVILY_API_KEY>
search_depth: basic
topic: general
```

The browser calls only the local Express ResearchJob API. Express dispatches the existing n8n workflow, and only the backend `TavilySearchProvider` sends requests to Tavily.

Official references:

- <https://docs.tavily.com/documentation/api-reference/endpoint/search>
- <https://docs.tavily.com/documentation/api-credits>
- <https://docs.tavily.com/documentation/api-reference/endpoint/usage>

## Backend configuration

```text
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=...
TAVILY_SEARCH_ENDPOINT=https://api.tavily.com/search
TAVILY_SEARCH_DEPTH=basic
SEARCH_REQUEST_TIMEOUT_MS=15000

CONTACT_CHECK_MAX_PAGES_PER_CANDIDATE=4
CONTACT_FETCH_TIMEOUT_MS=10000
CONTACT_FETCH_DELAY_MS=500
CONTACT_MAX_RESPONSE_BYTES=2000000
CONTACT_USER_AGENT=DPVLeadResearchDemo/1.0
```

The local Tavily key is configured in the ignored `.env.phase2` file. The key is not returned to the browser, persisted in PostgreSQL, placed in workflow JSON, printed in logs or written into reports.

## Tavily request

Every request explicitly uses the low-cost settings:

```json
{
  "query": "<generated ResearchJob query>",
  "search_depth": "basic",
  "topic": "general",
  "max_results": "min(20, remaining job target)",
  "include_answer": false,
  "include_raw_content": false,
  "include_images": false,
  "auto_parameters": false,
  "country": "united arab emirates"
}
```

`auto_parameters` is disabled and `search_depth` is fixed to `basic`. Phase 3 does not call Tavily Extract, Crawl, Map or Research endpoints.

The job target is `research_jobs.max_results`. Discovery executes distinct market/category strategies until that many unique candidates are collected or the generated strategy set is exhausted. The provider's per-request maximum is respected, but there is no internal five-query or five-result research cap. Provider-reported `usage.credits` is summed into `research_jobs.search_credits_used`.

## Result mapping

| Internal field | Tavily response field |
|---|---|
| title | `results[].title` |
| original URL | `results[].url` |
| snippet | `results[].content` |
| provider score | `results[].score` |
| deterministic rank | returned order, starting at 1 |
| request trace | `request_id` |
| credit usage | `usage.credits` |

The provider score is search relevance only. It is not a lead score, qualification score or Tier.

## Candidate page checks

Search candidates stay in Phase 3 research tables. The checker:

1. selects at most five high-relevance company, directory or trade-show candidates;
2. opens the candidate URL with a 10-second timeout and a five-redirect limit;
3. accepts HTML/text pages only and stops after 2 MB;
4. checks `robots.txt` before requesting additional same-site pages;
5. uses at most four pages per candidate;
6. prefers actual same-site Contact/About links, with `/contact` and `/contact-us` as limited fallbacks;
7. does not bypass login, CAPTCHA, rate limits or access challenges.

One candidate failure is recorded and the remaining candidates continue. A ResearchJob completes when at least one Tavily search succeeds, even if a website check later fails.

## Contact evidence rules

Contacts are inserted only when the exact value is observed on a fetched public page.

```text
EMAIL
  visible text or mailto link
  syntax check
  DNS MX check
  no guessed patterns

PHONE
  tel link or clearly displayed number
  conservative normalization
  fax excluded

WHATSAPP
  explicit wa.me, api.whatsapp.com or whatsapp:// evidence only
  never inferred from an ordinary phone number

CONTACT_FORM
  contact/enquiry form detected
  form is never submitted
```

`DOMAIN_MX_VERIFIED` means the email domain is configured to receive mail. It does not prove that the individual mailbox exists or will reply.

Every contact retains:

```text
contact value and normalized value
contact type
exact source URL
source page title
verification method/status
email syntax and MX result when applicable
capture timestamp
```

Contacts are stored in `leadgen.research_candidate_contacts`. Fetch audits are stored in `leadgen.research_candidate_fetches`. Neither table writes to the existing company `contacts` table.

## APIs

Public:

```text
GET /api/research/jobs/:id/queries
GET /api/research/jobs/:id/candidates
GET /api/research/candidates/:candidateId/contacts
```

Internal token-protected:

```text
POST /api/internal/research/jobs/:id/generate-queries
POST /api/internal/research/jobs/:id/discover
POST /api/internal/research/jobs/:id/check-contacts
```

The browser never receives the internal token and never calls n8n or Tavily directly.

## Provider abstraction

```text
SearchProvider
  -> TavilySearchProvider       (active)
  -> DataForSeoSearchProvider   (inactive)
  -> BraveSearchProvider        (inactive)
```

Existing fixed candidate arrays remain legacy inputs for the original synchronous company-directory path. They do not feed the ResearchJob/Tavily discovery path.

## Failure behavior

Stable Tavily error codes include:

```text
MISSING_API_KEY
INVALID_SEARCH_DEPTH
AUTHENTICATION_FAILED
CREDIT_OR_RATE_LIMIT
TIMEOUT
NETWORK_ERROR
HTTP_ERROR
INVALID_RESPONSE
```

If all searches fail, the job becomes `FAILED`. Partial search failure is retained in per-query status and counters. Website timeout, HTTP error, robots block, response-size rejection or non-HTML content is retained per candidate without failing successful search discovery.
