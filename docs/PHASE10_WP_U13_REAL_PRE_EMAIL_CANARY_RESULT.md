# Phase 10 WP-U13 Real Pre-email Canary Result

## Verdict

- WP-U13: PASS
- Execution date: 2026-09-04
- Entry point: real browser `Research → New Research Job → Start Research`
- Search and public-web evidence: live
- Outbound email and CRM side effects: 0

## Safety boundary

The deployed dashboard and worker configuration was verified before the run:

```text
OUTBOUND_EMAIL_PROVIDER=NONE
GMAIL_API_ENABLED=false
GMAIL_INBOUND_SYNC_ENABLED=false
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
RESEND_USE_CASE=DISABLED
```

The run stopped before management approval, drafting and sending.

## Real browser runs

| Run | ResearchJob | Scope | Result |
|---|---|---|---|
| Diagnostic | `eb3cceff-3c80-4ea4-85ac-4aba51ff9a5e` | AE / Dubai / WOMENSWEAR / 5 | Exposed two real orchestration defects; both were repaired and regression-tested. The same checkpointed job then completed without repeating discovery. |
| Reverse path | `f8ce0fa7-a3e7-4fe3-b729-1b4fb420d062` | AE / Dubai / WOMENSWEAR / 1 | `COMPLETED`; the single candidate did not qualify, so no downstream job was manufactured. |
| Positive path | `84aba78b-f830-4fca-b4c6-9066bc3dce19` | AE / Dubai / WOMENSWEAR / 5 | `COMPLETED`; 5 candidates crawled, 4 verified companies promoted, 0 job errors. |

The diagnostic run found that the selected ResearchJob product profile was not passed into Customer Match, and that initial opportunity decisions were not refreshed before auto-evidence scheduling. The implementation now carries the explicit product scope into matching and performs `category completion → decision refresh → auto-evidence scheduling` in that order.

## Positive path evidence

The completed discovery job automatically created category job `5cd96d98-e672-4b9d-a6d3-0a5720b0b2af`.

```text
discovery candidates                 = 5
companies crawled                    = 5
verified/qualified companies         = 4
discovery errors                     = 0
category sources                     = 87
category observations                = 97
buyer models classified              = 4
category job errors                  = 0
current opportunities after run      = 17
EVIDENCE_REQUIRED                    = 13
NOT_SUITABLE                         = 3
RECOMMENDED                          = 1
MANAGEMENT_APPROVED                  = 0
```

The terminal category event generated current decisions before scheduling evidence work. Two new tasks were created automatically for Emirates Apparel and Kreol Group. Each completed `S01_OFFICIAL_CATEGORY`, yielded fairly, and the real 14:00 n8n reconciliation advanced both to `S02_OFFICIAL_ASSORTMENT`. No operator endpoint, database status edit or fabricated evidence was used.

## Provider, idempotency and history

```text
provider usage ledger enabled        = yes
duplicate provider fingerprints      = 0
duplicate continuations              = 0
orphan dispatch outbox rows          = 0
current BUDGET_PAUSED tasks          = 0
fixed ten-attempt gate               = absent
seven-day cooldown gate              = absent
internal daily/company/job caps      = absent
429 and credit exhaustion            = distinct
historical stop reason changes       = 0
```

The UI displayed the completed discovery and category jobs, the updated opportunity totals and live auto-enrichment progress. The scope review now says `Selected result scope` instead of implying an internal network quota.

## Zero-email after snapshot

```text
outreach_drafts                     = 0
outreach_approvals                  = 0
outbound_messages                   = 0
outbound_message_attempts           = 0
email_webhook_inbox                 = 0
inbound_messages                    = 0
crm_sync_outbox                     = 0
gmail_ambiguous_send_events         = 0
```

WP-U13 therefore proves both the positive automatic path and the legitimate no-qualified-company reverse path while all email functionality remains closed.
