# DPV Phase 10 WP-A04 Category-Driven Automation Convergence Result

## Result

`WP-A04 = PASS`

Validated on 2026-09-04 after completing WP-A04R0 through WP-A04R5. This result covers the category-driven pre-email automation boundary only. Gmail, outbound sending, inbound synchronization and CRM mail effects remained disabled and at zero.

## Business contract

- Uploaded product data defines the target category used to discover and filter companies.
- `product_profile` is optional metadata and is not a hard gate.
- Exact SKU, MOQ, price and detailed product specifications are not discovery or opportunity hard gates.
- A verified category-matched company proceeds to named-buyer and official company-route research.
- A verified official company email, telephone, public WhatsApp, contact form or supplier portal may support opportunity readiness without being represented as a named Buyer.
- Email approval and sending remain independent downstream gates.

## Ten stale tasks

All ten tasks were classified before mutation as `STALE_RECOVERABLE_CONTINUATION`. Each had a unique S05 checkpoint, an expired lease, no active canonical continuation, no live queue owner and no ambiguous cross-task lineage. Existing business outputs were retained. One or more existing Provider-ledger records were also retained where present.

| Task ID | Company | R2 action | Final projection after R5 |
|---|---|---|---|
| `2c2f98ef-8bd2-4193-ad99-e170e331b59d` | Rizqé | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `37312db4-6b76-4281-880b-f8fe525a4563` | Bismi Group | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `425ae8e3-85eb-4d04-baf7-33c657fb5081` | Home Design México® | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `63a2ba1a-0247-41c8-b3e4-fe0e1b9f0198` | Bismi Group | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `735e5dd2-83bd-4d31-850e-a39d4322fce4` | Apparel Group | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `8341f46a-db91-461f-b8ce-fecb8eb23c40` | Right Face General Trading LLC | Preserve Provider and business lineage; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `8393d372-33a9-482d-a598-1cace3a9f9a6` | Apparel Group | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `b9505cb9-32fa-4f4a-90d5-c4ccbc0c85a1` | ELK Fashion Dubai | Preserve Provider and business lineage; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `e366af4c-0e83-4c3d-923a-b7aa45630ecd` | Home Design México® | Append attributed manual-retry audit; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |
| `fd7cbb15-985d-4be5-8859-68e6b725d98d` | ELK Fashion Dubai | Preserve Provider and business lineage; resume unique S05 checkpoint | `EVIDENCE_EXHAUSTED`, strategy 3 settled |

R2 post-apply evidence:

- ambiguous tasks: 0
- stale `RUNNING` tasks: 0
- attributed `WP-A04R2` schedule audits: 10 for 10 tasks
- strategy-3 ResearchJobs: 10 tasks / 10 unique jobs / 0 active jobs
- S05 stage ledger: 60 `STARTED` / 60 `SETTLED`, 10 distinct query fingerprints
- duplicate Provider request IDs: 0
- deleted members of the ten-task set: 0

## PRODUCT_SCOPE_REQUIRED retirement

ResearchJob `2c9ce1a5-c379-4c5c-a7a0-22afb30aa3d1` contains the explicit target category `Beauty & Personal Care` and a null `product_profile`. It completed through its single transactional dispatch outbox without another `PRODUCT_SCOPE_REQUIRED` result.

- ResearchJob: `COMPLETED`
- dispatch outbox: one row, `COMPLETED`
- active pg-boss executions: 0
- successful canonical dispatches: 1
- active continuation: 0
- current `PRODUCT_SCOPE_REQUIRED` error: 0
- Provider events retained: 7
- company outputs retained: 2

The target-category resolver now accepts explicit target categories, approved category scopes, compatible opportunity context and legacy profiles in a frozen order. Empty category input raises `TARGET_CATEGORY_REQUIRED` as `NON_RETRYABLE_INPUT_ERROR`. The direct executor terminalizes that outbox as `FAILED`, and a repeated queue message returns an idempotent terminal replay instead of scheduling another retry.

