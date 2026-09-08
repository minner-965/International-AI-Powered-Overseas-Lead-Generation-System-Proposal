# Phase 13 MC07 — Email Eligibility Bridge Result

Status: **PASS**

The Phase 13 projection now evaluates these independent facts:

- active MC04 business opportunity and permitted band;
- active market and approved target category;
- fresh Hunter `VALID` business mailbox;
- deterministic recipient/template type;
- no prior first touch under the current policy;
- no suppression or hard bounce;
- healthy OquMail sender and market send window.

Migration `062_phase13_auto_first_touch_reply_bridge.sql` adds an explicit first-touch reservation source to `outreach_threads`. The two automatic threads use this source and do not fabricate legacy FIT, manual approval, draft or recipient rows. Reply correlation accepts the stable RFC Message-ID and validates the corresponding sender identity before creating the inbound message.

The shared reply pipeline now covers automatic threads as well as manual threads: classification writes Activity, CRM outbox and the appropriate sales task. Positive reply categories reach `SALES_HANDOFF_READY`; opt-out and bounce continue through the existing suppression path. Automatic follow-up remains OFF.

Current evidence at acceptance:

| Fact | Count |
|---|---:|
| Decision-maker contacts | 132 |
| Fresh Hunter `VALID` contacts | 15 |
| Automatic first-touch threads | 2 |
| Automatic bridge threads without fabricated legacy recipient | 2 |
| IMAP checkpoint | ACTIVE |
| Current prospect replies to the new automatic messages | 0 |

The V3 queue distinguishes Business Opportunity, Contact Readiness and Email Eligibility. Missing mailboxes display “No verified email found / 未找到可发送邮箱” with “Continue contact research / 继续查找联系方式”; they do not expose a review-and-send action.
