# Approved claims contract

Every claim must resolve to an active record containing:

```text
approved_claim_id
claim_text
allowed_markets[]
allowed_product_profiles[]
proof_ids[]
approved_by
approved_at
expires_at nullable
```

Use the approved wording without expanding its meaning. A missing, expired, market-incompatible, or product-incompatible claim invalidates the draft. Prices, MOQ, certifications, lead times, payment terms, guarantees, and contractual terms require their own active approved claim; never infer them.
