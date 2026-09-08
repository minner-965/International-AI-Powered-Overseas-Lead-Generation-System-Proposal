# n8n workflow exports

Store reviewed n8n workflow JSON exports in this directory. Never include n8n
credential exports or secret values.

ResearchJob dispatch is canonical and immediate through the transactional
outbox and direct pg-boss queue. n8n is retained only for periodic
reconciliation and the reviewed non-ResearchJob orchestration workflows.

Research candidates remain job-scoped. Promotion uses `data_origin =
live_discovered` with a valid `research_job_id`; source URLs, capture times and
existing historical records are retained.

## Target category validation

`03-phase6_1-category-procurement-match.json` is the credential-free orchestration handoff
for a `CATEGORY_PROCUREMENT_ENRICHMENT` ResearchJob. The export display name is
`DPV Target Category Validation`; the workflow ID, webhook, node names, internal
job type and endpoint names are stable compatibility identifiers. Its payload is deliberately
limited to the job ID, job type and the two product-profile codes. It never
contains internal catalog rows, product names, prices, historical customers,
orders, source paths or evidence bodies.

Express remains the browser boundary. The workflow calls the internal-token
endpoint once; Express then creates pg-boss work items at
`company_id × product_profile` granularity for category/buyer evidence collection,
buyer-business-model classification, category matching, category-level opportunity
and Cooperation Feasibility V3. The workflow
does not contain outreach, supplier-portal submission, email or messaging
nodes. Import it after deployment review and activate it only when
`N8N_CATEGORY_PROCUREMENT_WEBHOOK_URL` points to the reviewed webhook.

The 30-minute evidence reconciliation workflow is a repair/fallback schedule,
not a normal-path waiting period. Research dispatch and completion events use
the transactional outbox and immediate queue producers. Preserve reconciliation
and its heartbeat/watchdog until their current repair responsibilities are replaced.

During cleanup the execution services remain stopped. Editing an export does not
update the persisted n8n instance or activate a workflow. A later reviewed import
must preserve workflow identity and execution history; CL08 performs no import.
