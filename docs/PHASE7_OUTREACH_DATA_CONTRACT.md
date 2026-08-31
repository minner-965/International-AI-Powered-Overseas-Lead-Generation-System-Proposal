# Phase 7 受控联系数据合同

版本：`phase7-outreach-data-v1`
日期：2026-08-31

## 权威边界

PostgreSQL 保存资格、版本、审批、消息、事件、抑制、任务和 CRM outbox；Express 执行认证、权限、验签和 Provider secret 边界；pg-boss 执行持久任务；n8n 只调用 Express internal API 编排。第三方 Skill 和草稿生成器都不拥有发送权限。

## 实体与关系

~~~text
marketing_context_versions
  └─ marketing_context_approvals

outreach_eligibility_snapshots
  └─ outreach_recipients
      └─ outreach_drafts
          ├─ outreach_draft_evidence
          ├─ outreach_draft_products → product_master.id
          └─ outreach_approvals
              └─ outbound_messages
                  ├─ outbound_message_attempts
                  └─ email_message_events

email_webhook_inbox
  ├─ email_message_events
  └─ inbound_messages
      ├─ reply_classifications
      └─ sales_tasks

outreach_threads
contact_suppressions
crm_sync_outbox
~~~

## 资格快照

`outreach_eligibility_snapshots` 固定 company、product profile、Phase 6/6.1 结果 FK、relationship status、reason codes、rule version、input digest 和过期时间。快照过期或底层 assessment revision 改变时重新计算，不覆盖旧快照。

`outreach_recipients` 必须引用同一 company 的快照，并且只引用一个 `contact_id` 或 `decision_maker_contact_id`。渠道当前固定为 `EMAIL`。

## 草稿输入与输出

草稿输入只包含白名单字段：公司和产品画像 ID、Phase 6/6.1 结果 ID、联系人 ID、Marketing Context 版本、批准的 claim/evidence/product ID、语言、CTA 和规则版本。不传原始网页、搜索摘要、内部备注、成本、订单、路径或凭据。

草稿输出保存 language、subject、plain-text body、followups、personalization reason、evidence/product/claim 引用、template/skill/generation 版本、input digest、content hash 和 policy warnings。

草稿状态：

~~~text
DRAFT | INVALID_DRAFT | PENDING_REVIEW | NEEDS_CHANGES
APPROVED | REJECTED | SUPERSEDED | EXPIRED
~~~

创建、修改、提交和批准草稿时均实时重查：当前 `business_opportunity_current` 必须为同一 assessment revision 的 `MANAGEMENT_APPROVED`、同一 decision snapshot 必须存在 `ACTIVE` Contact Queue、eligibility 必须是最新且未过期、recipient 必须 `VALID` 且在 TTL 内，并且不存在 company/contact/recipient suppression。任一底层 revision、队列、资格、联系人或 suppression 变化都会阻断后续草稿流程，旧审批不恢复新 revision 的权限。

## 精确消息审批

`outreach_approvals` 绑定：

~~~text
draft id + version
recipient id + normalized recipient
company + product profile
content hash + evidence snapshot hash + approval digest
from identity + reply-to + EMAIL channel
approver identity + role + decision + time
~~~

一个批准版本只对应一个 outbound message。发送前重新计算审批摘要并检查 recipient、content、from、reply-to 和 channel。

## 发送与事件

`outbound_messages.idempotency_key` 唯一；`approval_id` 唯一；非空的 `(provider, provider_message_id)` 唯一。每次尝试写入 `outbound_message_attempts`，仅在真实网络调用即将发生时写 `provider_call_started_at`。

Provider Webhook 使用原始请求体验签，`email_webhook_inbox` 以 `(provider, provider_event_id)` 去重。业务事件使用 `event_digest` 去重。入站消息以 `(provider, provider_message_id)` 去重并只保存清洗后的标题/正文；附件状态为隔离或复核，不进入自动动作。

## 抑制、回复和 CRM

联系人 suppression 与公司 suppression 分开。硬退信只抑制对应联系人；投诉建立联系人和公司范围抑制；明确退订优先处理。

回复分类只创建人工任务：报价、样品、会议、回复复核或 CRM handoff。`crm_sync_outbox.idempotency_key` 唯一，CRM 是业务副本，不反向覆盖 DPV 证据、评分或历史事实。

## Append-only 记录

迁移 025 为以下记录建立更新/删除阻断触发器：

~~~text
marketing_context_versions
marketing_context_approvals
outreach_eligibility_snapshots
outreach_approvals
email_message_events
import_approvals
product_master_revisions
data_export_download_events
~~~

撤销、替代或重算通过新事件/新版本表达。消息尝试、队列状态和 outbox 状态在受控生命周期内更新，并保留独立事件审计。

## 数据最小化

普通 API、UI、导出和 telemetry 不包含：完整邮件正文、无需显示的完整邮箱、Provider secret、原始 Provider payload、原始入站内容、内部成本/利润、共享目录或 staging 路径。

## 当前实现状态

迁移 025、026 已保留 checksum；新增 additive migration 027 扩展服务端绑定的管理审批角色约束。确定性资格/草稿/Provider/入站模块和自动化测试已写入工作树。
