STATUS: SUPERSEDED FOR CURRENT PHASE STATUS
Use docs/CURRENT_PROJECT_STATUS.md for current execution state.
Historical business/context sections remain reference-only.

Current Phase 10 execution note (2026-09-04): WP-A04.2 supersedes WP10's local Tavily ceilings. Migration 039 remains immutable history, while active runtime policy is `PROVIDER_ACCOUNT_ONLY`: no application daily, job, company/profile, purpose or global Tavily quota blocks task creation. Confirmed provider credit exhaustion is the only credit-based creation gate; fairness, exact dedupe, query fingerprints and bounded worker concurrency remain active.

# Project Context and Decision Record

Last consolidated: 2026-08-23

## 1. Project objective

Build an AI-assisted overseas lead-generation system for DPV International. The system must identify overseas B2B companies, qualify the correct buyer type, enrich and validate business contacts, prepare personalized outreach, preserve source traceability and hand qualified opportunities to sales.

## 2. Binding business decisions

1. The current plan is B2B only.
2. The target is an overseas importer / wholesaler that imports and supplies chain stores or organized retail networks.
3. End consumers are not the current acquisition target.
4. B2C may be evaluated later as a separate phase.
5. Initial outbound messages require human approval.
6. Every company must retain its source URL or provider reference.
7. Opt-out, hard-bounce and rejected-approval events stop further automated outreach.
8. High-intent replies are handed to sales for catalogue, sample, quotation or meeting follow-up.

## 3. n8n's role

n8n is the workflow orchestrator. It schedules jobs, passes structured JSON between nodes, calls approved APIs, applies routing rules, records execution status and updates the database or CRM.

n8n is not itself the customer-data source and the large language model is not used as a browser that independently controls a computer. Customer discovery comes from configured search APIs, public company pages, industry directories, B2B platforms, trade-data services, exhibition lists and other sources approved by the company.

## 4. Planned workflow

```text
Schedule Trigger / Manual Trigger
  -> country, product and ideal-customer-profile parameters
  -> multilingual keyword generation
  -> search API / directory / trade-data queries
  -> one workflow item per candidate company
  -> public company-page or provider-data extraction
  -> field normalization
  -> domain-based deduplication
  -> B2B company validation
  -> importer / wholesaler evidence validation
  -> chain-store / retail-network supply evidence
  -> decision-maker enrichment and verification
  -> product matching and lead scoring
  -> Tier A / B / C routing
  -> personalized email or LinkedIn draft
  -> human approval
  -> approved email send or sales task
  -> wait for reply, bounce or opt-out
  -> reply-intent classification
  -> CRM owner and next-action update
  -> sales handoff or stop status
```

## 5. Recommended minimum lead fields

- Lead ID
- Company name and normalized domain
- Country, city and service region
- Company website
- Source provider and source URL
- Capture timestamp
- Company type
- Importer / wholesaler evidence
- Chain-store supply evidence
- Product categories and brand portfolio
- Company description
- Decision-maker name, title and department
- Business email and verification status
- Public business phone and LinkedIn/company profile URL
- Product-match result
- Lead score, tier and score explanation
- Approval status
- Outreach message version and send status
- Reply intent, opt-out status, owner and next action
- n8n execution ID and last-updated timestamp

## 6. Data required from the company

- Product master data, categories, specifications, catalogues and approved product claims.
- MOQ, indicative price ranges, sample policy, lead times, export markets and logistics capabilities.
- Existing customer and order history in de-identified form for model and scoring validation.
- Definition of target and excluded company types.
- Successful sales messages, FAQs and objection-handling material.
- Corporate email/CRM account authorization and approval owners.
- Contact-retention, outreach-frequency, opt-out and lead-assignment rules.

Passwords and private keys must not be collected through spreadsheets or committed to the repository.

## 7. Documents and presentation decisions

- The formal bilingual proposal uses an eight-week implementation schedule.
- The management workflow demonstration intentionally removes the former final page about an eight-week live demonstration.
- The current management deck contains six slides and focuses on how n8n acquires company data, stores records, filters companies, verifies contacts, routes approvals, performs outreach and updates CRM.
- Funnel values shown in the presentation are illustrative demonstration data, not actual campaign results.

## 8. Current repository state

Available now:

- Chinese and English formal proposals.
- English management presentation and PDF copies.
- n8n workflow-principle presentation and PDF copies.
- Chinese and English cost-budget workbooks.
- Python and JavaScript/MJS sources used to generate documents, decks and workbooks.
- Logos and visual assets.

Not yet implemented:

- Production n8n workflow exports.
- PostgreSQL schema and migrations.
- Search/provider API adapters.
- Contact-enrichment integration.
- Corporate email and CRM integration.
- Operational dashboard, monitoring and alerting.
- Real campaign data and validated production KPIs.

## 9. Recommended next implementation milestone

Create a controlled n8n proof of concept for one country and one product category:

1. Accept country, product and ideal-customer-profile inputs.
2. Query one approved company-data/search provider.
3. Store 50 candidate companies with source traceability.
4. Normalize domains and remove duplicates.
5. Apply explicit importer/wholesaler and chain-store-supply criteria.
6. Enrich and verify a small set of decision-maker contacts.
7. Generate an approval-ready Tier A review table.
8. Keep outbound sending disabled until management approves the data quality.
