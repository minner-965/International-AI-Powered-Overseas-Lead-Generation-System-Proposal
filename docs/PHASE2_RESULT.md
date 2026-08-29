# DPV Phase 2 Result

Completion date: 2026-08-27

## Status

```text
PASS
```

Phase 2 established the ResearchJob control path only. No search provider, query generator, website crawler, qualification process, contact discovery, lead creation or scoring change was introduced.

## Architecture

Actual tested flow:

```text
Browser
  -> Express POST /api/research/jobs
  -> PostgreSQL creates QUEUED ResearchJob
  -> Express POSTs the persisted job to the n8n webhook
  -> n8n verifies the job through Express
  -> n8n PATCHes DISCOVERING through the authenticated internal API
  -> Phase 2 integration check waits 1.5 seconds
  -> n8n PATCHes COMPLETED through the authenticated internal API
  -> PostgreSQL persists timestamps and status
  -> Browser polls Express and displays the persisted lifecycle
```

The frontend never calls n8n directly.

## Files changed

```text
.env.example
.env.phase2                              (ignored local configuration)
compose.yaml
database/migrations/012_phase2_research_job_control.sql
services/demo-dashboard/src/server.js
services/demo-dashboard/public/index.html
services/demo-dashboard/public/app.js
services/demo-dashboard/public/bilingual.css
workflows/01-two-week-demo.json
tests/phase1_acceptance.mjs
tests/phase2_acceptance.mjs
docs/PHASE2_N8N_BEFORE.md
docs/PHASE2_NETWORK.md
docs/PHASE2_RESULT.md
```

## Environment variables

Variable names only:

```text
N8N_RESEARCH_WEBHOOK_URL
N8N_WEBHOOK_TIMEOUT_MS
APP_INTERNAL_BASE_URL
INTERNAL_API_TOKEN
```

The n8n container also enables environment-variable access for workflow expressions through its documented container configuration. The internal token is not returned to the browser.

## Backend behavior

`POST /api/research/jobs` now:

1. validates the request;
2. persists a `QUEUED` ResearchJob;
3. logs `RESEARCH_JOB_CREATED` and `N8N_DISPATCH_REQUESTED`;
4. dispatches the exact persisted job to n8n with a five-second timeout;
5. returns HTTP 202 with the job ID after webhook acceptance.

If n8n is unreachable, the job remains in PostgreSQL, changes to `FAILED`, receives one error count and stores a short non-secret `last_error` value.

The internal endpoint is:

```text
PATCH /api/research/jobs/:id/status
```

It accepts authenticated controlled transitions only:

```text
QUEUED -> DISCOVERING -> COMPLETED
QUEUED -> FAILED
DISCOVERING -> FAILED
```

It does not accept arbitrary database-field updates. A request without the internal token returned HTTP 401 during testing.

## n8n workflow

The existing workflow was updated in place:

```text
workflow id: dpvPhase1TwoWeekDemo
workflow name: DPV Phase 1 Research Job Control
active: true
node count: 9
```

Nodes:

```text
01 Research Job Webhook
02 Validate Payload
03 Verify Research Job
04 Set Job Discovering
05 Phase 2 Integration Check
06 Set Job Completed
07 Webhook Response
08 Set Job Failed
09 Stop Failed Execution
```

The integration-check node only waits 1.5 seconds so the persisted `DISCOVERING` state can be observed. It does not generate companies, contacts, evidence or counters.

## Test Research Job

The mandatory browser-click test used:

```text
job_id: 5b58b913-d68a-4dd1-8c4b-6c317d9cea85
country: United Arab Emirates
city: Dubai
product_category: Beauty & Personal Care
buyer_types: Importer, Wholesaler, Distributor
max_results: 5
status: COMPLETED
started_at: 2026-08-27 12:37:26.588536+08
completed_at: 2026-08-27 12:37:28.120040+08
```

Persisted counters:

```text
candidates_found: 0
websites_found: 0
companies_crawled: 0
companies_qualified: 0
companies_rejected: 0
tier_a_count: 0
tier_b_count: 0
tier_c_count: 0
error_count: 0
```

## Browser result

One click on `Start Research` produced this visible sequence:

```text
QUEUED
DISCOVERING
COMPLETED
```

The page displayed the same job ID throughout, all counters remained zero, and the existing 93 companies remained visible.

## n8n execution

