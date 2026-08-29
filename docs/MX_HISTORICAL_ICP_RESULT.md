# Mexico Historical Customer ICP Result

## Status

**ACTIVE — built from committed internal Mexico customer and order history**

| Field | Actual value |
| --- | --- |
| Profile | DPV Mexico Historical Customer ICP |
| Type | `HISTORICAL_CUSTOMER_ICP` |
| Version | `mx-historical-v2` |
| Reference market | MX |
| Application markets | MX, AE |
| Basis | Converted customer and order history |
| Source classification | `INTERNAL_BUSINESS` |
| Sample customers | 5 |
| Sample confirmed-order versions | 13 |
| Overall feature coverage | 63.21% |
| Win/loss coverage | NONE |
| Calculation version | `mx-historical-stats-v1` |

The database contains 17 Mexico order source versions: 14 confirmed and 3 cancelled. The profile uses 13 latest confirmed order versions after source-version selection, so older versions are not double-counted.

## Feature coverage

| Feature | Coverage | Sample | Status |
| --- | ---: | ---: | --- |
| Buyer type | 100% | 5 customers | Available |
| Product category/profile | 100% | 70 rows | Available; Womenswear |
| Market reference | 100% | 5 customers | Available; MX reference, MX/AE application |
| Order quantity | 97.14% | 68 of 70 rows | Available; 960–19,200 source order quantity |
| Commercial MOQ | 0% | 0 | Unavailable; order quantity is not treated as MOQ |
| Customer price band | 24.29% | 17 of 70 rows | Available; explicit USD 1.25–9 only |
| Repeat-order pattern | 100% | 5 customers | Available |
| Channel | 0% | 0 | Unavailable |
| Company size | 0% | 0 | Unavailable |
| Distribution pattern | 0% | 0 | Unavailable |
| Historical win similarity | 0% | 0 | Unavailable; no win/loss funnel source |

## Customer Match use

UAE prospects now receive two separate explainable results:

1. Management Baseline Match
2. Mexico Historical Reference Match

The two values are persisted and displayed independently. They are not combined into a hidden composite. The historical result records its profile version, coverage, dimension scores, reasons, evidence identifiers and calculation trace.

## Limitations

- This profile describes DPV's real Mexico converted-customer and order pattern; it does not claim UAE conversion history.
- Channel, company-size and distribution-pattern data were not supported by the imported sources.
- There is no reliable win/loss funnel dataset, so the profile is not a win/loss prediction model.
- Currency-dependent features use only rows with explicit currency. Unavailable currency remains `UNKNOWN`.
- The profile is versioned and append-only; rebuilding with unchanged source history reuses the same build key.

## Verification

- Rebuilding `mx-historical-v2` returned the same active profile.
- Five current verified UAE prospects received both management and Mexico-historical match rows.
- Re-running the same dual-match acceptance keys created no duplicate rows.
- The earlier `mx-historical-v1` profile remains retained as `RETIRED`; no historical profile row was deleted.
## Phase 5 V2.3.1 回归保护

OKKI 历史 CRM 导入后，Mexico Historical Customer ICP 继续只读取实际支持 5 家已成交客户和 13 个已确认女装订单的 import IDs。新增 OKKI 线索不进入成交样本；Profile ID、build key、11 项特征和 63.21 覆盖率保持不变。相同事实重建返回幂等结果。
