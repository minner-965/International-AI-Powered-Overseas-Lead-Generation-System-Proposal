# CL16 metrics and final candidate review

Measured 2026-09-13 before final release. Source baseline is `07af1424ad92ab9ba490b9bcafa5d025d0e16e19`, the clean accepted source recorded by CL00; `8abfd7f` is the subsequent freeze checkpoint. Run `node scripts/cleanup-final-metrics.mjs` to reproduce. The script is read-only, reads only source/example configuration and prints no environment values.

## Before/after measurements

| Metric | Source baseline | Current working tree |
| --- | ---: | ---: |
| Git index entries | 818 | 901 |
| Existing tracked plus nonignored additions | 818 | 909 |
| Runtime source JS files | 135 | 139 |
| Authored public CSS bytes | 189,554 | 187,048 |
| Authored source/public JS bytes | 2,377,990 | 2,371,867 |
| Static Express route declarations | 159 | 159 |
| Compose services | 7 | 7 |
| Tracked workflow JSON exports | 4 | 4 |
| Direct production dependencies | 16 | 16 |
| Distinct example environment keys | 155 | 144 |
| Markdown under docs outside history | 164 | 79 |
| Markdown under docs/history | 0 | 123 |

Counts change when the coordinating task adds/stages final reports; rerun at release. New Exa source files are included and are explicitly user-owned additions, not cleanup waste. Documentation counts are location-based: the non-history count includes cleanup acceptance reports, not only operating instructions. Bytes are raw bytes; worktree CRLF differences may contribute. Route counts use one identical regex before/after, not CL09's expanded route-method inventory; they neither replace that inventory nor prove reachability.

Queue handler count, semantically visible AI/legacy string totals, obsolete-state-key total, full tests and browser errors are **not measured by this metrics script**. No zero is fabricated. CL08 records removal of four orphan queue declarations/handlers while preserving queue history. CL10 and current copy tests evaluate app-owned wording; source evidence/correspondence and historical rule identifiers remain intact. Final full-suite/browser/current-state results belong in the coordinating CL15/FINAL report. CL00 recorded 1,119 tests: 1,063 PASS, 56 SKIP, zero failures.

## Final deletion candidate disposition

References below distinguish proven zero-caller removals from retained compatibility; historical inventory files remain unchanged.

| Path/symbol/object | Classification/reason | Reference count before | Replacement | Verification | Deleted | History preserved |
| --- | --- | --- | --- | --- | --- | --- |
| Synchronous discoveryService and hardcoded query generator | Retired active code (CL04) | Zero active discovery callers after country helper extraction; exact numeric historical count not recounted | Frozen query plan executor/current country helper | CL04 search fixtures | Yes in CL04 | Yes |
| In-memory reply correlator/sender-only fallback | Retired active code (CL07) | Zero production callers established in CL07 | Persisted RFC correlation/current classifier | Reply/CRM isolated fixtures | Yes in CL07 | Yes |
| Four orphan queue handlers named in CL08 | Retired declarations | Zero producers/pending/schedules/outbox consumers established in CL08 | Existing current handlers | CL08 orchestration evidence; CL15 isolated queue tests | Yes in CL08; no DB queue deletion | Yes |
| contact-result-table and unused dpv component aliases | Retired scaffold/duplicate CSS | Zero HTML/JS/test callers in CL11 | crm/table/form/dialog V3 components | CSS AST and assets tests | Yes in CL11 | Yes |
| Existing current Express routes/admin/history adapters | KEEP_CURRENT | Nonzero or external consumers not disproved | Existing authenticated routes, including 410 compatibility boundary | CL09 route inventory/security fixtures | No | Yes |
| Gmail/Resend adapter paths | KEEP_CURRENT compatibility | Nonzero service/worker/test references | Selected SMTP path remains default; other adapters isolated | CL06/CL15 mail fixtures | No | Yes |
| Phase-named CSS/JS and reference dashboard HTML | KEEP_CURRENT | Referenced HTML/import or reference-test paths | Same V3 components | Fresh CSS audit: 2,116 selectors, zero unresolved candidates | No | Yes |
| Applied migrations, business/evidence/mail/queue history | KEEP_IMMUTABLE_HISTORY | Audit/FK/current-read dependencies | Existing immutable lineage | CL13 inventory and CL15 rebuild/replay | No | Yes |
| Historical operation/repair scripts | REVIEW_REQUIRED retention | CLI/recovery consumers are not disproved by static imports | No proven replacement for every operator use | CL12 script inventory | No | Yes |
| Exa provider/configuration/repair additions | USER_CURRENT_WORK | New router/server references; user confirms ownership | Exa integration follows cleanup | Separate Exa acceptance required | No | Yes |

This final independent audit performed **no further deletion**. Missing static references alone do not establish absence of runtime/operator/audit use.

## Fresh CSS audit

`node scripts/cleanup-cl11-css-audit.mjs` was executed without writing its historical report: 21 files, 2,116 selectors; 1,984 referenced, 114 structural, 17 dynamic, one vendor-compatible, zero unresolved candidate selectors. All retained selectors have a recorded conservative reason; this does not claim every pseudo-state was exercised visually.

## CL15 dependency security closure

Nodemailer `7.0.6` → `10.0.9`; ImapFlow `1.2.10` → `1.7.8`. Versions are exact-pinned. Nodemailer 10 requires Node ≥20; local Node 24.19 and Docker Node 24 satisfy this. ImapFlow remains on its repaired 1.x line instead of introducing the 2.x TypeScript rewrite. No application interface changes were necessary. [Nodemailer requirements](https://nodemailer.com/), [supported security line](https://github.com/nodemailer/nodemailer/security), [ImapFlow migration information](https://imapflow.com/docs/getting-started/installation/).

- `npm install --ignore-scripts`: PASS; four packages removed, five changed.
- `npm ls --depth=0`: PASS.
- `npm audit --omit=dev`: **zero vulnerabilities**, replacing the previous two high-severity affected packages.
- Mail/Phase7/Phase11/template/reply fixtures: 236 tests, 233 PASS, three SKIP, zero FAIL.
- Native GoRules smoke: PASS.
- Installed Nodemailer stream transport generated a local RFC message with fixed Message-ID and unsubscribe header; ImapFlow construction/API-method smoke: PASS. No SMTP/IMAP connection was made.

Full integrated regression, intended runtime restoration, remote push/tag verification and Exa live verification remain coordinating-task responsibilities. This report does not pre-claim release acceptance.
