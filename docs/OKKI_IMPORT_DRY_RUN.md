# OKKI 导入 Dry Run

## STATUS

PASS

## BATCH KEY

`phase5-v2.3.1-okki-history-001`

Dry-run 批次 ID：`a9142adc-c87b-489c-9cbb-7690f2c42c3d`

## STAGING

- 本地目录：`data/staging/okki/phase5-v2.3.1-okki-history-001/`（Git 忽略）
- 来源文件：2
- 客户文件 before / local / after SHA-256 完全相同
- 活动文件 before / local / after SHA-256 完全相同
- 来源文件修改、删除、改名、移动：均为 0

## PARSE

| 项目 | 数量 |
|---|---:|
| 客户导出行 | 248 |
| 唯一客户/公司 | 46 |
| 联系人 | 248 |
| 活动 | 83 |
| 有活动客户 | 39 |
| 无活动客户 | 7 |
| 活动孤儿 | 0 |

## RECONCILIATION

| 关联类型 | 强关联 | 名称待审 |
|---|---:|---:|
| 既有内部成交客户 | 0 | 0 |
| 公开研究企业 | 0 | 0 |

- 不使用名称相似自动合并。
- 数值 `1` 与文本 `'0001` 的冲突测试通过：两个客户、两条独立来源键。
- Mexico 的 1 条 OKKI 资料没有进入 5 家成交客户样本。
- UAE 的 7 条资料只归类为历史 CRM 线索。

## PLANNED COMMIT

| 实体 | 计划写入 | REVIEW | 拒绝 |
|---|---:|---:|---:|
| 历史 CRM 客户/线索 | 46 | 0 | 0 |
| 历史联系人 | 248 | 0 | 0 |
| 历史活动 | 83 | 0 | 0 |
| 明确结果 | 0 | 0 | 0 |
| 订单 / 产品 / 报价 | 0 | 0 | 0 |

三种导入观察类型映射：

- `HISTORICAL_CUSTOMERS` → `CRM_LEAD_HISTORY`
- `HISTORICAL_CONTACTS` → `CRM_CONTACT_HISTORY`
- `HISTORICAL_ACTIVITIES` → `CRM_ACTIVITY_HISTORY`

## QUALITY GATES

- Errors：0
- Warnings：0
- 预期轮廓 46 / 248 / 83：通过
- 活动分布 82 / 1：通过
- 39/46 客户活动关联：通过
- 源哈希一致：通过
- Dry-run：`DRY_RUN_PASSED`
