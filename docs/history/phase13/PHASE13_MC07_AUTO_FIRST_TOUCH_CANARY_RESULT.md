# Phase 13 MC07 — Automatic First-touch Canary Result

Status: **PASS**

The initial automatic canary selected one real, never-contacted, eligible company and executed the complete automatic path:

`eligibility → deterministic template → immutable reservation → stable Message-ID → SMTP → Activity → CRM outbox`

| Check | Result |
|---|---|
| First canary company | tradeling |
| Template | `B_IMPORTER_WHOLESALER_DISTRIBUTOR` |
| SMTP status | `PROVIDER_ACCEPTED` |
| Business state | `SENT_NO_REPLY` |
| Stable provider Message-ID | persisted |
| Automatic mode after canary | remained ON |
| Duplicate reservation | 0 |
| Duplicate automatic outbound message | 0 |

After the canary passed, the enabled automation continued normally and sent the next eligible company, Fakhruddin Souq, with `C_OFFICIAL_GENERIC_MAILBOX`. This is a separate company-level first touch, not a repeat of the canary. Both accepted records are visible in the V3 Auto First-touch Queue and open as immutable mail records.

Reconciliation was executed again after both sends. It created zero additional reservations and zero additional SMTP submissions for those companies. The unique company × policy constraint and the unique reservation-to-message constraint both remain satisfied.
