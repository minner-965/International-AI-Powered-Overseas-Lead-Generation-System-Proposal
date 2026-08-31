# DPV Phase 7 V1.2 — 联系就绪机会决策、受控开发信、销售交接与业务数据交换

## Codex Authoritative Execution Plan

```text
Document version: Phase 7 V1.2
Plan status: READY FOR IMPLEMENTATION
Prepared at: 2026-08-31
Required baseline: remote-verified phase6.1
Next migration: 025_phase7_outreach_and_data_exchange.sql
Next release tag: phase7
Live prospect sending in this release: BLOCKED BY CURRENT DATA AND PROVIDER POLICY
Revision focus: verified Buyer/contact before Recommended and management approval
Reported runtime input: Hunter API key added; presence/health/credits still require secret-safe execution check
```

本文件以以下实际验收结果为唯一基线：

```text
docs/PHASE6_RESULT.md
docs/PHASE6_1_PRODUCT_MATCH_RESULT.md
docs/PHASE6_1_REUSE_RESEARCH.md
docs/VERSION_CHANGELOG.md
tag: phase6.1
```

只执行 **Phase 7**。不得重做或放宽 Phase 5、Phase 6、Phase 6.1 的身份、证据、Buyer Model、Category Procurement Match、Product Opportunity、Supplier Access、Decision Maker、Readiness 或历史客户规则。

Phase 7 的目标是建立可审计的销售准备、开发信草稿、人工审批、邮件 Provider 抽象、回复处理、CRM 交接和 Excel/CSV 数据交换能力。

当前真实数据没有可发送对象，因此本阶段必须做到：

```text
系统能力完成
测试夹具全链路通过
真实数据库发送数 = 0
OUTREACH_ENABLED = false
```

首次真实客户试发不属于本文件的自动动作。只有未来出现真实 `MANAGEMENT_APPROVED + SALES_READY + Hunter VALID + 合格用途 Provider + 精确消息审批` 记录后，才可进入受控试发。

---

# 1. 实际基线与现实门槛

## 1.1 Phase 6 / 6.1 已通过

```text
Phase 6 tag: phase6
Phase 6.1 tag: phase6.1
Phase 6.1 implementation commit: 858a8554d743c4b2984d36960987da6eb5754982
companies: 106
Phase 6 fixed opportunities: 7
Phase 6.1 company × profile results: 14
Phase 6.1 job errors/timeouts: 0 / 0
tests: 325
passed: 322
failed: 0
conditional skips: 3
```

## 1.2 当前真实数据不得触达

```text
CATEGORY_PROCUREMENT_MATCH: 0
SALES_READY: 0
Product Opportunity READY: 0
real Product Opportunity candidates: 0
verified named buyers: 0
verified buying/procurement departments: 0
Hunter VALID contacts: 0
Hunter ACCEPT_ALL contacts: 0
```

因此：

```text
不得为了 Phase 7 测试而降低 Product Match 门槛
不得把 NEEDS_DECISION_MAKER 提升成 SALES_READY
不得把公司级通用邮箱当成已验证 Buyer 邮箱
不得用高 Supplier Access 补偿 Category Procurement Match
不得制造商品、Buyer、邮箱或同意状态
```

## 1.3 Phase 7 的两部分

```text
A. Controlled Sales Preparation
   联系人补证、开发信草稿、人工审批、销售任务、Provider 抽象、回复处理、CRM

B. Business Data Exchange
   客户线索、公司商品、客户成交/订单的 Excel/CSV 导入、导出和共享文件只读导入
```

## 1.4 老板主入口：业务机会，而不是客户名录

四层业务关系固定为：

```text
市场研究 / Market Research
→ 搜索真实公司、官网和公开证据

客户名录 / Companies
→ 保存所有累计发现的公司主档
→ 包含合适、不合适、待确认、历史客户和资料不足公司
→ 出现在 Companies 不代表允许联系

业务机会 / Opportunities
→ 以 company × product_profile 为决策单元
→ 先完成采购方类型、品类采购匹配和 Supplier Access 判断
→ 再搜索并验证 profile-relevant Buyer / Procurement / 负责人和正式联系路径
→ 联系证据不足的记录保留为 Evidence Required
→ 只有联系就绪记录形成 Recommended，作为老板判断“要联系谁”的默认清单

待联系 / Contact Queue
→ 只有老板已确认的机会进入
→ 联系人已在 Recommended 之前完成首次验证
→ 进入后执行验证有效期复检、开发信生成、具体消息审批和联系记录管理
```

`Companies` 是累计公司主档和调查入口；`Opportunities` 是业务决策投影。不得把客户名录行数、公司存在状态或公司详情页访问行为解释为联系资格。

## 1.5 业务机会状态

页面显示以下五种明确状态：

| 中文 | 代码 | 产生方式 | 业务含义 |
| --- | --- | --- | --- |
| 建议联系 | `RECOMMENDED` | 系统自动 | 业务匹配、Buyer/采购职责和正式联系路径均已验证，等待老板确认 |
| 老板已确认 | `MANAGEMENT_APPROVED` | 有权限的老板/负责人显式点击“确认联系” | 进入待联系队列，但尚未批准任何具体邮件 |
| 待补充资料 | `EVIDENCE_REQUIRED` | 系统自动或人工退回 | 采购模式、业务证据、公司身份、Buyer 角色或邮箱仍需核实 |
| 暂不联系 | `HOLD` | 老板/负责人显式设置，或政策性暂停 | 保留机会，停止进入联系流程 |
| 不适合 | `NOT_SUITABLE` | 确定性排除规则，人工只可提交有证据的复核 | 当前不属于新客户联系对象 |

数据库必须分开保存：

```text
system_recommendation_status
  = RECOMMENDED / EVIDENCE_REQUIRED / NOT_SUITABLE

management_contact_status
  = NOT_REVIEWED / MANAGEMENT_APPROVED / HOLD

policy_contact_status
  = OPEN / HOLD

display_opportunity_status
  = 从当前系统结论、最新管理事件和当前 policy hold 确定性派生
```

不得让单一可编辑字段同时代表系统资格和老板意见。系统事实变化后必须重算；若原批准依赖的资格快照失效，旧管理批准保留审计记录，但当前状态回到 `EVIDENCE_REQUIRED` 或 `NOT_SUITABLE`，并从待联系队列移除。

## 1.6 自动为主、人工处理例外

自动设为 `RECOMMENDED` 必须同时满足：

```text
真实企业且身份 VERIFIED
公开资料仍有效、官网未失效
company lifecycle ACTIVE
relationship_status = NEW_PROSPECT
Buyer Business Model IN (DIRECT_END_BUYER, DISTRIBUTION_BUYER)
Category Procurement Match = CATEGORY_PROCUREMENT_MATCH
Supplier Access / Cooperation Feasibility is not blocked
存在与目标 product_profile 相关且已验证的 Buyer / Procurement / 负责人
Buyer 的职位或采购职责证据已验证
存在 ACTIVE 的企业邮箱联系路径
mailbox verification = VALID and within TTL
Readiness = SALES_READY
没有公司级 suppression
没有确定的现有客户记录
没有未解决的身份或证据冲突
```

其中 `DISTRIBUTION_BUYER` 必须有“采购目标品类并在其市场销售/分销”的证据。只做撮合、收佣、转介而没有采购或经销证据的中介/代理，继续属于 `UNCLEAR_INTERMEDIARY` 或 `EXCLUDED_INTERMEDIARY`，不得因为名称中出现 distributor/agent 就自动通过。

自动设为 `NOT_SUITABLE`：

```text
canonical duplicate / merged duplicate
EXCLUDED_INTERMEDIARY
明确品类不匹配
网站失效
confirmed existing customer
```

当前存在 company suppression 或市场/渠道政策暂停时，`policy_contact_status = HOLD`，页面显示 `HOLD`；它表示当前不应联系，不应篡改公司的长期业务匹配结论。

