# DPV Phase 10 Current Master Handoff

Generated: 2026-09-03

## Package boundary

This package contains the current DPV overseas lead-generation system source, database migrations 000–042, workflows, tests, configuration examples and implementation reports through the WP16 inspection.

It excludes Git internals, installed dependencies, runtime data, exports, staging files and all real `.env` files. OAuth credentials, passwords, API keys and refresh tokens are not included.

## Current outcome

- Phase 1–9: complete.
- Phase 10 WP00–WP14: complete.
- WP15 Gmail API Provider implementation: complete and deployed with all outbound flags closed.
- WP15 controlled-address send/reply/CRM E2E: pending Gmail OAuth and domain authentication readiness.
- WP16 read-only DNS inspection: completed, but acceptance is blocked by missing SPF, unverified DKIM and rejected Google sign-in.
- Phase 10 final acceptance: incomplete.
- Business-result status: NO. No result has been fabricated from test data.

## Source baseline

| Item | Current value |
|---|---|
| Source root | `D:\codex\International-AI-Powered-Overseas-Lead-Generation-System-Proposal` |
| Branch | `phase10-recovery-rc1` |
| Current HEAD | `54ce996345c41777c9c5e0d50e6ed170aa66723d` |
| Latest released phase | Phase 9 |
| Active phase | Phase 10 |
| Latest migration | `042_phase10_gmail_api_provider.sql` |

The current Phase 10 implementation remains in a dirty working tree after the WP03 implementation snapshot. No later package has been represented as a Git commit or remote release.

## Work Package summary

| WP | Result | Delivered boundary |
|---:|---|---|
| 00 | PASS | Confirmed the Codex and Claude roots without exposing credentials. |
| 01 | PASS | Created recoverable Git backup material before reconciliation. |
| 02 | PASS | Produced secret/runtime-excluded SHA-256 manifests and compared only the six permitted environment keys. Codex values were selected where the user directed. |
| 03 | PASS | Classified the Phase 10 working tree, installed/verified Node.js tooling, ran the required tests and created the implementation snapshot commit. |
| 04 | PASS | Repaired and revalidated deployment/automation foundations. Automatic evidence operation was later enabled at the user's direction. |
| 05 | PASS | Completed the next orchestration and reconciliation implementation boundary and revalidated it. |
| 06 | PASS | Added trustworthy orchestrator heartbeat, workflow activity and queued-state diagnostics. |
| 07 | PASS | Added a transactional ResearchJob dispatch outbox and direct pg-boss execution path while retaining n8n compatibility. |
| 08 | PASS | Made `provider_usage_events` the canonical provider-call and usage projection for API/UI/export. |
| 09 | PASS | Added ten distinct evidence strategies and separated business, provider and worker retry counters. |
| 10 | PASS | Added bounded Tavily budgets and priority-first round-robin fairness. |
| 11 | PASS | Expanded and validated the verified-company pool without fabricating company or Buyer evidence. |
| 12 | PASS | Added append-only Commercial Product Fit with independent score and evidence coverage. Missing price/specification/MOQ facts are ignored until a prospect shows interest. |
| 13 | PASS | Added an append-only manual official-route queue. Official company email, business phone or public WhatsApp can support an opportunity even without a named person. |
| 14 | PASS | Added GoRules native-module smoke testing, clean-install CI and deployed positive/negative validation. |
| 15 | IMPLEMENTATION PASS | Added the gated Gmail API/OAuth provider, stable message identity, database idempotency, ambiguous-send reconciliation, polling and structured inbound handling. Real E2E remains pending. |
| 16 | BLOCKED | MX and DMARC were observed; SPF is absent, DKIM is not verified and Google sign-in was rejected. No DNS change or email send occurred. |
| A04.2 | PASS | Removed all application-enforced Research/Tavily quantity budgets, added Provider account state, repaired continuation replay ownership and completed real positive/reverse validation. |

## Current application capability

### Research and qualification

- A user can create a ResearchJob from the Research workspace.
- The system can discover new companies through the configured search provider.
- Company identity, official website, market, business type, scale evidence and public contact routes are normalized and stored with evidence lineage.
- Category procurement, Buyer business model, product-category opportunity and cooperation feasibility are calculated independently.
- A company may become `RECOMMENDED` through a verified named Buyer or through a verified official company email, business phone or public WhatsApp when the other opportunity gates pass.
- Missing product price, specification, MOQ or order-format facts do not create an enrichment task and do not block a company opportunity.

