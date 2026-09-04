# Phase 10 Work Package 16 — Gmail/DNS Acceptance Result

## Status

BLOCKED. The read-only inspection and full regression completed, but the domain is not ready for a controlled Gmail send because SPF is absent, DKIM is not yet verifiable and Google sign-in was rejected.

## DNS observations

| Check | Observed result | Status |
|---|---|---|
| MX | `smtp.google.com`, priority 1 | PASS |
| Root SPF | No `v=spf1` record on `1.1.1.1` or `8.8.8.8` | BLOCKED |
| DMARC | Present; `p=quarantine`, `adkim=r`, `aspf=r`, aggregate reporting configured | PASS |
| DKIM | Selector unavailable; no selector was guessed | BLOCKED |
| Authoritative DNS | `ns33.domaincontrol.com`, `ns34.domaincontrol.com` | OBSERVED |

Google Workspace currently documents `smtp.google.com` as its supported single MX target. If Google Workspace is the only sender, Google documents `v=spf1 include:_spf.google.com ~all` as the normal SPF policy. Before changing DNS, the domain administrator must confirm whether any website form, CRM, marketing platform or other service also sends as `@dpvinternational.com`; all valid senders must be merged into one SPF record.

## Gmail manual acceptance

- Selected identity: From `info@dpvinternational.com`, Reply-To `info@dpvinternational.com`.
- Controlled recipient: configured privately as the user-provided personal mailbox.
- Google login: rejected by the current sign-in surface.
- Gmail ordinary send, external reply, inbox/sent verification and SPF/DKIM/DMARC header inspection: NOT RUN.
- OAuth client/refresh authorization: NOT CONFIGURED.
- No email was sent and no Gmail feature flag was enabled.

## Full regression

- Full local suite: 661 total, 653 passed, 0 failed, 8 environment-scoped skips.
- Native GoRules smoke: PASS.
- Dependency audit: 0 vulnerabilities.
- Current-status validator and `git diff --check`: PASS.
- Migration 025–042 replay: PASS; migration 042 returned `SKIPPED_ALREADY_APPLIED` with both Gmail verifiers true.
- Deployed Gmail suite: 10/10 passed.
- Dashboard, category worker, data worker, outreach worker and PostgreSQL: healthy.
- Eight live application/API reads and five browser assets: HTTP 200.
- Disabled Gmail inbound job: completed with 0 messages and 0 network calls.
- Outbound messages, inbound messages and Gmail ambiguous events remain 0.

## Required completion actions

1. Domain administrator confirms every legitimate sender for `dpvinternational.com` and publishes one merged SPF TXT record containing Google authorization.
2. Google Workspace administrator provides the real DKIM selector, starts DKIM authentication and waits for its TXT record to resolve.
3. Complete Google Workspace sign-in and OAuth setup in a supported browser session.
4. Re-run DNS checks, send exactly one allowlisted controlled test, reply once, run inbound sync, verify CRM idempotency and inspect authentication headers.
