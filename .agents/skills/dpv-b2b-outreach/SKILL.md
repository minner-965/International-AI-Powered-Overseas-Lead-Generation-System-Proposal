---
name: dpv-b2b-outreach
description: Produce evidence-bound, versioned B2B outreach draft JSON for DPV sales review. Use only after Phase 7 eligibility inputs and approved marketing claims are available; this skill does not approve or send messages.
---

# DPV B2B Outreach

Generate an `OutreachDraftOutput` from an allowlisted `OutreachDraftInput` and the approved DPV marketing context.

Use this skill only for versioned draft generation and reply-draft preparation. It does not decide qualification, create approvals, schedule sends, or call any provider.

## Workflow

1. Read [the domain contract](references/dpv-domain-contract.md) and treat every listed Phase 5/6/6.1 fact as immutable.
2. Project inputs using [the allowlist](references/input-field-allowlist.md). Reject unexpected or restricted fields instead of trying to reinterpret them.
3. Resolve every sales assertion through [the approved claims contract](references/approved-claims-contract.md).
4. Write one plain-text initial message or follow-up in the market language. Use exactly one allowed CTA and no fabricated thread prefixes.
5. Return only [the draft schema](references/draft-output-schema.md). Set no approval, scheduling, or send status.
6. Apply [the provider policy](references/provider-policy.md) only as a warning; provider selection, exact-version approval, suppression checks, and sending remain application responsibilities.

For reply drafting, first read [reply intents](references/reply-intents.md). For spreadsheet exchange work, read [the Excel contracts](references/excel-data-contracts.md). Use [acceptance cases](references/acceptance-cases.md) when validating a change to this skill.

Stop with `INVALID_DRAFT` when a claim, evidence reference, product ID, CTA, recipient/profile match, input digest, or language rule cannot be resolved exactly.
