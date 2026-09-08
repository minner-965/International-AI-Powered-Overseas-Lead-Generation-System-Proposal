# Phase 13 — MC04 Opportunity Pool Result

Date: 2026-09-08. Scope: WP-MC04 only. Status: PASS for the documented MC04 implementation and verification scope. STOP; no MC05 execution.

## Approved behavior

- PRECISION, RELEVANT and GENERAL_RELEVANT enter Active Business Opportunity automatically. No manual Opportunity Confirmation is required.
- Review flags are nonblocking evidence warnings, including broad category scope, evidence attribution and mixed operating roles. They do not claim that ambiguous source evidence has been independently verified.
- Business Opportunity, Contact Readiness and Email Eligibility are separate fields. Missing contact data, previous email or suppression does not remove business membership. Mailbox verification, suppression, exact draft approval and existing send limits remain authoritative for mail.
- Category-level supply fit is retained; no exact SKU requirement, manual product supplementation or new scoring calibration.

## Actual database and visibility

| Band | All stored companies | Visible-market API |
|---|---:|---:|
| PRECISION | 4 | 4 |
| RELEVANT | 2 | 2 |
| GENERAL_RELEVANT | 22 | 21 |
| EXPLORATORY | 101 | 100 |
| NOT_SUITABLE | 9 | 9 |
| Total | 138 | 136 |
| Active Business Opportunity | 28 | 27 |

The difference is the preserved hidden-market filter, not lost data. The visible API reports 21 active companies with a ready contact channel and 0 with authorized email eligibility. Email-ready contact facts are not permission to send. Current business opportunities include previously contacted companies; the first-contact queue independently filters completed first contacts.

Migration `058_phase13_opportunity_pool.sql` SHA-256: `544d7f2f8567900a4cbd36a35f6ab24e610cbe065f2fad3192342215333ef0be`.

Initial application appended 138 decisions. A subsequent explicit authorization-reason refinement appended another 138, preserving both revisions: 276 historical decisions, 138 current projections. Identical replay inserted 0 and reused 138. The append-only trigger rejects UPDATE and DELETE. Existing decision tables, source evidence, scores and approvals were not rewritten.

Private backup: `artifacts/phase13-mc04/2026-09-08T03-38-06-171Z/database.dump`, 9,606,850 bytes; SHA-256 `a5baf253c3c56a84a7cf8efa2fb04b64d875f87a7bf99d987f18eb1333afd4c6`. Archive listing checked; production restore was not performed.

The initial migration comparison changed only the new pool table and migration ledger; 128 other business tables and five runtime tables were unchanged. The final append comparison changed only pool decisions; all other 129 business tables and five runtime tables matched. Across service restarts/background polling, provider-account cache and IMAP checkpoint hashes changed separately, with unchanged counts; this is recorded rather than described as a completely frozen runtime.

## V3 integration

| Surface | MC04 change |
|---|---|
| Overview | Active-company KPI and market distribution use pool membership, not first-contact or mail status |
| Opportunities | Three approved bands admitted directly; independent state display; nonblocking expandable notes; profile/band filtering |
| Company Detail | Shared three-state presentation; pool companies can open detail while original evidence/identity status remains intact |
| Contact-ready | Active business membership plus current usable channel; one company per row; first-contact progress remains separate |
| Research / Jobs | Current pool summary and linked-company result projections; persisted historical job outcomes are retained |
| Email Review | Business and contact states shown separately from existing email approvals and exact-version send permission |
| Search Operations | Existing Research/Jobs/Settings service-monitor surfaces show the common summary; no invented standalone route |
| Export | Additive business-band, active-membership, readiness and warning columns alongside existing email eligibility and history |

UI uses the existing dpv-workspace-ui / V3 components and ui-ux-pro-max compact disclosure guidance. No design replacement or dependency was needed. Chinese/English labels remain stacked at equal size. Mobile channel details use expandable secondary content rather than stacking every channel in the initial card.

## Verification evidence

- Isolated PostgreSQL: 7 checks passed: automatic active status without contact, warning/suppression separation, append/replay, A→B→A history, concurrent refresh, immutable-history protection and unrelated-history preservation. Temporary database deletion and absence verified.
- Actual GET API + existing CSV/XLSX serializers: 136 rows, 22 columns, 137 XLSX rows including header; all 2,992 data cells round-tripped. Formula-prefix escaping and private-column protection passed. This is serializer integration testing, not an end-user export download test; no export job was created.
- Actual migration/append evidence: `artifacts/phase13-mc04/2026-09-08T03-47-57-911Z/verification.json` and `artifacts/phase13-mc04/2026-09-08T03-52-36-162Z/final-receipt.json`.
- Full application suite: 1,031 tests, 977 passed, 0 failed, 54 skipped. Skipped tests are not counted as executed acceptance. Current-status validator and whitespace/diff checks passed.
- Real browser: five widths (375, 390, 768, 1024 and 1440), 50 page/dialog observations with no document overflow, unnamed visible buttons or JavaScript errors. Ten dialog Escape/focus-restoration checks passed. Existing CRM-history 404 for an unlinked company is the expected empty-history contract, not an invented linked record.
- After compact mobile corrections, 375/1440 recheck: 16 observations, no page overflow or JavaScript/network errors, actual five-company research result rendered; isolated loading and 503/retry behavior passed. Evidence: `artifacts/phase13-mc04/ui/2026-09-08T03-57-46-897Z/`. These checks are scoped browser assessments, not full WCAG certification or human screen-reader testing.
- Actual discovery-job linkage was corrected to include enrichment, cohort/requested companies, persisted company provenance and verification relations. Previously omitted discovery job `d363645e-1f5e-4d15-93e5-e607a846e764` resolves five companies. Missing enrichment execution facts remain null, not fabricated counts. Latest company states are labeled separately from historical job results.
- Runtime updated by rebuilding and restarting only dashboard/category-worker. PostgreSQL volumes and n8n behavior were preserved. New-company verification and completed category/business/cooperation evaluations refresh the pool after the underlying operation commits; no manual bootstrap is needed for those future operations.
- Final deployed Research/Jobs visual correction: result dimensions use three columns, company results have separators, Research summary spans the KPI grid. Actual 375px columns are 109px each and 1440px columns 368px each, without overlap or page overflow. Final viewed screenshots: `artifacts/phase13-mc04/ui/final-job-review/research-summary-final-375.png` and `research-summary-final-1440.png`; the `research-{width}.png` files in that folder redirected to Jobs and are not Research evidence. Valid job-detail screenshots demonstrate the repaired five-company result.

## Boundaries and known limitations

- Zero task-triggered search/Hunter/SMTP calls and zero emails sent. Automatic sending/follow-up remain closed; manual policy is unchanged.
- MC04 does not grant email authorization to new pool members. The existing legacy mail snapshot/approval workflow still requires its own compatible authorization evaluation. New active companies can therefore show pending/ineligible email status; the pool must not manufacture an old FIT decision or approval to bypass that workflow.
- The approved broad bands retain the MC03 evidence-quality risks as warnings. Approval of the bands is not proof of current purchasing demand or guaranteed contactability.
- Historical plans and MC03 reports remain as historical records. Current rules and V3 page contracts explicitly state the MC04 amendment.
- No MC05 work, new research batch, provider activation, remote push or release tag is part of this task.
- Changes are retained in the local working tree; no new implementation commit has been created in this task.
