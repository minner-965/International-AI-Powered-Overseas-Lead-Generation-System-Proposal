# DPV Phase 10.1 — Category and Contact Simplification Result

Status: **PASS**

Completed: 2026-09-04 (Asia/Shanghai)

Scope: WP-B00 through WP-B11

## Accepted business flow

The active flow is:

`Product file → approved target category → discover companies → confirm company category → collect named or company-level public contact routes → create/update Opportunity → terminal state`

- Procurement pages, buying announcements, supplier portals, supplier-access scores, exact SKUs, and a populated `product_profile` are not active gates.
- A named decision maker is preferred, but a public company email, phone, WhatsApp number, or ordinary contact page is sufficient contact evidence.
- Confirmed category plus a company route yields `RECOMMENDED`; confirmed category without a route yields `EVIDENCE_REQUIRED / CONTACT_ROUTE_REQUIRED`; unconfirmed category yields `CATEGORY_CONFIRMATION_REQUIRED`.
- Historical values remain readable through compatibility projection and were not rewritten.

## Database and compatibility

- Migrations 001–048 were left unchanged.
- Migration 049 adds company-level contact identity/projection and retires new writes to the legacy manual-route queue.
- Migration 050 adds the new category status values and a canonical company-route uniqueness key.
- Apply and replay verification passed; both new migrations replay as `SKIPPED_ALREADY_APPLIED` with checksum verification.
- Current company contact routes: 83; duplicate canonical route groups: 0.
- New `CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE` rows since migration 049: 0.
- Active PRODUCT/SUPPLIER/PROCUREMENT blockers: 0.

## Real UI canary

- ResearchJob: `9a97cff3-712c-416e-9b0b-de2a056ca172`.
- UI input: Mexico / General Merchandise / maximum 5 / no product profile.
- Manual stage intervention: none.
- Discovery: 5 candidates and 3 verified/promoted companies.
- Category: 3 results; 1 `CATEGORY_MATCH_CONFIRMED` and 2 `CATEGORY_CONFIRMATION_REQUIRED`.
- Contact: 12 company-level public routes across the promoted set.
- Opportunity: 1 new `EVIDENCE_REQUIRED` result. The category-confirmed company had no qualifying contact route after all seven contact strategies were exhausted, so this is an accepted terminal business result.
- Provider units: 6 for root discovery and 18 across the complete lineage.
- Stale dispatch pending: 0. Email and CRM deltas: 0.

## Verification

- Functional regression before documentation finalization: 775 tests, 722 passed, 52 conditionally skipped; the sole pending check was the deliberately stale current-status snapshot owned by WP-B11.
- Browser checks passed for Company Category Evidence detail, one-row-per-company Contact-ready Companies, Opportunity official-channel display, absence of Start review, and absence of Dispatch Pending on terminal business state.
- Opportunity `ALL` now contains only decision-backed records, so its total is consistent with the five status buckets and category matches awaiting a decision are not mislabelled as opportunities.
- Final clean-tree suite: 776 tests, 724 passed, 52 conditionally skipped, 0 failed.
- Current-project status verifier: PASS.
