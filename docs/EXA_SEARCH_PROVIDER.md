# Exa search provider

## Configuration

The local `.env` supplies `EXA_API_KEY`; do not copy its value into documentation or Git. Runtime configuration uses `EXA_ENABLED=true`, `SEARCH_PROVIDER=exa`, optional `EXA_SEARCH_ENDPOINT` (default `https://api.exa.ai/search`) or `EXA_BASE_URL`, and `EXA_CAPACITY_RETRY_HOURS` (default 24). The persisted research control's `provider_order` is the worker spending allowlist. Existing authorized order is retained by this adapter work. Environment selection and persisted worker selection must be checked together.

The adapter reuses the existing native fetch, ResearchJob, frozen plan, provider usage ledger and durable query response. No SDK or new production dependency is introduced. [Official search API](https://exa.ai/docs/reference/search-api-guide-for-coding-agents).

## Request and evidence contract

POST `/search` uses the `x-api-key` header, `type:auto`, integer `numResults` bounded to 1–20, and an ISO two-letter `userLocation` when present. It requests `contents.highlights.maxCharacters=2000` and maps those excerpts into the existing snippet field. A returned page-text fallback is retained; generated summaries are not substituted for source evidence. Query text remains the frozen business query. Market location is a search hint, not proof of company location.

## Failure and billing behavior

- Network failure, timeout and HTTP 5xx make one attempt and require review; the adapter does not repeat a potentially billed ambiguous request.
- HTTP 429 may retry within the existing maximum of three attempts; waits longer than ten seconds are returned for later handling. Every attempt emits STARTED/FINISHED ledger callbacks.
- Authentication and payment errors pause through the existing state/execution handling. Remote error bodies and transport causes are not copied into user-facing errors.
- `credits=1` means request count, not provider balance or USD. Actual `costDollars.total` is retained when returned; an absent/invalid monetary value is `null`, not zero.
- Durable response recovery restores the monetary cost to the ledger. Successful ledger replay returns saved results/cost without a new search.
- Historical request fingerprints remain unchanged, including the existing Exa version-2 identity; this repair does not rebill old results by changing fingerprints.

## Account-state interpretation

`AVAILABLE` means configured and not blocked by the most recent persisted provider outcome; it is not a verified balance. `capacity_verified=false` and `remaining_credits=null` explicitly convey that distinction. `credential_verified=true` requires a persisted successful outcome. Without one, `state_source=LOCAL_CONFIGURATION_ONLY`. Database history read failures propagate instead of being treated as a healthy account. No balance endpoint is fabricated.

## Verification status

2026-09-13 offline implementation checks: 11 Exa-specific tests plus seven existing Brave audit regressions passed (18 PASS, zero FAIL). Cases cover request shape/excerpts, integer count, rejected configuration, malformed response, ambiguity single-attempt behavior, safe errors, rate-limit attempts, cost/replay, restart account state and durable-cost mapping. The recovery mapping assertion is a source contract test, not a full PostgreSQL Exa E2E.

The implementation workstream made no live calls. The coordinating task subsequently executed the following bounded credential/adapter check; this is distinct from an automatic ResearchBatch run.

### Actual live verification — 2026-09-13

- One request, three results, zero retries; request ID `d583e963034ad5ae252aab00d6d1dc3d`.
- Provider-reported cost: USD 0.007. This is the request's actual cost, not an account-balance estimate.
- Returned sources: [Wholesale Clothing UAE](https://wholesale-clothing.ae/wholesale-women-clothing-uae/), [Rizqé](https://rizqe.co/), [Fithub Fashion](https://fithubfashion.com/pages/wholesale-womens-clothing-dubai). Nonempty excerpts: 1,072 / 1,900 / 1,964 characters.
- Query: women clothing wholesaler importer Dubai UAE dresses womenswear; market hint AE; result limit 3.
- `scripts/exa-bounded-smoke.mjs` records the pre-request marker and result in ignored `artifacts/exa-configuration-verification/result.json`. A second invocation refuses to repeat the request while that record exists.
- No production ResearchJob or company was created by this configuration probe; no database write, SMTP call or backlog resume occurred. Search-result relevance does not establish buyer qualification or contact deliverability.
- Existing worker research order remains Exa then Tavily. Full automatic execution remains paused pending separate budget/release conditions; a successful credential test is not full pipeline acceptance.

### Local deployment

`compose.readonly-recovery.yaml` loads the ignored `.env.exa-runtime` credential copy and exposes the verified application on loopback port 3000 with mutation/producer execution paused. The original local Exa repair files remain present and ignored, not deleted. The normal configuration remains available for a subsequently approved full restoration.