### Automatic evidence

- Automatic evidence scheduling is enabled in the current deployed runtime.
- Direct pg-boss ResearchJob dispatch is enabled; n8n remains available for the configured workflows.
- Ten evidence strategies are versioned and deduplicated by query fingerprint.
- Provider retries and stale-worker recovery do not consume additional business strategy attempts.
- Tavily usage is audited without application-enforced daily, per-run, per-job, purpose-pool, company/profile or global quantity budgets. Only confirmed provider-account credit exhaustion blocks creation; 429 waits and retries.
- Hunter runs only when its exact named-Buyer/email gate applies.

### Scoring and customer fit

- Product Category Score remains the opportunity hard score.
- Commercial Product Fit is a separate non-blocking ranking with score plus data coverage.
- Customer Match remains separate from DPV Lead Score.
- Management Baseline ICP is available now.
- Historical Customer ICP requires real customer/order imports and is not synthesized when data is absent.

### Contact and official routes

- Contact Queue accepts named buyers and verified official company routes.
- Generic company email, phone, WhatsApp and contact forms are not presented as a verified named Buyer.
- Official supplier/vendor/procurement routes have append-only task history.
- Contact route availability does not grant management approval or send permission.

### Gmail Provider

- Provider: Gmail API with OAuth 2.0 user authorization.
- Selected controlled identity: From `info@dpvinternational.com`; Reply-To `info@dpvinternational.com`.
- A user-controlled personal mailbox is configured privately as the controlled recipient.
- OAuth client ID, client secret and refresh token are absent.
- `OUTBOUND_EMAIL_PROVIDER`, Gmail send, inbound polling, outreach and live prospect flags remain closed.
- Gmail acceptance maps to `PROVIDER_ACCEPTED / ACCEPTED_BY_GMAIL`, not `DELIVERED`.
- Stable RFC `Message-ID` and database execution keys prevent ordinary duplicate sends.
- Ambiguous timeouts enter Sent-mailbox reconciliation instead of direct resend.
- Automatic replies cannot become positive replies.
- Bounce processing requires a structured DSN with recipient and enhanced status code.
- Explicit opt-out and confirmed hard bounce reuse the append-only suppression flow.

## Database migrations

Migrations 000–042 are retained. Phase 10 additions are:

| Migration | Purpose |
|---|---|
| 030 | Approved category scope and automatic evidence lifecycle |
| 031 | Controlled evidence audit hardening |
| 032 | Category-level opportunity without exact SKU dependency |
| 033 | Orchestrator heartbeat and dispatch diagnostics |
| 034 | Transactional ResearchJob direct-queue outbox |
| 035 | Canonical provider-usage projection |
| 036 | Provider-usage export contract |
| 037 | Versioned evidence strategy attempts |
| 038 | Checkpoint replay without false strategy consumption |
| 039 | Tavily fair-budget accounting |
| 040 | Commercial Product Fit |
| 041 | Manual official-route queue |
| 042 | Gmail API provider, checkpoints and ambiguous-send audit |
| 043 | Immutable budget-resume continuation lineage and outbox |
| 044 | Provider-account-only Tavily ledger policy |
| 045 | Provider account state and append-only state transition audit |

Migrations 042–045 were applied to the live PostgreSQL database and replayed successfully as `SKIPPED_ALREADY_APPLIED`.

## Current real-data snapshot

| Record | Count |
|---|---:|
| Companies | 108 |
| Sources | 215 |
| Contacts | 61 |
| Lead reviews | 93 |
| Collection runs | 13 |
| Research jobs | 120 |
| Current opportunities | 14 |
| Evidence Required | 11 |
| Not Suitable | 2 |
| Recommended | 1 |
| Management Approved | 0 |
| Decision makers | 12 |
| Decision-maker contacts | 82 |
| Company contact routes | 55 |
| Auto-evidence tasks | 23 |
| Provider-usage events | 89 |
| Commercial-fit results | 26 |
| Active official-route tasks | 44 |
| Outreach drafts | 0 |
| Outbound messages | 0 |
| Inbound messages | 0 |
| CRM outbox | 0 |

