# Acceptance cases

Validate these behaviors with synthetic fixtures:

- Every personalization statement resolves to evidence in the eligibility snapshot.
- Every recommended product resolves to an allowed `product_master.id`.
- Every claim resolves to an active approved claim for the market/profile.
- Unexpected or restricted input fields are rejected before they reach draft generation.
- Price, MOQ, certification, lead-time, payment, internal cost/order/path, and fabricated thread prefixes are rejected when unsupported.
- AE uses English and MX uses Spanish.
- The output is plain text with one low-commitment CTA.
- The result is `PENDING_REVIEW` or `INVALID_DRAFT`; it is never self-approved or sent.
- Prospecting or RevOps inputs cannot alter DPV qualification facts.
- Raw-body webhook verification is required before inbound events or sales tasks are normalized.