```text
workflow_id: dpvPhase1TwoWeekDemo
execution_id: 6
mode: webhook
received_job_id: 5b58b913-d68a-4dd1-8c4b-6c317d9cea85
status: success
started: 2026-08-27 12:37:26.510+08
finished: 2026-08-27 12:37:28.137+08
```

The job ID is present in the stored n8n execution data; verification is not based only on the webhook HTTP response.

## Job ID consistency

```text
frontend:   5b58b913-d68a-4dd1-8c4b-6c317d9cea85
Express:    5b58b913-d68a-4dd1-8c4b-6c317d9cea85
PostgreSQL: 5b58b913-d68a-4dd1-8c4b-6c317d9cea85
n8n:        5b58b913-d68a-4dd1-8c4b-6c317d9cea85
```

Result: identical in all four locations.

## Protected counts

Final database result:

```text
companies:       93
sources:         97
contacts:        15
lead_reviews:    93
collection_runs: 12
research_jobs:    5
```

No company, source, contact, review or historical collection-run record was added or removed by Phase 2.

## Failure tests

### n8n unreachable

n8n was stopped temporarily without removing its container or volume. A new ResearchJob was created through Express.

```text
job_id: 828d802f-3cd0-4905-bebf-92e901cbac65
HTTP result: 502
persisted status: FAILED
error_count: 1
completed_at: set
safe last_error: set
```

n8n was restarted immediately and its health endpoint returned `ok`.

### Invalid job ID

The active n8n webhook was called with:

```text
11111111-1111-4111-8111-111111111111
```

Result:

```text
matching ResearchJob rows: 0
n8n execution id: 5
n8n execution status: error
companies created: 0
```

The workflow stopped after ResearchJob verification and did not update another job.

## Regression tests

```text
[PASS] dashboard loads
[PASS] 93 existing companies display
[PASS] existing lead list and score fields load
[PASS] existing approval endpoint retains send_status=disabled
[PASS] existing synchronous collection code remains available
[PASS] PostgreSQL healthy
[PASS] Express healthy
[PASS] n8n healthy and workflow active
[PASS] Phase 1 provenance invariants remain valid
```

The synchronous collection endpoint was not executed during Phase 2 because doing so would intentionally add a new `collection_runs` row and violate the protected count of 12.

## Audit logging

The Express application emits these structured events without credentials or stack traces:

```text
RESEARCH_JOB_CREATED
N8N_DISPATCH_REQUESTED
N8N_DISPATCH_SUCCEEDED
N8N_DISPATCH_FAILED
RESEARCH_JOB_STARTED
RESEARCH_JOB_COMPLETED
RESEARCH_JOB_FAILED
```

Structured audit-table storage remains deferred as required.

## Automated tests

```text
tests/phase1_acceptance.mjs: PASS
tests/phase2_acceptance.mjs: PASS
```

The Phase 2 test observed `QUEUED`, `DISCOVERING` and `COMPLETED`, retained 93 companies and kept all discovery counters at zero.

## Blockers

```text
None for Phase 2.
```

## Phase 3 readiness

```text
READY FOR DYNAMIC QUERY GENERATION: YES
```

Phase 2 is complete. Phase 3 has not started.

## Acceptance gate

```text
[PASS] Start Research exists on localhost:3000
[PASS] Browser creates ResearchJob through Express
[PASS] ResearchJob initially persists as QUEUED
[PASS] Express triggers the actual n8n webhook
[PASS] Existing dpvPhase1TwoWeekDemo workflow is used
[PASS] n8n workflow is active
[PASS] n8n receives the exact job_id
[PASS] n8n verifies ResearchJob exists
[PASS] n8n sets job to DISCOVERING
[PASS] frontend sees DISCOVERING through polling
[PASS] n8n sets job to COMPLETED
[PASS] frontend sees COMPLETED
[PASS] started_at persists
[PASS] completed_at persists
[PASS] all discovery counters remain zero
[PASS] no companies are generated
[PASS] no contacts are generated
[PASS] same job_id exists across frontend/backend/database/n8n
[PASS] n8n unreachable path tested
[PASS] invalid job_id path tested
[PASS] companies remain 93
[PASS] sources remain 97
[PASS] contacts remain 15
[PASS] lead_reviews remain 93
[PASS] collection_runs remain 12
[PASS] existing dashboard still works
[PASS] PHASE2_RESULT.md created
```
