# MC06 Query Matrix Result

Status: PASS — scoped planning, isolated persistence and browser acceptance. Authority: `DPV_PHASE13_MC06_QUERY_MATRIX_DOMAIN_POLICY_CORROBORATION_CODEX_EXECUTION.md` supplied 2026-09-08. Scope: MC06 only.

## Checkpoint and execution plan

Accepted MC05 preserved in local commit `cf559d6db0b7b4baa68cc41af54a246b3fba97e0`, including 30 implementation/documentation files. No reset, clean, restore or discard. No push/tag.

1. Preserve accepted checkpoint and read-only database fingerprints.
2. Implement pure versioned query/lane/domain modules and frozen plan persistence.
3. Extend existing candidate provenance for replay-safe discovery corroboration, independent of opportunity scores.
4. Extend V3 Research and Batch planning summaries with bounded sample disclosure.
5. Verify isolated PostgreSQL, unit/integration, unchanged business data and real browser desktop/mobile.
6. Write results, create MC06 local checkpoint and STOP before MC07.

Default collaboration mode uses this written plan. Parallel ownership: planner/config, UI/browser, provenance/database verification; primary agent owns integration and acceptance.

## Implemented and verified

- Versioned deterministic planner: 7 Precision and 8 Coverage strategies, fair work-conserving 1/1 lane scheduling, no fixed strategy-count stop.
- Frozen language arrays expand independently; lexical configuration includes EN/ES/AR. The actual current registries supply EN for AE and ES/EN for MX; AR is tested in an isolated scope, not enabled as a new market language.
- New batch scope captures approved revision aliases and active configured parent metadata. Old snapshots and reused child execution settings remain unchanged. Pure planner never reads current registries.
- Original/display-normalized queries are preserved; case folding applies to fingerprints only. Fingerprints include all required scope/strategy/lane/language/purpose dimensions.
- Optional batch planning hook freezes parent and newly created child plans inside the existing atomic transaction. Existing child reuse, queue/outbox/worker behavior and business rules remain intact. Reused child plans are not replaced by a later batch's requested overrides.
- Plan records preserve full config and snapshot. Old batch/job read previews are not persisted by GET and are explicitly PLANNED. A legacy single job with only preferred-language storage is disclosed as a legacy stored-job scope; current registry languages are not invented for it.

## Actual local API preview

Read-only all-selection preview after deployment: 2 active markets × 13 approved categories = 26 scopes; languages EN/ES; 579 planned queries = 273 Precision + 306 Coverage. Seven Precision and eight Coverage strategies contribute. Six scope/language strategy combinations lack a configured frozen parent and are recorded as skipped. These are planned counts, not provider calls or discovered companies.

Five local read-only preview requests measured 197.4, 17.3, 16.2, 17.4 and 15.2 ms; median 17.3 ms. This is endpoint latency on this workstation, not a replacement for the fixed Phase12 browser-performance baseline or a public-server speed promise.

## Database and regression

Migration `060_phase13_search_planning_corroboration.sql` applied and replayed; SHA-256 `634224360d327be3cc730ff663f3d009621abf5c9fd3c324f2ab12cc974d59e9`. It adds immutable plan storage and an existing-candidate provenance extension, without rewriting old data. Old migrations 001–059 remain unchanged.

- MC06 isolated PostgreSQL: 11 checks PASS, including deterministic matrix/fingerprints, immutable plans, registry changes, concurrent provenance replay, cross-job company projection, actual batch planning hook, version conflicts and concurrent first-plan insert.
- MC05 isolated existing regression: 19 checks PASS.
- Full suite: 1,075 tests, 1,021 PASS, 54 skipped, zero failures. Skipped tests are not counted as passed.
- A real integration test exposed Date versus persisted ISO-string hashing inconsistency; canonical serialization now matches persisted JSON. Five simultaneous first-plan inserts converge on one immutable plan.
- Production QA batch/plan/hit inserts: zero. Real searches, Hunter, SMTP and LLM calls initiated by this task: zero. Existing account metadata probes on startup are tracked separately, not described as zero provider HTTP.

## Browser acceptance

15 checks PASS; seven required viewport sizes, actual API preview, bounded samples, fixture batch detail, Back/Forward, Escape/focus, loading and error/retry. Zero page errors, failed responses, remote UI assets or attempted production writes. Additional native 200% visual scaling and equivalent 720×450 reflow passed; desktop menu zoom is not claimed. A short-landscape footer overlap was found and fixed. See `PHASE13_MC06_UI_RESULT.md` for exact scope and screenshots.

Evidence: ignored `artifacts/phase13-mc04/mc06-baseline-2026-09-08T04-38-25-478Z/isolated-result.json` and `artifacts/phase13-mc06/browser/result.json`. Browser batch detail uses a fixture carrying an actual preview; production batch creation is deliberately not claimed.

## Final acceptance

Final read-only comparison after deployment: companies 138, sources 438, contacts 129, research jobs 461, MC04 decisions 276, provider usage events 842 and outbound records 2, all with identical content hashes to the baseline. Batches/children/plans/hit provenance remain 0/0/0/0. Old migrations 001–059 and MC04 rule files are unchanged.

Expected differences: migration ledger 36→37; Tavily account check timestamps; IMAP sync timestamps. Provider credentials/status/usage/limits and IMAP UID/state were unchanged. The account timestamp difference remains visible in the raw comparison and was investigated, not silently suppressed. Evidence: `artifacts/phase13-mc04/mc06-baseline-2026-09-08T04-52-43-656Z/comparison.json`.

```text
MC06_QUERY_MATRIX = PASS
MC06_PRECISION_LANE = PASS
MC06_COVERAGE_LANE = PASS
MC06_DOMAIN_POLICY = PASS
MC06_CORROBORATION = PASS
REAL_BRAVE_SEARCH = NOT_RUN
REAL_TAVILY_SEARCH_BY_MC06 = NOT_RUN
EMAILS_SENT_BY_MC06 = 0
MC07_STARTED = NO
```

Final MC06 checkpoint is the local commit containing this report (message `phase13: add deterministic query planning and corroboration`). The report records its MC05 parent rather than attempting a self-referential commit SHA. No push/tag; STOP before MC07.
