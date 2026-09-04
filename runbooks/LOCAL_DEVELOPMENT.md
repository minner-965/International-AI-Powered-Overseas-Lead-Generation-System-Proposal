# Local development runbook

## Start

1. Start Docker Desktop and wait until its engine is running.
2. From the repository root, run `docker compose up -d --build`.
3. Open <http://localhost:3000> for the lead-review dashboard.
4. Open <http://localhost:5678> only when reviewing the periodic reconciliation
   or other non-ResearchJob workflows.
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

ResearchJob creation does not require an n8n webhook; it writes the dispatch
outbox in the same transaction and queues the job through pg-boss.

The application does not enforce Tavily daily, per-run, per-job, purpose-pool or
company/profile quantity limits. `provider_usage_events` remains the canonical
audit ledger and query fingerprints prevent duplicate calls. A 429 response is
rate limiting and follows `Retry-After`; only confirmed Provider account credit
exhaustion closes the create-job gate. n8n reconciliation is a recovery and fair
strategy-progression mechanism, not a research quota.

## Stop

Run `docker compose stop` to preserve data. Use `docker compose down` only when
you want to remove the containers while preserving named volumes.

## Reset local data

`docker compose down --volumes` permanently removes the local n8n and database
data. Export any needed workflow JSON first and never export credentials. The
real lead database cannot be recreated exactly because public sources change;
export the local workbook or make a protected database backup before deleting volumes.
