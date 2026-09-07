# WP-MC00 — Accepted baseline and freeze

Date: 2026-09-07. Result: **PASS**. Authorization continues only through WP-MC02; STOP there. MC03 and later work are not included.

## Git receipt

- Accepted Phase12 implementation: `6403dd3fb4e82ea757636c8a59cb7edf29f5beb0`.
- Configured remote branch independently verified at the same commit by the executing agent.
- New annotated tag: `phase12-workspace-ui-v3-accepted-20260907`.
- Tag object: `fb70993b7eaff99beb78985f6220a1d2ee914fd3`; peeled implementation is the commit above.
- Previous `phase12-workspace-ui-v3` implementation-only tag remains unchanged.
- Phase12 acceptance scope and human screen-reader NOT_TESTED limitation remain in `PHASE12_ACCEPTANCE_COMPLETION.md`; the freeze does not imply WCAG certification.

## Local data freeze

Private ignored directory: `artifacts/backups/phase13-mc00-2026-09-07T11-05-25-392Z/`.

- `database.dump`: 9,610,272 bytes. SHA256 `C9A6A8DF4540B5F1D939E9BA2CFB4A098CC6C8E5732A5DE024D46AEDE0BA8DED`.
- `pg_restore --list` read 2,242 entries; this checks archive readability, not a completed restore exercise.
- `baseline.json` observed at `2026-09-07T11:05:25.895Z`: companies138, sources438, contacts129, research_jobs461, outbound_messages2, drafts9, approvals9, inbound_messages3, provider_usage_events842.
- Existing background research remains active; this is a timestamped backup, not a permanent operational database lock.
- All 57 migration file hashes recorded. Latest applied migration `057_phase11_controlled_shared_crm.sql`, SHA256 `08dfc8d0ff581850c804ee6608a116fce316f2093e57e7910214baf510b3d063`. Existing migrations remain immutable; any future migration starts at actual latest +1.

## Preserved runtime

Existing search jobs show 422 COMPLETED, 14 historical COMPLETE, 17 PARTIAL, 7 FAILED and 1 SCORING at the snapshot. These are existing records, not newly fabricated success evidence. Latest IMAP sync recorded `2026-09-07T11:00:36.369Z`. SMTP and IMAP remain configured/enabled; dashboard manual-only sending remains enabled, while outreach worker sending is disabled. Automatic email follow-up remains closed.

Phase11 regressions and current real-data UI checks remain recorded in the accepted baseline. No extra email was sent to establish this freeze. Provider credentials and database contents are excluded from Git. No public-server deployment is claimed.
