# Phase 10 Work Package 15 — Gmail API Provider Result

## Outcome

WP15 implementation and disabled-state deployment verification pass. The real controlled-address send/reply/CRM E2E is pending mailbox configuration and therefore is not represented as completed.

## Implemented

- Gmail API adapter with OAuth 2.0 refresh-token authorization and minimized send/compose/readonly scope guidance.
- Existing Phase 7 approval, suppression, exact-recipient, immutable draft revision, rate-cap and idempotency gates remain the only outbound path.
- Stable RFC `Message-ID`, internal correlation header and database `send_execution_key` prevent ordinary duplicate sends.
- A timeout becomes `AMBIGUOUS`; redelivery queues Sent-mailbox reconciliation and does not call Gmail send again.
- Gmail success becomes `PROVIDER_ACCEPTED / ACCEPTED_BY_GMAIL`, never `DELIVERED`.
- Inbound polling uses Gmail `historyId`, Gmail message id uniqueness, thread/header correlation and the existing reply-classification/CRM queues.
- Automatic-response headers force `AUTO_REPLY`; structured DSN requires a delivery-status report with recipient and enhanced status code. Only confirmed 5.x DSN results create hard-bounce suppression.
- Migration `042_phase10_gmail_api_provider.sql` is additive and provides checkpoint and append-only ambiguous-send audit tables.

## Verification

- Native GoRules smoke: PASS.
- Full local suite: 661 total, 653 passed, 0 failed, 8 environment-scoped skips.
- WP15 targeted local suite: 10/10 passed.
- Live PostgreSQL migration: APPLIED, then SKIPPED_ALREADY_APPLIED on replay.
- Rebuilt deployed image WP15 suite: 10/10 passed.
- `demo-dashboard`, `category-worker`, `data-worker`, `outreach-worker` and PostgreSQL: healthy.
- Live disabled-state Gmail health endpoint: `GMAIL_PROVIDER_NOT_SELECTED`, ready false.
- Live inbound-sync queue job: completed as disabled with zero messages and zero network calls.
- Database counts after disabled verification: 0 outbound messages, 0 inbound messages, 0 Gmail checkpoints and 0 ambiguous-send events.
- In-app visual-control connection was attempted twice but its local control runtime did not initialize; API, deployed-container and existing UI contract tests were used for this package. WP15 adds no new visible interface.

## Remaining controlled E2E inputs

Before the one-message controlled test, management must provide:

1. Sender/Reply-To selection: A (`info@`/`info@`), B (`enquiries@`/`enquiries@`) or C (`info@`/`enquiries@`).
2. Confirmation that the selected sender exists as a Workspace user or permitted send-as alias and that replies are monitored.
3. OAuth client ID, OAuth client secret and user refresh authorization stored only in the deployment secret file.
4. One company-controlled recipient email for the allowlist and receipt/reply check.

Until those values are present, `OUTBOUND_EMAIL_PROVIDER=NONE`, `GMAIL_API_ENABLED=false`, `GMAIL_INBOUND_SYNC_ENABLED=false`, `OUTREACH_ENABLED=false` and `LIVE_PROSPECT_SEND_APPROVED=false` remain effective.
