# CL12–CL13 integrated result

Verification date: 2026-09-13. Local cleanup checkpoint only; no CL14, push, tag, runtime restoration, live search or mail send.

## Delivered

- [CL12 dependency/configuration/Docker report](CL12_DEPENDENCY_CONFIG_DOCKER.md): 15 unused example configuration keys removed; all 16 used dependencies and seven purposeful services retained. Private configuration and Exa work remain preserved.
- [CL13 database report](CL13_DATABASE_CLEANUP.md): 147 tables and their catalog dependencies inventoried; no sufficiently proven DROP candidate. No database object, business record, source lineage or applied migration removed.
- Baseline comparison now detects a whole table disappearing, not just modified or added tables. Three isolated tests cover removed, unchanged and added/modified tables.
- Current status regenerated from actual PostgreSQL/container metadata. Exa is selected and its credential presence is detected; `NOT_CHECKED` is retained for account verification. Credential presence does not establish successful live search.

## Verification

| Check | Actual result |
| --- | --- |
| Full local test suite | 1,161 total; 1,107 pass; 54 skip; 0 fail |
| Current-state report vs database | PASS |
| Read-only current opportunity API | PASS; 153 companies, 37 active opportunities |
| Package install / dependency tree / native smoke | PASS |
| Compose configuration / maintenance guard | PASS |
| Configured-secret scan | PASS; zero exposed configured values detected |
| Whitespace validation | PASS |
| Dependency security audit | REVIEW_REQUIRED; two high-severity affected packages |
| September 8 data baseline equality | FAIL / cross-turn drift; 33 tables changed, zero tables removed |
| Two September 13 paused snapshots | PASS; all 147 table fingerprints and controls/policy/migrations/backups identical |

No skipped test is counted as passed. The suite uses isolated/mocked provider and outbound paths; this is not a live Exa or email acceptance claim.

Paused snapshot comparison uses local `artifacts/backups/cleanup-cl00-20260908/cl13-after.json` (11:47:11 UTC) and `cl13-final.json` (11:48:56 UTC), without replacing `before.json`. Both historical-comparison commands correctly exit 1 for the older cross-turn drift; direct comparison of the two paused snapshots passes with zero changes.

## Data preservation and remaining work

Historical baseline files are not replaced. Their backup hashes and applied migration hashes remain unchanged. The existing migration 063 is the sole appended file relative to the earlier snapshot; no migration was introduced by CL12–CL13. Control revisions and incoming-message timestamps demonstrate changes before this September 13 inspection. Existing data is preserved rather than rolled back to force equality.

Nodemailer/ImapFlow security remediation requires a deliberate compatibility update and transport/reply/suppression regression. No forced major upgrade was made. Exa source/configuration and local repair files remain user-owned working-tree changes, outside this cleanup checkpoint. They were not deleted, published or represented as connectivity-tested.

PostgreSQL remains available; execution services remain paused under the cleanup maintenance boundary. The full cleanup plan is not complete: CL14–CL16 and final restoration remain later work packages. Exa live acceptance follows cleanup, as requested.
