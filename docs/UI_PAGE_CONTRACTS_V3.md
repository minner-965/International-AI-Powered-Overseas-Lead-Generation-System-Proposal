# V3 Page Contracts

Status: implemented page contracts, consolidated at WP-UI16. Thirteen current routes include Contact-ready and Replies; System Status is an existing overview/settings surface, not a separate new business entity. Verification scope and remaining gaps are recorded in PHASE12_UI_RESULT.md.

## MC04 functional amendment — 2026-09-08

The approved MC04 business projection supersedes the earlier opportunity-admission semantics below, not V3 styling. PRECISION, RELEVANT and GENERAL_RELEVANT automatically mean Active Business Opportunity. Review flags are expandable warnings, not confirmation controls. Overview, Opportunities, Company Detail, Contact-ready, Research/Jobs, Email Review, existing search/service monitors and Export show independent Business Opportunity, Contact Readiness and Email Eligibility. Contacting a company does not remove its business opportunity; first-contact queues and mail authorization remain separate. Operational search monitoring stays in the existing Research/Jobs/Settings surfaces. Historical scores, task outcomes and approval records retain their original meaning.

| Page | V3 structure | Data/behavior invariants |
| --- | --- | --- |
| Overview | Four KPIs; 2:1 analysis/distribution; 1:1 tasks/attention | Recommended, verified-active, SENT_NO_REPLY PROSPECT, actionable pending; no synthetic trends; actual API scope |
| Opportunities | Header, metrics, status tabs, primary filters, advanced drawer, table/mobile cards, pagination | Preserve query keys and decision semantics; recommended, missing evidence, approved, sent, replied, hold, unsuitable, all projections; do not create new backend statuses for tabs |
| Research | Market/category/buyer scope form, optional advanced product profile, scope review, create action; recent tasks | Preserve research-form, original POST payload, one job creation and polling; UI work itself does not submit |
| Jobs | Research/Import/Export/Outreach tabs; task, scope, state, stage, latest event, owner/action | Existing persisted tasks only; detail summary/progress/results/evidence/usage/audit; hide tokens/raw payload |
| Companies | Company/site/market/type/verification/categories/channels/opportunity/activity | Directory membership is not opportunity approval; existing data and company review semantics remain |
| Company Detail | Snapshot, Category Fit, Contacts, Opportunity, Communication, Evidence, Activity, Records | Definition lists/tables/timeline; content-sized dialog, visible Back/Close; preserve detail hook and approval separation |
| Contact-ready | One company row with aggregated categories and distinct channels | Do not duplicate mailbox for each category; no named-person gate for verified official department mailbox; manual phone/form/WhatsApp not email-send controls |
| Email Review & Contact | Left company/opportunity, middle recipient/subject/body, right approvals/gates/activity | Preserve all approval gates; send-one action only when existing gate passes; sent-no-reply, replied, opt-out, bounce, ambiguous display accurately |
| Replies & Follow-up | Inbox with sender/type/time/related message/owner/next action; activity timeline | Actual reply classification and CRM tasks; scope separated; opted-out closes follow-up and blocks contact |
| Evidence | Type, finding, official link, captured/verified time, supports/contradicts | Safe links, original evidence; no raw payload/private paths |
| Customer Match | Aligned comparisons, small bars, coverage, sample counts | DPV Score, Management Baseline, Historical Match remain independent; no black-box combined probability |
| Import | File/type → check → preview → submit approval → approved version → commit | Existing permissions, validation, preview/commit separation; shared files stay read-only |
| Export | Dataset → scope → format → columns → generate → download | Existing allowlists, role projections, expiry, download audit; no fabricated export success |
| Settings | Density/language/theme preferences; existing default scope if supported | Browser preferences only; unavailable settings not invented as functional controls |
| System Status | Redacted database/research/outreach/n8n/search/mailbox/IMAP/CRM health | Ready/Degraded/Action required backed by current health; no credentials, raw errors or internal paths |

## Navigation target

Workspace: Overview, Opportunities. Execution: Research, Jobs, Contact-ready, Email Review, Replies & Follow-up. Records: Companies, Evidence, Customer Match. Data: Import, Export. System: System Status, Settings. Preserve current stable route identifiers; later additions require explicit routing tests, not silent redefinition of old hashes.

## Truth and scope

Every future chart must document endpoint, exact fields, window, scope, controlled exclusion and empty behavior before implementation. Use existing metrics, opportunities, research workbench summary and Phase 11 dashboard APIs. No proof-of-current-procurement or exact-SKU gate added. Known history such as Tier versus qualification alignment is not repaired by UI score edits.

Every page retains loading/empty/error/permission/degraded states, mobile and keyboard access, existing field names and original evidence. A missing projection must be reported for later design, never approximated by unrelated scores or database writes.