自动设为 `EVIDENCE_REQUIRED` 并进入单独例外队列：

```text
采购模式不清楚
关键证据不足或相互冲突
公司身份冲突
已通过产品匹配但尚未找到采购负责人 → EVIDENCE_REQUIRED_CONTACT
已找到联系人但职位/采购职责不明确 → EVIDENCE_REQUIRED_BUYER_ROLE
邮箱为 NOT_VERIFIED / UNKNOWN / ACCEPT_ALL → EVIDENCE_REQUIRED_EMAIL
```

上述记录继续保留在 Opportunities 和对应的证据补充队列中，但不得出现在老板默认的 `RECOMMENDED` 清单。只有 Buyer、采购职责和联系路径全部达到当前验证策略后，确定性重算服务才可把它提升为 `RECOMMENDED`。

`Supplier Access`、证据新鲜度和 DPV Score 用于 `RECOMMENDED` 列表内的解释和排序，不得补偿 Buyer Model、Category Procurement Match、Buyer 职责或邮箱验证的失败。老板默认只看 `RECOMMENDED`，例外审核放在独立的 `EVIDENCE_REQUIRED` 队列。

## 1.7 两级人工关口

```text
Gate A — Opportunity Management Approval
老板/负责人确认“这个已经联系就绪的 company × product_profile 可以进入正式联系流程”
→ 创建 append-only 管理事件
→ display_opportunity_status = MANAGEMENT_APPROVED
→ 创建待联系任务
→ 不生成发送授权，不调用邮件 Provider

Gate B — Exact Message Approval
负责人审核具体 recipient、subject、body、产品、证据、发件身份和时间
→ 绑定不可变 content hash
→ 发送前仍执行全部资格、抑制、邮箱和 Provider 复检
```

不得增加第三个含义模糊的“已审批”字段。页面、API、数据库和审计日志必须明确区分 `opportunity management approval` 与 `exact message approval`。

---

# 2. 不可补偿的触达资格门

任何真实开发信发送必须在 worker 调用 Provider 之前重新检查全部条件：

```text
OUTREACH_ENABLED = true
AND LIVE_PROSPECT_SEND_APPROVED = true
AND company.verification_status = VERIFIED
AND company.lifecycle_status = ACTIVE
AND relationship_status = NEW_PROSPECT
AND current opportunity status = MANAGEMENT_APPROVED
AND Buyer Business Model IN (DIRECT_END_BUYER, DISTRIBUTION_BUYER)
AND Category Procurement Match = CATEGORY_PROCUREMENT_MATCH
AND Readiness = SALES_READY
AND verified profile-relevant named buyer OR verified buying/procurement department
AND active business email route
AND mailbox verification satisfies send policy
AND no active company suppression
AND no active contact/recipient suppression
AND approved message version is immutable
AND approved content hash, recipient, from identity and channel still match
AND selected Provider permits this purpose and recipient consent state
AND minute/day/company/contact send caps permit the attempt
```

任何一项失败：

```text
send_status = BLOCKED
provider network call = 0
reason_codes[] must be persisted
```

现有 `lead_reviews.approval_status`、`lead_reviews.outreach_draft` 和 `lead_reviews.send_status` 是历史演示字段，不构成生产级消息审批或发送授权。

---

# 3. Phase 7 分层架构

```text
Phase 6/6.1 verified facts
        ↓
business fit / Category Procurement Match / Supplier Access
        ↓
Hunter/contact discovery + Buyer role evidence + mailbox verification
        ↓
Outreach Eligibility Snapshot
        ↓
Recommended or Evidence Required routing
        ↓
Management Approved → Contact Queue
        ↓
DPV-approved Marketing Context
        ↓
Marketing Skills → versioned text draft
        ↓
deterministic fact/policy validation
        ↓
human edit → submit → exact-version approval
        ↓
provider-purpose and suppression recheck
        ↓
OutboundEmailProvider
        ↓
append-only delivery events / inbound replies
        ↓
suppression / sales task / CRM outbox
```

职责边界：

```text
PostgreSQL = 唯一业务主记录、幂等和审计权威
Express = 权限、API、审批、Provider secret、Webhook 验签
pg-boss = 持久任务、重试、发送、事件、导入导出
n8n = 高层编排、人工提醒、CRM 流程，不承载核心规则
Skills = 内容和实现规范，不是生产发送服务
LLM = 只生成草稿，不作客户资格、审批或发送决策
```

---

# 4. 第三方 Skill 采用策略

## 4.1 来源固定

实现开始时固定并复核：

```text
coreyhaines31/marketingskills
reviewed commit: e55de886fe7580ec75cdb7ded5092b33f7d4ed58
license: MIT

resend/resend-skills
reviewed commit: 828340bd8a361c4e6e0c02bddf1575f131d5d77f
license: MIT
```

规则：

```text
不安装两个完整仓库
只复制选定 Skill 目录及其直接 references
保留 LICENSE、版权和来源
建立 skills.lock.json
记录 repository、commit、skill version、目录 SHA-256
不自动跟随 main
上游更新必须通过人工审核 PR 和回归测试
```

Skill 的 MIT 许可不等于相关 SaaS 服务允许所有发送用途。服务条款必须独立检查。

## 4.2 Marketing Skills 采用清单

| Skill | 决策 | Phase 7 用途 |
| --- | --- | --- |
| `product-marketing` 2.1.0 | 采用 | 形成版本化、脱敏、经过批准的 DPV 产品定位、Buyer Persona、公开卖点和 CTA |
| `cold-email` 2.0.0 | 采用 | 编写首封开发信和跟进草稿，不直接发送 |
| `copy-editing` 2.0.0 | 采用 | 检查语气、清晰度、事实一致性和未支持主张 |
| `sales-enablement` 2.0.1 | 采用 | 回复后的目录、样品、会议、异议处理和销售简报 |
| `revops` 2.0.0 | 受限采用 | Owner、SLA、Pipeline、Next Action 和 CRM 交接；禁用通用 Lead Score |
| `prospecting` 1.1.0 | 部分采用 | 只使用 research signal、合规检查和联系理由；禁用候选发现、资格和评分 |
| `emails` | 暂缓 | 等存在明确 opt-in audience 后用于培育/生命周期邮件 |
| SEO / Ads / CRO / Social 等 | Phase 7 排除 | 与受控 B2B 开发信和销售交接无直接关系 |

## 4.3 Resend Skills 采用清单

| Skill | 决策 | Phase 7 用途 |
| --- | --- | --- |
| `email-best-practices` 1.0.2 | 采用 | SPF/DKIM/DMARC、结构、幂等、退信、投诉、抑制和可访问性检查 |
| `agent-email-inbox` 3.0.4 | 采用安全合同 | 入站邮件视为不可信输入，验签、清洗、限权、审计、人工复核 |
| `resend` 3.6.0 | 受限采用 | 复用 SDK/Webhook/幂等工程模式；服务只用于明确 opt-in 或事务邮件 |
| `resend-cli` 2.8.0 | 暂缓 | 仅开发/运维健康检查，不进入生产发送路径 |
| `react-email` 2.1.0 | 暂缓 | 开发信默认纯文本；以后用于已同意接收的品牌/事务邮件 |

## 4.4 Resend 用途硬限制

Resend 当前官方 Acceptable Use Policy 明确禁止：

```text
unsolicited recipients
cold outreach
purchased lists
scraped contact data
```

因此 Phase 7 必须实现：

```text
RESEND_USE_CASE = DISABLED / OPT_IN / TRANSACTIONAL
```

当：

```text
recipient consent != EXPLICIT_OPT_IN
OR provider_purpose = COLD_OUTREACH
```

ResendProvider 必须返回：

```text
PROVIDER_PURPOSE_NOT_ALLOWED
network call = 0
```

