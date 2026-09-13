# CL15 consolidated acceptance

Date: 2026-09-13. **Overall: REVIEW_REQUIRED, not full per-route acceptance.** Passing checks below do not substitute for the remaining HTTP coverage.

| Area | Actual evidence |
| --- | --- |
| Ordinary tests after Exa/security/maintenance changes | Final: 1,257 total; 1,203 PASS, 54 SKIP, 0 FAIL |
| Previously optional PostgreSQL checks | 46 enabled and passed independently, not assumed passed because skipped in the ordinary run |
| Empty rebuild and replay | All 63 migrations; 18 reply/CRM and five provider-ledger cases PASS |
| Search/contact/mail/reply | Injected provider, Hunter, SMTP/IMAP outcomes; ambiguity, duplicate prevention, suppression and handoff covered by fixtures; no cleanup live sends |
| Dependency security | Fixed Nodemailer 10.0.9 / ImapFlow 1.7.8; npm production audit: zero vulnerabilities |
| Browser fixture matrix | 169 page/state combinations across all seven specified viewport sizes; 39 further native-200% combinations; dialogs, Back, reload and focus return PASS |
| Deployed read-only browser | 52 route/viewport checks PASS; 200% zoom and reduced motion; four dialog focus/return checks; zero page/HTTP/unexpected-request errors |
| CSS inventory | 2,116 selectors; no unresolved candidates in the current conservative reference scan |
| Static checks | Whitespace and configured-secret scans PASS; current-state validation PASS |
| Runtime isolation | Dashboard and three workers start/restart PASS; empty installation stays empty; four n8n workflow copies imported without activation; temporary resources removed |
| HTTP coverage | 82 injected HTTP tests PASS across Research and Phase7; 72 current method/path pairs and two retired routes demonstrated; additional isolated server checks recorded separately |
| Full-server read paths | All 53 direct GET identities returned 200; 114 actual requests; zero 5xx; includes frozen plan, verification details and historical CRM fixtures |
| Full-server write paths | 81 checks PASS across 32 of 33 direct write identities; actual isolated PostgreSQL persistence/replay, invalid input and transition rejection; worker completion not inferred from 202 |
| Production preservation | Migration 063 adds one ledger entry only; all other 146 business/history table fingerprints unchanged |

## Browser evidence

The existing fixture browser runner was reused. Evidence is in ignored `test-artifacts/cleanup-cl10/browser` and `test-artifacts/cleanup-cl15/browser-native-200`. These are intentionally injected records, never production data. The main reviewer inspected screenshots spanning every navigation page plus email and reply detail; V3 geometry, bilingual hierarchy and bounded mobile scrolling remain intact. Empty evidence/customer-match fixture states are not evidence of populated data rendering.

The separate deployed read-only browser run uses actual database reads. Its initial guard blocked the read-only POST `/api/research/batches/preview`; inspection confirmed registry SELECT plus pure planning only. The guard and test allowlist now permit that exact preview while still blocking creation. A startup race was also fixed in the harness with a readiness check. Original failed run records are retained; final deployed-browser outcome is in the final report.

## Remaining acceptance gap

The [route ledger](CL15_ROUTE_COVERAGE.md) enumerates 158 unique method/path identities; 157 now have actual HTTP evidence. POST `/api/live/collect` remains unexecuted. Several outcomes deliberately exercise maintenance, disabled/empty work or queue acceptance rather than live external completion. These are not full successful business flows. Accordingly, **no unrestricted CL15 PASS or accepted-runtime tag is claimed**. Genuine production SMTP/IMAP/CRM and active n8n execution were deliberately not invoked as acceptance tests. Restoring paid/background execution requires a separate controlled decision; current data and controls remain preserved.

Details: [backend](CL15_BACKEND_ACCEPTANCE.md), [runtime](CL15_RUNTIME_ACCEPTANCE.md), [Exa](../EXA_SEARCH_PROVIDER.md). Exa's later one-request configuration probe is separate from zero-provider-spend cleanup fixtures.

Extended HTTP evidence: [Phase7](CL15_PHASE7_HTTP_ACCEPTANCE.md), [server reads](CL15_SERVER_HTTP_ACCEPTANCE.md), [server writes](CL15_SERVER_WRITES_HTTP_ACCEPTANCE.md). The extended acceptance fixed twelve malformed UUID server errors and three category validation server errors; all recorded regressions now return the expected 400/404 responses without changing business decisions.