These are factual database counts at the last status snapshot. The single `RECOMMENDED` record is not management-approved and has not been emailed.

## Verification result

| Verification | Result |
|---|---|
| Full local suite | 681 total; 666 passed; 0 failed; 15 environment-scoped skips |
| Isolated continuation PostgreSQL | 7/7 passed |
| Provider-only 100-task stub queue | 100 accepted; 0 local quota rejection |
| Real Research canary | COMPLETED; 5 audited Tavily units; no local budget pause |
| Continuation recovery | 4 old paused tasks recovered; 0 old stop-reason mutation |
| Worker restart | 0 duplicate Provider request fingerprints |
| WP15 Gmail tests | 10/10 passed locally and in the deployed image |
| GoRules native smoke | PASS |
| Dependency audit | 0 vulnerabilities |
| Current-status validator | PASS |
| Git whitespace validation | PASS |
| Migration 025–042 replay | PASS |
| Dashboard/API reads | PASS after correcting the probe URLs to the actual frontend routes |
| Static application assets | HTTP 200 |
| Dashboard, workers and PostgreSQL | Healthy |
| Disabled Gmail inbound job | Completed with 0 messages and 0 network calls |
| Gmail business tables | 0 outbound, 0 inbound, 0 ambiguous-send events |

The in-app browser-control runtime did not initialize, so no artificial manual visual-pass claim was recorded. Existing UI contract tests pass and the deployed HTML, JavaScript and CSS assets return HTTP 200.

## WP16 DNS inspection

| Check | Observed result | Status |
|---|---|---|
| MX | `smtp.google.com`, priority 1 | PASS |
| SPF | No `v=spf1` record through Cloudflare or Google public DNS | BLOCKED |
| DMARC | Present with `p=quarantine`, relaxed alignment and aggregate reporting | PASS |
| DKIM | Google Admin selector not supplied; no selector guessed | BLOCKED |
| DNS host | GoDaddy nameservers `ns33.domaincontrol.com` and `ns34.domaincontrol.com` | OBSERVED |
| Google sign-in | Rejected in the current embedded sign-in surface | BLOCKED |

Before publishing SPF, management must identify every legitimate system that sends as `@dpvinternational.com`. If Google Workspace is the only sender, Google's documented baseline is `v=spf1 include:_spf.google.com ~all`. If other systems send mail, their authorization must be merged into the same SPF record rather than creating a second SPF record.

## Remaining work

1. Sign in to Google Workspace Admin and Google Cloud Console through a supported browser session.
2. Confirm the selected sender is a real Workspace user or permitted send-as alias and that replies are monitored.
3. Obtain the actual DKIM selector from Google Admin, publish its TXT record through the DNS host and start authentication.
4. Publish one correct SPF record after confirming all legitimate senders.
5. Create the Gmail OAuth client and store the client ID, client secret and refresh token only in the ignored deployment environment file.
6. Re-run DNS and OAuth health checks.
7. Enable only the controlled-test flags and send exactly one allowlisted test message.
8. Confirm receipt, send one reply, run Gmail inbound sync and verify one-time CRM processing.
9. Restore all send flags to false immediately after the controlled test.
10. Keep prospect sending closed until a current opportunity has exact management approval and every independent send gate passes.

## Primary detailed reports

- `docs/CURRENT_PROJECT_STATUS.md`
- `docs/PHASE10_WP12_COMMERCIAL_PRODUCT_FIT_RESULT.md`
- `docs/PHASE10_WP13_MANUAL_OFFICIAL_ROUTE_RESULT.md`
- `docs/PHASE10_WP14_NATIVE_DEPENDENCY_HEALTH_RESULT.md`
- `docs/PHASE10_WP15_GMAIL_API_PROVIDER_RESULT.md`
- `docs/PHASE10_WP16_GMAIL_DNS_ACCEPTANCE_RESULT.md`
- `docs/VERSION_CHANGELOG.md`

## Security boundary

- No password, API key, OAuth secret or refresh token is included in this document.
- Real `.env` files remain ignored by Git.
- No Gmail message has been sent.
- No DNS record has been changed.
- No test recipient is counted as a prospect or business result.
