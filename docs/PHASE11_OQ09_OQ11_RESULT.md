# Phase 11 OQ09–OQ11 Actual Result

Updated: 2026-09-07 11:21 +08:00. Replaces the earlier pending/zero-send snapshot.

| Work package | Actual result |
|---|---|
| WP-OQ09 | PASS: address suppression, opt-out and structured Bounce/DSN paths verified |
| WP-OQ10 | PASS: one accepted controlled application send, two replies, opt-out suppression and blocked repeat send |
| WP-OQ11 | One approved prospect message accepted by SMTP; delivery and prospect reply remain unconfirmed |

Phase 11 final acceptance and commercial outcome remain incomplete. SMTP acceptance is not proof of inbox delivery, recipient interest or a completed CRM sales outcome.

## OQ09 and controlled OQ10 evidence

- Opt-out stops that address, cancels unsent work and closes relevant follow-ups. Later retries recheck suppression before the provider call.
- A hard bounce requires structured message/delivery-status evidence, matching recipient and 5.x.x status. 4.x.x is soft bounce. Ordinary failure wording is not DSN evidence.
- Quoted original-message unsubscribe text does not classify a normal reply as an opt-out. Real complaint delivery was not performed; that path remains fixture-tested.
- Controlled application database result: 1 message, 1 attempt, 2 inbound replies, 2 activities and 1 suppression. Reply classifications: REVIEW acknowledgement and OPT_OUT.
- A repeat send after opt-out was blocked with 0 additional provider calls.
- The controlled context remains separate from Company/Opportunity and production CRM records.

The real mailbox test exposed integration issues absent from simplified fixtures. ImapFlow supplies combined MIME types such as text/plain; replies may be Base64 or quoted-printable. The adapter now decodes these and the declared charset, prefers plain text and excludes attachments. UID queries use UID semantics, and body reads occur after the metadata fetch completes.

OquMail rewrites Message-ID and removes custom DPV headers. The controlled test recovered the observed Sent ID only from a unique exact match of decoded body, subject, sender, single recipient and bounded send time. No subject-only or guessed relationship was used.

## Hunter and recipient readiness

Initial actual Hunter usage was zero despite configured credentials: the automatic path required a verified named buyer and never verified observed general company mailboxes. Official observed business, company and department emails now enter the verifier automatically, with source preservation and fresh-result reuse.

Actual Hunter result: 3 completed calls, 1,500 credit units, 3 verification events, 2 VALID routes and 1 INVALID address suppression. Two valid addresses do not imply that two prospect messages were sent. Only the selected Rizqé recipient was used for the single pilot.

The user clarified that a category business opportunity is sufficient for an introductory contact. Separate procurement-intent proof, named buyer identity and exact internal SKU correspondence are not prerequisites. Verification, exact approval and suppression controls still apply.

## OQ11 actual single send

- Company: Rizqé; selected official mailbox is masked as i***@rizqe.co.
- Message scope: approved introduction covering womenswear and Yiwu general-merchandise supply.
- Final draft: b7fd7217-cfc4-432c-beb8-ede863bb2244.
- Exact approval: e3eebd62-2f66-44ae-9849-7ee470f06c3d.
- Persisted outbound message: 04602fd0-5247-4c94-a8e4-54d14cbcb315.
- SMTP result: ACCEPTED_BY_SMTP at 2026-09-07T03:20:44.545538Z (11:20:44 +08).
- 2 persisted attempt records: the first was BLOCKED before any provider call; the second reached the provider at 03:20:39.430253Z and was accepted. There was one actual SMTP call for the prospect.
- Prospect delivery, reply and commercial interest: not yet established.

The initial enqueue transaction rolled back due to execution-key mismatch. Date canonicalization and omitted worker projection fields were also corrected. The blocked attempt is retained as evidence; it is not represented as an extra email. Each focused database rollback/readback regression passed.

## Final observed controls and counts

At 11:21 +08: scope DISABLED, outreach false, live-prospect approval false. SMTP configuration and IMAP polling remain enabled. Controlled mode is false. No further prospect send is enabled.

Database: 3 outreach draft versions, 1 prospect outbound message, 2 prospect attempt records, 3 general inbound records and 0 production CRM outbox rows. General inbound records predate/overlap the controlled scheduler correction and are not evidence of a prospect reply. Controlled inbound/activity/suppression records remain separately counted above.

Migrations 054, 055 and 056 are applied. Migration 056 SHA-256: 2812ea9cbffc8b1f502764c16043a987d74ac99b0461ad94da4d945c1fbf54dd. Earlier immutable migration baselines remain recorded separately in CURRENT_PROJECT_STATUS.md.

An earlier full regression run after Hunter/MIME corrections passed 774 of 826 tests with 0 failures and 52 skips. Later UI/pilot integration verification is recorded in the final consolidated execution report; the earlier count is not presented as a final-build rerun.

See [PHASE11_OQ11_PILOT_READINESS.md](PHASE11_OQ11_PILOT_READINESS.md), [CURRENT_PROJECT_STATUS.md](CURRENT_PROJECT_STATUS.md) and [LLM_RUNTIME_ACTUAL_STATE.md](LLM_RUNTIME_ACTUAL_STATE.md).
