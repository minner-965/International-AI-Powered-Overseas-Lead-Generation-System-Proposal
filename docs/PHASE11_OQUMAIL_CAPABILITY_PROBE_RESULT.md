# Phase 11 Company Mailbox Capability Probe Result

Date: 2026-09-05

## Probe scope

The probe only established SMTP/IMAP connections and performed read-only mailbox discovery. It did not send a message, alter mailbox contents, or read message bodies.

## SMTP

| Capability | Observed result |
|---|---|
| Server greeting | 220 |
| STARTTLS advertised | Yes |
| AUTH advertised after EHLO | Yes |
| TLS certificate validation | Passed |
| Negotiated TLS version | TLS 1.3 |
| SMTP quit response | 221 |

The probe required certificate validation and TLS 1.2 or newer. No plaintext fallback was used.

## IMAP

| Capability | Observed result |
|---|---|
| Inbox special-use folder | Present |
| Sent special-use folder | Present |
| Drafts special-use folder | Present |
| Junk special-use folder | Present |
| Trash special-use folder | Present |
| Folder delimiter | `/` |
| UIDVALIDITY | Captured for Inbox, Sent, Drafts, Junk, and Trash |
| IDLE | Available |
| CONDSTORE | Not advertised |
| QRESYNC | Not advertised |

The Sent folder was discovered using the server's `\\Sent` special-use flag rather than a hard-coded folder name.

## Sent copy and message identity

The controlled smoke Message-ID lookup in the special-use Sent folder returned no exact match. Current result:

```text
SMTP_SEND_AUTOSAVES_SENT = NO
```

The result is limited to the specific controlled smoke message, whose identifier is retained only as a SHA-256 digest in local evidence. Phase 11 ambiguous-send recovery must therefore hold an uncertain send for controlled reconciliation; it must not assume that a Sent copy will always be available or resend blindly.

## Mail authentication observations

External receipt confirms message transport only. SPF, DKIM, and DMARC have not yet been recorded from a controlled recipient's `Authentication-Results` header, so their Phase 11 evidence status remains **NOT_YET_OBSERVED**.

## Scope boundary

This result does not establish application outbound E2E, inbound reply synchronization, CRM closure, suppression, or a prospect pilot.
