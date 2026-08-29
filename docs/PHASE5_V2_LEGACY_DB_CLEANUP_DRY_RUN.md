# Phase 5 V2.2 Legacy Database Cleanup Dry Run

## Status

PASS — database dry run completed; no cleanup action or hard deletion was executed.

## Safety boundary

- Scope: `DPV_DATABASE_ONLY`
- Cleanup batch: `phase5-v2-legacy-db-refresh-001`
- Validated restore point: `artifacts/backups/phase5-v2-prechange-20260828.dump`
- Backup format: PostgreSQL custom format; `pg_restore` table-of-contents validation completed before migration.
- Shared-folder operations by this database workstream: read `0`, write `0`, rename `0`, move `0`, delete `0`.
- The company hard-delete guard is installed and enabled. It requires an approved/executing batch plus a prior `DELETED` audit row before a company deletion can proceed.

## Database counts before migration

| Entity | Rows |
|---|---:|
| Companies | 97 |
| Sources | 137 |
| Contacts | 31 |
| Lead reviews | 93 |
| Research jobs | 16 |
| Collection runs | 12 |
| Score runs | 9 |
| Customer Match runs | 9 |

## Dry-run result

| Proposed action | Rows |
|---|---:|
| Retained | 25 |
| Review | 72 |
| Merged | 0 |
| Superseded | 0 |
| Archived | 0 |
| Deleted | 0 |
| Total reviewed | 97 |

Correctness, not deletion volume, controls this result. The dry run found no conservative duplicate/replacement pair and no row that satisfied the safe hard-delete gate.

### Reason distribution

| Reason code | Proposed action | Rows |
|---|---|---:|
| `VERIFIED_CANONICAL_RECORD` | Retained | 5 |
| `REVIEW_RECORD_WITH_TRACEABLE_DATA` | Retained | 20 |
| `LEGACY_WEAK_EVIDENCE` | Review | 72 |

### Origin/action distribution

| Data origin | Retained | Review |
|---|---:|---:|
| `fixed_public_candidate` | 9 | 0 |
| `fixed_public_profile` | 6 | 0 |
| `live_discovered` | 4 | 0 |
| `directory_live` | 0 | 9 |
| `osm_live` | 6 | 63 |

The 72 review rows have no official domain, active contact, or material target-business verification evidence. They remain stored and remain outside the active opportunity pool pending manual/updated verification.

## Dependency and history review

| Proposed action | Sources | Contacts | Lead reviews | Score runs | Match runs | Research-job links | Verification evidence |
|---|---:|---:|---:|---:|---:|---:|---:|
| Retained | 61 | 31 | 21 | 9 | 9 | 4 | 424 |
| Review | 76 | 0 | 72 | 0 | 0 | 0 | 0 |
| Total | 137 | 31 | 93 | 9 | 9 | 4 | 424 |

Additional preserved dependencies:

- Facts snapshots: 9
- Candidate verification rows: 5
- Social-account rows: 19
- Cleanup plan items: 97
- Performed cleanup audit rows: 0, because this run performed no lifecycle change or deletion

## Duplicate and replacement mapping

- Conservative duplicate pairs: 0
- Replacement mappings: 0
- Safe hard-delete candidates: 0
- Fuzzy-name-only matches were not accepted as duplicates.

## Counts after migration and dry run

| Entity | Rows | Change |
|---|---:|---:|
| Companies | 97 | 0 |
| Sources | 137 | 0 |
| Contacts | 31 | 0 |
| Lead reviews | 93 | 0 |
| Research jobs | 16 | 0 |
| Collection runs | 12 | 0 |
| Score runs | 9 | 0 |
| Customer Match runs | 9 | 0 |

## Decision required before any cleanup execution

The 72 weak-evidence rows require a management/manual review or stronger replacement evidence. This dry run does not authorize changing them to `ARCHIVED`, `INVALID`, or deleting them. No cleanup result document was created because no cleanup action was executed.

## Tests

- Full dashboard suite: 129 tests
- Passed: 127
- Failed: 0
- Intentional skipped live-provider fixtures: 2
