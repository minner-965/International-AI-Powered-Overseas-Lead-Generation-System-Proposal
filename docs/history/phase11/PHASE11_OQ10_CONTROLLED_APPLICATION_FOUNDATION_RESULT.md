# Phase 11 WP-OQ10 Controlled Application Foundation Result

## Status

```text
CONTROLLED_APPLICATION_CONTEXT_IMPLEMENTATION = PASS
CONTROLLED_APPLICATION_DATABASE_ISOLATION = PASS
CONTROLLED_APPLICATION_UI_WORKFLOW = PASS
CONTROLLED_APPLICATION_REAL_SEND = SMTP_ACCEPTED
CONTROLLED_APPLICATION_EXTERNAL_RECEIPT = USER_CONFIRMED
CONTROLLED_APPLICATION_HUMAN_REPLY = RECEIVED_AND_LINKED
CONTROLLED_APPLICATION_OPT_OUT = RECEIVED_AND_SUPPRESSED
WP_OQ10_FINAL = PASS_WITH_DOCUMENTED_LIMITATION
```

The Settings-page workflow created one context, recorded management and exact-draft approvals, and submitted one message. SMTP accepted the message; the user confirmed receipt and sent a normal reply and an opt-out reply. Both are linked to this controlled context. The normal acknowledgement remains a review activity and is not represented as commercial interest.

## Isolation and lifecycle

Migration `055_phase11_controlled_application_context.sql` adds a dedicated persistence boundary for:

- controlled context lifecycle;
- management approval;
- exact draft and draft approval;
- queued SMTP message, stable Message-ID and attempts;
- IMAP checkpoint and correlated inbound messages;
- exactly-once controlled activities;
- controlled recipient opt-out or hard-bounce suppression.

These records have no foreign key to Company, Opportunity or production CRM tables. The controlled recipient is persisted only as a SHA-256 digest. The original address remains in the Git-ignored runtime allowlist.

## Send and reply boundaries

- `CONTROLLED_TEST` is separate from `PROSPECT_PILOT`.
- Controlled sending requires the explicit scope, enabled controlled mode, a positive maximum of at most two, exact allowlist membership and `LIVE_PROSPECT_SEND_APPROVED=false`.
- The message and stable headers are persisted before the SMTP provider call.
- A worker replay after a provider call started enters `AMBIGUOUS / manual hold`; it does not make a second SMTP call.
- Suppression is rechecked inside the reservation transaction and immediately before marking the provider call started.
- IMAP correlation requires a stable Message-ID/reference or DPV message key. Human replies must also hash to the controlled recipient. A DSN must identify that same controlled recipient.
- Activity and suppression writes have stable unique keys and never dispatch production CRM work.

## Management UI

- Settings now contains a bilingual controlled-email workflow with a create-context entry point.
- The page follows the persisted lifecycle: context creation, management approval, draft save, exact-version draft approval, explicit final confirmation and single-message enqueue.
- Runtime readiness is visible without exposing the controlled address, sender identity, Reply-To or recipient digest.
- Busy states, inline success/error feedback, 44px touch targets and responsive single-column behavior prevent duplicate actions and keep the workflow usable on mobile.

## Runtime during the controlled test

The controlled test used the following restricted runtime. Final runtime closure is recorded in the combined result:

```text
OUTREACH_SEND_SCOPE=CONTROLLED_TEST
CONTROLLED_TEST_MODE=true
CONTROLLED_TEST_MAX_MESSAGES=2
CONTROLLED_TEST_RECIPIENT_ALLOWLIST=<one ignored local controlled address>
OUTREACH_ENABLED=true
LIVE_PROSPECT_SEND_APPROVED=false
```

## Actual E2E result

Persisted controlled counts: one context, two approvals, one approved draft, one accepted message, one attempt, two inbound messages, two activities and one active suppression. Context status is OPTED_OUT. Resubmission is blocked with CONTROLLED_RECIPIENT_SUPPRESSED; message and attempt counts remain one. Repeated sync adds no activities or suppressions.

OquMail rewrites Message-ID and removes custom headers. The observed Sent identifier is linked only after a unique exact match of decoded body, subject, sender, recipient and bounded send time. MIME decoding and UID handling were corrected using the real mailbox responses.

Two unlinked production inbound records were retained before the scheduled controlled-sync routing fix. They created zero CRM outbox rows. This is a documented isolation limitation of the initial run; the corrected scheduler uses isolated controlled persistence. Detailed evidence is in PHASE11_HUNTER_AND_REAL_EMAIL_FIX_RESULT.md.

## Verification

- Full dashboard suite before final trigger/revision corrections: 826 total, 774 passed, 0 failed and 52 skipped isolated database scenarios. See the combined result for final verification.
- Controlled backend and UI focused suite: 14 passed, 0 failed.
- Dashboard, PostgreSQL and outreach worker are healthy after rebuilding the deployed image.
