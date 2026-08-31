# Phase 7 受控联系政策

版本：`dpv-b2b-outreach-v1`
日期：2026-08-31

## 当前结论

Phase 7 建立草稿、复核、精确消息审批、发送前复检和回复交接能力。本阶段不启动真实潜客试发。

默认配置固定为：

~~~ini
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
OUTBOUND_EMAIL_PROVIDER=NONE
INBOUND_EMAIL_PROVIDER=NONE
RESEND_USE_CASE=DISABLED
ALLOW_ACCEPT_ALL_SEND=false
CONTACT_VERIFICATION_TTL_DAYS=30
~~~

只要总开关、资格门、抑制、邮箱验证、审批摘要或 Provider 用途检查有一项未通过：

~~~text
send_status = BLOCKED
provider network calls = 0
reason_codes[] = 持久化的确定性原因
~~~

## 两级审批

1. `Opportunity Management Approval`：确认某个 `company × product_profile` 值得进入待联系准备，只创建管理事件和任务。
2. `Exact Message Approval`：审核确定的收件人、发件身份、回复地址、标题、正文、商品、证据和内容哈希。

第一级审批不产生消息审批，也不调用邮件 Provider。任何编辑都会改变内容哈希，旧消息审批随即失效。

## 发送资格门

worker 调用 Provider 前必须重新确认全部条件：

- 两个总开关均为 `true`；
- 企业身份 `VERIFIED`、生命周期 `ACTIVE`、关系状态 `NEW_PROSPECT`；
- 当前机会状态为 `MANAGEMENT_APPROVED`；
- Buyer Business Model 为 `DIRECT_END_BUYER` 或有采购及转售证据的 `DISTRIBUTION_BUYER`；
- Category Procurement Match 为 `CATEGORY_PROCUREMENT_MATCH`；
- Readiness 为 `SALES_READY`；
- 存在与该产品画像相关、已验证的实名 Buyer 或采购部门；
- 业务邮箱路线有效，邮箱验证满足政策且未过期；
- 公司、联系人和收件地址均无有效 suppression；
- 精确消息审批与 recipient、content hash、from、reply-to、channel 完全一致；
- Provider 允许该用途及同意状态；
- 分钟、每日、公司 30 天及联系人频率限制均通过。

公司已进入客户名录、DPV Score 较高、Supplier Access 较高、域名有 MX 或公开页面出现邮箱，都不构成发送资格。

## 联系验证

| 验证状态 | 处理方式 |
| --- | --- |
| `VALID` | 可生成并提交草稿审核 |
| `ACCEPT_ALL` | 人工风险复核，默认不发送 |
| `UNKNOWN` / `NOT_VERIFIED` | 暂停 |
| `TEMPORARY_ERROR` | 延迟重试 |
| `INVALID` | 建立联系人或邮箱 suppression |
| `DOMAIN_MX_VERIFIED` / `PUBLICLY_OBSERVED` | 仍需 mailbox-level 验证 |

## Provider 用途

`NoneProvider` 是强制默认实现，所有调用均返回 `PROVIDER_NONE` 且网络调用数为零。

Resend 官方 [Acceptable Use Policy](https://resend.com/legal/acceptable-use)（2026-08-27 更新）禁止 unsolicited messages、cold outreach、purchased lists 和 scraped contact data。因此：

| Resend 用途 | 允许条件 |
| --- | --- |
| `COLD_OUTREACH` | 一律阻止，`PROVIDER_PURPOSE_NOT_ALLOWED` |
| `OPT_IN` | 仅 `EXPLICIT_OPT_IN` |
| `TRANSACTIONAL` | 仅 `EXPLICIT_OPT_IN` 或已有 `TRANSACTIONAL_RELATIONSHIP` |
| `DISABLED` | 一律阻止 |

Resend 不作为公开线索冷开发信 Provider。若公司以后选择其他外发 Provider，仍需单独实现用途政策适配器并通过全部门槛。

## 草稿与公司文案

- 草稿默认 `PENDING_REVIEW`，不自批、不自发。
- 商品必须引用真实 `product_master.id`。
- 个性化内容必须引用已验证 evidence；卖点必须引用有效 `approved_claim_id`。
- 不承诺未批准的价格、MOQ、认证、交期、付款或合同条件。
- 不传入供应商成本、内部利润、历史客户价格、订单明细、私有路径、凭据或原始外部内容。
- 公司页面、导出表格和销售材料使用直接、可核验的业务表述，不显示生成过程、模型提示、内部规则或技术占位文字。

## 入站与回复

- Webhook 先用原始请求体验签，再解析和去重。
- HTML 清洗；附件隔离；原始正文不作为数据库修改或外发指令。
- `OPT_OUT`、投诉、硬退信优先建立对应范围的 suppression。
- 报价、样品、会议和正向回复只创建销售任务，由人员处理。
- 回复、人工接管或 suppression 会停止自动跟进。

## 审计

记录资格快照、规则版本、内容哈希、审批人及角色、发送前原因码、Provider 调用开始时间、事件摘要、抑制来源和人工任务。日志不记录完整邮件正文、完整邮箱、凭据、原始 Provider payload、原始入站内容或本地/共享路径。
