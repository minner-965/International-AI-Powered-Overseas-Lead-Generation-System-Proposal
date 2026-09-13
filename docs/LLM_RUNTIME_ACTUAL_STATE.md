# LLM runtime: actual state and total-plan gap

Verified: 2026-09-07. Internal technical report. This report distinguishes the project's application runtime from development assistance.

## Actual result

The DPV application currently does not call a general-purpose LLM API. The running dashboard container has no configured `LLM_API_KEY` or `LLM_MODEL` and no provider-specific LLM environment variables. The checked application and workflow files contain no model inference adapter or inference request path. Accordingly, the application should not claim that its current scoring, draft creation or reply classification was performed by a connected language model.

Codex has helped write and test the application and prepare individual draft text during development. That activity does not create a reusable server-side model integration and does not demonstrate that future users can generate drafts automatically inside the application.

## Total plan compared with implemented behavior

| Function | Total-plan intention | Verified current implementation |
|---|---|---|
| Workflow operation | n8n, PostgreSQL, CRM interface and model services | Express and PostgreSQL task/outbox boundary, pg-boss workers; reviewed n8n workflows coordinate or reconcile work |
| Company discovery | Search and source APIs, multilingual queries | Search adapters and structured query generation; search API use is not proof of LLM inference |
| Company/category evaluation | Rules plus language-model assistance | Evidence extraction, category/feasibility logic and deterministic scoring; no LLM adapter |
| Contact verification | Contact-enrichment provider | Hunter Verifier now called for actual official email routes, with persisted results; Hunter is not the application's draft-generation model |
| Email preparation | Multilingual personalized model-assisted drafts | The workbench provides a static approved-category template; users edit subject/body, save, submit and approve in the application. Drafts are validated and versioned; no LLM generates them. The supplied-text service defaults to `phase7-manual-v1` |
| Reply intent | Model-assisted intent recognition | Header/body rules in `classifyInboundReply`; uncertain acknowledgement is REVIEW; explicit opt-out follows the suppression path |
| Sending and follow-up | Approved message, reply/CRM workflow | OquMail SMTP/IMAP and persisted control/CRM components; these are independent of LLM generation |

The total proposal explicitly describes language models for company classification, page summaries, product matching, multilingual copy and reply intent. Current user decisions supersede exact-item matching: the implemented business scope is category-level opportunity scoring. Adding an LLM later must preserve that category contract.

## Evidence inspected

- `build_dpv_proposals.py`, architecture paragraphs around lines 782–783: total-plan model roles and commercial-commitment boundary.
- `README.md`, proposed operating model: rules/AI classification and draft/approval sequence. Its original phase-one implementation section is historical and predates current mail integration.
- `docs/history/reference/PROJECT_CONTEXT.md`: historical total workflow; it explicitly directs current-phase readers to `CURRENT_PROJECT_STATUS.md`.
- `workflows/README.md` and current JSON exports: server orchestration and HTTP/code nodes; no configured language-model node.
- `services/demo-dashboard/src/phase7/service.js`: draft creation consumes supplied subject/body and validates approved context.
- `services/demo-dashboard/src/outreach/marketingContext.js`: prepares a restricted model-facing context, but does not itself invoke a model.
- `services/demo-dashboard/src/outreach/inbound.js`: deterministic reply classification.
- `services/demo-dashboard/src/server.js` and package manifest: scoring/provider wiring and installed dependencies.
- `.env.example`: placeholder LLM fields only. Sanitized runtime check: LLM key configured = false, model configured = false; no secrets were printed.

## Proposed minimum configuration contract — not implemented

```text
LLM_ENABLED=false
LLM_PROVIDER=<selected provider adapter>
LLM_API_BASE_URL=<provider endpoint>
LLM_API_KEY=<server secret>
LLM_MODEL=<validated economical model>
LLM_REQUEST_TIMEOUT_MS=<bounded timeout>
LLM_MAX_OUTPUT_TOKENS=<task-specific output limit>
LLM_MAX_CONCURRENCY=<worker concurrency>
LLM_MAX_RETRIES=<bounded retry count>
```

Except for the existing placeholder `LLM_API_KEY` and `LLM_MODEL`, these are a proposed contract, not active settings. Writing them today would not enable model generation. Before activation, implement an adapter, persisted generation job/usage records, evidence-limited prompts, validated structured outputs, draft-version creation, application progress/error handling and regression checks. Model/provider selection and billing configuration remain to be specified; this report makes no model-price claim.

A practical first model-backed feature is draft generation from the approved category/company context. Keep the existing review and send stages; use the same real recipient/evidence rules for generated and manually prepared copy. Follow [SERVER_WORKFLOW_EXECUTION_RULES.md](SERVER_WORKFLOW_EXECUTION_RULES.md).