DPV 的冷开发信草稿仍可生成并交给销售人员，但实际发送 Provider 必须由公司选择并确认其政策、合同、发件域名和当地适用要求。默认 Provider 为 `NONE`。

Hunter 与 Resend 在技术职责上不冲突：Hunter 做联系人发现/验证，Resend 做允许用途下的邮件服务；但 Resend 的服务政策与公开线索冷开发信用途冲突，因此不得把两者串成默认冷外联系统。

---

# 5. DPV 自有组合 Skill

创建：

```text
.agents/skills/dpv-b2b-outreach/
├── SKILL.md
└── references/
    ├── dpv-domain-contract.md
    ├── input-field-allowlist.md
    ├── approved-claims-contract.md
    ├── draft-output-schema.md
    ├── provider-policy.md
    ├── reply-intents.md
    ├── excel-data-contracts.md
    └── acceptance-cases.md
```

版本：

```text
dpv-b2b-outreach-v1
```

执行顺序：

```text
DpvBusinessOpportunityQualification
→ Hunter Contact Discovery and Verification
→ DpvOutreachEligibility
→ DpvOpportunityRecommendation
→ Management Contact Approval
→ DpvMarketingContextBuilder
→ Prospecting evidence-to-rationale（受限）
→ Cold Email
→ Copy Editing
→ Email Best Practices
→ Human Approval
→ OutboundEmailProvider
→ Delivery / Inbound Events
→ Agent Email Inbox security contract
→ RevOps Handoff
```

组合 Skill 不拥有发送工具。它只接收白名单输入并返回草稿 JSON。

## 5.1 不得覆盖的字段

以下为只读：

```text
Company identity / lifecycle / exclusion
Buyer Business Model
Category Procurement Match
Product Opportunity and product_master foreign keys
Supplier Access / Product Access Matrix / Readiness
Decision Maker and contact verification semantics
DPV Score
Management Baseline Match
Mexico Historical Reference Match
existing customer / suppression / CRM history
taxonomy / catalog snapshot / evidence IDs
```

严禁：

```text
用 Prospecting 或 RevOps 通用评分改变 DPV 资格
用文案质量或 Hunter VALID 绕过 Product Match
用回复内容自动改写 Buyer Model 或 Readiness
模型承诺价格、MOQ、认证、交期、付款或合同
模型把缺失字段补写成事实
```

---

# 6. DPV Marketing Context

创建版本化、可审批的安全上下文：

```text
.agents/product-marketing.md
rules/outreach/v1/approved-claims.json
rules/outreach/v1/locale-policy.json
rules/outreach/v1/message-policy.json
rules/outreach/v1/reply-intents.json
rules/outreach/v1/metadata.json
```

只能包含：

```text
DPV 公开公司介绍
批准使用的产品品类和销售卖点
批准使用的证明材料
目标 Buyer Persona
允许 CTA
禁止主张
品牌语气
AE English / MX Spanish 语言规则
```

不得包含：

```text
供应商成本
内部利润或毛利
历史客户价格
原始订单明细
内部客户备注
共享目录或 staging 路径
未公开供应商资料
未确认商品属性
API key / password / token
```

每项公开卖点必须有：

```text
approved_claim_id
claim_text
allowed_markets
allowed_product_profiles
proof_ids[]
approved_by
approved_at
expires_at nullable
```

---

# 7. 开发信输入输出合同

## 7.1 `OutreachDraftInput`

```text
company_id
product_profile
buyer_business_model_result_id
category_procurement_match_result_id
product_opportunity_result_id nullable
decision_maker_id
decision_maker_contact_id
marketing_context_version
approved_claim_ids[]
evidence_ids[]
recommended_product_ids[]
target_language
allowed_ctas[]
generation_policy_version
```

API 不向模型发送整行数据库记录，只投影经过白名单和长度限制的事实。

潜客网页正文、搜索摘要和入站邮件是外部不可信输入。草稿生成只能使用已经结构化、验证并通过证据门的摘要，不能直接拼入 raw HTML、raw payload 或页面指令。

## 7.2 `OutreachDraftOutput`

```text
language
subject
body_text
followups[]
personalization_reason
used_evidence_ids[]
recommended_product_ids[]
approved_claim_ids[]
template_version
skill_versions
generation_version
input_digest
policy_warnings[]
```

默认开发信：

```text
plain text
不伪造 Re: / Fwd:
不虚构熟悉关系
不堆叠功能或商品
使用一个明确、低门槛 CTA
不自动附加报价、价格表或订单文件
```

## 7.3 确定性草稿验证

发布为可审批草稿前必须通过：

```text
all claims resolve to approved_claim_id
all personalization facts resolve to evidence_id
all recommended products resolve to real product_master.id
no restricted internal fields
no unsupported commercial commitment
language matches market policy
recipient and product_profile match eligibility snapshot
```

任何无证据新增句子：

```text
draft_status = INVALID_DRAFT
```

---

# 8. Hunter、EmailService 与联系方式门槛

## 8.1 现有能力继续复用

```text
EmailService
→ normalize + syntax + DNS MX

HunterProvider
→ Domain Search + Email Finder + Email Verifier
→ persistent credit budget
→ request fingerprint
→ idempotent replay
```

用户已报告 `HUNTER_API_KEY` 加入运行环境。Phase 7 实施时必须用不回显密钥的方式验证：

```text
secret exists in deployment environment / secret store
HUNTER_MODE = FREE_FIRST or company-approved enabled mode
account credits/budget available
health check passes
secret absent from Git, browser bundle, logs and result documents
```

“密钥已配置”只代表具备调用前提，不代表已经找到联系人、邮箱已经有效或机会已经达到 `RECOMMENDED`。

`DOMAIN_MX_VERIFIED` 只证明域名有邮件服务，不证明具体邮箱可投递。

## 8.2 状态映射

| 联系状态 | Phase 7 决策 |
| --- | --- |
| `VALID` | 在 Buyer 角色和其他硬门槛也通过时，可形成 `RECOMMENDED` |
| `ACCEPT_ALL` | `EVIDENCE_REQUIRED_EMAIL`；默认不进入 `RECOMMENDED` |
| `UNKNOWN` | `EVIDENCE_REQUIRED_EMAIL` |
| `TEMPORARY_ERROR` | 延迟重试，不发送 |
| `INVALID` | 创建邮箱/联系人级 suppression |
| `NOT_VERIFIED` | `EVIDENCE_REQUIRED_EMAIL` |
| `DOMAIN_MX_VERIFIED` | 仍需 mailbox-level 验证，不进入 `RECOMMENDED` |
| `PUBLICLY_OBSERVED` | 仍需 mailbox-level 验证，不进入 `RECOMMENDED` |

默认：

```text
ALLOW_ACCEPT_ALL_SEND = false
CONTACT_VERIFICATION_TTL_DAYS = 30
```

首次进入 `RECOMMENDED` 前必须完成验证；验证过期后必须从老板默认清单撤回到 `EVIDENCE_REQUIRED_EMAIL`，或在审批/发送前成功复检后重新进入。

---

# 9. 邮件 Provider 架构

## 9.1 接口

```text
OutboundEmailProvider
  capabilities()
  validatePurpose({purpose, consent_status})
  health()
  send(message, idempotency_key)

InboundEmailProvider
  capabilities()
  verifyWebhook(raw_body, headers)
  normalizeEvent(raw_body, headers)
```

实现候选：

```text
NoneProvider       mandatory default
SmtpProvider       only after company/provider policy approval
ResendProvider     OPT_IN / TRANSACTIONAL only
CorporateInboxProvider optional inbound
ResendInboundProvider optional inbound
```

发送和接收配置必须分离。配置了 Resend 或 SMTP outbound，不等于回复会自动进入系统。

## 9.2 配置

