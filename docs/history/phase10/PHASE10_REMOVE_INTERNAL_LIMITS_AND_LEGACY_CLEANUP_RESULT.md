# Phase 10 Remove Internal Limits and Legacy Cleanup Result

```text
FINAL_STATUS: PASS

internal daily cap: ABSENT
internal per-run cap: ABSENT
internal per-job cap: ABSENT
internal purpose-pool cap: ABSENT
internal company/profile cap: ABSENT
fixed 10-attempt cap: ABSENT
7-day cooldown: ABSENT

provider account usage gate: PASS
429 handling: PASS
credit exhausted create-job block: PASS
capacity recovery: PASS

ensureResearchJob canonical continuation reuse: PASS
4 task links repaired: 4/4 canonical; 0 current mutations required
3 former internally paused tasks handled: 3/3 already recovered; 0 current pauses
historical stop reason changes: 0
strategy attempt repair delta: 0
repair-time provider calls: 0
email side-effect delta: 0

dead files removed: 4
dead functions removed: internal budget enforcement/reservation/reset and duplicate dispatch/counter paths
dead rules removed: daily/run/job/purpose/company-profile caps, numeric max-attempt and cooldown gates
dead UI removed: internal budget remaining/reset/pause controls and misleading bounded-network wording
retained historical migrations: 001-047
retained audit tables: provider_usage_events, provider_account_state_events, historical continuation/stage/decision ledgers

full tests: 708 total; 657 PASS; 0 FAIL; 51 environment-scoped skips
isolated PostgreSQL: provider-only 20/20; purge 20/20; capacity 3/3; 0 skipped
migration apply/replay: 047 APPLIED / SKIPPED_ALREADY_APPLIED; full 001-047 rebuild PASS
real pre-email canary: PASS
Git implementation snapshot: 5956dfe4ce2fa1d6eb233b6f352c7bbabf684550
remote verified: PASS
tag: phase10-pre-email-automation-no-internal-tavily-limits
```

## Real automation result

The browser-created positive canary `84aba78b-f830-4fca-b4c6-9066bc3dce19` completed company discovery with five candidates, five crawled sites, four verified companies and zero errors. It automatically created category job `5cd96d98-e672-4b9d-a6d3-0a5720b0b2af`, which completed with 87 sources, 97 observations, four buyer-model classifications and zero errors.

The terminal category event refreshed current decisions before auto-evidence scheduling. Two new evidence tasks were created and the live n8n reconciliation advanced both from `S01_OFFICIAL_CATEGORY` to `S02_OFFICIAL_ASSORTMENT`. A separate one-result reverse canary completed correctly with no qualified company and created no artificial downstream work.

The diagnostic canary exposed and drove repair of two real defects: missing product-scope propagation into Customer Match and decision refresh occurring after the scheduling opportunity. Both fixes have regression coverage. The original job resumed from its preserved checkpoint and completed without another discovery pass.

## Current policy and retained safeguards

The old bounded Tavily budget policy is superseded. Research volume is governed only by Tavily's actual account credits, Provider rate limit and service/configuration state. HTTP 429 is handled as a rate-limit retry with `Retry-After`; it is not treated as credit exhaustion. Confirmed account credit exhaustion closes the new ResearchJob gate until Provider capacity recovers.

The following remain active: Provider usage audit, exact query fingerprint deduplication, transactional dispatch outbox, pg-boss singleton identity, bounded technical concurrency, leases, worker recovery, checkpoint replay, canonical continuation reuse, immutable historical reasons and management/email gates.

## Verification boundary

- Full local functional suite: 657 passed, 0 failed; 51 PostgreSQL-environment tests are separately executed and passed in the recorded WP-U12 matrices.
- Current project status validator: PASS.
- Real dashboard and Opportunities UI inspection: PASS.
- Dashboard, workers and PostgreSQL: healthy.
- `npm run lint` and `npm run build`: no such repository scripts; Docker image build passed.
- Dependency audit: the WP-U12 zero-vulnerability result is retained. A repeat registry audit in U14 did not return before the command timeout and made no dependency or lockfile change.
- All outbound email and CRM side-effect tables remained at zero.

The only remaining Phase 10 acceptance boundary is controlled Gmail configuration and domain authentication. It is independent of the completed provider-only research release.
