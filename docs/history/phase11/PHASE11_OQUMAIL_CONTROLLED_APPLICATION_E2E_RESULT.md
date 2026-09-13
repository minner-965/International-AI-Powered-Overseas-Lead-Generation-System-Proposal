# Phase 11 Controlled Application Email Result

Evidence refreshed read-only: 2026-09-07 12:09:53 +08:00.

## Result

```text
CONTROLLED_SEND_RECEIPT_REPLY_SUPPRESSION = PASS
CONTROLLED_FULL_PLAN_APPLICATION_CRM_CLOSURE = PASS
```

One message followed the application Settings workflow: controlled context, management approval, saved draft, exact-draft approval and explicit send. SMTP accepted it at 2026-09-07 10:39:52 +08:00. The user confirmed receipt, replied normally, then sent a separate opt-out reply on the same thread. No second controlled email was needed.

| Persisted evidence | Actual count/status |
|---|---|
| Context | 1, OPTED_OUT |
| Approval records | 2 |
| Controlled draft | 1 |
| Outbound messages | 1 |
| Attempts | 1 |
| IMAP inbound messages | 2 |
| Controlled Activities | 2 |
| Active controlled suppressions | 1 |
| Shared application CRM outbox, CONTROLLED scope | 2, both SYNCED |
| Shared application CRM Activities, CONTROLLED scope | 2 |
| Shared application follow-up task | 1, CANCELLED because of opt-out |
| Acknowledgement classification | UNKNOWN_REVIEW, not buying interest |
| Opt-out classification | OPT_OUT |

Context: `5442f69f-d926-4dcf-b9bd-bae6c7a93f58`. The controlled address remains excluded from this document and normal prospect exports.

## Message identity and receipt

The application retained its original stable RFC Message-ID. OquMail supplied a different Sent-folder Message-ID and removed the custom correlation header. A unique exact match of decoded body, subject, sender, recipient and bounded timestamp recovered the observed identifier. `CONTROLLED_SENT_EXACT_CONTENT_MATCH` is persisted with the accepted message.

This later observed Sent copy supersedes any general inference from the earlier smoke lookup that Sent copies never exist. It does not establish a guarantee that every future message is saved or that an ambiguous send can always be recovered.

External controlled receipt is user-confirmed, not inferred from SMTP. Recipient-side SPF, DKIM and DMARC header evidence remains unrecorded in the capability report; this document does not fabricate those results.

## Shared application CRM closure

Migration 057 closed the previously documented CRM gap. The two existing real controlled replies were replayed through the existing CRM outbox and worker. Shared Activity and sales-task tables now carry explicit CONTROLLED scope and source references, without creating a company or inflating PROSPECT statistics. Both outbox entries are SYNCED with one attempt each; they produced two shared Activities and one historical review task assigned to the recorded actor `dpv-workspace`, due 24 hours after the original acknowledgement. The task is CANCELLED for OPT_OUT, not open for sending.

The worker actually processed opt-out first and acknowledgement second. The later review task was created closed, demonstrating monotonic suppression. Subsequent replay created zero outbox entries; independent isolated concurrency tests added no duplicate effects. This proves the application CRM path; it does not claim delivery to an external CRM vendor.

Three operational inbound records currently remain classified for review and unlinked to a prospect. Earlier documents recorded two at an earlier snapshot. They were retained, not counted as customer replies and not silently deleted.

See `PHASE11_OQUMAIL_INBOUND_REPLY_CRM_RESULT.md` and `PHASE11_OQUMAIL_SUPPRESSION_RESULT.md`. Historical sending is complete; this report itself issued no mail or mailbox modification.
