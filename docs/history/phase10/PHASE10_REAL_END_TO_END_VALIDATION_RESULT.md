# Phase 10 真实端到端验证结果

执行日期：2026-09-01

## 结论

确定性系统链路、真实数据库、真实 Tavily 搜索和真实 Excel 导出已验证；V1.1 要求的完整真实联系闭环尚未完成。因此：

```text
CONTROLLED LIVE E2E: INCOMPLETE
APPROVED OPPORTUNITY PILOT: NOT ELIGIBLE
PHASE10 IMPLEMENTATION PASS: NOT PASS / INCOMPLETE
BUSINESS-RESULT PASS: NO
```

## 已实际运行的链路

```text
现有真实公司/机会
→ approved category scope revision 2
→ 当前 14 条 dry-run
→ append-only apply
→ 自动补证任务
→ 真实 Tavily provider events
→ 公开来源归一与证据刷新
→ Buyer/Contact gate
→ 机会决策刷新
→ 14 行 XLSX 导出
→ 数据库/工作簿核对
```

代表 lineage：

| Layer | ID / result |
| --- | --- |
| Auto evidence task | `abe1577d-afa3-43a0-a0b3-ee3a92e00a10` |
| Category ResearchJob | `e7b9ce4a-aae2-43c9-a7ca-477453a3ce0f` |
| Contact ResearchJob | `c5755076-f4b0-49d9-87a0-92689e3a8390` |
| Tavily | 4 calls in the representative task; 3 `NOT_FOUND`, 1 `COMPLETED`; total Phase 10 usage 8 calls/8 units |
| Category decision | `GENERAL_MERCHANDISE` remains customer-evidence limited for the representative company |
| Export job | `1c91bd16-a53a-4924-ad55-8d371307b459` |
| Export verification | 14 rows, 36 columns, 1 worksheet; category score/context columns present; no formula errors |

## 正向与反向边界

- 正向：目标公司的公开采购/经营类目与 approved category scope 相同、相似或属于同一批准画像，即可形成类目级供货机会；不要求对应某个单品，也不创建商品补充任务。一个真实 WOMENSWEAR 机会已释放。
- 反向：缺少客户公开类目证据的 11 条继续保留；不合格 Buyer model 的 2 条没有被放行。
- 联系反向门槛：没有实名相关 Buyer，Hunter 保持 0；没有 VALID path，Recommended 保持 0。
- 外发反向门槛：Provider `NONE`、审批和开关未通过，所有邮件、webhook、reply 和 CRM side effect 保持 0。
- 幂等/恢复/预算/乱序事件等 fixture 在四象限 suite 中通过，但没有被写成真实外部事件。

## 尚未发生的真实链路

以下 V1.1 强制事实目前没有证据：

```text
实名相关 Buyer
→ Hunter Finder/Verifier 实际调用
→ VALID 企业邮箱
→ Recommended
→ Management Approved
→ 草稿与逐封批准
→ Provider 允许用途发送
→ delivered/replied/退订/投诉等真实事件
→ CRM 跟进/成交状态回流
```

缺少这些不是测试失败的替代说法，而是当前真实业务输入和 Provider 门槛的实际状态。按照 V1.1，fixture 不替代该 real-run，因此最终验收保持 `INCOMPLETE`。

## 已发现的审计注意项

代表 category ResearchJob 的旧式 summary counters 没有完整反映 `provider_usage_events` 中的真实 4 次 Tavily 调用；本报告使用 provider usage ledger 作为调用与额度的 canonical 审计来源，不把 job summary 的零值当成零调用。该投影一致性需在下一次进入真实外发验证前纳入修正和回归。
