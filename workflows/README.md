# n8n workflow exports

Store reviewed n8n workflow JSON exports in this directory. Never include n8n
credential exports or secret values.

The workflow remains no-send and now performs the Phase 4 management pipeline:

1. accept country code/name plus optional city/region and preferred language;
2. generate five market-aware balanced queries;
3. execute bounded Tavily Basic discovery and public contact checks;
4. resolve company identity and official websites;
5. persist structured business, size and accessibility evidence;
6. retain SME/regional opportunities and strategic accounts;
7. promote only verified, traceable, non-duplicate businesses.

`01-two-week-demo.json` is the credential-free workflow export. Secrets remain
in n8n environment variables. It contains no email, WhatsApp or other outreach
node.

Research candidates remain job-scoped. Promotion uses `data_origin =
live_discovered` with a valid `research_job_id`; source URLs, capture times and
existing historical records are retained.

## Phase 6.1 category procurement matching

`03-phase6_1-category-procurement-match.json` is the credential-free orchestration handoff
for a `CATEGORY_PROCUREMENT_ENRICHMENT` ResearchJob. Its payload is deliberately
limited to the job ID, job type and the two product-profile codes. It never
contains internal catalog rows, product names, prices, historical customers,
orders, source paths or evidence bodies.

Express remains the browser boundary. The workflow calls the internal-token
endpoint once; Express then creates bounded pg-boss work items at
`company_id × product_profile` granularity for category/buyer evidence collection,
Buyer Business Model classification, Category Procurement Match, Product Opportunity
and Cooperation Feasibility V3. The workflow
does not contain outreach, supplier-portal submission, email or messaging
nodes. Import it after deployment review and activate it only when
`N8N_CATEGORY_PROCUREMENT_WEBHOOK_URL` points to the reviewed webhook.
