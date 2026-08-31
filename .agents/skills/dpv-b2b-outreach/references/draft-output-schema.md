# Draft output schema

Return one JSON object:

```json
{
  "language": "en",
  "subject": "",
  "body_text": "",
  "followups": [],
  "personalization_reason": "",
  "personalization_statements": [],
  "used_evidence_ids": [],
  "recommended_product_ids": [],
  "approved_claim_ids": [],
  "template_version": "",
  "skill_versions": {"dpv-b2b-outreach": "v1"},
  "generation_version": "dpv-b2b-outreach-v1",
  "input_digest": "",
  "policy_warnings": []
}
```

Each `personalization_statements[]` item has `text` and one or more `evidence_ids`. Do not use `Re:`, `Fwd:`, HTML, attachments, a fabricated relationship, or more than one CTA. A valid draft enters `PENDING_REVIEW`, never `APPROVED`.

`input_digest` must match the exact allowlisted marketing-context projection used for generation. Any edit to content, evidence, products, CTA, language, sender identity, or recipient requires a new approval version outside this skill.
