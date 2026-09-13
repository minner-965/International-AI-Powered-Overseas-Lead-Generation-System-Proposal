# CL15 — Full-server GET HTTP acceptance

Date: 2026-09-13. Scope: direct GET identities declared in `server.js`, exercised through the actual mounted server with a disposable PostgreSQL database.

## Measured outcome

- 53 GET route identities; 114 actual HTTP requests.
- All 53 identities returned HTTP 200 for fixture records or current/list responses.
- 65 total HTTP 200 responses, including empty collections for missing parent records; these extra empty responses are not treated as positive populated-detail coverage.
- 0 HTTP 5xx in the final run.
- Fixtures include a company, score run, customer-match result, ICP profile, research job/query/candidate, enrichment and category-procurement jobs, reference import and text-key cleanup batch.
- Actual internal-token omission returned 401. Default local management behavior was used; this run is not evidence of hardened production authentication configuration.

## Found and fixed

Malformed UUID paths originally produced 12 PostgreSQL `22P02` HTTP 500 responses: research query/candidate/verification lists, candidate contact/verification details, score/history, customer match/history, ICP profile, reference import and lead detail. The coordinator added direct GET parameter validation for `id` and `candidateId`. Final malformed-ID cases return 400 without echoing the value. Text `batchId` remains unchanged and was exercised using `cl15-http-batch`.

## Completed supplementary positive fixtures

Five initially unpopulated cases were completed through database fixtures and rerun successfully, without external services:

- Research frozen search plan: created an immutable plan using the existing SearchPlanService, then read it through HTTP 200. Prior missing-scope 422 and missing-job 404 remain negative evidence.
- Candidate verification detail: inserted a linked verification fixture and read it through HTTP 200.
- CRM import summary: inserted the expected historical import batch fixture and read it through HTTP 200.
- CRM record detail: inserted an OKKI historical customer with source import-row lineage and typed source identity, then read it through HTTP 200.
- Linked company CRM record: inserted a confirmed fixture link to a separate company and read it through HTTP 200.

All direct GET identities now have a positive database/current-list response. The two duplicate research-job declarations are shadowed by the mounted research router; HTTP exercises mounted behavior, not each duplicate handler independently. List endpoints were not all tested with every filter or malformed query combination.

## Boundaries

The internal-only Docker network blocked external access. No real provider/email credentials or production database were attached. Fixtures and temporary containers were removed by the runtime harness. Raw webhooks are mounted by the Phase7 router, not direct GET declarations; their evidence is recorded separately in `CL15_ROUTE_COVERAGE.md`.

Runner: `scripts/cleanup-cl15-server-get-cases.mjs`, invoked with `CL15_SERVER_GET=true` through `scripts/cleanup-cl15-runtime.mjs`. Machine output: ignored `artifacts/cl15-server-get-result.json`. The route ledger lists each positive and negative response separately. This report does not claim every application route or every branch has complete positive/negative coverage.
