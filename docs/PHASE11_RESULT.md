# Phase 11 — Controlled outreach, replies and application CRM

Date: 2026-09-07. Scope: WP-OQ12–WP-OQ16, including the corrective shared CRM closure requested during final acceptance.

## Actual result

The application now exposes company-contact approval, draft editing/submission, exact-version approval and single-email sending through **邮件审核与联系 / Email Review & Contact**. The failing company-detail action was caused by a missing legacy review being treated as an existing review; company identifiers and the conditional footer are corrected.

Actual previously received controlled replies have been processed through the existing CRM outbox and worker into shared application Activity and Sales Task entities. This is no longer only an isolated test Activity display. No synthetic company was created and no additional email was sent during this work.

### Controlled reply closure

| Evidence | Actual result |
| --- | --- |
| Existing real controlled incoming messages | 2 |
| Shared CRM outbox records | 2, both SYNCED |
| Shared Activities | 2: FOLLOW_UP_REQUIRED and OPTED_OUT |
| Reply-review task | 1, CANCELLED because of OPT_OUT |
| Owner | Existing context creator, `dpv-workspace` |
| Historical task due time | 2026-09-08 10:40:59 +08:00, original receipt time + 24h |
| Current next action | STOP_CONTACT; no active due time |
| Repeated replay | 0 new records |
| Worker restart and replay | Same IDs/counts; 0 new records |
| Additional mail calls | 0 |
| External CRM API calls for this controlled application test | 0 |

The normal reply remains a review classification, not a fabricated positive sales response. The real worker happened to process opt-out first; the later normal-reply task was therefore created closed. Activity/task/outbox writes are transactional and serialized by controlled context.

Migration 057 adds strict CONTROLLED/PROSPECT scope checks and same-context foreign keys to the existing entities. Controlled rows have no company ID and cannot become prospect leads. Prospect statistics and ordinary exports exclude them. Migrations 001–056 were not edited. The operational database was backed up locally before applying 057; the backup is ignored by Git.

### Real prospect pilot

The earlier approved Rizqé pilot remains one SMTP-accepted message, with one actual provider call. It has two attempt records because the first attempt stopped before the provider was called. UI and export show **已发送，未回复 / Sent, no reply yet**. Customer receipt, read, reply and commercial outcome remain unconfirmed; none are invented.

## UI, monitoring and exports

- Company details link directly to email review; legacy company-record review is not presented as contact or draft approval.
- One company groups its category actions. Historical sent messages remain visible after readiness refreshes, while current sending gates are reevaluated.
- Monitoring covers inbox staleness/errors, identifier reset, ambiguous/stuck sending, CRM reconciliation and unmatched incoming mail. Sensitive configuration values are never returned.
- XLSX and CSV reuse the existing export workflow and include all 18 OQ13 fields, with bilingual labels and explicit no-reply/unassigned states.
- Actual 18-column files were downloaded over HTTP, parsed and visually inspected. The browser generated a separate two-row opportunity report. See `PHASE11_VISUAL_AUDIT.md` for dimensions and the in-app download-event observer limitation.

## Faults fixed during final checks

1. Partial unique-index conflict prevented creation of reply follow-up tasks.
2. A changed mailbox UIDVALIDITY retained the old high cursor and could skip later messages.
3. Successful IMAP synchronization did not record its success timestamp.
4. Interrupted CRM processing could remain stuck indefinitely; uncertain external operations now require reconciliation, while controlled internal effects replay atomically.
5. Unknown SMTP disconnects could be treated as retryable failures. Uncertain post-send exceptions now enter AMBIGUOUS, not an automatic resend path.
6. Controlled incoming replies did not enter the shared CRM outbox and follow-up entities; migration 057 and the real replay close that gap.

## Verification

- Full test suite: 851 total, 797 passed, 0 failed, 54 skipped. Skipped tests are not counted as passed.
- Isolated PostgreSQL rebuild through 057, replay and fault/isolation checks: 18 passed; temporary database removed and absence verified.
- SMTP/IMAP fault additions: 4 passed, including unknown-disconnect ambiguity and UID reset/disconnect behavior.
- Actual protected application replay: two existing incoming messages, shared CRM closure, repeated replay, and worker restart verified.
- Desktop 1440×900, small desktop 1280×720 and mobile 390×844 checked. Sending remains disabled for already-sent and unapproved records.
- No new email, automatic follow-up, synthetic customer or shared-source file modification.

Real SMTP process-kill testing was not performed; crash/ambiguity coverage uses controlled adapters and isolated PostgreSQL as specified for fault regression. External vendor CRM delivery is not claimed. This acceptance concerns the application CRM and controlled outreach workflow, not a proven sale or production-public deployment.

## Operating state

Continuous prospect sending, controlled sending and automatic email follow-up remain closed. `CONTROLLED_TEST_MAX_MESSAGES=0`. SMTP configuration and IMAP polling remain available. Existing background research continues; its activity is not reported as a new manually initiated canary.

## Release

Technical corrections and actual CRM closure are verified. Final repository checks and release references are recorded below after execution; no acceptance tag is claimed before it exists.

Release status: PENDING_FINAL_REPOSITORY_CHECKS.

## Supporting records

- `PHASE11_OQ12_OQ13_RESULT.md`
- `PHASE11_OQ14_REGRESSION_RESULT.md`
- `PHASE11_OQUMAIL_CONTROLLED_APPLICATION_E2E_RESULT.md`
- `PHASE11_OQUMAIL_INBOUND_REPLY_CRM_RESULT.md`
- `PHASE11_OQUMAIL_SUPPRESSION_RESULT.md`
- `PHASE11_APPROVED_PROSPECT_PILOT_RESULT.md`
- `PHASE11_VISUAL_AUDIT.md`
- `CURRENT_PROJECT_STATUS.md`
