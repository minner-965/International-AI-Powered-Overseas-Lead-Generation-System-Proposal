# CL06 Email / Outreach Legacy Cleanup

Date: 2026-09-08. Scope: CL06 only, with maintenance execution containers stopped. No real provider requests, SMTP sends, database updates, queue replay or history deletion.

## Integrated CL04–CL06 verification

Final full suite: 1,140 tests; 1,086 passed, 54 skipped, 0 failed. Skipped integration checks are not reported as passed. Current status DB/runtime verification and secret audit PASS. Read-only comparison of all 147 production tables: no changes; persisted controls equal baseline. Applied migration files unchanged; previously added 063 remains pending on production (no new migration in this package). Backup hashes remain unchanged. Execution containers remain stopped; no live search/Hunter/SMTP calls. No UI changes or live browser acceptance claimed. Local checkpoint only; no push/tag; STOP after CL06.

## Result

Conditional retirement audit completed. Gmail and Resend do **not** meet the plan's zero-reference deletion prerequisites; they remain `REVIEW_REQUIRED`, not falsely reported removed. Current OquMail automatic first-touch remains separate from the manual fallback. No adapters, routes, queues, configuration keys, migrations or historical rows were deleted in this workstream.

A concrete isolation defect was fixed: the legacy Gmail ambiguous-send worker previously could load a historical Gmail row then invoke the currently selected SMTP adapter's reconciliation method. It now returns `GMAIL_PROVIDER_NOT_SELECTED` before any repository or provider operation unless Gmail is selected. Historical Gmail audit/reconciliation remains available when explicitly selected. This does not enable Gmail.

## Classification and evidence

| Candidate | Classification | Evidence / decision |
| --- | --- | --- |
| OquMail SMTP/IMAP adapter | KEEP_CURRENT | `src/outreach/smtpImapProvider.js`; SMTP 587 STARTTLS / IMAP 993 TLS, stable Message-ID, ambiguous outcomes, incremental mailbox and DSN handling. |
| Phase13 eligibility / Simon A/B/C / reservations | KEEP_CURRENT | `phase13EmailEligibility.js`, `firstTouchTemplates.js`, `AutoFirstTouchService.js`; dedicated `send-auto-first-touch` queue, transactional reservation, suppression and prior-send gates. |
| Gmail adapter / config | REVIEW_REQUIRED | `providers.js` factory/export; Phase7 health GET and health-check POST, inbound-sync POST; `queueHandlers.js` reconcile/inbound handlers; service historical audit methods. Active route/worker references are nonzero. Current selected SMTP is not a zero-reference proof. |
| Resend adapter / webhook config | REVIEW_REQUIRED | `providers.js` outbound/inbound factories; Phase7 service `resendInbound` constructor and `acceptWebhook`; router registers `/api/webhooks/resend`. Nonzero references, authenticated event verification and retained event history dependencies. |
| Manual draft approval / management approval | REVIEW_REQUIRED (admin fallback retained) | Current manual service/UI contract and safe administrator fallback remain referenced. Phase13 bridge never fabricates legacy approval/FIT rows and does not call manual send. No authority to remove fallback solely because auto first-touch exists. |
| Controlled test allowlist / caps | KEEP_CURRENT transport safety; REVIEW_REQUIRED UI retirement | SMTP adapter uses controlled mode and the separate controlled application test path remains referenced. Removing an allowlist/cap would remove safety, not just stale copy. |
| PROSPECT_PILOT identifier | KEEP_CURRENT compatibility | `AutoFirstTouchService.sendReservation` still passes it as send scope; manual service also uses it. Historical-looking spelling is not dead-code proof. |
| Migration 042 / approvals / drafts / mail / suppression / CRM history | KEEP_IMMUTABLE_HISTORY | No migration/schema/data modifications. |

Paths above are relative to `services/demo-dashboard`. Queue/API pruning belongs to later CL08/CL09 after dependency review, not an implicit extension of CL06. The current runtime contract from CL02 remains authoritative; old result documents are historical evidence, not current manual-only policy.

## Verification

Configuration comments in `.env.example` and `compose.yaml` now distinguish legacy manual provisioning from the separate Phase13 first-touch policy. No configuration values, limits or gates changed.

Fixture suite: `cleanup-cl06-provider-isolation`, `phase13-auto-first-touch-service`, `phase13-first-touch-policy`, `phase11-smtp-imap-provider`, `phase7-outreach-provider-inbound`, `phase10-gmail-provider`.

Actual result: **59 tests passed, 0 failed, 0 skipped**.

Coverage includes SMTP selection despite legacy settings; zero Gmail API access for unselected health/inbound/reconciliation; selected historical reconciliation audit; Simon A/B/C selection; current positive MC04 eligibility without manual rows; suppression/bounce/prior-send blocking; terminal/ambiguous no resend; SMTP exactly-once; controlled allowlist and cap protection; reply correlation and opt-out. All external transports are fixtures. Maintenance guard reports PASS with PostgreSQL running and persisted controls untouched.

No claim of full live acceptance or deletion of every legacy path. STOP after the parent CL04–CL06 handoff; no CL07 execution.
