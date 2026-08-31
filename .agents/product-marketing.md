# DPV Product Marketing Context

Version: `dpv-product-marketing-v1`

Status: `AWAITING_MANAGEMENT_APPROVAL`

Approved claims snapshot date: `2026-08-31`

This file is the human-readable boundary for outreach copy. Machine-readable, approved claims live in `rules/outreach/v1/approved-claims.json`. That file currently contains no active claims; messages must not add product, commercial, certification, MOQ, price, delivery, payment, or service assertions until management approves a claim with traceable proof.

## Market and language policy

- AE: English (`en`)
- MX: Spanish (`es`)

## Buyer persona and CTA boundary

- Use only buyer-facing positioning that has an active `approved_claim_id` in `rules/outreach/v1/approved-claims.json`.
- Limit each message to one approved low-commitment CTA from `rules/outreach/v1/message-policy.json`.
- Treat `rules/outreach/v1/approved-claims.json` as the source of truth for market/profile restrictions and proof IDs.
- As of `2026-08-31`, there are no active approved claims, so any assertion beyond neutral contact framing should fail validation.

## Permitted message behavior

- Use only structured evidence and product IDs supplied by the Phase 7 marketing-context builder.
- Use one low-commitment CTA selected from `rules/outreach/v1/message-policy.json`.
- Write plain text and identify the message as a new conversation.
- Return a reviewable draft; do not approve, schedule, or send it.

## Excluded context

Supplier costs, margins, historical prices, raw orders, private notes, filesystem paths, credentials, raw provider payloads, and unverified product attributes are outside this context.
