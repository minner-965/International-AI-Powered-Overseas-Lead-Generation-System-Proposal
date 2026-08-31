# Phase 7 业务机会决策合同

版本：`phase7-opportunity-decision-v1`
日期：2026-08-31

## 业务对象

业务机会的唯一决策单位是 `company × product_profile × assessment revision`，不是公司名录中的一行。

~~~text
市场研究 / Market Research
→ 客户名录 / Companies
→ 业务机会 / Opportunities
→ 待联系 / Contact Queue
~~~

`Companies` 保留全部累计公司主档；存在于该页面不表示允许联系。`Opportunities` 是负责人决定“准备联系谁”的入口。只有当前有效且获管理确认的具体机会才进入 `Contact Queue`。

## 独立状态轴

~~~text
system_recommendation_status
  RECOMMENDED | EVIDENCE_REQUIRED | NOT_SUITABLE

management_contact_status
  NOT_REVIEWED | MANAGEMENT_APPROVED | HOLD

policy_contact_status
  OPEN | HOLD
~~~

页面状态由这三条轴和当前 assessment revision 确定性派生：

~~~text
RECOMMENDED
MANAGEMENT_APPROVED
EVIDENCE_REQUIRED
HOLD
NOT_SUITABLE
~~~

管理意见不覆盖系统事实，policy hold 不改写长期业务匹配结论。底层证据或 assessment revision 变化后，旧审批保留审计，但不再维持当前 Contact Queue 资格。

## 系统推荐

`RECOMMENDED` 必须同时满足：

- 企业身份 `VERIFIED`、官网和公开资料仍有效、生命周期 `ACTIVE`；
- 关系状态 `NEW_PROSPECT`；
- Buyer Business Model 为 `DIRECT_END_BUYER` 或有采购及转售证据的 `DISTRIBUTION_BUYER`；
- Category Procurement Match 为 `CATEGORY_PROCUREMENT_MATCH`；
- 无公司 suppression、无已确认现有客户、无未解决身份或证据冲突。

`Supplier Access`、Readiness、联系人完整度和 DPV Score 只影响通过硬门槛后的解释与排序，不补偿 Buyer Model 或 Category Procurement Match 失败。

## 其他系统结论

确定性 `NOT_SUITABLE`：canonical duplicate、`EXCLUDED_INTERMEDIARY`、明确品类不匹配、失效网站、confirmed existing customer。

`EVIDENCE_REQUIRED`：采购模式不清、关键证据不足或冲突、公司身份冲突。联系人缺失或不确定另记为 `contact_readiness=EVIDENCE_REQUIRED`；它可以与机会 `RECOMMENDED` 并存，但在补齐前不发送。

有效 suppression 或市场/渠道暂停时派生 `HOLD`。

## 管理动作

| 动作 | 结果 |
| --- | --- |
| Confirm Contact | append-only 管理事件；创建待联系任务；Provider calls 0；Message approvals 0 |
| Hold | 当前机会停止进入联系流程，审计保留 |
| Request Evidence | 进入例外队列并记录所需证据 |
| Reopen | 在当前事实和 revision 上重新计算，不恢复失效审批 |

每次管理事件记录 actor、role、时间、准确的 decision revision 和可选原因。系统推荐状态只能由确定性重算服务写入。

## 排序

~~~text
Opportunity Status
→ Readiness
→ Category Procurement Match confidence / evidence freshness
→ Supplier Access
→ Contact readiness
→ DPV Score（仅同级 tie-breaker）
~~~

不新增会改变 Phase 5/6/6.1 资格的通用 Lead Score。

## 当前数据预期

Phase 6.1 的当前 14 个 `company × product_profile` 结果含 0 个 Category Procurement Match、0 个 SALES_READY、0 个已验证实名 Buyer/采购部门。因此确定性重算应得到 0 个可联系机会和 0 个发送对象。

## 当前实现状态

本合同是 Phase 7 的验收边界。机会决策表、append-only 管理事件、Contact Queue 持久化、API 与浏览器操作仍需以最终代码、迁移回放和真实数据库查询验收；未完成前标记为 `pending`。