```ini
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false

OUTBOUND_EMAIL_PROVIDER=NONE
# NONE | SMTP | RESEND

INBOUND_EMAIL_PROVIDER=NONE
# NONE | CORPORATE_MAILBOX | RESEND

OUTREACH_ALLOWED_MARKETS=AE,MX
OUTREACH_MAX_SENDS_PER_MINUTE=1
OUTREACH_MAX_SENDS_PER_DAY=10
OUTREACH_MAX_SENDS_PER_COMPANY_30D=2

HUNTER_MODE=DISABLED
HUNTER_API_KEY=

RESEND_USE_CASE=DISABLED
# DISABLED | OPT_IN | TRANSACTIONAL
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_FROM_NAME=DPV International
RESEND_FROM_EMAIL=
RESEND_REPLY_TO=

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_NAME=DPV International
SMTP_FROM_EMAIL=
SMTP_REPLY_TO=
```

同步更新：

```text
.env.example
实际 compose deployment env contract
docs/COMPANY_PC_SETUP.md
runbooks/LOCAL_DEVELOPMENT.md
```

凭据只进入部署 secret/n8n credential manager，不进入 Git、数据库、前端、日志或任务 payload。

---

# 10. 消息级人工编辑与精确版本审批

本节只定义 Gate B 的具体消息审批。它不得替代 Gate A 的业务机会确认；Gate A 也不得被当成任何邮件正文的发送授权。

状态：

```text
DRAFT
INVALID_DRAFT
PENDING_REVIEW
NEEDS_CHANGES
APPROVED
REJECTED
SUPERSEDED
EXPIRED
```

审批必须绑定不可变快照：

```text
draft_id + draft_version
content_hash
recipient_id + normalized_email
company_id + product_profile
from_identity + reply_to
channel
subject + body hash
approved_claim_ids
evidence snapshot hash
approver identity and role
approval timestamp
optional scheduled_at
```

任何编辑、收件人变化、发件身份变化、证据变化或产品变化：

```text
old approval = invalid
new draft version required
new approval required
```

批量审批仍必须为每个 recipient × exact content 生成独立 approval digest。不得批准一个以后还能变化的模板。

审批 API 必须有：

```text
authenticated user
role-based authorization
CSRF/session protection
append-only audit
separation of author and approver configurable
```

---

# 11. 发送、幂等与事件

## 11.1 发送幂等键

```text
approval_id
+ approved_content_hash
+ recipient
+ from_identity
```

数据库唯一约束是最终权威；pg-boss singleton 只做运行期去重。

审批记录和 outbound outbox 必须在同一事务中创建。worker 每次 Provider 调用前重新检查：

```text
kill switch
provider purpose
current suppression
current readiness
contact verification freshness
approval digest
rate caps
```

## 11.2 发送状态

```text
QUEUED
BLOCKED
SENDING
PROVIDER_ACCEPTED
DELIVERED
SOFT_BOUNCED
HARD_BOUNCED
FAILED
CANCELLED
```

投诉、退订、回复是独立事件维度，不能用一个 send_status 覆盖历史。

Provider event 必须 append-only。派生显示优先级：

```text
COMPLAINED / OPTED_OUT
> HARD_BOUNCED
> FAILED
> DELIVERED
> PROVIDER_ACCEPTED
> QUEUED
```

永久错误不重试；429、可恢复 5xx 和网络错误使用有界指数退避。

---

# 12. Webhook、入站邮件与回复分类

## 12.1 Webhook 路径

```text
raw HTTP body
→ signature + timestamp verification
→ idempotent webhook inbox
→ immediate 2xx
→ pg-boss normalization
→ event / suppression / thread / CRM outbox
```

要求：

```text
invalid signature → no business event
duplicate provider event → processed once
out-of-order events supported
provider secret server-side only
raw provider payload not exposed in company-facing API
```

## 12.2 回复关联

顺序：

```text
1. In-Reply-To / References → outbound provider/message ID
2. unguessable Reply-To token
3. sender email + active outreach thread
4. otherwise NEEDS_REVIEW
```

Resend 只有在配置 receiving domain/MX/Webhook，或企业邮箱主动转发到 Resend receiving address 后，回复才会进入 Resend。普通企业 `Reply-To` 默认进入企业邮箱。

## 12.3 入站安全

所有入站内容是外部不可信输入：

```text
sanitize HTML
never execute code/macros/scripts
isolate attachments
limit MIME / size / count
do not store raw email directly in agent system prompt
no direct database mutation requested by email text
no automatic quote, price, order or send action
```

## 12.4 回复意图

```text
CATALOGUE
SAMPLE
QUOTATION
MEETING
DEFER
DECLINE
OPT_OUT
AUTO_REPLY
IRRELEVANT
REVIEW
```

回复分类只能：

```text
创建销售任务
设置 owner / SLA / next action
生成待审批回复草稿
更新 CRM outbox
```

不得自动发送报价或承诺任何商业条件。

---

# 13. 抑制模型

现有 `company_suppressions` 继续作为公司级最高优先门槛。

新增联系人/邮箱级 suppression：

```text
INVALID_EMAIL
HARD_BOUNCE
SOFT_BOUNCE_LIMIT
OPT_OUT
COMPLAINT
MANUAL
PROVIDER_SUPPRESSED
```

处置：

```text
Hunter INVALID → email/contact suppression
hard bounce → email/contact suppression; do not automatically exclude whole company
soft bounce → retry/threshold; then contact hold
complaint → contact suppression + company DO_NOT_CONTACT
explicit recipient opt-out → contact suppression
explicit company-wide opt-out → company suppression
reply → stop automated follow-up for that thread
manual takeover → stop automation for that thread
```

发送前 suppression 检查必须与创建发送 attempt 在事务边界内协调，避免审批后新增 suppression 仍被发送。

---

# 14. Excel / CSV 数据交换总目标

Phase 7 必须提供：

```text
客户线索总表导出
筛选后客户机会导出
客户线索导入
公司商品上传/导入
客户成交/订单上传/导入
导入批次结果与错误表导出
标准模板下载
共享文件夹只读发现和导入
```

支持格式：

```text
CSV UTF-8
XLSX
```

V1 默认拒绝：

```text
legacy .xls
password-protected workbook
executable macro behavior
unbounded workbook
```

`.xlsm` 如用于历史只读共享文件，只读取缓存值，不执行宏，并进入单独的受控路径；普通网页上传模板不接受 `.xlsm`。

---

# 15. 复用现有导入基础

继续复用：

```text
leadgen.reference_data_import_batches
leadgen.reference_data_source_files
leadgen.reference_data_imports
leadgen.reference_data_import_rows
SharedHistoryImportService
ReferenceDataImportService
source_identity_key
source file SHA-256
import version / supersedes
dry-run → manual commit
```

继续复用：

```text
csv-parse 7.0.2 for CSV
existing Windows shared-folder inventory/staging scripts
existing openpyxl host-side historical workbook staging
```

生产 Node UI 的 XLSX 读写采用 reuse-first 评估后的 `ExcelJS`，固定版本和 package-lock；理由是当前 dashboard Docker image 只有 Node 24，直接加入 Node XLSX 库比向应用容器加入完整 Python runtime 更符合现有部署。正式采用前在 `docs/PHASE7_REUSE_RESEARCH.md` 记录 MIT 许可、维护状态、流式读写、公式处理、内存上限和回滚方式。

不得建立第二套无 provenance 的 Excel 导入系统。

---

# 16. 导入类型与模板

创建可下载模板：

```text
DPV_Prospect_Leads_Import_Template_v1.xlsx
DPV_Product_Master_Import_Template_v1.xlsx
DPV_Customer_Deals_Import_Template_v1.xlsx
```

## 16.1 客户线索导入

类型：

```text
PROSPECT_LEADS
dataset_role = PROSPECT_IMPORT
```

最低字段：

