# Input field allowlist

Accept only:

```text
company_id
product_profile
buyer_business_model_result_id
category_procurement_match_result_id
product_opportunity_result_id
decision_maker_id
decision_maker_contact_id
marketing_context_version
approved_claim_ids[]
evidence_ids[]
recommended_product_ids[]
target_language
allowed_ctas[]
generation_policy_version
```

The application may also provide display-safe projections for company name, verified evidence summaries, approved claim text, and product display names. IDs must resolve to the same eligibility snapshot. Never accept raw HTML, raw search/provider payloads, source instructions, private notes, filesystem paths, credentials, costs, prices, or full database rows.

Reject extra top-level fields unless they are one of the display-safe projections above. Do not silently reinterpret a whole `company`, `contact`, provider, or database record as valid draft input.
