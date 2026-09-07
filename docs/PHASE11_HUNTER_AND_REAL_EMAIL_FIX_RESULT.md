# Phase 11 — Hunter and real email verification

## Verified findings (2026-09-07)

The configured Hunter key had not previously been used by this database: the initial HUNTER usage-event count was zero. Automatic enrichment considered named buyers only and omitted observed official company mailboxes.

Three real email-verifier calls were then executed through the application queue:

| Company | Mailbox | Hunter result |
| --- | --- | --- |
| Rizqé | i***@rizqe.co | VALID, score 100 |
| Rizqé | c***@rizqe.co | INVALID, score 0 |
| Alanic Clothing | i***@alanic.clothing | VALID, score 100 |

The ledger contains three completed calls and 1500 internal usage units. Units are not presented as a currency charge. Three verification events and one address-level invalid-email suppression are persisted. Replaying the interrupted jobs added no provider calls.

## Corrections

- Official observed business, general and department mailboxes enter bounded Hunter verification without a named buyer prerequisite.
- Public-page refresh preserves Hunter verification provider and timestamp.
- Verification-history inserts explicitly type timestamps; the prior SQL type error interrupted history and suppression persistence after the actual provider response.
- Official-domain comparisons handle the existing `live:<market>:` provenance prefix without changing source records.
- Category business opportunity is sufficient commercial justification. A separate active procurement announcement is not required.
- Fresh VALID official mailboxes can create recipients without pretending to be named buyers. One invalid address does not block a company's other valid address.

## Controlled application email

One approved message was submitted from the Settings page and accepted by SMTP. The user confirmed receipt and replied. The reply was received through IMAP and linked to the controlled context.

OquMail rewrites Message-ID and removes custom correlation headers. The application recovered the observed Sent identifier only after a unique match on exact decoded body, subject, sender, recipient and a bounded timestamp window. The original application Message-ID is preserved.

IMAP handling now supports actual combined MIME types, Base64/quoted-printable decoding, charset decoding, plain-text preference, UID-based reads and attachment exclusion.

The user then replied with an explicit opt-out. Observed controlled state:

```text
context_status = OPTED_OUT
messages = 1
attempts = 1
inbound_messages = 2
activities = 2
active_suppressions = 1
```

The normal acknowledgement is classified for review rather than being presented as buying interest. The second activity is OPT_OUT. Resubmission returned CONTROLLED_RECIPIENT_SUPPRESSED before a new SMTP attempt. Repeated sync added no controlled activities or suppressions.

Before the scheduler was routed to the isolated controlled flow, two mailbox records were also retained as unlinked production inbound records. They produced zero CRM outbox rows. They have not been deleted or represented as prospect replies. The corrected controlled scope routes scheduled sync to controlled persistence.

## Verification

Full-suite snapshot before the final additive trigger fix: 826 tests, 774 passed, zero failed, 52 conditional database tests skipped. Final deployment and pilot results are recorded in PHASE11_OQ09_OQ11_RESULT.md.
