# Phase 11 OQ11 Pilot Readiness

## Decision

**RIZQÉ SINGLE PILOT ACCEPTED BY SMTP / Rizqé 单封试联系邮件已由 SMTP 接受。**

Updated 2026-09-07 11:21 +08 following the user's explicit correction: existing product-category business opportunity is sufficient commercial eligibility. Separate active procurement intent and a named purchasing contact are not required. Exact email verification, approval and suppression controls still apply. One final message was accepted by SMTP at 11:20:44 +08; delivery and prospect reply are not yet confirmed.

## Candidate comparison

| Hard gate | Alanic Clothing | Rizqé |
|---|---|---|
| Current Opportunity | `RECOMMENDED`, Womenswear | `RECOMMENDED`, Womenswear |
| Company identity | `VERIFIED`, `ACTIVE`, current official-site evidence | `VERIFIED`, `ACTIVE`, current official-site evidence |
| Database size profile | Medium; SME relevance `HIGH`; not strategic | Medium; SME relevance `HIGH`; not strategic |
| Product-category overlap | Womenswear category confirmed; category score 77 | Womenswear category confirmed; category score 87 |
| Public business role | Official site presents the company as an apparel manufacturer and supplier serving retailers and bulk buyers | Official site presents the company as a manufacturer, wholesaler and exporter serving retailers and boutiques |
| Active external purchasing intent | Not established; not required | Not established; not required |
| Official email observed | Yes — `i***@alanic.clothing`; official-domain generic mailbox | Yes — `c***@rizqe.co` and `i***@rizqe.co`; official-domain generic mailboxes |
| Current email verification | Hunter `VALID` | Hunter `i***@rizqe.co` `VALID`; `c***@rizqe.co` `INVALID` and suppressed |
| Named buyer route | None | None |
| Send-ready recipient row | 0 | 1 |
| Current management approval | None | Approved, `dpv-workspace` |
| Current approved draft | None | English womenswear and Yiwu general-merchandise introduction approved and sent |
| Active suppression | None | Invalid `c***` address only |
| Pilot decision | Alternative; not selected | One SMTP acceptance; awaiting recipient outcome |

## Official-source review

### Alanic Clothing

- Official company description: <https://www.alanic.clothing/about/>
- Official distributor programme: <https://www.alanic.clothing/become-a-distributor/>
- Official contact page: <https://www.alanic.clothing/contact/>

The official pages describe Alanic as a manufacturer and supplier offering bulk apparel to retailers, business owners and distributors. The distributor programme asks other businesses to purchase Alanic products in bulk. This supports seller/supplier status, but does not establish that Alanic is currently sourcing the company’s garment categories from an external supplier.

### Rizqé

- Official company description: <https://rizqe.co/pages/about-us>
- Official contact page: <https://rizqe.co/pages/contact>
- Official FAQ: <https://rizqe.co/pages/faq>

The official pages describe Rizqé as a UAE-based fashion manufacturer, wholesaler and exporter with production in India. Its catalogue has strong womenswear overlap and its stated small-MOQ offer is relevant to an SME strategy. However, these pages present Rizqé as a supplier to boutiques and retailers; they do not establish an active external garment-purchasing need.

## Why Rizqé is selected

The current category-level business opportunity is sufficient for an exploratory introduction. Rizqé is the closer match to the preferred SME profile and has one official mailbox verified VALID by Hunter on 2026-09-07 at 10:41:13 +08. The other official address was INVALID at 10:41:18 +08 and is excluded. Address suppression does not block other valid addresses at the same company.

The introduction may describe a womenswear cooperation possibility but must not assert that the recipient is currently procuring garments. Exact SKU correspondence is not required.

Initial preparation found no marketing context. The factual English context `oq11-rizqe-category-introduction-20260907-v1` has now been created and approved by `dpv-workspace` under the user's express authorization. The exact introductory draft has been submitted and approved. It contains no prices, delivery promises, certifications, SKU claims or automatic follow-ups, and includes a reply-to-unsubscribe instruction.

## Gates completed for OQ11

- Use the current recommended womenswear category opportunity for Rizqé.
- Preserve manufacturer/supplier positioning as a fact; do not require separate procurement intent.
- Use only the official-domain mailbox verified as `VALID`; domain observation alone is insufficient.
- Recalculate the current Opportunity and outreach eligibility snapshot from those facts.
- Complete exact management and draft approval for that single recipient.
- Add only the approved recipient to the Git-ignored pilot allowlist and retain the one-message cap.

## Historical preparation baseline

This section records preparation only, not the later pilot execution. Company ID: `8b19d2b9-e7a7-4bd0-a57b-0f8a5f7da9db`; selected contact ID: `de2f85b3-3d62-48fc-b9db-08c7abebf70b`. Homepage source ID: `1c4a39d3-3121-4d3e-8af8-a622db3a9c81`; contact source ID: `44016f9d-6b28-4422-93c1-3ce894af849e`.

Integration correction: database domain keys such as `live:ae:rizqe.co` now have their known discovery prefix removed only for exact official-email domain comparison. Source facts are preserved. Fresh valid routes are selected without a named-buyer role requirement; an invalid address is suppressed individually.

- Candidate records reviewed: 2
- Pilot candidates approved: 1
- Recipient allowlist changes: 0
- Management approvals created: 1
- Drafts created or approved: 1
- SMTP messages sent: 0

Historical preparation IDs: context `2b36f907-1194-4d80-8213-c459e715f332`; recipient `fc5ff893-9faa-47ff-90ad-fe2b87529fd1`; initial draft `d3c897f1-2347-4c95-ade4-8e9ae1bfdb40`; initial approval `f073ec4b-de85-4d5e-987a-1feb450c3e46`. These are retained history, not the final sent draft.

The first context approval exposed a pre-existing shared PostgreSQL trigger that referenced fields from the other record type. Additive migration `056_phase11_version_payload_guard_rowtype.sql` repairs that field projection while retaining every original immutable field. Applied checksum: `2812ea9cbffc8b1f502764c16043a987d74ac99b0461ad94da4d945c1fbf54dd`. Migration baseline and result: 129 companies, 32 opportunity projections, 0 outbound messages, 1 context and 0 context approvals. The later context approval and draft are normal application actions. Temporary PostgreSQL regression tables proved status updates succeed and payload edits fail for both guarded table types; those fixtures were rolled back.

## Final persisted execution

The user requested the introduction include womenswear and Yiwu general merchandise. The application draft was revised and approved as an exact new version before the single send.

- Final draft: `b7fd7217-cfc4-432c-beb8-ede863bb2244`.
- Final approval: `e3eebd62-2f66-44ae-9849-7ee470f06c3d`.
- Outbound message: `04602fd0-5247-4c94-a8e4-54d14cbcb315`.
- SMTP accepted: `2026-09-07T03:20:44.545538Z`, code `ACCEPTED_BY_SMTP`.
- Attempt records: 2. The first was blocked with no provider call; the second was accepted. Actual prospect SMTP calls: 1.
- Total draft versions: 3; older drafts are retained history.
- Delivery and prospect reply: unconfirmed. Phase 11 final acceptance remains incomplete.

Afterward the send scope, outreach switch and live-prospect approval were closed. SMTP configuration and IMAP polling remain available. No other prospect was sent. See [PHASE11_OQ09_OQ11_RESULT.md](PHASE11_OQ09_OQ11_RESULT.md).
