# DPV emergency private backup — 2026-09-08

This encrypted snapshot contains the project workspace, local business data,
environment configuration, a PostgreSQL custom-format dump, and an n8n data
backup. Reinstallable dependency and cache directories are excluded.

## Restore

1. Download every `DPV_FULL_PRIVATE_BACKUP_20260908.7z.*` volume into one directory.
2. Obtain the backup password from the separately stored recovery record.
3. Open the `.7z.001` volume with 7-Zip and extract it.
4. Verify the downloaded volumes against `SHA256SUMS.txt` before extraction.

The password is intentionally not stored in this repository.
