# Server workflow execution rules

Updated: 2026-09-07. Internal engineering and operation rules; this is not customer-facing copy.

## Execution contract

1. A user action starts persisted server work. Express validates the request and writes the task/outbox; workers perform background work. Exception explicitly approved on 2026-09-07: single-email delivery is manual-only, with the outbound identity persisted before the authenticated API invokes the existing transport once. It is not placed on a background send queue. A lost response must be reconciled against persisted evidence, never silently resent.
2. Use the existing PostgreSQL, pg-boss and reviewed n8n reconciliation paths. Do not make normal company operation depend on Codex, a desktop automation session, a developer terminal, or manually editing database rows.
3. Keep company records, evidence, approvals, drafts, provider responses, replies and operational outcomes persisted and inspectable in the application. A successful API response alone is not an accepted business outcome.
4. Repeated clicks must reuse the same work identity. Never retry an ambiguous SMTP send as a new send. The user replaced the old one-message-per-day test allowance with **50 manually approved emails per day**, retaining **1 per minute** and **1 per company in 30 days**. Address-level suppression, current company approval, verified recipient and exact-version draft approval remain mandatory. Background sending and automatic follow-up email remain off.
5. Company supply scope includes womenswear and approved Yiwu general-merchandise categories. Product and historical-deal imports support category scope, ICP and scoring. Category fit does not require an exact internal SKU or separate evidence of current procurement intent.
6. Automatically verify observed official business mailboxes through Hunter and retain the actual result and usage event. An invalid address does not invalidate another verified address at the same company. A named buyer is optional for an official company mailbox.
7. Initial prospect drafts remain reviewable and versioned in the application. Approval binds the exact recipient, subject, body and evidence version. Revising the draft supersedes its approval; an approved prior version must not silently supply approval for new copy.
8. The operations overview should show active tasks, failures requiring attention, waiting approvals, accepted messages, replies, opt-outs, provider usage and the next action in business language. Separate controlled test records from prospect operations.
9. Shared-folder source files are read-only. Importers may write to designated local working/output areas and the application database, while preserving originals.

## Model execution and cost policy

- When an LLM-backed feature is implemented, call the configured model API from a server worker. Codex assistance during development is not the application's production model runtime.
- Prefer an economical model that passes the task's factual and language checks for routine extraction, concise summaries, translation and first drafts. Model choice is configurable; provider and model are not selected by this document.
- Use deterministic code for numeric scoring, recipient eligibility, suppression, approval validity, prices, commercial commitments and send execution. LLM output is evidence-linked proposed content, not authority to change these controls.
- Reuse an output when the input digest, prompt version and model are unchanged. Bound input/output length, concurrency, timeouts and retries. Record actual provider/model, request identity, usage tokens, measured cost when available, status and output version. Missing provider billing data must remain unknown rather than an invented zero.
- Permit a more capable model only for a documented task-quality reason and configured routing. Do not escalate merely because a task is long, and do not retry a valid response repeatedly to obtain a preferred conclusion.
- Send only the fields needed for the task. Do not include mailbox credentials, private source-folder documents, full customer/order exports or unsupported company claims in a model request.
- Each model-generated draft must pass the same server validation and human draft approval as an authored draft. An LLM must not send mail directly.

## Current implementation boundary

The current application has real search/contact/mail integrations and deterministic scoring, but no connected LLM inference adapter. These model rules govern the next implementation; they do not assert that an LLM API is already running. See [LLM_RUNTIME_ACTUAL_STATE.md](LLM_RUNTIME_ACTUAL_STATE.md) for verified code/runtime evidence and the proposed configuration contract.
