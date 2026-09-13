# Phase 8 UI/UX Rebuild Result

Date: 2026-08-31

Authoritative plan: `DPV_PHASE8_UI_UX_CODEX_EXECUTION_PLAN_V1.md`

Phase 7 baseline and peeled tag: `bd4af24634069aa3ee9b009c1e8799d627eff118`

Phase 8 implementation commit: `6579d57f79fbc2646a03e219923fef6d570fd105`

## Final status

```text
CONTACT-READY RECOMMENDATION GATE: PASS
PHASE 8 UI/UX REBUILD: PASS
REAL RECOMMENDED OPPORTUNITIES: 0
REAL PROSPECT SENDS: 0
PHASE 9 ENRICHMENT: NOT STARTED
```

Phase 8 is accepted with zero Recommended opportunities because the release objective is to enforce the contact-readiness boundary and present the current operational state accurately. No fallback company, high-score lead or sample record is shown as contact-ready.

## Contact-ready recommendation gate

Migration `028_phase8_contact_ready_recommendation.sql` was applied before the interface rebuild. Its SHA-256 is:

```text
c45f4d3be0e97583fd1b05a76120cec8b9d78b937f268f6f8150c9149c6252f4
```

The explicit runner verified the new `business_fit_status` column, current view projection, value constraint and V2 contact-ready constraint. Repeated execution returned `SKIPPED_ALREADY_APPLIED` for migrations 025, 026, 027 and 028. The historical 001 through 027 sequence remains covered by the Phase 7 accepted migration result; Phase 8 adds and replays 028 without rewriting earlier migration files.

Current decision distribution:

| Business fit | Count |
|---|---:|
| `EVIDENCE_REQUIRED` | 12 |
| `NOT_SUITABLE` | 2 |
| `FIT` | 0 |

| Current displayed decision | Count |
|---|---:|
| `EVIDENCE_REQUIRED` | 12 |
| `NOT_SUITABLE` | 2 |
| `RECOMMENDED` | 0 |
| `MANAGEMENT_APPROVED` | 0 |

The V2 refresh added 14 append-only decision revisions and preserved the 14 Phase 7 decision revisions. Company and product-master counts remain 106 and 366.

The management-approval route now rejects a stale revision, a non-contact-ready decision, a missing current eligible snapshot, an invalid or mismatched recipient and a current suppression before it creates a management event, queue item or recipient.

## Current operational evidence

Database checks after migration, UI testing and export testing:

| Record | Count |
|---|---:|
| Current decisions | 14 |
| Management approval events | 0 |
| Contact Queue items | 0 |
| Outreach recipients | 0 |
| Outbound messages | 0 |
| Provider usage events | 0 |
| Email message events | 0 |

No Hunter batch, provider send, prospect message or Phase 9 enrichment job was started.

## Interface result

- Opportunities is the default decision surface and defaults to `RECOMMENDED`.
- Overview uses only Recommended opportunities and shows four actual management counts.
- The zero state explains the Product Match, Buyer/Procurement responsibility and VALID contact requirements without substituting Company Directory rows.
- Six status views and all 20 opportunity query parameters remain available; secondary filters are grouped in an advanced dialog with removable active-filter chips.
- The operational table uses seven decision columns at desktop width and converts to readable records on mobile.
- Evidence Required routes product/category, buyer model, buyer contact, buyer role, email verification, identity and history blockers to a next action.
- Contact Queue is an independent navigation view backed by the existing management API.
- Companies remains the 106-record master directory. It has eight directory columns and no Confirm Contact, message approval or send action.
- Company record review is labelled `Confirm Company Record` / `Exclude Company Record`, separate from opportunity management approval.
- Company detail uses four top-level areas: Snapshot, Business Fit, Buyer & Contact, and Activity & Records. Product Match, both Customer Match references, scoring and Phase 7 lazy record panels remain available inside those areas.
- Data Import and Data Export now show explicit six-step progression while retaining the Phase 7 endpoints, roles, CSRF and form contracts.
- Light, dark and system modes; comfortable and compact density; and standard and compact bilingual spacing remain available.
- Chinese and English remain stacked with equal computed font size, weight, line height and colour. Visual hierarchy comes from component role and layout, not from shrinking English.

