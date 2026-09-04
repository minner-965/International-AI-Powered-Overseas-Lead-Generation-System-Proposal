# Search Provider and Contact Check Configuration

Reviewed: 2026-08-27

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