Target-category flow verification contains 16 named assertions with 16 passes and zero skips. The wider R2–R4 focused suite contains 42 passes and zero skips.

## Orphan Job

ResearchJob `9ad717d3-468f-4e4d-a978-9096391f26a8` had no Provider use, checkpoint, business output, live queue, continuation or required downstream reference. It had already converged through the strict empty-job purge before R4.

- current ResearchJob rows: 0
- current task rows: 0
- current dispatch outbox rows: 0
- current continuation rows: 0
- current live queue rows: 0
- immutable purge audit rows: 1
- audit classification: `EMPTY_NEVER_STARTED`
- audit reason: `STRICT_EMPTY_JOB_POLICY`
- deleted auto-evidence task rows: 0
- deleted business-result rows: 0

Two consecutive dry-run replays returned zero candidates and made no further mutation.

## Migration result

- repository latest migration: `048_phase10_category_driven_context.sql`
- migrations 001–047: unchanged from their Git sources
- migration 048: additive and follows 047
- main database verification: pass
- consecutive apply/replay runs: `SKIPPED_ALREADY_APPLIED`
- ledger/file checksum for 025–048: pass
- migrations 001–023 remain the original initialization history and were not rewritten

## Database and queue acceptance

All required counts were zero after the live scheduler runs:

| Assertion | Count |
|---|---:|
| unexplained stale `RUNNING` task | 0 |
| orphan `QUEUED/DISPATCHED` Job without outbox | 0 |
| retrying `PRODUCT_SCOPE_REQUIRED` outbox | 0 |
| expired lease without recovery | 0 |
| duplicate active continuation | 0 |
| duplicate pending dispatch outbox | 0 |
| ambiguous current lineage | 0 |

Provider ledger source units and `research_job_provider_usage_summary` projected units were both 286; projection drift was 0.

## Business assertions

- null `product_profile` dispatch: pass
- target-category context resolution: pass
- category-matched company continues to contact research: pass
- verified official company route can support opportunity readiness: pass
- exact SKU is absent from hard opportunity gates: pass
- official company route is not labeled as a named Buyer: pass

## Real scheduler acceptance

The active n8n workflow `dpvPhase10AutoEvidenceReconciliation` was exercised through two consecutive real Schedule Trigger runs. Its interval was temporarily reduced from 30 minutes to 1 minute for the bounded acceptance window and restored to 30 minutes afterward in both the current and published workflow records.

| n8n execution | Workflow status | Reconciliation | Selected | Errors | End heartbeat |
|---|---|---|---:|---:|---|
| 104 | `success` | `COMPLETED` | 10 | 0 | `HEALTHY` |
| 105 | `success` | `COMPLETED` | 10 | 0 | `HEALTHY` |

A separate real reconciliation call with a bounded nonexistent-company target returned `COMPLETED`, `selected=0`, `scanned=0`, `scheduled=0`, and `errors=0`, proving the zero-repair path is successful.

## Zero-email proof

The following values were zero before and after R5, with a delta of zero:

- outreach drafts
- outreach approvals
- outbound messages
- outbound message attempts
- email webhook inbox
- inbound messages
- CRM sync outbox
- Gmail ambiguous-send events

Runtime state after acceptance:

- automatic evidence: enabled
- new ResearchJob maintenance freeze: released
- n8n reconciliation workflow: active, 30-minute interval
- outbound provider: `NONE`
- Gmail API: disabled
- Gmail inbound sync: disabled
- outreach sending: disabled

## Final decision

`PRE_EMAIL_AUTOMATION_ACCEPTANCE: PASS`

`WP-A04 = PASS`

STOP after WP-A04R5. WP-A05 was not started.

## A15 follow-up

WP-A15 later found and repaired four historical ResearchJob projection drifts. Their downstream company decisions already existed and were preserved. The deployed reconciliation now performs the same bounded, queue-aware projection repair automatically; the final runtime check showed zero active ResearchJobs, zero stale tasks, zero orphan dispatches and zero duplicate continuations.
