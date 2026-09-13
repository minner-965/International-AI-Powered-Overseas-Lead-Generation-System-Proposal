# Phase 11 OQ06–OQ08 Result

## Result

WP-OQ06, WP-OQ07 and WP-OQ08 are implemented on the existing Phase 7 outreach and CRM foundation. No email was sent and the real IMAP polling switch remains disabled pending the controlled E2E phase.

## WP-OQ06 — IMAP incremental sync

- Added one provider-neutral `inbound-email-sync` queue. Only the selected inbound provider may be scheduled; Gmail and IMAP are not scheduled together.
- The OquMail adapter opens Inbox read-only and reads a bounded initial/rescan window or `last_processed_uid + 1` thereafter.
- Checkpoints persist the mailbox hash, folder, UIDVALIDITY, last processed UID, highest modseq when available, last sync, last success and reset count.
- A UIDVALIDITY change starts a bounded rescan and appends a reset audit event. It does not continue blindly from the previous UID.
- Receipt uniqueness is enforced by mailbox + folder + UIDVALIDITY + UID. Message-ID is retained as an additional content-level deduplication key.
- Fetch requests exclude full message source and attachments. Only headers and a bounded first text part are requested; attachments remain metadata-only.

## WP-OQ07 — reply correlation and classification

- Correlation order is exact In-Reply-To to stable RFC Message-ID, References, X-DPV-Message-Key, provider thread, then manual review.
- Subject and sender-only matching were removed from automatic correlation.
- The matched outbound message, correlation method and evidence digest are persisted.
- Reply categories are `HUMAN_POSITIVE`, `HUMAN_NEUTRAL`, `HUMAN_NEGATIVE`, `OPT_OUT`, `AUTO_REPLY`, `OUT_OF_OFFICE`, `BOUNCE_DSN` and `UNKNOWN_REVIEW`.
- DSN and automation headers are evaluated before body keywords, preventing quoted unsubscribe text inside an automatic reply from creating a false opt-out.
- Classification revision has a database uniqueness constraint, so worker replay does not add a second classification.

## WP-OQ08 — CRM activity, owner and follow-up

- Reused `crm_sync_outbox` and `sync-outreach-to-crm`; no second CRM queue was created.
- Human replies create an Opportunity Activity, funnel state, assigned follow-up task, due date and CRM outbox records.
- Owner is taken from the active Contact Queue and falls back only to the recorded management actor. No owner is invented.
- Automatic and out-of-office replies create an Activity but no positive follow-up task.
- Opt-out creates an Activity, updates the funnel, uses the existing suppression path and closes pending follow-ups.
- Stable effect identity is derived from inbound message ID + classification revision + opportunity snapshot ID. Activity, task and CRM outbox inserts are idempotent.
- Automatic funnel transitions are limited to `CONTACTED`, `REPLIED`, `OPTED_OUT` and `BOUNCED`.

## Runtime and verification

- Migration `053_phase11_oqumail_inbound_crm.sql` applied successfully to PostgreSQL `lead_generation`.
- Verified runtime tables: `imap_mailbox_checkpoints`, `imap_message_receipts`, `imap_checkpoint_events`, `opportunity_activities`, `opportunity_crm_states`.
- Dedicated OQ06–OQ08 tests: 4 passed, 0 failed.
- Full dashboard suite: 797 total, 745 passed, 0 failed, 52 skipped database/integration fixtures.
- PostgreSQL, dashboard and outreach worker were healthy after the migration.
