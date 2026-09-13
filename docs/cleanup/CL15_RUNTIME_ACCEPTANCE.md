# CL15 — Isolated runtime acceptance

Date: 2026-09-13. Result: PASS for the explicitly tested isolated scenarios below.

## Isolation and build

- Built `dpv-cleanup-acceptance:cl15` from the current Dockerfile and pinned package lock. Build completed; npm reported zero vulnerabilities.
- Did not overwrite the production image tag.
- Created a dedicated internal-only Docker network and PostgreSQL 17 instance using fixture credentials and tmpfs database storage. No production database, volume or environment file was attached.
- Mounted current application source and migrations read-only. The source includes Exa integration, maintenance read-only mode and removal of automatic empty-database collection. The coordinator must rebuild the final image after all concurrent source edits settle; this test is not evidence that an older image layer includes subsequent edits.
- Rebuilt migrations 001–063 successfully in the isolated database.

## Actual checks

| Component | Start | Restart | Evidence |
| --- | --- | --- | --- |
| Dashboard | PASS | PASS | health: ok; database: ready; jobs: ready |
| Category worker | PASS | PASS | live process and readiness file; 16 subscribed queues |
| Data worker | PASS | PASS | live process and readiness file; 4 subscribed queues |
| Outreach worker | PASS | PASS | live process and readiness file; 14 subscribed queues |
| n8n workflow import | PASS | Not claimed | n8n 2.36.7 imported 4 tracked workflow copies |

HTTP GET `/`, `/api/health`, `/api/research/jobs` and `/api/research/provider-status` each returned 200 from the isolated dashboard.

An additional dashboard process with `DPV_MAINTENANCE_READ_ONLY=true` returned GET health 200 and POST research job 503. Company counts remained unchanged. This is a read-only viewing mode, not restoration of background processing.

The final run started from an empty company table. After dashboard start/restart the actual count remained zero; dashboard logs contained no `Live source` or `Initial live collection` messages. This verifies the coordinator's removal of startup collection.

All temporary runtime containers and the dedicated network were removed afterward. The temporary database was in tmpfs; no production volume was deleted.

## n8n scope

The tracked workflow JSON includes active flags. The harness parsed all four files and copied them into ignored fixture artifacts with `active=false` before import. Source workflows were unchanged. Import used disposable n8n SQLite state on the internal network, without production encryption keys or credentials. The CLI reported `Successfully imported 4 workflows.` No workflow was activated or executed.

## Diagnostic iterations

The first harness attempt used unsupported `SEARCH_PROVIDER=disabled`; startup correctly rejected that configuration. The harness was corrected to `exa` without a key. A subsequent empty-database run exposed legacy startup website collection, whose network attempts were blocked by network isolation. The coordinator removed that bootstrap, and the final empty-database run passed without those attempts. These earlier diagnostic failures are not silently presented as passing results.

## Not established by this report

- Production execution-service restoration or draining existing backlog.
- Real IMAP/SMTP/Hunter/provider connectivity or delivery.
- n8n UI health, restart, workflow activation or real execution.
- Full authenticated HTTP mutation coverage; see the separate database/service and browser acceptance results.
- Final immutable image verification after subsequent source edits.

Runner: `scripts/cleanup-cl15-runtime.mjs`. Machine output: ignored `artifacts/cl15-runtime-result.json`. Private credentials were neither read nor printed. No successful external service call or production business write occurred.
