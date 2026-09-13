# Cleanup and Exa handoff

Date: 2026-09-13.

## Outcome

- CL14 documentation reorganization completed: 121 historical documents archived, original README retained in history and current navigation restored. Private reports were not published.
- CL15 implemented fixes and executed regression, database, browser and isolated runtime checks. **Full per-route acceptance remains REVIEW_REQUIRED**; see [coverage](CL15_ROUTE_COVERAGE.md). Do not read this handoff as a claim that all 158 interfaces have passed both directions.
- CL16 migration, backup, release preparation and restricted recovery completed. Full automation restoration is not performed; persisted intent remains unchanged.
- Exa credential/adapter live verification **PASS**: one query, three results with excerpts, actual cost USD 0.007, no retry, no email and no backlog execution. [Exa result and configuration](../EXA_SEARCH_PROVIDER.md).

## Delivered changes

Historical/duplicate current documentation paths were consolidated and their references repaired. Removed the once-used documentation-move helper after its result was recorded; Git renames retain the audit trail. Original user Exa repair/context files remain locally, excluded from release rather than deleted.

Nodemailer and ImapFlow were updated to fixed versions with zero reported production dependency vulnerabilities. Exa now requests bounded source excerpts, validates count, avoids ambiguous automatic retry, redacts error payloads and preserves unknown versus known cost through replay/recovery.

Empty startup no longer runs legacy fixed discovery. A staged read-only mode prevents queue/probe/reconcile startup and rejects writes before handlers; PostgreSQL connections are read-only. Registry-only preview remains available. This mode does not change normal behavior when disabled and does not change stored automation controls.

## Verification

Final ordinary suite: **1,188 total, 1,134 passed, 54 skipped, zero failed**. The independent database runner additionally executed 46 formerly optional cases successfully. Final deployed-browser check: **52 route/viewport checks PASS**, native 200% zoom at two sizes, reduced-motion desktop/phone, four dialog focus/return checks, zero console/page errors, zero HTTP errors and zero blocked unexpected requests. Evidence: ignored `artifacts/phase12-ui-baseline/browser-accessibility/2026-09-13T13-24-58-981Z/result.json`.

The final deployed image is `sha256:c4ffb15473ceb61b598a2e98c393b8bc5180a9d792951315297ad33f02ebd24a`, rebuilt after the audited read-only-preview exception. Production dependency audit and configured-secret scan both pass with zero findings.

See [consolidated acceptance](CL15_FULL_ACCEPTANCE.md), [backend checks](CL15_BACKEND_ACCEPTANCE.md), [runtime checks](CL15_RUNTIME_ACCEPTANCE.md), and [metrics/candidates](CL16_METRICS_AND_CANDIDATES.md). No unexecuted or skipped check is presented as passed. Full accepted-runtime tagging is withheld while route coverage is incomplete.

## Data and runtime

[Restoration record](CL16_RESTORATION.md) contains the new complete ignored backup and its hash. Migration 063 was applied with the existing migration runner after isolated replay; only the migration ledger gained one row. All other application table fingerprints, including controls and email history, stayed unchanged.

The workbench is served at `http://127.0.0.1:3000` in read-only mode using `compose.readonly-recovery.yaml`. Dashboard and PostgreSQL are available; research/mail/data workers and n8n execution remain paused. This is **restricted recovery**, not all automation ON at runtime. The existing 544-query backlog was not released. Stored automation controls and original credentials were preserved.

## Release

The authenticated GitHub repository was verified private. Release will be a code/checkpoint branch push, not the proposed `phase13-cleanup-current-runtime-accepted` tag. That accepted tag is intentionally withheld because full per-route acceptance and unrestricted execution/budget conditions remain outstanding. Exact commit/remote verification is appended after publication.
