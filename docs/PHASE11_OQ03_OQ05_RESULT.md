# Phase 11 OQ03–OQ05 Result

## Scope

Implemented the controlled outbound safeguards for OquMail SMTP/IMAP.  No live prospect email was sent while completing this work.

## OQ03 — Outbound state and stable identity

- An RFC Message-ID is derived from the persisted outbound idempotency key before the SMTP call.
- A database reservation and lease are created before the provider call.  A provider call is marked separately, so a restarted worker never treats a previously-started SMTP operation as safe to resend.
- A duplicate enqueue returns the existing message.  A completed provider acceptance returns an idempotent replay without another provider call.
- SMTP acceptance is recorded as `SMTP_ACCEPTED` / `SENT_NO_REPLY`; it is not displayed or stored as delivery confirmation.

## OQ04 — SMTP ambiguity and Sent-folder policy

- A timeout or uncertain SMTP result is persisted as `SEND_AMBIGUOUS` and enters `SMTP_MANUAL_HOLD_REQUIRED`.
- The system records an append-only ambiguity event with the stable Message-ID.
- It does not enqueue the Gmail reconciliation worker for SMTP, does not use IMAP APPEND, and does not automatically retry an uncertain SMTP transmission.
- The current OquMail capability evidence does not establish reliable Sent-folder lookup, so a manager must check the mailbox before any later controlled retry decision.

## OQ05 — recipient and approval controls

- Recipient records distinguish `NAMED_BUYER_EMAIL`, `OFFICIAL_COMPANY_EMAIL`, and `OFFICIAL_DEPARTMENT_EMAIL`.
- A recipient is eligible only when it has official-site evidence, a verified current route, and an email domain matching the verified company domain.
- An approval now binds the exact opportunity snapshot, management event, recipient-route hash, purpose, sender, reply address, claims/evidence hash, and expiry date (default seven days).
- Any change to the opportunity, management event, purpose, route, approval expiry, suppression, verification, or draft digest blocks enqueue/send.
- Draft validation rejects unsupported statements that assert the prospect is purchasing, sourcing, or procuring without evidence.

## Validation completed

- `node --test test/phase7-backend-integration.test.js test/phase11-smtp-imap-provider.test.js`: 29 passed, 0 failed.
- JavaScript syntax checks passed for service, repository, migration runner, and draft validator.
- Sending gates remain disabled; this result contains no external email action.

## Runtime verification

- Docker Desktop was restarted and the `demo-dashboard` and `outreach-worker` services were rebuilt from the updated source.
- Migration `052_phase11_oqumail_outbound_safety.sql` was applied to PostgreSQL database `lead_generation` and appears as the newest migration-ledger entry.
- PostgreSQL, the workbench, and the outreach worker are healthy after the rebuild.
- The workbench home page returned HTTP 200 after the rebuild.
- The migration is additive. It does not rewrite existing prospect records; no outbound ambiguity events existed at verification time.
