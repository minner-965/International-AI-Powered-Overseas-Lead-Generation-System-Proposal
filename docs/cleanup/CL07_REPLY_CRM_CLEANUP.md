# CL07 — Reply / CRM / Suppression Cleanup

Date: 2026-09-08. Scope: cleanup plan CL07 only, alongside separately authorized CL08. Production execution remains stopped; no provider, Hunter, SMTP, IMAP-server or external CRM requests were made by this work package. No database writes or migrations were performed by this workstream.

## Result

Removed the unused in-memory reply correlator and its sender-only fallback. The persisted RFC/thread correlation implementation remains authoritative. Current classification, Activity, CRM outbox, sales-task handoff and suppression paths are preserved.

## Reachability and disposition

| Candidate / location | Evidence before change | Classification / action |
|---|---|---|
| `services/demo-dashboard/src/outreach/inbound.js`: `correlateInboundReply` | Zero runtime call sites. Only import and four assertions in the old provider fixture test; re-exported by the outreach barrel. Its `SENDER_ACTIVE_THREAD` fallback differed from current persisted correlation. | DELETE_ACTIVE_CODE. Removed helper, its private `headerValues`, unused `unique` / `upper` imports and obsolete test. |
| Same module: `classifyInboundReply` | One classifier, used by both ordinary and controlled reply processing in `phase7/service.js`, plus task builder. | KEEP_CURRENT. No duplicate classifier found. Removed only an unused local `headers` binding; intent semantics unchanged. |
| `phase7/repository.js`: `findInboundThread`, `findOutboundByRfcReferences` | Current webhook/inbound processing uses persisted outbound references; supports first-touch reservation threads and normalized-recipient restriction. | KEEP_CURRENT. No sender-only correlation reinstated. |
| `outreach/smtpImapProvider.js`, `phase7/service.js`, `phase7/repository.js` | UID/UIDVALIDITY synchronization, MIME parsing, inbound receipt identity and replay protection remain referenced. | KEEP_CURRENT. |
| Gmail historyId synchronization | Gmail compatibility provider was retained in CL06, so CL07's prerequisite “if Gmail removed” is false. | REVIEW_REQUIRED / retained. No Gmail checkpoint or history removed. |
| `phase7/service.js`: `processCrmSyncWork` | Called by existing CRM queue handler. Implements persisted claim, payload allowlist, idempotency header, HTTP result handling and retries; controlled scope has its own internal CRM processing. | KEEP_CURRENT. This is a referenced implementation, not an empty external-CRM placeholder. Missing external configuration remains a retryable state, not fabricated success. |
| Activity / CRM outbox / SalesTask effects | Current ordinary inbound and controlled replay use persisted effect keys, owner and tasks. | KEEP_CURRENT, including all history. Sales handoff is represented by these existing effects; no new deal/quotation/shipment engine introduced. |
| Won/Lost automatic outcome logic | No automatic Won/Lost writer found in inspected outreach/reply modules. `WON` in data-exchange constants/import tests belongs to imported historical deal data. | KEEP_IMMUTABLE_HISTORY / no deletion. No automatic outcome mapping added. |
| `isolateAttachments` | Fixture-covered metadata-only attachment isolation helper; separate from removed correlation behavior. | REVIEW_REQUIRED / retained security utility. No change to actual MIME attachment exclusion. |
| Reply UI narrative | No public files edited in CL07. | Deferred to explicitly scheduled CL10 full UI/copy pass. This report does not claim a completed UI audit. |

## Verification

Integrated CL07–CL08 result: 1,150 tests, 1,096 passed, 54 skipped, 0 failed. The skipped integration tests are not counted as passed. Read-only production fingerprint comparison: all 147 business tables unchanged, controls unchanged, applied migration hashes unchanged. Prior migration 063 remains pending; this round adds no migration. Orchestration snapshots preserve 87 registered queues, 4 workflow records and 178 execution-history rows unchanged. Compose validation, current-state DB/runtime comparison and secret scan PASS. No UI edits or live browser acceptance claimed. Maintenance remains active; local checkpoint only, no push/tag, STOP after CL08.

Command run from `services/demo-dashboard`:

```text
node --test test/cleanup-cl07-reply-crm.test.js test/phase11-oqumail-inbound-crm.test.js test/phase7-outreach-provider-inbound.test.js test/phase7-backend-integration.test.js
```

Actual result: **52 passed, 0 failed, 0 skipped**.

New fixture checks exercise the real repository method with an intercepted query, verify normalized RFC variants and the absence of sender-only fallback, and call the real service follow-up method for positive, negative, opt-out, out-of-office and bounce classifications. They verify stable effect keys on replay, owner propagation, task/no-task boundaries, no automatic sends, opt-out closure and unmatched-inbound rejection. Repository persistence replay remains covered by existing isolated acceptance; the new fixture does not claim to prove a real database transaction by itself.

Existing tests additionally cover incremental UID, UIDVALIDITY rescan, MIME decoding, attachment exclusion, DSN validation, quoted opt-out handling, suppression closure, CRM retry state and payload safety.

Cross-workstream full regression and the read-only production fingerprint comparison are recorded by the coordinating cleanup run. No historical inbound/outbound, suppression, Activity, SalesTask or CRM outbox records were removed. No current business-opportunity rule was changed.