```text
external_lead_id
company_name
country_code
website_url nullable
city nullable
company_type nullable
contact_name nullable
contact_title nullable
business_email nullable
business_phone nullable
product_profile nullable
source_reference
owner nullable
notes nullable
```

规则：

```text
imported row starts as UNCONFIRMED / IMPORTED_REVIEW
does not become Product Match evidence
does not become verified Decision Maker evidence
does not enter outreach
domain/exact external ID first; fuzzy name only creates REVIEW link
verification and existing-customer reconciliation required before promotion
```

## 16.2 公司商品上传

类型：

```text
PRODUCT_MASTER_UPDATE
dataset_role = PRODUCT_CATALOG_UPDATE
```

最低字段：

```text
external_product_id
sku nullable
product_name
product_profile
category nullable
subcategory nullable
material nullable
size_spec nullable
color nullable
MOQ nullable
packing nullable
certification nullable
approved_sales_claim nullable
catalog_status
effective_date nullable
```

规则：

```text
do not overwrite raw product_master facts
stage every row with source file/sheet/row/hash
UNKNOWN remains UNKNOWN
taxonomy conflicts enter REVIEW
price/currency fields must carry explicit commercial type
approved sales claims require separate approval
commit creates append-only product revision
rebuild product-profile catalog snapshot after approved commit
enqueue Phase 6.1 recalculation only for affected profiles
```

为保持现有 `product_master.id` 外键稳定，新增 append-only：

```text
product_master_revisions
```

当前视图选择最新已批准 revision；旧 revision 和引用它的历史结果继续可回放。

## 16.3 客户成交/订单上传

类型：

```text
CUSTOMER_DEALS
CUSTOMER_DEAL_LINES
dataset_role = CONVERTED_ORDER_HISTORY
```

最低字段：

```text
external_customer_id
company_name
country_code
external_deal_or_order_id
deal_status
order_date nullable
currency nullable
incoterm nullable
external_product_id / sku nullable
product_name nullable
quantity nullable
customer_sales_price nullable
supplier_cost nullable
owner nullable
source_reference
```

规则：

```text
customer crosswalk must be explicit or REVIEW
WON/confirmed order must be explicit
CRM stage text alone does not prove conversion
customer sales price and supplier cost remain distinct
missing currency remains UNKNOWN
delivery date is not order date
commit marks confirmed customer relationship
confirmed existing customer is removed from new-prospect outreach
history triggers versioned ICP/customer-match rebuild, not silent overwrite
```

---

# 17. 统一导入流程

```text
upload or shared-file discovery
→ file allowlist / size / MIME / extension validation
→ SHA-256 and batch identity
→ local Git-ignored staging
→ workbook structure validation
→ header/schema mapping
→ row normalization
→ exact dedupe / review candidate recall
→ dry-run result
→ user review
→ authorized approval
→ transactional commit
→ affected downstream recalculation
→ row-level result workbook
```

Dry-run 必须显示：

```text
accepted
review
rejected
duplicate
new entities
updates/revisions
ambiguous crosswalks
missing required fields
taxonomy conflicts
currency/price-type warnings
downstream jobs to enqueue
```

Commit 规则：

```text
dry_run_passed = true
errors = 0
approval record exists
source hash unchanged
transaction + advisory lock
append/version, never destructive overwrite
same file hash replay is idempotent
changed file creates new version
prior provenance retained
```

文件限制必须可配置：

```text
maximum file bytes
maximum worksheets
maximum rows per sheet
maximum columns
maximum cell length
maximum formula cells
maximum concurrent import jobs
```

公式安全：

```text
never execute formulas or macros
read cached values only where applicable
reject external workbook links in V1
escape CSV cells beginning with = + - @
write XLSX values with explicit cell types
```

---

# 18. 共享文件夹只读导入

支持公司共享目录，但必须延续已经验收的只读模式：

```text
Windows host read-only inventory
→ allowlisted UNC root
→ source before hash / size / mtime
→ copy to local Git-ignored staging
→ local hash
→ source after hash
→ three hashes equal
→ parse local copy only
→ dry-run
→ human approval
→ commit
```

必须保持：

```text
shared source modified = 0
deleted = 0
renamed = 0
moved = 0
created = 0
```

边界：

```text
不把 UNC 共享目录挂载到 n8n 或应用容器
不在共享目录写 marker / lock / report / temp file
Windows helper 只提交 manifest 和 staged bundle
DPV_SHARED_FOLDER_PATH 是固定 allowlist
复制期间来源变化则整文件失败
不执行宏、外链或嵌入对象
UNC/staging path 永不进入 UI、导出、模型输入或外联内容
```

共享目录检查可以由计划任务发现新文件，但：

```text
auto discovery allowed
auto dry-run allowed
auto commit forbidden
```

---

# 19. 客户线索与业务数据导出

## 19.1 导出类型

```text
LEAD_MASTER_INTERNAL
SALES_OPPORTUNITY
PRODUCT_CATALOG_INTERNAL
CUSTOMER_DEAL_HISTORY
IMPORT_ERROR_REPORT
```

支持：

```text
CSV
XLSX
```

## 19.2 客户线索总表

至少包含：

```text
company name
market / country
website
verification/lifecycle
Buyer Business Model
Category Procurement Match
Product Opportunity summary/status
Supplier Access
Product Access Matrix
Readiness and blockers
Opportunity status: Recommended / Management Approved / Evidence Required / Hold / Not Suitable
system recommendation reason codes
management decision actor/time/revision
decision maker / buying department
business contact and verification
company/contact suppression state
draft/approval/send/reply summary
owner / next action
DPV Score
Management Baseline Match
Mexico Historical Reference Match
source reference URLs
last assessed / last verified
```

三种导出模式：

```text
Current Filter Export
Selected Rows Export
Full Authorized Master Export
```

## 19.3 导出安全

不得导出：

```text
API keys / provider secrets
supplier costs unless explicit Finance-authorized export
profit / margin
raw order payload
private customer notes
UNC / local staging paths
provider raw payload
internal telemetry
```

要求：

```text
same filters and qualification semantics as /api/opportunities
role-based column allowlist
export schema version
data snapshot timestamp
row count and SHA-256
requester and generated_at
expiry and download audit
short-lived local download token
Git-ignored export directory
```

---

# 20. Database Migration 025

创建：

```text
database/migrations/025_phase7_outreach_and_data_exchange.sql
```

事务化、additive only、通过现有 checksum ledger runner 应用。

## 20.1 Outreach entities

```text
business_opportunity_decision_snapshots
business_opportunity_management_events
contact_work_queue
outreach_eligibility_snapshots
outreach_recipients
outreach_drafts
outreach_draft_evidence
outreach_draft_products
outreach_approvals
outbound_messages
outbound_message_attempts
email_webhook_inbox
email_message_events
outreach_threads
inbound_messages
reply_classifications
contact_suppressions
sales_tasks
crm_sync_outbox
```

关键约束：

```text
opportunity decision is unique per company × product_profile × assessment revision
management event is append-only and references exact decision snapshot
management approval requires the referenced current snapshot to be RECOMMENDED
only current MANAGEMENT_APPROVED opportunity can own an active contact_work_queue row
system recommendation and management decision are stored separately
outreach recipient references exactly one active contact source
draft evidence uses typed FK/reference, not unbounded mixed IDs
draft products FK to real product_master.id
approval append-only and bound to content_hash
outbound_messages.approval_id UNIQUE
outbound_messages.idempotency_key UNIQUE
webhook UNIQUE(provider, provider_event_id)
inbound UNIQUE(provider, provider_message_id)
active contact suppression partial unique index
CRM outbox idempotency key UNIQUE
```

## 20.2 Data exchange extensions

扩展现有 import types：

```text
PROSPECT_LEADS
PRODUCT_MASTER_UPDATE
CUSTOMER_DEALS
CUSTOMER_DEAL_LINES
```

