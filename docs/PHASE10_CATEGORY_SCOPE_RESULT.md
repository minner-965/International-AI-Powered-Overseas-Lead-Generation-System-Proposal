# Phase 10 公司类目范围与机会规则结果

执行日期：2026-09-01

## 已批准范围

- Scope revision：`f39c1190-7c67-4ff4-b35f-5da8674da2ed`
- Revision：2
- 状态：`APPROVED`
- 批准标识：`local-demo`
- 来源：`MANAGEMENT_APPROVED`
- 当前有效 scope：13

| Product profile | Approved scopes |
| --- | --- |
| `GENERAL_MERCHANDISE` | `GENERAL_MERCHANDISE`, `DAILY_USE_GOODS`, `HOMEWARE`, `HOME_AND_LIVING`, `HOUSEHOLD_GOODS`, `NON_FOOD` |
| `WOMENSWEAR` | `WOMENSWEAR`, `DRESSES`, `KNITWEAR`, `OUTERWEAR`, `SKIRTS`, `TOPS`, `TROUSERS` |

该范围与 `product_master` 的具体 SKU 完整度分离。只有 `APPROVED + ACTIVE` 的 scope 可作为确定性匹配基线。

## 当前 14 条 apply 结果

| Product profile | Match status | Match basis | Count |
| --- | --- | --- | ---: |
| `GENERAL_MERCHANDISE` | `INELIGIBLE_BUYER_MODEL` | `PROFILE_SCOPE` | 1 |
| `GENERAL_MERCHANDISE` | `NEEDS_PRODUCT_EVIDENCE` | — | 6 |
| `WOMENSWEAR` | `CATEGORY_PROCUREMENT_MATCH` | `PROFILE_SCOPE` | 1 |
| `WOMENSWEAR` | `INELIGIBLE_BUYER_MODEL` | `OUT_OF_SCOPE` | 1 |
| `WOMENSWEAR` | `NEEDS_PRODUCT_EVIDENCE` | — | 5 |

实际变化：`Rizqé × WOMENSWEAR` 从“内部具体商品目录不足”释放为画像级品类匹配。释放数为 1；客户侧类目证据仍不足的记录为 11。

## 规则结论

- `category-procurement-match-v2` 依据 approved scope、taxonomy/alias 和客户公开证据判断 exact/similar/profile scope。
- 没有具体 SKU 不再产生客户不匹配结论。
- `product-opportunity-v2` 的现行输出是类目级机会：批准类目命中时写入 `CATEGORY_SCOPE_QUALIFIED`，固定 `candidate_count=0`、`NO_EXACT_SKU`，且不读取或匹配 `product_master`。
- 商品资料与客户成交资料继续通过共享文件夹导入数据库，仅用于 approved category/profile、历史 ICP 和客户评分基线；新客户机会、详情页和普通导出均不生成或展示具体商品候选。
- 明确 `OUT_OF_SCOPE`、不符合 Buyer model、身份冲突、历史客户和 suppression 等门槛继续保留。
- Supplier Access 未知只影响排序；明确关闭合作路径仍为 `HOLD`。
- 原始验收使用 `business-opportunity-decision-v3`，当时要求实名相关 Buyer 与当前 VALID 路径后才能 Recommended。后续管理规则已由 `business-opportunity-decision-v4` 取代：实名 Buyer 优先，但官网公司邮箱、业务电话或公开 WhatsApp 也可构成公司级业务机会；发送控制仍独立执行。

## Dry-run 与数据保护

当前 14 条均先生成 old/new dry-run，再 append 新 revision；没有原地改写历史 decision snapshot。Phase 10 migration 均为 additive，旧来源、联系人、历史客户、审批、旧商品机会/候选和 collection history 保留。

当前机会分布仍为：

```text
EVIDENCE_REQUIRED = 12
NOT_SUITABLE      = 2
RECOMMENDED       = 0
MANAGEMENT_APPROVED = 0
```

批准类目通过只证明产品业务匹配，不代表联系门槛已经通过；精确 SKU 不属于联系或业务机会门槛。
