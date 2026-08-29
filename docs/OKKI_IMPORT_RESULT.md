# OKKI 导入结果

## STATUS

PASS — 已提交并完成幂等重放。

## BATCH

- Batch ID：`a9142adc-c87b-489c-9cbb-7690f2c42c3d`
- Batch key：`phase5-v2.3.1-okki-history-001`
- Status：`IMPORTED`
- Imported at：2026-08-28 17:51:52 +08:00

## SOURCE SAFETY

| 检查 | 数量 |
|---|---:|
| Modified | 0 |
| Deleted | 0 |
| Renamed | 0 |
| Moved | 0 |
| Created in source folder | 0 |

最终复核时，两份来源文件哈希仍分别为 `D3F64A...73D4` 与 `C719A5...C9D0`，并与本地 staging 副本一致。

## IMPORTED

| 实体 | 写入 | REVIEW | 拒绝 |
|---|---:|---:|---:|
| 历史 CRM 客户/线索 | 46 | 0 | 0 |
| 历史联系人 | 248 | 0 | 0 |
| 历史活动 | 83 | 0 | 0 |
| 明确结果 | 0 | 0 | 0 |
| 订单 / 产品 / 报价 | 0 | 0 | 0 |

客户分类：45 个 `HISTORICAL_OPEN_LEAD`、1 个 `HISTORICAL_CRM_LEAD`。另以独立字段记录：39 个已有历史接触、7 个没有活动记录。

## ACTIVITY

- EDM / 营销邮件发送：82
- 人工跟进：1
- 其他：0
- EDM 没有转换为回复、报价、WON 或 LOST。

## RECONCILIATION

- 确认既有成交客户：0
- 历史线索：46
- 公开企业 CONFIRMED links：0
- 名称 REVIEW links：0
- 内部成交客户 links：0
- 模糊/歧义关联：0
- 同一 batch key 重放新增 observation：0
- 同一 batch key 重放新增 canonical entity：0

新客排除规则已收紧为同时满足：`company link = CONFIRMED` 且 `customer_role = INTERNAL_EXISTING_CUSTOMER`。确认关联到公开公司的历史线索不会被误当作已成交客户排除。

## ICP

- Mexico 已成交客户样本：5 → 5
- Mexico 已成交订单样本：13 → 13
- Mexico ICP ID：`7d054a1b-b44b-4446-afed-d81061f9d54e`
- Mexico ICP build key：`a16b8e64954d4f8bdd23729815bebc30eb17cf1c068d5667f8d6ac1e6c66b9bc`（未变）
- Mexico CRM 历史线索新增：1
- UAE CRM 历史线索新增：7
- Win/loss coverage：`NONE`

## IDEMPOTENCY

相同 bundle 再次执行 dry-run 与 commit 均返回 `idempotent_replay = true`。批次、来源文件、import、import row、客户、联系人和活动计数均没有增加。

## TESTS

- Node 测试：172 项；169 通过；0 失败；3 项按环境条件跳过
- JavaScript 语法检查：通过
- Python staging 编译与实际解析：通过
- PostgreSQL 迁移、dry-run、commit、replay：通过
- API：46 条列表、详情、批次汇总及公开公司历史查询契约通过
- 浏览器桌面检查：无页面级横向溢出；46/248/83 与分类显示正确
- 390 × 844 检查：保留关键 5 列、表格容器内滚动、44px 操作按钮、详情无审批按钮
- 内部 OKKI 链接、附件、来源路径和哈希未进入 API/DOM