扩展 dataset roles：

```text
PROSPECT_IMPORT
PRODUCT_CATALOG_UPDATE
CONVERTED_ORDER_HISTORY
```

新增：

```text
product_master_revisions
data_export_jobs
data_export_download_events
import_approvals
```

旧 import batches、source files、rows、historical customers/orders、product master 和 OKKI 数据保持不变。

---

# 21. APIs

## 21.0 Opportunities decision and contact queue

```text
GET  /api/opportunities?status=RECOMMENDED
GET  /api/opportunities/:id/decision-history
POST /api/opportunities/:id/management-approve
POST /api/opportunities/:id/hold
POST /api/opportunities/:id/request-evidence
POST /api/opportunities/:id/reopen
GET  /api/contact-queue
```

`management-approve` 必须要求认证身份、相应角色、当前 `RECOMMENDED` decision revision 和 CSRF/session protection。非 `RECOMMENDED`、联系人验证过期或 snapshot 已变化时返回确定性冲突，不创建管理事件。成功时只创建管理事件和待联系任务；响应中必须明确 `provider_calls=0`、`messages_approved=0`。

最小角色分离：

```text
MANAGEMENT_APPROVER = 确认是否进入 Contact Queue
OUTREACH_APPROVER = 审核具体消息版本
SENDER_OPERATOR = 只操作已经满足两个关口的队列
```

同一人员可由公司授权拥有多个角色，但每次事件必须记录其当时使用的角色和确切对象。

系统推荐状态只能由确定性重算服务写入；LLM、浏览器请求和通用 CRM 字段不得直接把机会改成 `RECOMMENDED`。

## 21.1 Skills / Marketing Context

```text
GET  /api/outreach/marketing-context
POST /api/outreach/marketing-context/versions
POST /api/outreach/marketing-context/:id/approve
```

## 21.2 Contact verification

```text
POST /api/contacts/:id/hunter-verify
GET  /api/contacts/:id/verification-history
```

## 21.3 Draft and approval

```text
POST  /api/outreach/drafts
GET   /api/outreach/drafts/:id
PATCH /api/outreach/drafts/:id
POST  /api/outreach/drafts/:id/submit
POST  /api/outreach/drafts/:id/approve
POST  /api/outreach/drafts/:id/reject
POST  /api/outreach/drafts/:id/supersede
```

## 21.4 Messages and inbox

```text
POST /api/outreach/messages/:id/enqueue
GET  /api/outreach/messages/:id
GET  /api/outreach/messages/:id/events
GET  /api/outreach/threads/:id
GET  /api/outreach/inbox
POST /api/webhooks/email/resend
POST /api/webhooks/email/corporate
```

## 21.5 Import

```text
GET  /api/data-imports/templates/:type
POST /api/data-imports/dry-run
GET  /api/data-imports/:id
GET  /api/data-imports/:id/rows
POST /api/data-imports/:id/submit
POST /api/data-imports/:id/approve
POST /api/data-imports/:id/commit
GET  /api/data-imports/:id/error-report
```

## 21.6 Export

```text
POST /api/data-exports
GET  /api/data-exports/:id
GET  /api/data-exports/:id/download
```

所有写入 API 都需要认证身份与角色；内部 worker API 使用 internal token；外部 Webhook 只使用 Provider 签名，不接受 internal token 作为替代。

---

# 22. pg-boss 与 n8n

新增队列：

```text
recalculate-business-opportunities
refresh-opportunity-exception-queue
verify-outreach-contact
generate-outreach-draft
validate-outreach-draft
send-outreach-email
process-email-provider-event
process-inbound-message
classify-inbound-reply
create-sales-followup
sync-outreach-to-crm
discover-shared-import-files
parse-reference-import
commit-reference-import
export-business-data
recalculate-after-import
```

新增 n8n workflow：

```text
workflows/04-phase7-controlled-outreach-and-data-exchange.json
```

n8n 负责：

```text
发起验证/草稿/导入导出 job
通知审批人
等待审批结果
触发 CRM outbox processing
显示聚合进度
```

n8n 不负责：

```text
直接持有 Provider secret
直接调用 SMTP/Resend 发送节点
直接访问 UNC 共享目录
直接计算 Product Match/Readiness
直接自动 commit 导入
```

---

# 23. CRM

Phase 7 以 PostgreSQL 为主记录，CRM 为业务副本。

```text
DPV DB approval/send/reply event
→ crm_sync_outbox
→ n8n/approved CRM adapter
→ external ID + result
```

CRM 同步内容：

```text
company/contact identity
Buyer Model and Readiness summary
owner
approved outreach activity
delivery/reply summary
reply intent
next action / SLA
existing customer/deal link
```

不得把：

```text
进入 CRM
```

解释成：

```text
批准发送
```

CRM 重放必须幂等，CRM 字段不得反向覆盖 DPV 的证据、评分或历史事实。

---

# 24. UI

先读并遵守：

```text
docs/UI_SYSTEM.md
```

公司侧继续使用中文上、英文下且同等字号权重的 `.bi` 结构。

## 24.1 Opportunities 是老板默认决策页面

主导航和页面职责：

```text
市场研究 / Market Research = 搜索和证据采集
客户名录 / Companies = 全量公司主档、调查与历史
业务机会 / Opportunities = 老板默认入口和联系决策
待联系 / Contact Queue = 已获管理确认后的执行队列
```

`Companies` 页面不得提供绕过 Opportunity Gate 的批量联系或直接发送入口。公司详情可以展示关联机会和“查看业务机会”，但联系操作必须落到具体 `company × product_profile` 机会。

Opportunities 默认筛选：

```text
status = RECOMMENDED
不是全量 Companies
不是全部 DPV Score 排名
不是历史客户列表
```

建议联系表至少显示：

```text
Company / Market / Product Profile
Opportunity Status
Buyer Business Model
Category Procurement Match
Product Opportunity
Supplier Access
Decision Maker / Buying Department readiness
verified contact route and verification freshness
关键推荐理由与来源
阻碍项
Owner / Next Action
Last assessed
```

排序采用确定性优先级：

```text
Opportunity Status
→ Readiness
→ Category Procurement Match confidence/evidence freshness
→ Supplier Access
→ contact verification freshness
→ DPV Score as tie-breaker only
```

不得创建会改变 Phase 5/6/6.1 资格的新通用 Lead Score。

老板操作：

```text
确认联系 / Confirm Contact
暂不联系 / Hold
要求补证 / Request Evidence
查看证据 / View Evidence
```

点击“确认联系”后：

```text
opportunity status = MANAGEMENT_APPROVED
创建待联系任务
记录 actor、role、time、decision revision、reason nullable
provider calls = 0
approved messages = 0
```

只有当前 `RECOMMENDED` 行显示可用的“确认联系”。`EVIDENCE_REQUIRED_CONTACT`、`EVIDENCE_REQUIRED_BUYER_ROLE`、`EVIDENCE_REQUIRED_EMAIL`、`HOLD` 和 `NOT_SUITABLE` 均不提供该动作。

批量确认如以后启用，仍必须逐个机会创建独立事件、显示影响数量和排除原因，并且绝不等同批量邮件审批或群发。

例外工作区：

```text
Evidence Required
→ 采购模式不清楚
→ 证据不足/冲突
→ 公司身份冲突
→ Contact：尚未找到 profile-relevant Buyer / Procurement
→ Buyer Role：职位或采购职责未验证
→ Email：NOT_VERIFIED / UNKNOWN / ACCEPT_ALL / 已过期
```

老板默认不需要逐一审核自动排除项；`NOT_SUITABLE` 进入可检索的排除视图，并显示确定性 reason codes 和来源。

## 24.2 Contact Queue / Company Detail

只有 `MANAGEMENT_APPROVED` 机会进入待联系。新增：

