# CL15 consolidated acceptance

Date: 2026-09-13. **Overall: REVIEW_REQUIRED, not full per-route acceptance.** Passing checks below do not substitute for the remaining HTTP coverage.

| Area | Actual evidence |
| --- | --- |
| Ordinary tests after Exa/security/maintenance changes | Final: 1,188 total; 1,134 PASS, 54 SKIP, 0 FAIL |
| Previously optional PostgreSQL checks | 46 enabled and passed independently, not assumed passed because skipped in the ordinary run |
| Empty rebuild and replay | All 63 migrations; 18 reply/CRM and five provider-ledger cases PASS |
| Search/contact/mail/reply | Injected provider, Hunter, SMTP/IMAP outcomes; ambiguity, duplicate prevention, suppression and handoff covered by fixtures; no cleanup live sends |
| Dependency security | Fixed Nodemailer 10.0.9 / ImapFlow 1.7.8; npm production audit: zero vulnerabilities |
| Browser fixture matrix | 169 page/state combinations across all seven specified viewport sizes; 39 further native-200% combinations; dialogs, Back, reload and focus return PASS |
| Deployed read-only browser | 52 route/viewport checks PASS; 200% zoom and reduced motion; four dialog focus/return checks; zero page/HTTP/unexpected-request errors |
| CSS inventory | 2,116 selectors; no unresolved candidates in the current conservative reference scan |
| Static checks | Whitespace and configured-secret scans PASS; current-state validation PASS |
| Runtime isolation | Dashboard and three workers start/restart PASS; empty installation stays empty; four n8n workflow copies imported without activation; temporary resources removed |
| HTTP coverage | 17 injected HTTP tests PASS; 11 current method/path pairs and two retired routes demonstrated; runtime health/list/provider endpoints also sampled |
| Production preservation | Migration 063 adds one ledger entry only; all other 146 business/history table fingerprints unchanged |

## Browser evidence

The existing fixture browser runner was reused. Evidence is in ignored `test-artifacts/cleanup-cl10/browser` and `test-artifacts/cleanup-cl15/browser-native-200`. These are intentionally injected records, never production data. The main reviewer inspected screenshots spanning every navigation page plus email and reply detail; V3 geometry, bilingual hierarchy and bounded mobile scrolling remain intact. Empty evidence/customer-match fixture states are not evidence of populated data rendering.

The separate deployed read-only browser run uses actual database reads. Its initial guard blocked the read-only POST `/api/research/batches/preview`; inspection confirmed registry SELECT plus pure planning only. The guard and test allowlist now permit that exact preview while still blocking creation. A startup race was also fixed in the harness with a readiness check. Original failed run records are retained; final deployed-browser outcome is in the final report.

## Remaining acceptance gap

The [route ledger](CL15_ROUTE_COVERAGE.md) enumerates 158 unique method/path identities. This round has not demonstrated full positive/negative HTTP behavior for the remaining 145 identities; static references and service-unit tests are not relabeled as HTTP execution. Accordingly, **no full CL15 PASS or accepted-runtime tag is justified**. Genuine production SMTP/IMAP/CRM and active n8n execution were deliberately not invoked as acceptance tests.

Details: [backend](CL15_BACKEND_ACCEPTANCE.md), [runtime](CL15_RUNTIME_ACCEPTANCE.md), [Exa](../EXA_SEARCH_PROVIDER.md). Exa's later one-request configuration probe is separate from zero-provider-spend cleanup fixtures.
