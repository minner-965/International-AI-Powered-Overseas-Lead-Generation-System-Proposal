# Phase 10 WP-U00 Baseline Result

## Verdict

- WP-U00: PASS
- Mode: read-only Git/database baseline plus repository-external safety backup
- Business source changes: 0
- Database mutations: 0
- Tavily/Hunter calls: 0
- Email calls: 0

## Git freeze

- Repository: `D:/codex/International-AI-Powered-Overseas-Lead-Generation-System-Proposal`
- Source branch: `phase10-recovery-rc1`
- Safety branch: `phase10-remove-internal-limits-20260904-112916`
- Frozen HEAD: `fa9f7fb8f188ecc32d155e186916e6cfeae38c4d`
- Dirty entries before WP-U00: 12 (3 modified, 9 untracked)
- Existing dirty files were preserved unchanged.

Safety artifacts outside the repository:

- Patch: `D:\codex\phase10-before-limit-removal-20260904-112916.patch`
- Patch SHA-256: `B7DD01C489EE434F6ADF7E40F5D7B9D95BB8BFA4B67CD955FF0333722A824A1C`
- Status: `D:\codex\phase10-before-limit-removal-status-20260904-112916.txt`

## Zero-email database baseline

- Snapshot time: `2026-09-04T11:30:05.730441+08:00`
- Evidence: `docs/evidence/phase10-limit-removal-email-zero-before.json`

| Table/projection | Count |
|---|---:|
| outreach_drafts | 0 |
| outreach_approvals | 0 |
| outbound_messages | 0 |
| outbound_message_attempts | 0 |
| email_webhook_inbox | 0 |
| inbound_messages | 0 |
| crm_sync_outbox | 0 |
| gmail_ambiguous_send_events | 0 |
| management-approved opportunities | 0 |

## Continuation baseline

The plan carried an older expectation of four incorrect task links. The current canonical dry-run examined the same four task histories and returned `incorrect_task_links=0`, `links_safe_to_repair=0`. No current repair is authorized or required in U00.

| Task | Current task state | Current ResearchJob binding | Latest historical continuation | Historical original stop reason | Checkpoint | Strategy attempts | Provider usage events (original + historical continuation) | Current repair action |
|---|---|---|---|---|---:|---:|---:|---|
| `56dc38ac-8793-4027-aef0-a19a1710e5f0` | RUNNING / DISCOVERING_SOURCES | `6ffdac04-ecf2-4366-9d25-0be482e4adf4` | `a4a5e5d3-56d8-48d4-b15f-e9f65d3c914c` | null | task 0 / historical continuation 1 | 2 | 7 | NONE |
| `7f9d4d2f-2555-4f40-8958-21d49eb3740b` | RETRY_SCHEDULED | `d517b515-781a-4b03-8273-b05d89d1064b` | `df15379d-0c33-4b4d-820a-cc5ddca35b56` | null | task 0 / historical continuation 1 | 2 | 6 | NONE |
| `abe1577d-afa3-43a0-a0b3-ee3a92e00a10` | RETRY_SCHEDULED | `a9e325ca-377a-4199-a104-6978de682078` | `299df9e0-4191-4354-a024-04769395d2bb` | null | task 0 / historical continuation 1 | 2 | 6 | NONE |
| `ba03dace-a7a8-4978-95c8-bb695e2fb8b1` | RETRY_SCHEDULED | `aacccc94-c63a-4ecd-b518-f4fa3883d50d` | `82558990-6b98-4a07-a72b-da9702a42ad3` | TAVILY_CREDIT_CAP | task 0 / historical continuation 2 | 4 | 7 | NONE |

The latest outbox rows are historical lineage, not automatically the correct binding for a later strategy/checkpoint. The canonical diagnostic therefore governs the repair decision.

## Paused-task baseline

- Current `auto_evidence_tasks.task_status='BUDGET_PAUSED'`: 0
- Historical original jobs with literal `stop_reason_code='BUDGET_PAUSED'`: 0
- Earlier WP-A04.1 evidence records three legacy task checkpoints with `technical_blocker='PROVIDER_BUDGET_PAUSED'` but no job stop reason, plus one original job with `TAVILY_CREDIT_CAP`.
- The plan's “3 currently paused tasks” is an older pre-repair expectation; it is not the current database state.

## U00 stop line

The version, backups, task lineage and zero-email baseline are frozen. WP-U00 performed no business-code or database-data change.
