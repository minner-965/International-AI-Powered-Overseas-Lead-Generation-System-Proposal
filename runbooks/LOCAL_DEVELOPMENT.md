# Local development runbook

## Start

1. Start Docker Desktop and wait until its engine is running.
2. From the repository root, run `docker compose up -d --build`.
3. Open <http://localhost:3000> for the lead-review dashboard.
4. Open <http://localhost:5678> and create the local n8n owner account if n8n
   requests first-time setup. The workflow is named `DPV Phase 1 - Live Public Data Demo`.
5. Create provider credentials in n8n's credential manager. Do not paste
   secrets into workflow nodes or commit them to Git.

The phase-one workflow needs no credentials and has no send node. The default
dataset is cumulative live public business information.

## Verify

Run `docker compose ps`, then verify `postgres`, `n8n` and `demo-dashboard` are
running. PostgreSQL and the dashboard must report `healthy`.

Run the acceptance suite:

```powershell
node tests/live_acceptance.mjs
```

The live test makes new network requests and therefore its company and tier
counts can change, but requires at least ten real records, multiple
providers, 100% source traceability and zero send-enabled records. Click
**抓取最新真实数据** in the dashboard to append or update the live dataset.

If the workflow export must be imported again, run:

```powershell
docker compose exec -T n8n n8n import:workflow --input=/files/workflows/01-two-week-demo.json
```

## Stop

Run `docker compose stop` to preserve data. Use `docker compose down` only when
you want to remove the containers while preserving named volumes.

## Reset local data

`docker compose down --volumes` permanently removes the local n8n and database
data. Export any needed workflow JSON first and never export credentials. The
real lead database cannot be recreated exactly because public sources change;
export the local workbook or make a protected database backup before deleting volumes.
