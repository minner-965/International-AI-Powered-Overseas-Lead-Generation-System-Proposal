# Phase 5 V2.3 Import Result

## STATUS

**PASS — Phase 5 V2.3 complete; Phase 6 not started**

## SHARED FOLDER SAFETY

| Operation by this phase | Count |
| --- | ---: |
| Modified | 0 |
| Deleted | 0 |
| Renamed | 0 |
| Moved | 0 |
| Created inside share | 0 |

An unrelated process edited one 37TH F1/PEDIDO workbook while the deep scan was running. Two subsequent full metadata baselines were stable. The 54 files selected for staging were individually verified with matching source-before, local-copy and source-after SHA-256 values.

## DEEP SCAN

- Relevant workbooks reviewed: 502
- Readable non-sensitive source candidates: 500
- Worksheets inspected: 1,205
- Non-empty business rows structurally processed: 30,781
- Exact TF1 files: 2
- Order/purchase-order candidates: 205
- Product-price/quotation candidates: 324
- Invoice/customs candidates: 358
- Shipment/logistics candidates: 355
- Customer follow-up/comment candidates: 92; these are overlapping remark/status candidates, not confirmed funnel exports
- Sample-tracking candidates: 97

## TF1

- Actual meaning: mixed product, order, pricing and shipment/logistics tracking
- Common fields: product/style, quantity, packing, carton/CBM/weight, supplier price, customer sales price, cost, sales, profit/margin and optional HS/tax fields
- Follow-up support: not available as a reliable funnel source
- Price support: strong, with supplier and customer price kept separate
- Customer support: limited; filename context is not a canonical identity
- Order support: partial; stable external order ID and order date are not present across all layouts

## STAGING

- Files copied to Git-ignored local staging: 54
- Source hashes verified: 54 of 54
- Parsed sheets: 60
- Encrypted files included in the business import: 0
- Sensitive HR/finance local copies included in the business import: 0

## IMPORT

| Measure | Actual result |
| --- | ---: |
| Batch ID | `30ffd8e4-d865-4457-93ef-e52a85ac8c73` |
| Batch key | `phase5-v2.3-mx-history-001` |
| Status | `IMPORTED` |
| Source files | 54 |
| Reference imports | 117 |
| Staged rows | 766 |
| Committed rows | 500 |
| Review rows | 266 |
| Rejected rows | 0 |
| Customers | 5 |
| Customer aliases | 20 |
| Orders/source versions | 17 |
| Order lines | 92 |
| Products | 366 |
| Follow-up outcomes | 0 |
| Channels | 0 |
| Errors | 0 |
| Warnings | 511 |

The committed order set contains 14 confirmed and 3 cancelled source versions. Product profiles are 109 Womenswear, 18 General Merchandise and 239 Unknown. Unknown values were retained rather than fabricated.

Re-running the same batch reused the existing import batch and deterministic row identities. Missing source hashes: 0. Missing source identities: 0. Duplicate source identities: 0.

Migration 021 completed the future-source version contract and corrected unsupported derived fields:

- each batch owns its own import observation;
- an exact cross-batch replay is recorded as `DUPLICATE` and links to the earlier observation;
- a changed file receives the next `import_version` and `supersedes_import_id`;
- the same PO from a changed source receives the next order `source_version` and a supersedes link;
- 353 product MOQ values that had been derived from order quantity were cleared to `NULL`;
- no customer, order, order-line, product, import or import-row record was deleted.

## MARKET

- MX historical customers: 5
- MX order source versions: 17
- MX normalized customer/order records detected during dry run: 22
- AE historical records: 0
- UAE remains a prospecting market; no UAE converted-customer history is claimed
- Bangladesh remains configured for future use and hidden from the current UI

## HISTORICAL ICP

- Profile: DPV Mexico Historical Customer ICP
- Version: `mx-historical-v2` (`mx-historical-v1` retained as `RETIRED`)
- Status: `ACTIVE`
- Reference market: MX
- Application markets: MX, AE
- Sample customers: 5
- Sample latest confirmed orders: 13
- Feature coverage: 63.21%
- Product-profile coverage: 100%
- Repeat-order coverage: 100%
- Order-quantity coverage: 97.14% (68 of 70 latest-confirmed order lines)
- Explicit customer-price coverage: 24.29% (17 of 70 rows; USD 1.25–9)
- Commercial MOQ coverage: 0%; unavailable because no explicit MOQ source was found
- Channel coverage: 0%
- Win/loss coverage: NONE
- Limitation: converted/order history only; no complete sales-funnel or loss dataset

## CUSTOMER MATCH

- Management Baseline Match and Mexico Historical Reference Match are persisted independently.
- Five current verified UAE companies have both match types.
- Re-running the same ten acceptance calculations created no duplicate rows.
- The company detail endpoint returns `management_baseline` and `mx_historical_reference` separately.
- The Opportunities view shows both values beside the unchanged DPV score.
- `/api/leads`, `/api/export/leads` and `/api/opportunities` share the same confirmed-existing-customer exclusion.

## EXISTING CUSTOMERS

- Imported historical customers are classified as `INTERNAL_EXISTING_CUSTOMER`.
- Confirmed exact links to the current public-company table: 0.
- No current public prospect was silently tagged from name similarity alone.
- Confirmed links, when created later from sufficient evidence, are excluded by the Opportunities query from new-customer prospecting while remaining available for account history and ICP reference.

## LEGACY CORE COUNTS

The production import did not change the existing public research dataset:

| Table | Rows after import |
| --- | ---: |
| Companies | 97 |
| Sources | 137 |
| Contacts | 31 |
| Lead reviews | 93 |
| Research jobs | 16 |
| Collection runs | 12 |

## TESTS

- Migration 020: PostgreSQL 17 migration chain and repeat execution passed.
- Parser, staging-bundle, import, provenance, idempotency, market visibility, historical ICP, dual Customer Match, existing-customer exclusion and frontend tests passed.
- Final full-suite result: 161 tests, 158 passed, 0 failed, 3 conditional skips; the PostgreSQL cross-batch integration test was also run explicitly and passed.
- Docker services: dashboard healthy, PostgreSQL healthy, n8n running with unchanged behavior.
- Browser checks: desktop and 390px mobile layouts, internal table scrolling, three ICP cards, dual-match columns and import-batch display passed.

## BLOCKERS

None for Phase 5 V2.3.

Unavailable data remains explicit: follow-up/win-loss outcomes, channel, company size and some currencies. Encrypted HR/finance local copies are isolated from this phase and do not block the customer/order/product import.

## READY FOR PHASE 6

**YES — after management review of the five Phase 5 V2.3 result documents.**

Phase 6 has not started.