Superseded runtime presentation was removed or replaced: the 11-column default opportunity table, Company Directory fallback, 15 equal-weight top-level detail tabs, legacy manual-approval wording, gradients and decorative placeholder metrics are not present in the Phase 8 surface. Underlying business panels and APIs remain where the accepted plan requires reuse.

## Responsive and accessibility acceptance

Browser acceptance covered:

```text
1440 × 900
1024 × 768
768 × 900
390 × 844
375 × 667
844 × 390
```

All six dimensions showed one active primary navigation item, no page-level horizontal overflow and component-owned overflow for dense data. The mobile sidebar leak found during acceptance was corrected with clipped horizontal overflow and independent vertical scrolling, then rechecked at 390 × 844.

Verified interactions include mobile menu open/close, Escape close with focus return, advanced-filter dialog close with opener focus restoration, four-section detail switching, detail close with row focus restoration, theme and density switching, native zoom support, visible focus styling, reduced-motion rules and 44px controls. A sample of 120 rendered bilingual pairs had no computed size, weight, line-height or colour difference.

Local acceptance screenshots and the viewport manifest are stored under the Git-ignored `runtime/phase8-visual-audit/` directory.

## Export acceptance

The deployed management API created, processed and downloaded a real XLSX export after the UI rebuild:

| Check | Result |
|---|---:|
| Export state | `READY` |
| Rows | 14 |
| Applied columns | 31 |
| Downloaded bytes | 9,760 |
| XLSX ZIP magic | `504b0304` |
| Download audit | recorded |

The exported file was generated in the private runtime volume and was not added to Git.

## Test and runtime result

```text
npm test
tests: 449
passed: 446
failed: 0
skipped: 3
```

The three skips are existing conditional integration fixtures. Phase 8 UI contracts pass 17/17. The focused Phase 5/6 UI, Phase 7 UI and Phase 8 compatibility group passes 67/67 after replacing assertions for superseded layouts while preserving Product Match, independent reference matching, enrichment triggers and API/security contracts.

Docker checks after rebuild:

- PostgreSQL: healthy
- demo-dashboard: healthy
- category-worker: running
- data-worker: running
- outreach-worker: running
- n8n: unchanged and running
- `/api/health`: database ready

`npm audit --omit=dev` reports two moderate findings in the pinned ExcelJS 4.4.0 dependency path through `uuid`. The suggested forced change is an incompatible ExcelJS downgrade, so the tested export runtime remains pinned and the findings remain tracked for an upstream-compatible resolution. No high or critical finding is present.

## Acceptance checklist

- [x] Phase 7 baseline, main and peeled tag verified
- [x] Phase 7 plan-version erratum recorded without changing Phase 7 results
- [x] Gate 0 implemented before the interface rebuild
- [x] Missing Buyer, role or current VALID email cannot become Recommended
- [x] Management approval requires a current contact-ready eligible decision
- [x] Current Recommended = 0 and Management Approved = 0
- [x] Current provider calls = 0 and prospect sends = 0
- [x] Opportunities is the primary management decision surface
- [x] Overview Recommended list never falls back to Company Directory records
- [x] Companies has no contact-confirmation bypass
- [x] Evidence Required routes contact, buyer-role and email blockers
- [x] Contact Queue is an independent view
- [x] All 20 opportunity filter semantics are retained
- [x] Four-section detail workspace accepted
- [x] Import/export progression and deployed XLSX download accepted
- [x] Six responsive dimensions, colour modes and bilingual hierarchy accepted
- [x] Phase 7 API, security and data contracts preserved
- [x] Migration apply/replay and full test suite accepted

## Release boundary

Implementation was pushed on `main` in commit `6579d57f79fbc2646a03e219923fef6d570fd105`. The release handoff commit is the commit referenced by the annotated `phase8` tag.

STOP — Phase 9 real-opportunity enrichment and Phase 10 live-contact pilot were not started.
