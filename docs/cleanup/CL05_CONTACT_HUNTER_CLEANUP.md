# CL05 Contact / Hunter cleanup

Date: 2026-09-08. Scope: contact/Hunter legacy cleanup only, under the CL00 process maintenance guard. No live Hunter/provider request, SMTP send, production data mutation or service startup was performed.

## Integrated CL04–CL06 verification

Final full suite: 1,140 tests; 1,086 passed, 54 skipped, 0 failed. Skipped integration checks are not reported as passed. Current status DB/runtime verification and secret audit PASS. Read-only comparison of all 147 production tables: no changes; persisted controls equal baseline. Applied migration files unchanged; previously added 063 remains pending on production (no new migration in this package). Backup hashes remain unchanged. Execution containers remain stopped; no live search/Hunter/SMTP calls. No UI changes or live browser acceptance claimed. Local checkpoint only; no push/tag; STOP after CL06.

## Implemented removal

`services/demo-dashboard/src/enrichment/EnrichmentService.js` contained an active `if(calls>=3)break` in `verifyOfficialMailboxes`. It silently stopped at three observed official mailboxes even when additional distinct eligible observations existed. Classification: **DELETE_ACTIVE_CODE**. The one active guard and its test expectation were removed/replaced; there was no historical data dependency on this source-code branch.

The method now traverses eligible observed candidates while retaining freshness, official-domain/source checks, duplicate-address filtering, active suppression exclusion, provider credit capacity, authentication failure and transient/replay stop handling. A fixture with seven candidates verifies that no three/five-candidate cutoff remains in this verification traversal. A separate fixture confirms provider credit capacity still stops the traversal after four completed calls. This does not authorize additional live calls during cleanup.

## Retained current mechanisms

| Area | Classification | Evidence / decision |
|---|---|---|
| Named Finder candidates | KEEP_CURRENT | `applyHunter` filters verified named business roles before Finder; its current list has no five-candidate slice. Official generic/department mailboxes are verified independently before this optional named path. |
| Fresh VALID and exact recipient gates | KEEP_CURRENT | `opportunityPool/contactReadiness.js` and existing outreach eligibility separate readiness from send permission. VALID freshness, source/domain and named-person evidence are not removed. |
| Hunter credit ledger | KEEP_CURRENT | `HunterProvider.js` imports/constructs `HunterCreditBudget`; reservations, run/daily/billing capacity, duplicate replay and bounded temporary retries remain actively used and tested. They are not stale attempt caps. |
| Verification / INVALID audit | KEEP_CURRENT | Verification events and address-level INVALID suppression writes remain unchanged; no history or applied migration was edited. |
| Company-level routes | KEEP_CURRENT | `upsertContact` locks canonical company/type/value and reuses records. The current contact queue groups companies and distinct category references; B05 regression passes. |
| Category-specific evidence tasks | KEEP_CURRENT | `autoEvidence/AutoEvidenceOrchestrator.schedule` includes category/blocker/revision lineage. Those tasks are not duplicate company contact records and are not deleted by this pass. |
| Contact strategy attempts | KEEP_CURRENT | Current strategy traversal has no `strategy_attempt_count >= max_attempts` hard gate. Historical column/constraint checks remain audit/migration compatibility; no migration changed. |
| Extraction noise bounds | KEEP_CURRENT | `boundedObservedContacts` still prioritizes observed channels and market-local telephone routes with per-type limits. This is an upstream page-directory noise bound, not the removed verification attempt cutoff; its existing contract was preserved. |
| Manual official-route task | RETIRED / regression retained | Current active task creation was already removed; B04 regression confirms absence. Immutable historical task names/rows remain intact. |
| Hunter as opportunity gate | ABSENT in current pool | MC04 business classification and the independent contact projection are unchanged. Missing Hunter verification does not remove business-pool membership. |
| Legacy wording / UI explanations | REVIEW_REQUIRED for CL10 | No frontend changes in this package. Historical procurement/role identifiers and evidence are not globally replaced. Active UI lexical cleanup belongs to CL10, with its visual checks. |

No file was deleted, no dependency added, no schema migration created, and no MC04 rule recalculation performed. This report claims the bounded CL05 code and fixture checks, not the future CL15 full acceptance or runtime restoration.

## Verification

Maintenance guard: PASS, all five execution containers stopped and PostgreSQL running.

Actual focused test command in `services/demo-dashboard`:

```text
node --test test/phase11-official-mailbox-hunter.test.js test/phase6-hunter-provider.test.js test/phase13-mc03-contact.test.js test/phase6-enrichment-bounds.test.js test/phase9-real-enrichment-gates.test.js test/phase10-1-b03-b05-category-contact-flow.test.js test/phase10-auto-evidence-strategy-attempts.test.js
```

Result: **59 passed, 0 failed, 0 skipped**. All provider behavior in these tests uses injected fixtures; no production database writes are involved. Coverage includes generic mailbox without buyer, freshness, foreign-domain rejection, duplicate routes, INVALID suppression, disabled policy, provider capacity, replay, company contact aggregation and independent readiness.