```text
联系有效期复检 / Contact Revalidation
开发信 / Outreach Draft
消息审批 / Message Approval
联系记录 / Outreach History
回复与下一步 / Reply & Next Action
```

当前没有可发送记录时显示业务结果：

```text
暂不具备联系条件
当前阻碍：验证过期 / 新 suppression / 证据变化 / 消息审批
```

不得显示技术叙述、把无结果伪装成系统错误，或把 `MANAGEMENT_APPROVED` 显示成“邮件已批准”。

## 24.3 Data Exchange

新增页面：

```text
数据导入 / Data Import
数据导出 / Data Export
```

导入页：

```text
下载模板
选择导入类型
上传 CSV/XLSX
共享目录发现批次
dry-run 结果
accepted/review/rejected/duplicate
字段级错误
提交审批
commit
逐行结果下载
```

导出页：

```text
选择数据集
复用当前筛选
选择 CSV/XLSX
显示列权限
生成状态
行数/生成时间/过期时间
下载
```

## 24.4 Browser matrix

```text
1440×900
1024×768
768×900
390×844
375×667
844×390
light/dark
comfortable/compact
keyboard/focus
loading/empty/error/long content
reduced motion
no page-level overflow
```

---

# 25. Metrics 与审计

业务指标：

```text
opportunities by RECOMMENDED / MANAGEMENT_APPROVED / EVIDENCE_REQUIRED / HOLD / NOT_SUITABLE
recommended → management-approved conversion
management approval → contact-ready lead time
exception queue age and resolution reason
eligible outreach recipients
Hunter verification distribution
drafted / invalid / pending / approved / rejected
blocked sends by reason
provider accepted / delivered / bounced / complained / opted out
reply intents
sales tasks and SLA
CRM sync status
import batches and row states
export jobs/downloads
```

当前真实验收必须报告：

```text
eligible recipients = 0
live provider calls = 0
real prospect sends = 0
```

Telemetry 禁止写入：

```text
full email body
full recipient email when hash/reference is enough
API keys/secrets
raw import payload
prices/costs
UNC/staging paths
inbound raw content
```

---

# 26. Tests

## 26.1 Eligibility and Phase 6 regression

```text
current 14 Phase 6.1 results produce 0 RECOMMENDED opportunities
current 14 Phase 6.1 results all blocked from sending
Companies membership never implies outreach eligibility
verified direct end buyer + category match + Supplier Access + verified Buyer role + VALID email can become RECOMMENDED
verified distribution buyer procurement/resale evidence + verified Buyer role + VALID email can become RECOMMENDED
broker/commission/referral-only intermediary cannot become RECOMMENDED
duplicate, category mismatch, dead website, existing customer become NOT_SUITABLE
unclear procurement model/business evidence/identity becomes opportunity EVIDENCE_REQUIRED
missing Buyer becomes EVIDENCE_REQUIRED_CONTACT
unclear Buyer responsibility becomes EVIDENCE_REQUIRED_BUYER_ROLE
NOT_VERIFIED / UNKNOWN / ACCEPT_ALL / expired email becomes EVIDENCE_REQUIRED_EMAIL
contact evidence completion triggers deterministic recomputation before RECOMMENDED
active suppression derives display HOLD without rewriting long-term business-fit evidence
Supplier Access evidence level/contact verification freshness/DPV Score can sort but cannot compensate a failed hard gate
only explicit management approval creates Contact Queue item
management approval creates zero provider calls and zero message approvals
management approval against non-RECOMMENDED or stale snapshot is rejected
underlying decision revision change makes prior approval stale and removes active Contact Queue item
HOLD never enters Contact Queue
UNCLEAR_INTERMEDIARY blocked
EXCLUDED_INTERMEDIARY blocked
UNKNOWN buyer blocked
non-CATEGORY_PROCUREMENT_MATCH blocked
Supplier Access HIGH cannot bypass Product Match
NEEDS_DECISION_MAKER blocked
existing customer blocked
company suppression blocked
contact suppression blocked
all Phase 5/6/6.1 scores and evidence unchanged
```

## 26.2 Skills and draft

```text
every personalization statement references evidence
every product references real product_master.id
every product claim references approved_claim_id
unapproved price/MOQ/certification/lead-time claim fails
internal cost/order/path canaries never reach model or draft
Re:/Fwd: fabrication rejected
draft defaults PENDING_REVIEW, never self-approves
edit after approval invalidates old digest
prospecting/revops cannot alter DPV qualification
```

## 26.3 Hunter and provider

```text
VALID / ACCEPT_ALL / UNKNOWN / TEMPORARY_ERROR / INVALID mapping
MX status never becomes mailbox VALID
verification TTL
provider NONE causes zero network calls
Resend cold outreach/no-opt-in returns PROVIDER_PURPOSE_NOT_ALLOWED
Resend opt-in/transactional synthetic fixture permitted
SMTP/other provider must pass purpose policy adapter
same idempotency key sends once
worker crash/restart does not duplicate send
429/5xx bounded retry
permanent errors no retry
kill switch checked immediately before provider call
```

## 26.4 Approval and suppression

```text
opportunity management approval and exact message approval remain distinct
only MANAGEMENT_APPROVED opportunity can reach message drafting/contact execution
approval bound to recipient/content/from/channel
changed content requires reapproval
authorization/role/CSRF/audit
suppression created after queueing blocks send
hard bounce suppresses contact, not whole company
complaint creates contact + company suppression
thread reply stops automated follow-up
manual takeover stops automation
```

## 26.5 Webhook and inbound

```text
raw-body signature verification
invalid signature rejected
duplicate event idempotent
out-of-order events safe
reply threading by headers/token
unmatched reply enters REVIEW
HTML sanitized
attachments isolated
email instructions cannot trigger database mutation or send
AUTO_REPLY not treated as positive reply
QUOTATION/SAMPLE/MEETING create task only
```

## 26.6 Import

```text
CSV and XLSX templates round-trip
file/MIME/size/sheet/row/column/cell limits
formula and CSV injection
macros/external links not executed
password-protected file rejected
dry-run has no canonical writes
same hash replay idempotent
changed file creates version
ambiguous company/customer link remains REVIEW
unknown taxonomy remains UNKNOWN
product revision preserves product_master.id
customer sales price and supplier cost separated
missing currency remains UNKNOWN
confirmed deal marks existing customer and blocks outreach
downstream recalculation only affects relevant profiles/entities
```

## 26.7 Shared folder

```text
allowlisted UNC only
source before/local/after SHA-256 equal
source change during copy fails
modified/deleted/renamed/moved/created = 0
parse local staged copy only
auto discovery never auto commits
UNC/staging paths absent from API/UI/export/model
```

## 26.8 Export

```text
current filter / selected / full authorized modes
CSV and XLSX schema versions
column-level role permissions
formula injection protection
internal fields absent
row count/hash/audit/expiry
download authorization
/api/opportunities filter semantics preserved
```

最终：

```text
npm test
0 failed
```

---

# 27. PASS Gate

