# Phase 11 Suppression Result

Evidence refreshed: 2026-09-07 12:09:53 +08:00, read-only.

```text
CONTROLLED_OPT_OUT = PASS
POST_SUPPRESSION_ADDITIONAL_SMTP_CALLS = 0
REAL_PROSPECT_OPT_OUT = NOT_OBSERVED
```

The user sent an explicit opt-out reply on the controlled message thread after the acknowledgement. IMAP persisted a separate OPT_OUT event. The context became OPTED_OUT with one active controlled suppression and one opt-out Activity, in addition to the acknowledgement Activity.

Historical application resubmission returned `CONTROLLED_RECIPIENT_SUPPRESSED` before a new SMTP attempt. Counts remained one controlled message and one attempt; repeated synchronization added no controlled suppression or Activity. The current read-only database snapshot confirms those same counts. No new suppressed send was attempted for this report.

## Address-level production result

The production contact-suppression table contains one active INVALID_EMAIL result from Hunter. It applies to the failed address, not every address of that company. It is not a customer opt-out, bounce or complaint.

## Bounce and complaint boundaries

Automated provider fixtures require structured delivery-status MIME evidence for DSN handling. Hard and soft statuses remain distinct; ordinary text saying delivery failed is insufficient. No real hard bounce, real customer opt-out or real complaint was manufactured or observed for acceptance.

SMTP/IMAP complaint testing is deferred when no complaint event channel exists. A fixture test is not a real complaint result.

## Shared CRM follow-up closure

Migration 057 routes the real controlled events through the shared application CRM worker under CONTROLLED scope. The opt-out produced an OPTED_OUT Activity. When the earlier acknowledgement was processed afterward, its review task was created CANCELLED with close reason OPT_OUT, preserving the original owner and due date for audit. Two outbox entries are SYNCED; repeated enqueue adds zero entries. PROSPECT-scoped Activity, tasks and outbox remain zero. No customer response or external vendor synchronization is fabricated.

Controlled recipient addresses, raw reply bodies and server authentication data are excluded from this document.
