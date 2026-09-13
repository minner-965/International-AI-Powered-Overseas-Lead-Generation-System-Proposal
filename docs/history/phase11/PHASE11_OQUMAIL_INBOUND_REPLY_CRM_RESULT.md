# Phase 11 Inbound Reply and CRM Result

Read-only operational snapshot: 2026-09-07 12:09:53 +08:00.

```text
CONTROLLED_IMAP_REPLY_LINKING = PASS
ISOLATED_POSTGRES_CRM_IDEMPOTENCY = PASS
PHASE11_INBOUND_REPLY_CRM = PASS_APPLICATION_CRM
EXTERNAL_CRM_VENDOR_DELIVERY = NOT_CLAIMED
```

## Observed application evidence

| Dataset | Actual result |
|---|---|
| Controlled inbound | 2: UNKNOWN_REVIEW and OPT_OUT |
| Controlled Activities | 2 |
| Production inbound | 3, all REVIEW |
| Shared CRM outbox, CONTROLLED scope | 2, both SYNCED, one attempt each |
| Shared CRM Activities, CONTROLLED scope | 2: OPTED_OUT and FOLLOW_UP_REQUIRED |
| Shared sales tasks, CONTROLLED scope | 1 REPLY_REVIEW, CANCELLED / OPT_OUT |
| PROSPECT-scoped CRM outbox / Activities / sales tasks | 0 / 0 / 0 |
| Confirmed prospect replies | 0 |

The acknowledgement was linked to the controlled message but not interpreted as procurement intent. Migration 057 routes its existing persisted event through the shared application CRM outbox and worker, with explicit CONTROLLED scope. Owner is the recorded context actor `dpv-workspace`; original due date is `2026-09-08T02:40:59Z`. A later opt-out terminates the follow-up. No real prospect reply or external CRM vendor delivery is claimed.

## Technical verification

The isolated PostgreSQL runner in `scripts/phase11-oq14-isolated-regression.mjs` exercised concurrent classification, Activity/task/outbox creation, replay through a new repository instance, concurrent claim, retry and stale-processing hold. It uses fixture-only data in a temporary database, removed after execution.

It exposed a real `ON CONFLICT` mismatch against the partial sales-task index. After correction, eight concurrent effects yielded one Activity, one follow-up task and two distinct outbox operations. Replaying the same effect added nothing. An uncertain stale processing operation is held for reconciliation rather than sent to an external CRM again.

The operational protected replay then used the two real existing replies, not new synthetic mail. First enqueue created two entries; repeat enqueue created zero. Actual execution processed OPTED_OUT at `2026-09-07T04:08:48.900Z` and FOLLOW_UP_REQUIRED at `2026-09-07T04:08:50.897Z`. Because suppression was already known, the historical review task was created CANCELLED. Both source events are traceable through shared outbox → Activity/task without any external CRM request.

The outreach worker was then restarted and the same protected replay repeated. It created zero entries; the two shared outbox IDs, two Activity IDs and one cancelled task remained unchanged. Final next action is STOP_CONTACT; the cancelled task retains its historical due date but is not an open due action.

## Acceptance interpretation

OQ08.2 and OQ10.3 require human reply → CRM outbox → Activity → follow-up requirement → owner → due date and idempotent replay. These application-level requirements now have actual persisted controlled-event evidence. OQ13.2 requires isolation from ordinary prospect exports; scope checks, composite source foreign keys and prospect query filters provide that isolation without fake companies.

The plan does not mandate a particular external CRM vendor. This result accepts the reused in-application CRM path only. An external vendor integration and its delivery/idempotency contract remain separate configuration-dependent work, not a silently simulated result.

The earlier gap is resolved; final browser, export and release gates are recorded by the primary acceptance report. SMTP and controlled outbound counts did not change during this repair.
