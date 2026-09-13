# CL16 — Migration and restoration preparation

Date: 2026-09-13. Status: backup and migration PASS; execution-service restoration is intentionally separate.

## Fresh recovery point

- Ignored backup: `artifacts/backups/cleanup-cl16-20260913T131932/database.dump`.
- Format: full PostgreSQL custom-format database dump; 11,844,585 bytes.
- SHA-256: `45a055151476abfeda8d21ffddf9fc739ddfb66a5bf432be4f4a3fa2dcbc7617`.
- The directory also contains the checksum, before/after table fingerprints and migration result. The CL00 backup was not overwritten.

## Image

- Built current source and lockfile as `dpv-cleanup-acceptance:cl16`.
- Image ID: `sha256:c6436cb039d1282a3f1ddb7701b1dce3f8ae9cce370124066e2c389e85f42690`.
- No production image tag was replaced and no execution service was started by this operation.

## Migration 063

Applied only `063_cleanup_optional_cohort_catalog_snapshot.sql` through the existing `applyPhase7Migration` runner, after verifying it was absent from the production ledger, matched its checkpoint bytes and all frozen migration files retained their hashes.

Migration SHA-256: `56f9f985d7118b7e137bc4a7c4a3f58f016ef40aa001b1fd1057e817786c1f9e`.

Actual runner result: `APPLIED` on `lead_generation`; `catalog_snapshot=OPTIONAL_AUDIT_CONTEXT`. The column `research_job_cohort_items.product_profile_catalog_snapshot_id` is now nullable. Existing values and foreign-key relationships were retained.

Before/after comparison covered all 147 `leadgen` tables. The only changed table was `schema_migrations`, with exactly one new row and the expected checksum. All other row counts and full-row fingerprints were unchanged, including business records, history, queues and persisted automation controls.

## Remaining operational boundary

Coordinator staged recovery: dashboard recreated from final image `sha256:8a2824782928f7dc68492c5607b33bbd280e6377a6b41ca36d81ab9b94b7ef75` with `DPV_MAINTENANCE_READ_ONLY=true`, loopback port 3000 and a read-only PostgreSQL session default. This image includes the subsequent invalid-detail-ID and category-input error fixes. Dashboard and PostgreSQL are healthy. Workers/n8n remain stopped; no backlog or email is released. Registry-only batch preview is the one audited non-GET read operation permitted. Final deployed-browser evidence is in `FINAL_CLEANUP_RESULT.md`.

This preparation did not release search backlog, start email workers, change automation controls, invoke providers or send messages. Background service restoration and any controlled Exa verification must be recorded separately by the coordinator. A read-only dashboard is not equivalent to full automation restoration.

Reproducible audit runner: `scripts/cleanup-cl16-restoration.mjs`. It refuses a duplicate migration application and never overwrites an existing backup directory.
