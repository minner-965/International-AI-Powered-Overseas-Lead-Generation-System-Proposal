# Phase 5 V2.3 Import Dry Run

## Status

**PASS — production commit was authorized only after this gate passed**

Batch key: `phase5-v2.3-mx-history-001`

The dry run used project-local, Git-ignored copies. It did not read production rows from HR or finance files and did not write to the shared folder.

## Dry-run counts

| Measure | Actual result |
| --- | ---: |
| Files staged | 54 |
| Files parsed | 54 |
| Parsed sheets | 60 |
| Sheets requiring at least one review decision | 60 |
| Exact TF1 files | 2 |
| Broader TF1/F1/PRE-PEDIDO family files | 33 |
| TF1-family rows parsed | 524 |
| Customers detected | 5 |
| Customer aliases | 20 |
| Ambiguous customers | 1 |
| Order source versions | 17 |
| Order lines | 92 |
| Products | 366 |
| Standalone quotations | 0 |
| Follow-up/outcome rows | 0 |
| MX customer/order records | 22 |
| AE historical records | 0 |
| Unknown-market review rows | 266 |
| Duplicate rows | 0 |
| Invalid rows | 0 |
| Review rows | 266 |
| Currency ambiguities | 241 |
| Price-type ambiguities | 0 |
| Warnings | 511 |
| Errors | 0 |

`Standalone quotations = 0` means the V2.3 batch did not create a separate quotation entity. Explicit supplier and customer price fields remain distinct in product/order provenance.

## Review and warning decisions

| Condition | Count | Handling |
| --- | ---: | --- |
| Currency unavailable | 241 | Stored as `UNKNOWN`; no currency was inferred |
| Negative numeric source value | 1 | Skipped instead of being treated as quantity or value |
| Filename/workbook PO mismatch | 3 | Kept in `REVIEW`; workbook facts were not silently replaced by filename text |
| Ambiguous customer identity | 1 | Kept in `REVIEW`; display name alone was not accepted as a canonical key |

Missing critical business fields were handled as unavailable or `UNKNOWN`. Delivery date was kept separate from order date; container sequence was kept separate from customer and order identity; supplier price was not mapped to customer revenue.

## Quality gates

| Gate | Result |
| --- | --- |
| Every staged file has a source SHA-256 | PASS |
| Source-before = local-copy = source-after hash | PASS, 54 of 54 |
| Every staged row has file/sheet/row provenance | PASS |
| Deterministic source identities are unique | PASS |
| Customer duplicates and ambiguity reviewed | PASS |
| Supplier cost remains separate from sales value | PASS |
| Delivery date remains separate from order date | PASS |
| Product profile mapping is explainable | PASS |
| TF1 meaning is documented | PASS |
| Sensitive HR/finance data excluded | PASS |
| Shared-folder modifications by this run | 0 |

## Source safety

| Operation against the shared source | Count |
| --- | ---: |
| Modified | 0 |
| Deleted | 0 |
| Renamed | 0 |
| Moved | 0 |
| Created | 0 |

## Decision

The dry run passed with zero errors. The 266 review rows were deliberately preserved as review evidence and were not force-imported as canonical business facts. The production commit proceeded only after this result was recorded.