```text
[ ] phase6.1 remote baseline verified before implementation
[ ] docs/PHASE7_REUSE_RESEARCH.md completed
[ ] selected Skills pinned with commit/version/SHA/license
[ ] dpv-b2b-outreach-v1 created and validated
[ ] Phase 6/6.1 domain fields are read-only to Skills
[ ] Companies remains the complete master and never implies contact eligibility
[ ] Opportunities is the management default decision surface
[ ] deterministic rules produce all five opportunity states
[ ] DISTRIBUTION_BUYER requires procurement-and-resale evidence; pure intermediary remains excluded
[ ] RECOMMENDED requires verified profile-relevant Buyer/Procurement responsibility
[ ] RECOMMENDED email route is Hunter VALID and within verification TTL
[ ] ACCEPT_ALL / UNKNOWN / NOT_VERIFIED remain EVIDENCE_REQUIRED_EMAIL
[ ] only MANAGEMENT_APPROVED opportunities enter Contact Queue
[ ] opportunity approval and exact message approval are separate append-only events
[ ] management approval alone produces 0 provider calls and 0 approved messages
[ ] stale eligibility invalidates active Contact Queue status without deleting audit history
[ ] current real data produces 0 eligible recipients and 0 sends
[ ] production send uses a new exact-version approval model
[ ] EmailService, Hunter and Provider states remain independent
[ ] Resend cold outreach is deterministically blocked
[ ] Provider NONE is the default
[ ] OUTREACH_ENABLED and LIVE_PROSPECT_SEND_APPROVED default false
[ ] contact-level and company-level suppression are distinct
[ ] approved message idempotency prevents duplicate sends
[ ] Webhook verification and event replay pass
[ ] inbound content is sandboxed and human-reviewed
[ ] reply intent creates tasks, not automatic commitments
[ ] CRM outbox is idempotent and does not overwrite DPV facts
[ ] lead master CSV/XLSX export works with current filters
[ ] lead, product and deal import templates work
[ ] all imports require dry-run + approval + commit
[ ] shared-folder access remains read-only with three-hash verification
[ ] product imports use revisions and preserve product_master IDs
[ ] confirmed customer/deal imports stop new-prospect outreach
[ ] raw prices, costs, paths and payloads remain isolated
[ ] migration 025 applies and replays on existing database
[ ] tests 0 failed
[ ] browser matrix PASS
[ ] docs/PHASE7_RESULT.md created
[ ] VERSION_CHANGELOG updated
[ ] implementation commit pushed and remote verified
[ ] annotated tag phase7 pushed and remote verified
```

Phase 7 可在零真实发送的情况下 PASS，但必须明确报告：

```text
CONTROLLED OUTREACH INFRASTRUCTURE: PASS
REAL PROSPECT SENDS: 0
LIVE PILOT: NOT STARTED
```

不得通过放宽 Phase 6.1 或联系人门槛来制造 live acceptance。

---

# 28. 实施顺序

```text
1. Verify main/phase6.1 remote baseline and clean worktree
2. Create docs/PHASE7_REUSE_RESEARCH.md
3. Recheck Resend AUP and all selected Skill/provider versions
4. Vendor selected Skills and create skills.lock.json
5. Build dpv-b2b-outreach-v1 and safe Marketing Context
6. Create migration 025 and explicit migration runner verification
7. Build deterministic business-fit qualification and initial Evidence Required routing
8. Verify Hunter secret presence/mode/credits/health without exposing the key
9. Run Hunter contact discovery and mailbox verification only for business-fit candidates
10. Build CONTACT / BUYER_ROLE / EMAIL evidence reason codes and five-state projection
11. Require verified Buyer responsibility + VALID email + SALES_READY before RECOMMENDED
12. Build append-only management decision events and Contact Queue
13. Update Opportunities as the management default; keep Companies as full master
14. Build eligibility snapshot, TTL revalidation and contact suppression
15. Build draft generation and deterministic validation
16. Build exact-message editing/submission/approval
17. Build OutboundEmailProvider with NoneProvider first
18. Build Resend restricted-purpose adapter and synthetic tests
19. Build approved SMTP/other provider only if company selects one
20. Build outbound outbox, attempts and append-only events
21. Build webhook inbox and inbound/reply security
22. Build sales tasks and CRM outbox
23. Extend import types and product revision model
24. Build CSV/XLSX templates and UI upload dry-run
25. Build shared-folder discovery using existing read-only boundary
26. Build async lead/product/deal export jobs
27. Update Contact Queue, Company Detail and Data Exchange UI
28. Add n8n Phase 7 orchestration without direct send nodes
29. Run unit, contract, migration, privacy and regression tests
30. Apply/replay migration on existing database
31. Run synthetic sandbox send/event fixtures only
32. Verify current real database produces zero recommendations, approvals and sends
33. Run browser matrix
34. Create docs/PHASE7_RESULT.md and update docs
35. Implementation commit + push + verify
36. Documentation handoff commit
37. Annotated tag phase7 + push + verify
38. STOP
```

---

# 29. 交付文件

```text
DPV_PHASE7_CODEX_EXECUTION_PLAN_V1.md
docs/PHASE7_REUSE_RESEARCH.md
docs/PHASE7_RESULT.md
docs/PHASE7_OPPORTUNITIES_DECISION_CONTRACT.md
docs/PHASE7_DATA_EXCHANGE_CONTRACT.md
docs/PHASE7_OUTREACH_DATA_CONTRACT.md
docs/UI_SYSTEM.md
docs/VERSION_CHANGELOG.md
docs/COMPANY_PC_SETUP.md
workflows/04-phase7-controlled-outreach-and-data-exchange.json
database/migrations/025_phase7_outreach_and_data_exchange.sql
skills.lock.json
.agents/skills/dpv-b2b-outreach/
```

生成文件目录、导入 staging、导出文件、真实联系人、邮件正文、Provider payload 和凭据必须 Git 忽略。

---

# 30. Phase 7 之后的已确认规划输入（本阶段不执行）

收到实际 `docs/PHASE7_RESULT.md`、相关验收文档和实施后的 UI 代码后，以真实实现为基线编写 Phase 8，不得把本计划文件当作已完成结果。

后续正式阶段：

| Phase | 主要任务 | 完成标志 |
| --- | --- | --- |
| Phase 8 | 全系统 UI/UX 重构 | Opportunities、Companies、Contact Queue、详情页和 Data Exchange 完成新版设计 |
| Phase 9 | 真实业务机会补证 | 找到真实品类匹配公司并补齐 Buyer、采购部门、邮箱和 Supplier Access，产生真实 `RECOMMENDED / SALES_READY` |
| Phase 10 | 小规模真实联系闭环 | 受控发送、回复、退信、退订、销售任务和 CRM 成交反馈完整跑通 |
| Phase 11（可选） | Bangladesh、新市场、多语言和更多渠道 | 经单独范围确认后实施 |

Phase 8 的用户指定视觉参考：

```text
https://ui-ux-pro-max-skill.nextlevelbuilder.io/demo/customer-support-crm
```

Phase 8 使用 `ui-ux-pro-max` 对实际系统进行 audit-first 重构，参考该 Demo 的视觉语言：

```text
暖色强调色和浅色背景
清晰的大标题与信息层级
简洁导航和柔和阴影
更自然的圆角与留白
收件箱、对话和真实业务场景感
减少满屏状态标签、渐变装饰和卡片堆积
消除模板化“AI Dashboard”观感
```

该参考更偏产品展示型页面。DPV 后台继续保留适合高密度业务操作的表格、筛选器、左右分栏、详情抽屉、批次处理和审计信息，不照搬客服 CRM 的业务字段或 Landing Page 布局。

Phase 8 重点页面：

```text
Opportunities — 老板默认决策页
Companies — 全量公司主档
Evidence Required — Buyer/Contact/Email 补证工作区
Contact Queue — Management Approved 后的执行队列
Company / Opportunity Detail
Data Import / Export
Outreach / Inbox / CRM handoff
```

Phase 10 核心闭环：

```text
搜索公司
→ 产品与采购匹配
→ Supplier Access
→ Buyer / Procurement 搜索与职责验证
→ Hunter 邮箱验证
→ Recommended
→ 老板确认
→ 开发信生成和具体消息审批
→ 真实联系
→ 回复和销售跟进
→ 成交数据回流
```

---

# 31. STOP

Phase 7 PASS 后立即停止：

```text
STOP — live prospect pilot not started; Phase 8 not started.
```

未来真实试发必须单独取得管理授权，并以当时实际 `SALES_READY` 数据、Provider 服务政策、发件域名、联系人验证和精确审批记录为基础。
