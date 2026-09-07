# Phase 11 WP-OQ00 to WP-OQ02 Result

Date: 2026-09-05

| Work package | Result |
|---|---|
| WP-OQ00 — baseline and credential safety | PASS |
| WP-OQ01 — SMTP/IMAP capability probe | PASS |
| WP-OQ02 — single mailbox provider configuration | PASS |

## Confirmed baseline

- Migration files 001–050 remain unchanged; applied migrations 024–051 match their database checksums.
- The ignored local mailbox configuration contains the credentials. Tracked files contain only empty password keys.
- Before this work, outreach drafts, approvals, outbound messages, outbound attempts, inbound messages, CRM outbox, and suppression records were all zero.
- The earlier SMTP acceptance and external controlled receipt remain provider-connectivity evidence only; they were not inserted into business workflow tables.

## Provider configuration

- Selected vendor: company SMTP/IMAP mailbox.
- Selected outbound adapter: `SMTP`.
- Inbound protocol configuration: `IMAP`.
- Historical Gmail adapter code remains available but is not selected at runtime.
- `nodemailer` 7.0.6 (MIT-0) is used for SMTP STARTTLS; `imapflow` 1.2.10 (MIT) is used for IMAP TLS.
- Both dashboard and outreach worker report the mailbox connection ready while `SMTP_ENABLED`, automatic inbound sync, outreach, and prospect sending remain false.

## Capability findings

- SMTP advertises STARTTLS and AUTH; certificate validation passed with TLS 1.3.
- IMAP exposes Inbox, Sent, Drafts, Junk, and Trash through special-use flags. IDLE is available; CONDSTORE and QRESYNC are not advertised.
- The controlled smoke Message-ID was not found in the special-use Sent folder. Later ambiguous-send handling must hold and reconcile rather than assume a Sent copy or resend automatically.
- SPF, DKIM, and DMARC still need a controlled recipient-header observation.

## Verification

- Provider-focused tests: 18 passed, 0 failed.
- Full application suite: 741 passed, 0 failed, 52 skipped.
- Dashboard and outreach worker: healthy.
- No new email was sent by WP-OQ00, WP-OQ01, or WP-OQ02.

## Stop boundary

WP-OQ03 through WP-OQ09 have not started. The next scope is the outbound state machine and safe ambiguous-send recovery; this result does not claim application E2E, reply sync, CRM closure, suppression, or a prospect pilot.
