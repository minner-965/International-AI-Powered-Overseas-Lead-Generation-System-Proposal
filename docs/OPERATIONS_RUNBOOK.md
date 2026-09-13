# Operations runbook

## Read-only inspection

Run `node scripts/generate-current-project-status.mjs` and `node scripts/verify-current-project-status.mjs --database`. These read PostgreSQL and container metadata, not providers. Read `CURRENT_RUNTIME_CONTRACT.md` before changing execution controls.

## Maintenance

`node scripts/cleanup-maintenance-guard.mjs --apply` pauses execution services while preserving PostgreSQL and stored intent. Without `--apply`, it checks this condition. Preserve database volumes, applied migrations, original backups and user working-tree changes.

## Credentials and providers

Keep credentials in ignored local environment files. Reports should expose only presence/status, never values. Recreating a service loads changed environment; restarting an existing container alone may retain old settings. Verify actual stored provider order, request budget and pending work before releasing research execution. Unknown cost is not free. One smoke request does not authorize an entire historical backlog.

## Staged restoration

Validate isolated migration replay, current images/source, dependency security, pending outbound reservations and service health first. Dashboard, category-worker, data-worker, outreach-worker and n8n have separate responsibilities. Starting workers with stored automation enabled can cause external actions; do not start all services blindly during acceptance. Record remaining pauses accurately, and preserve separate follow-up/manual-channel controls.

## Release

Scan secrets and inspect staged paths. Commit intended changes, verify remote identity/privacy, push the exact branch without force, then compare remote and local hashes. Preserve existing tags; use an accepted tag only when its acceptance conditions hold. Confidential snapshots stay in ignored local artifacts.
