# Phase 12 WP-UI14 — Independent regression and read-only audit

Audit time: 2026-09-07 16:21–16:30 Asia/Shanghai. Working-tree inspection, not a committed release. Scope: automated regression, production frontend asset references, credential-pattern screening, and business-interface diff review. Browser acceptance is owned by the main workstream and is not asserted here.

## Actual execution results

Primary-workstream final supplement, 16:43 +08:00: after shared dialog boundaries and the last visual fixes, full suite **913 total / 859 passed / 0 failed / 54 skipped**. The existing isolated PostgreSQL runner additionally passed **18/18** checks with 57 migrations in a temporary database, production ledger read-only, and zero provider calls. Temporary database cleanup was verified. This does not change the skipped live-provider tests into passes. Final static traversal is **47 paths / 1,629,428 text bytes / zero failures**. Business aggregate and runtime-flag snapshots compare unchanged; see `PHASE12_UI12_UI14_RESULT.md` for final primary-workstream evidence. Earlier point-in-time results below are retained.

| Check | Actual result | Status |
| --- | --- | --- |
| `npm test` in `services/demo-dashboard` | 902 tests: 847 passed, 1 failed, 54 skipped | FAIL — status metadata validation only |
| Full-suite rerun after primary workstream reconciled status metadata | 906 tests: 852 passed, 0 failed, 54 skipped | PASS for executed tests |
| Final full-suite rerun including independent responsive contract tests, 16:30 | 911 tests: 857 passed, 0 failed, 54 skipped | PASS for executed tests |
| New `test/phase12-responsive.test.js` | 5 tests passed: shell width, 64px topbar geometry, uncapped mobile company list, full-row mobile Settings selector, equal bilingual typography with compact spacing | PASS — source contract, not screenshot acceptance |
| `node --test test/phase10*.test.js test/phase11*.test.js` | 340 tests: 290 passed, 0 failed, 50 skipped | PASS for executed tests |
| `node scripts/phase12-static-assets-check.mjs` | 47 static documents/modules, 1,627,087 text bytes, 0 failed loads, 0 external asset origins | PASS within script scope |
| Production HTML/CSS/JS external UI reference scan | No CDN, Google Fonts, Font Awesome, remote avatar, remote CSS URL, or CSS `@import` matches outside vendor scope | PASS — static inspection |
| Credential-pattern filename-only screening of production files | No private-key header, long OpenAI/Tavily token-shaped value, or quoted password assignment matches | PASS — bounded pattern screening, not an absolute secret-free guarantee |

The initial failed full-suite case was `test/current-project-status.test.js`, reporting `Current status commit does not match the latest implementation commit` from `scripts/verify-current-project-status.mjs:163`. The primary workstream reconciled the status metadata; both subsequent full-suite executions passed. The original failure remains recorded above for traceability. No failing test was removed or skipped by this audit.

Skipped live PostgreSQL/provider integration tests remain NOT RUN. For example, schema rollback checks require explicit `PHASE11_LIVE_SCHEMA_ROLLBACK=1`; this audit did not enable live-write flags. Passing fixture tests does not establish a fresh real SMTP/IMAP round trip.

## Business behavior and data truth review

- Existing Phase 10 tests passed for category-level opportunity decisions, scope matching without an exact SKU requirement, official contact routes, provider/account states, task classification and UI contracts.
- Existing Phase 11 tests passed for stable Message-ID, ambiguity handling, UIDVALIDITY/checkpoint logic, eligibility and approvals, blocked retries, immutable draft versions, suppression and controlled/prospect isolation. Provider test adapters are fixtures; no real recipient was contacted by this audit.
- The diff in `public/ui/outreach-workbench.js` and `public/ui/contact-queue.js` contains no changed API endpoint, HTTP method or request-body lines. This is a scoped diff check, supplemented by the existing behavioral tests; it is not a claim that every application file is unchanged.
- Additional overview reads use existing metrics, research summary/jobs and outreach operations/workbench endpoints. Evidence reads existing `/api/leads` and `/api/leads/:id`. These reads do not create jobs, drafts, approvals or sends.
- Source metadata is shown only when returned. No page-title, finding or capture-time substitute is fabricated. Missing evidence has a real empty state. Coverage bars use valid returned percentages only.
- There **is** a backend change in the current working tree: `src/phase7/repository.js` adds four SELECT aggregate fields to `getOutreachOperationsSummary`: `sent_no_reply`, `pending_followups`, `pending_management`, `pending_contacts`. It is inaccurate to call the complete Phase 12 diff “backend untouched”. The reviewed addition changes a read projection, not score/write/mail transitions. Follow-up counts explicitly filter `record_scope='PROSPECT'`; controlled application message counters remain sourced from their separate controlled tables.
- No package manifest or lockfile change was found in the inspected backend/dependency diff.

## Limits and remaining main-thread checks

1. Status metadata reconciliation and full-suite rerun are complete: final 911 total, 857 pass, 0 fail, 54 skipped.
2. Compare actual before/after database counts and SMTP attempt evidence through the main thread's read-only baseline mechanism; this audit did not query or mutate the database.
3. Browser screenshots, keyboard/focus, responsive states, console/runtime network, reduced motion and zoom require the separate visual QA record.
4. The static asset script follows HTML asset references and local JavaScript imports. It does not measure full browser font/image transfer bytes or rendering speed; 1,627,087 is text-byte inventory, not page-load performance or a percentage-regression claim.
5. No live email, approval, research submission, import commit, database edit, source-file mutation, browser operation, commit, push or tag was performed by this audit workstream.
