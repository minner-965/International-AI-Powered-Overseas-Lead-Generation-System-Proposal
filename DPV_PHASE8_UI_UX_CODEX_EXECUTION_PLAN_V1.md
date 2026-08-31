# DPV Phase 8 V1 — 联系就绪门槛校正与全系统 UI/UX 重构

## Codex Authoritative Execution Plan

```text
Document version: Phase 8 V1
Plan status: READY FOR IMPLEMENTATION
Prepared at: 2026-08-31
Required baseline: remote-verified phase7
Baseline main/peeled tag commit: bd4af24634069aa3ee9b009c1e8799d627eff118
Phase 7 tag object: 7885974772a0cea3cd9a4be6551f1d6caeb7a6ae
Implementation baseline: 3ffcdb613d9ea4a3b0fc1990774c1d189d204fa5
Next migration: 028_phase8_contact_ready_recommendation.sql
Next release tag: phase8
Live prospect sending: NOT STARTED
Phase 9 real-opportunity enrichment: NOT STARTED
```

本文件以以下实际材料为权威基线：

```text
docs/PHASE7_RESULT.md
docs/VERSION_CHANGELOG.md
docs/UI_SYSTEM.md
DPV_PHASE7_CODEX_EXECUTION_PLAN_V1.md at tag phase7
actual Phase 7 frontend/backend source at tag phase7
```

用户指定的视觉参考：

```text
https://ui-ux-pro-max-skill.nextlevelbuilder.io/demo/customer-support-crm
```

只执行 **Phase 8**。本阶段先关闭 Phase 7 发布版中“联系人未就绪仍可显示 Recommended”的后补差异，再完成全系统 UI/UX 重构。不得启动 Phase 9 真实机会补证、Hunter 批量搜索、真实开发信发送或 Phase 10 小规模联系试点。

---

# 1. Phase 7 实际基线

## 1.1 发布状态

```text
phase7: PASS
main = origin/main = bd4af24634069aa3ee9b009c1e8799d627eff118
phase7 peeled commit = bd4af24634069aa3ee9b009c1e8799d627eff118
migrations applied: 025 / 026 / 027
tests: 427
passed: 424
failed: 0
conditional skips: 3
```

当前业务数据：

```text
companies: 106
product_master: 366
company × product-profile decisions: 14
eligibility snapshots BLOCKED: 14
eligible recipients: 0
Category Procurement Match: 0
SALES_READY: 0
verified named Buyer / Procurement: 0
Hunter VALID: 0
outbound messages: 0
Provider call starts: 0
real prospect sends: 0
```

Phase 8 必须保持这些业务事实，不得用 UI 演示数据、默认排序、颜色或空状态制造虚假业务机会。

## 1.2 Phase 7 已完成能力

继续复用并保持：

```text
deterministic opportunity decisions and eligibility snapshots
management auth / role / CSRF boundary
Contact Queue persistence
draft / exact-message approval / provider gates
NoneProvider default and Resend purpose restriction
webhook / inbound / suppression / CRM outbox
CSV/XLSX import and export
shared-folder read-only three-hash proof
isolated category / outreach / data workers
n8n workflow 04 inactive and provider-free
```

Phase 8 是视觉与工作流表达重构，不得重新实现这些后端能力。

## 1.3 文档版本差异

`docs/PHASE7_RESULT.md` 标题仍写“计划 V1.1”，但已发布的 `phase7` tag 内计划文件实际为 **V1.2**。

Phase 8 开始时必须：

```text
verify tag object and peeled commit again
record a documentation-only erratum from V1.1 → V1.2
do not rewrite Phase 7 counts, PASS status or Git history
do not move or recreate the phase7 tag
```

---

# 2. Gate 0 — Recommended 联系就绪规则校正

这是 Phase 8 的不可跳过前置项。Gate 0 PASS 后才允许进入 CSS 和页面重构。

## 2.1 实际代码差异

发布版 `services/demo-dashboard/src/phase7/opportunityDecision.js` 当前行为：

```text
business gates pass
→ system_recommendation_status = RECOMMENDED

Buyer / VALID email missing
→ contact_readiness = EVIDENCE_REQUIRED
→ display_opportunity_status can still remain RECOMMENDED
```

发布版测试也明确接受：

```text
missing contact
→ system recommendation remains RECOMMENDED
→ contact readiness is EVIDENCE_REQUIRED
```

`Phase7Service.manageOpportunity()` 目前只检查：

```text
current.system_recommendation_status === RECOMMENDED
```

因此理论上老板可以先批准一个尚无验证 Buyer/邮箱的机会，随后创建空的 Contact Queue 项。这正是本阶段必须关闭的差异。

## 2.2 V2 决策语义

保持业务匹配和联系建议两个概念独立：

```text
business_fit_status
  = FIT / EVIDENCE_REQUIRED / NOT_SUITABLE

contact_readiness
  = READY / EVIDENCE_REQUIRED / BLOCKED

system_recommendation_status
  = RECOMMENDED / EVIDENCE_REQUIRED / NOT_SUITABLE
```

`business_fit_status = FIT` 只说明公司、采购模式、品类采购匹配和 Supplier Access 达到业务匹配要求，不代表老板现在应该联系。

只有同时满足以下条件才产生 `RECOMMENDED`：

```text
company VERIFIED + ACTIVE
relationship = NEW_PROSPECT
Buyer Model = DIRECT_END_BUYER or DISTRIBUTION_BUYER
DISTRIBUTION_BUYER has procurement-and-resale evidence
Category Procurement Match = CATEGORY_PROCUREMENT_MATCH
Supplier Access / Cooperation Feasibility is not blocked
profile-relevant Buyer / Procurement / responsible department is VERIFIED
Buyer role or procurement responsibility is verified
business email route is ACTIVE
mailbox verification = VALID
verification is within TTL
Readiness = SALES_READY
no company/contact/recipient suppression
```

联系证据分流：

```text
no profile-relevant Buyer
→ EVIDENCE_REQUIRED_CONTACT

person exists but buying responsibility is unclear
→ EVIDENCE_REQUIRED_BUYER_ROLE

NOT_VERIFIED / UNKNOWN / ACCEPT_ALL / expired mailbox
→ EVIDENCE_REQUIRED_EMAIL
```

这些机会继续存在于 Opportunities 的 Evidence Required 视图，但不得进入老板默认 `RECOMMENDED` 视图。

## 2.3 管理批准硬门槛

`POST /api/opportunities/:id/management-approve` 必须在同一事务边界内重新检查：

```text
current decision snapshot
display_opportunity_status = RECOMMENDED
system_recommendation_status = RECOMMENDED
business_fit_status = FIT
contact_readiness = READY
latest eligibility_status = ELIGIBLE and not expired
at least one ACTIVE recipient with VALID mailbox inside TTL
no new company/contact/recipient suppression
decision revision unchanged
```

任一失败：

```text
HTTP 409
code = OPPORTUNITY_APPROVAL_GATE_BLOCKED
management event created = 0
Contact Queue row created = 0
provider calls = 0
messages approved = 0
```

## 2.4 Migration 028

创建：

```text
database/migrations/028_phase8_contact_ready_recommendation.sql
```

迁移必须 additive、事务化并使用现有 checksum/advisory-lock runner：

```text
add business_fit_status to business_opportunity_decision_snapshots
add CHECK constraint for FIT / EVIDENCE_REQUIRED / NOT_SUITABLE
update current-decision view to expose business_fit_status
keep all old snapshots append-only and replayable
do not backfill old rows by destructive overwrite
new rule_version = business-opportunity-decision-v2
recalculate creates a new assessment revision
```

当前 14 条真实记录在 V2 重算后仍必须：

```text
RECOMMENDED = 0
MANAGEMENT_APPROVED = 0
ELIGIBLE = 0
provider calls = 0
real sends = 0
```

---

# 3. 当前 UI 审计结论

## 3.1 技术栈

```text
Express 5.2.1
vanilla HTML / CSS / JavaScript
Tabler Core 1.4.0
Tabler Icons Webfont 3.46.0
no React / Vue / Svelte / Tailwind runtime
```

Phase 8 不进行前端框架迁移。保留现有 Express 静态服务、Tabler 基础组件和稳定 API/DOM hooks。

`ui-ux-pro-max` 的 `html-tailwind` stack 搜索在一次原查询和一次收窄重试后均为 0 条匹配，因此 Phase 8 的栈实现规范来自当前本地 Tabler/vanilla 代码与 Skill 的通用可访问性规则，不把空搜索结果伪装成已验证建议。

## 3.2 当前前端体量

```text
public/index.html: 56,720 bytes
public/app.js: 190,768 bytes / 2,196 lines
public/phase7-ui.js: 59,898 bytes / 847 lines
public/phase5.css: 48,401 bytes / 584 lines
public/styles.css: 17,984 bytes / 839 lines
public/contact-results.css: 14,613 bytes / 580 lines
public/phase7.css: 8,904 bytes / 346 lines
```

现有 CSS 审计计数：

```text
pill / badge / chip mentions: 27
box-shadow declarations: 27
border-radius declarations: 99
raw hex colors: 90
!important declarations: 34
```

这些数字不是独立失败条件，但证明当前视觉语义散落在多层 CSS，Phase 8 不应继续追加一个大型覆盖文件。

## 3.3 主要 UX 问题

### Overview

```text
7 个等权 KPI 横向排列
“Priority companies”仍按 DPV Score 显示，而不是老板真正关心的 Recommended Opportunities
页面标题、说明、更新时间和按钮在同一横排，双语内容发生挤压
```

### Opportunities

```text
默认 status = RECOMMENDED，当前结果 0
20 个筛选控件
11 个桌面表格列
实测表格约 2,199px 宽，而浏览器 viewport 为 1,920px
空结果仍显示一张宽空表和滚动条
当前表格没有把五态 Opportunity Status 作为第一决策信号
```

### Companies

```text
11 个表格列
Verification / Data Status / Size / Tier 等大量字段使用彩色胶囊
公司主档和业务机会决策在视觉上仍容易混淆
“Companies and Prospect Review”继续强化了客户名录即审核入口的旧概念
```

### Company Detail

```text
960px 桌面弹窗
15 个页签
页签横向滚动
顶端多组评分卡和状态胶囊争夺注意力
底部仍显示 legacy manual approval / reject，容易与 Opportunity Management Approval 混淆
```

### Data Import / Export

```text
功能链路完整，但步骤关系依赖多个同权卡片表达
空状态占据较大空间
导入审批和写入按钮的阶段区别主要依靠禁用颜色
移动端双语字段进一步拉长页面
```

### 全局

```text
中英文在标题、说明、状态和表头中同等放大，扫描成本高
卡片、胶囊、状态色和边框同时出现，形成模板化 dashboard 观感
信息层级依赖容器数量，不依赖排版、间距和主次关系
```

功能验收 PASS 不等于视觉质量 PASS。Phase 8 必须在保持数据语义的同时重新组织信息结构。

---

# 4. 视觉参考的采用边界

## 4.1 已观察到的参考特征

指定 Demo 是产品展示型 Landing Page，而不是完整后台 CRM。可采用：

```text
安静的浅色画布
单一高辨识主色
清晰的大标题与短说明
白色浮层容器
16–20px 自然圆角
低透明度柔和阴影
真实收件箱/对话场景，而不是抽象图表
充分但有控制的留白
```

参考页面实测视觉信号：

```text
body: DM Sans 16px
headings/actions: Plus Jakarta Sans
navigation radius: 16px
demo card radius: 20px
demo card shadow: 0 4px 20px rgba(0,0,0,.04)
primary action: indigo
canvas: pale lavender / cool neutral
```

## 4.2 明确不照搬

```text
60px marketing hero
pricing / feature landing sections
gradient headline
purple glow or AI neon effects
large marketing whitespace inside operational screens
customer-support ticket fields
social-channel examples
decorative fake metrics
landing-page CTA language
```

DPV 必须保持业务后台的表格、筛选、分栏、详情、证据和审计能力。

## 4.3 UI/UX Pro Max 采用结果

设计参数：

```text
variance = 3 / 10
motion = 2 / 10
density = 8 / 10
```

采用：

```text
Minimalism & Swiss Style
clean grid
high contrast
functional hierarchy
low decoration
subtle feedback
```

拒绝或调整：

```text
Product Demo + Features pattern
→ 属于 Landing Page，不用于后台信息架构

Calistoga heading font
→ 不适合中英双语高密度业务系统

external Google Font import
→ 不增加网络字体依赖

GSAP scroll reveal
→ 业务后台无必要，使用简短 CSS transition
```

---

# 5. Phase 8 设计系统

创建：

```text
docs/PHASE8_DESIGN_SYSTEM.md
```

同时重写 `docs/UI_SYSTEM.md`，使 Phase 8 成为新的前端视觉 Source of Truth。

## 5.1 设计目标

```text
Executive first
Opportunities first
Calm, operational and human
Evidence before decoration
One primary decision per screen
Progressive disclosure
No fake business success
```

## 5.2 字体

不增加外部字体请求：

```css
--font-sans: "Inter Var", Inter, "Segoe UI Variable", "Segoe UI",
  "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
--font-mono: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
```

双语层级：

```text
Chinese primary label: 14–16px / 600 where appropriate
English companion: 12–13px / 450–500 / muted
page title: 28–32px desktop, 24–26px mobile
body: 15–16px, line-height 1.5
table metadata: minimum 12px
```

中英文保持语义同等完整，但不再强制相同字号和重量。公司名、邮箱、电话、URL、证据原文保持原样。

## 5.3 Light tokens

| Role | Token | Value | Contrast intent |
| --- | --- | --- | --- |
| Canvas | `--p8-canvas` | `#F6F5F2` | warm quiet background |
| Surface | `--p8-surface` | `#FFFFFF` | operational surface |
| Surface subtle | `--p8-surface-subtle` | `#F1F2F6` | grouped content |
| Main ink | `--p8-ink` | `#172033` | 14.92:1 on canvas |
| Muted ink | `--p8-muted` | `#5F6B7A` | 4.98:1 on canvas |
| Border | `--p8-border` | `#DDDDE3` | structural divider |
| Primary | `--p8-primary` | `#4F46E5` | 6.29:1 with white |
| Primary hover | `--p8-primary-hover` | `#4338CA` | stronger action |
| Warm accent | `--p8-warm` | `#B45309` | 5.02:1 on white |
| Success | `--p8-success` | `#166534` | 7.13:1 on white |
| Warning | `--p8-warning` | `#92400E` | 7.09:1 on white |
| Danger | `--p8-danger` | `#B91C1C` | 6.47:1 on white |

主色参考 Demo 的 indigo，但不得使用渐变文字、发光或紫色大面积状态填充。暖色只用于需要注意的证据与风险，不承担普通 CTA。

## 5.4 Dark tokens

```text
canvas: #10131A
surface: #171B24
surface raised: #1D2230
main ink: #F3F4F6
muted ink: #A8B0BF
border: #303747
primary: #818CF8
```

关键暗色对比：

```text
main ink / canvas = 16.89:1
muted ink / canvas = 8.52:1
primary / canvas = 6.23:1
```

## 5.5 Shape, elevation and spacing

```text
shell radius: 18px
major panel radius: 16px
control radius: 10px
compact status radius: full only when semantically justified
panel shadow: 0 6px 24px rgba(23,32,51,.06)
popover shadow: 0 16px 48px rgba(23,32,51,.14)
base spacing: 4px
page gap: 24px desktop / 16px mobile
panel padding: 20–24px desktop / 16px mobile
```

不得对每个表格单元格、KPI 或详情字段加独立卡片和阴影。

## 5.6 Motion

```text
hover/focus/selection: 120–180ms
drawer/modal entry: 180–220ms
no page scroll reveal
no bouncing counters
no animated gradients
no width/height layout animation
prefers-reduced-motion removes nonessential motion
```

---

# 6. 去除“AI Dashboard 味道”的硬规则

## 6.1 容器规则

卡片只用于：

```text
独立决策区
表单步骤
汇总区
需要边界和操作的业务对象
```

普通字段组使用标题、分隔线、两栏或描述列表，不使用卡片套卡片。

## 6.2 状态规则

每个列表行最多：

```text
1 个主决策状态
1 个阻断/风险标记
```

其他信息使用普通文字、图标、数值或 detail disclosure。

保留彩色状态的场景：

```text
RECOMMENDED
MANAGEMENT_APPROVED
EVIDENCE_REQUIRED
HOLD
NOT_SUITABLE
SUPPRESSED
hard bounce / complaint / opt-out
```

不再使用胶囊的普通属性：

```text
company size
market
business type
data active
DPV score
tier numeric value
product profile
source count
```

状态必须包含文本或图标含义，颜色永远不是唯一信号。

## 6.3 禁止视觉模式

```text
gradient headline
glassmorphism
neon glow
floating AI orb
decorative sparkles
emoji as structural icon
bento wall of equal cards
every field as a badge
every section as a rounded rectangle
empty charts without real data
fake avatars or fake opportunity data
```

---

# 7. 新信息架构

## 7.1 Primary navigation

按老板的业务路径分组：

```text
决策 / Decide
  总览 / Overview
  业务机会 / Opportunities

执行 / Act
  待联系 / Contact Queue
  市场研究 / Research
  研究任务 / Jobs

资料 / Records
  客户名录 / Companies
  客户匹配 / ICP
  资料依据 / Evidence

数据 / Data
  数据导入 / Data Import
  数据导出 / Data Export

设置 / Settings
```

`Opportunities` 是登录后的默认业务页面；Overview 保留为管理摘要，但任何“优先客户”必须来自 Opportunities，而不是 DPV Score 排名。

## 7.2 Stable hooks

保留现有 ID、请求字段和 API 语义，至少包括：

```text
[data-app-nav] / [data-app-view]
#sidebar-toggle
#opportunity-table
#opportunity-sort
#opportunity-filters
#start-enrichment
#leads
#detail
#research-form
#research-job
data import/export form IDs
all Phase 7 management auth / CSRF flows
```

新增稳定 hook：

```text
[data-app-nav="contact-queue"]
[data-app-view="contact-queue"]
#opportunity-status-tabs
#opportunity-primary-filters
#opportunity-advanced-filter-drawer
#evidence-required-list
#contact-queue-list
#detail-section-nav
```

---

# 8. Overview — 管理层摘要

删除当前按 DPV Score 展示的 “Priority companies / Top five by current score”。

新版首屏：

```text
page title + one-sentence operating summary
last data refresh
one primary action: Open Recommended Opportunities
```

四个管理指标：

```text
Recommended
Management Approved / Contact Queue
Evidence Required
Active Companies
```

当前真实数据必须显示：

```text
Recommended = 0
Management Approved = 0
```

主列表：

```text
Recommended opportunities — 最多 5 条
```

如果为 0，不回退到 Tier A 或 DPV Score 公司；显示：

```text
当前没有达到联系就绪门槛的业务机会
0 Category Procurement Match
0 verified Buyer / Procurement
0 Hunter VALID
action: 查看待补证机会
```

右侧辅助区：

```text
Evidence Required by reason
CONTACT / BUYER_ROLE / EMAIL / PRODUCT / COMPANY
```

不得展示没有业务动作含义的装饰图表。

---

# 9. Opportunities — 老板默认决策页

## 9.1 顶部结构

```text
业务机会 / Opportunities
“只显示经过产品、采购角色和联系方式验证的可行动机会”

view tabs with counts:
Recommended | Evidence Required | Management Approved | Hold | Not Suitable | All
```

默认仍为 `RECOMMENDED`。

## 9.2 筛选重构

当前 20 个筛选器改为渐进披露。

始终显示：

```text
Search company
Status view
Market
Product Profile
Sort
Advanced Filters button + active count
```

Advanced Filters 按组进入右侧 drawer：

```text
Buyer
  Buyer Model
  Buyer subtype
  Buying role

Product & Access
  Product Match band/status
  Supplier Access
  Product Access Matrix

Contact
  Contact type
  Verification
  Contact readiness reason

History & Reference
  Relationship
  Management Match
  Mexico Historical Match
  Tier
```

已启用筛选以可移除 filter chips 显示；chips 可换行，标签保持完整，不依赖 hover tooltip。

## 9.3 列表列

将 11 列缩减为 7 个决策列：

```text
Company
Market / Product Profile
Opportunity Status
Buyer Model + procurement role
Product Match
Buyer / VALID contact
Supplier Access + action
```

以下进入详情：

```text
Product Opportunity details
Product Access Matrix
secondary scores
evidence freshness
full reason codes
all contact routes
```

桌面 1,440px 不出现页面级或默认表格横向滚动。只有 All/technical audit view 可使用受控横向表格。

## 9.4 Recommended row

每行重点顺序：

```text
company + market
what they buy
why category matches
who the verified Buyer is
how the VALID contact route works
supplier access
Confirm Contact
```

“确认联系”只在 Gate 0 全部通过时可用。

## 9.5 Empty state

当前真实 `RECOMMENDED=0` 时，不显示一张 2,199px 空表。

显示紧凑空状态：

```text
尚无联系就绪机会
No contact-ready opportunities yet

产品与采购匹配、Buyer 职责和 VALID 邮箱全部通过后，机会才会出现在这里。

View Evidence Required
```

同时显示确定性聚合原因，不显示技术堆栈或错误代码。

---

# 10. Evidence Required — 例外处理工作区

作为 Opportunities 内的一级 view，而不是老板默认列表。

按首要阻断原因分组：

```text
Product / Category evidence
Buyer model evidence
Buyer / Procurement contact missing
Buyer role unclear
Email verification required
Company identity conflict
Historical relationship review
```

每行只显示：

```text
Company / Profile
business fit summary
one primary blocker
owner
last checked
next safe action
```

下一动作：

```text
Run approved research job
Review evidence
Verify selected contact
Resolve identity/history
```

当前 Phase 8 只重构入口与表达；不得自动启动 Phase 9 的真实批量补证。

---

# 11. Contact Queue — 已确认执行队列

新增独立导航页面，复用现有：

```text
GET /api/contact-queue
```

只有当前 `MANAGEMENT_APPROVED` 且 Gate 0 仍有效的记录出现。

列表字段：

```text
Company / Profile
Buyer / Role
VALID contact + verification expiry
Management approver / approved at
Draft state
Message approval state
Last contact/reply
Owner / next action
```

主流程：

```text
contact validity recheck
→ generate draft
→ review exact message
→ approved message queue
```

当前为空时显示业务状态，不生成示例记录。

---

# 12. Companies — 全量公司主档

页面标题改为：

```text
客户名录 / Company Directory
所有累计发现的公司主档；出现在此处不代表建议联系。
```

默认列表列：

```text
Company / Website
Market
Business Type
Verification
Relationship
Latest Evidence
Related Opportunity
Action
```

DPV Score、Tier、大小、双匹配等移到展开详情或列设置，不使用大量状态胶囊。

公司行的主要动作：

```text
View Company
View Opportunity
```

不得从 Companies 直接出现 `Confirm Contact`、消息审批或发送入口。

现有 legacy company review 的 UI 文案改为明确的数据审核语义：

```text
Confirm Company Record
Exclude Company Record
```

它不得显示为 Opportunity Management Approval。

---

# 13. Company / Opportunity Detail

当前 15 个横向页签重组为 4 个一级区域：

```text
1. Snapshot
   identity / relationship / current opportunity / key blockers

2. Business Fit
   Product Match / Buyer Model / Product Opportunity / Supplier Access / matrices / scores

3. Buyer & Contact
   decision makers / departments / routes / verification / source evidence

4. Activity & Records
   outreach readiness / drafts / messages / replies / data history / CRM handoff
```

桌面详情采用：

```text
max width 1,200–1,280px
left section navigation
main content
optional 260px sticky decision summary
one scroll container
sticky footer only when a valid action exists
```

Tablet：接近全屏；Mobile：单栏全屏详情，顶部 Back 固定，section navigation 变为可访问 select 或 accordion。

顶端只保留：

```text
Company name
Market / Product Profile
one primary opportunity status
one blocker if any
source freshness
```

不再同时展示多张评分卡和多组胶囊。

---

# 14. Research 与 Jobs

## 14.1 Research

研究表单改为三步工作流：

```text
1. Market & Product
2. Buyer target
3. Scope review & create job
```

保留所有现有 input name/value 和 `POST /api/research/jobs` 合同。

## 14.2 Jobs

区分：

```text
Research Jobs
Import Jobs
Export Jobs
```

列表默认显示当前任务、进度、结果计数和安全下一步。技术队列、内部 token、路径和 raw payload 不进入 UI。

---

# 15. Data Import / Export

## 15.1 Import

将当前三块同权面板改为清晰 stepper：

```text
Select Type & File
→ Check
→ Review Rows
→ Submit Approval
→ Approve Version
→ Commit
```

一次只突出当前可执行步骤。禁用按钮必须同时说明缺少什么，不只依赖浅色。

Row Check 使用：

```text
accepted / review / rejected / duplicate summary
row table on demand
download result
```

## 15.2 Export

```text
Dataset
Scope
Format
Column permission preview
Generate
Download with expiry/audit
```

将 Column Permission 放在表单下方的普通摘要区，避免多个空卡片。

Phase 7 的导出白名单、token、SHA、审计和私有路径边界保持不变。

---

# 16. Customer Match、Evidence 与 Settings

## Customer Match / ICP

保留三套独立 profile；使用对齐的 comparison rows，不做三张重复装饰卡。

## Evidence

提供按公司/机会进入的证据阅读器：

```text
evidence type
finding
source
freshness
supports / contradicts
```

不把 Evidence 页面变成文件仓库或共享目录浏览器。

## Settings

保留：

```text
theme: system / light / dark
density: comfortable / compact
```

新增纯前端显示偏好：

```text
bilingual detail: standard / compact
default opportunity view: Recommended
```

偏好保存在浏览器，不改变数据库资格或管理状态。

---

# 17. CSS 与 JavaScript 重构策略

## 17.1 不继续叠加 override

创建：

```text
public/ui/phase8-tokens.css
public/ui/phase8-foundation.css
public/ui/phase8-components.css
public/ui/phase8-pages.css
public/ui/phase8-responsive.css
```

实施步骤：

```text
inventory existing selectors and stable hooks
map every reused component
move tokens first
migrate shell and components by page
remove superseded declarations from legacy files
finish with one documented load order
```

最终不得以一个新的 `phase8.css` 覆盖全部旧规则。目标是减少重复 raw colors、`!important`、冲突 radius 和 shadow。

## 17.2 JavaScript modules

保持 vanilla JS，但按页面责任拆分：

```text
ui/shell.js
ui/status.js
ui/filters.js
ui/opportunities.js
ui/contact-queue.js
ui/companies.js
ui/detail.js
ui/data-exchange.js
```

不得在纯视觉重构中改变 API payload、evidence content 或后端枚举。

`app.js` 和 `phase7-ui.js` 逐段迁移，避免一次性重写造成行为回退。

---

# 18. Responsive contract

验收 viewport：

```text
1440 × 900
1024 × 768
768 × 900
390 × 844
375 × 667
844 × 390
```

## Desktop

```text
floating/quiet left navigation surface
content max width suited to operational tables, up to 1,600px
primary filters on one row where possible
no default page-level horizontal scroll
```

## Tablet

```text
collapsible sidebar
filters wrap into two rows
detail becomes near-fullscreen
sticky actions stay visible
```

## Mobile

```text
off-canvas navigation
one page title and compact actions
Opportunity/Company tables transform into decision cards or reduced columns
primary status, company, profile, Buyer/contact and action remain visible
advanced filters use full-height sheet
44px minimum target
safe-area padding
native zoom remains enabled
```

Mobile 不把 11 列表格缩小到不可读，也不通过裁切隐藏关键状态。

---

# 19. Accessibility and interaction

必须满足：

```text
WCAG AA text contrast ≥ 4.5:1
visible focus for every action
logical heading hierarchy
keyboard navigation
dialog focus trap and exact focus restoration
Escape/backdrop behavior when no unsaved action
44×44px touch targets
visible input labels
inline validation and recovery action
aria-busy for async regions
one contextual live region per operation
prefers-reduced-motion
status never color-only
```

Badge/Chip 规则采用 Skill 验证结果：

```text
badge = static state
chip = filter/value/action
compact labels remain whole where practical
unavoidable truncation has keyboard/touch-accessible full disclosure
chip collections wrap or use operable +n disclosure
```

---

# 20. Backend、数据和安全边界

除 Gate 0 和必要只读 UI 聚合外，Phase 8 不改变：

```text
Phase 5 scores and ICP
Phase 6 Buyer/Contact evidence semantics
Phase 6.1 Buyer Model / Product Match / Product Opportunity / Supplier Access
Phase 7 provider / suppression / approval / webhook / CRM / import/export behavior
historical OKKI facts
product_master IDs
```

允许新增的只读聚合 API：

```text
GET /api/ui/overview
GET /api/opportunities/facets
```

仅在现有 API 无法高效提供页面聚合时添加。返回聚合与白名单字段，不暴露 private paths、raw payload、token、email body、supplier cost 或 internal notes。

Phase 8 保持：

```text
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
OUTBOUND_EMAIL_PROVIDER=NONE
RESEND_USE_CASE=DISABLED
```

Hunter API Key 已报告配置，但本阶段不打印、不导出、不写文档，也不启动 Phase 9 批量联系人补证。

---

# 21. Tests

## 21.1 Gate 0

```text
business fit + no Buyer → EVIDENCE_REQUIRED_CONTACT
business fit + unclear Buyer role → EVIDENCE_REQUIRED_BUYER_ROLE
business fit + ACCEPT_ALL → EVIDENCE_REQUIRED_EMAIL
business fit + UNKNOWN → EVIDENCE_REQUIRED_EMAIL
business fit + expired VALID → EVIDENCE_REQUIRED_EMAIL
business fit + current VALID + verified role + SALES_READY → RECOMMENDED
distribution buyer still requires procurement/resale evidence
Supplier Access never compensates Product Match
management approval of non-contact-ready decision returns 409
stale revision returns 409
suppression created before approval returns 409
failed approval creates no event/queue/recipient/provider call
current 14 records remain 0 RECOMMENDED
```

## 21.2 UI contracts

```text
Opportunities is the default business decision view
Overview priority list uses Recommended only
Companies never exposes Confirm Contact
Contact Queue has a standalone view
only one active primary nav item
status tabs preserve API status values
advanced filters preserve all 20 existing query parameters
default filter remains RECOMMENDED
empty Recommended state does not render wide empty table
legacy data review is not labelled management approval
company detail has four top-level sections, not 15 horizontal tabs
```

## 21.3 Visual and accessibility

```text
light / dark / system
comfortable / compact
all six viewports
no page-level horizontal overflow
no clipped bilingual label
no focus hidden behind sticky footer
keyboard open/close/return focus
screen-reader labels for icon buttons
contrast checks
reduced motion
one primary status + at most one risk marker per row
```

## 21.4 Regression

```text
Phase 7 import/export templates and real downloads
management auth / CSRF
draft exact approval
provider NONE and zero sends
webhook/inbound tests
migrations 001→028 apply/replay
shared-folder three-hash proof
all existing 427 tests remain 0 failed
```

最终：

```text
npm test
0 failed
```

---

# 22. Browser acceptance matrix

每个主页面检查：

```text
loading
empty
populated synthetic fixture in test database only
error with retry
long company name
long source URL
long bilingual reason
keyboard-only use
light/dark
comfortable/compact
```

必须保存内部验收截图或 screenshot manifest，但不得提交真实邮箱、消息正文、内部订单、路径或密钥。

视觉验收不是像素复制 Demo，而是检查：

```text
calm canvas
clear hierarchy
single primary action
soft but restrained elevation
fewer pills/cards
real operational content
no AI-template decoration
```

---

# 23. Implementation order

```text
1. Verify clean phase7 baseline, origin/main and annotated tag
2. Record Phase 7 plan-version erratum V1.1 → V1.2
3. Create docs/PHASE8_VISUAL_AUDIT.md with current screenshots/measurements
4. Create docs/PHASE8_DESIGN_SYSTEM.md and update docs/UI_SYSTEM.md
5. Create docs/PHASE8_UI_UX_REUSE_RESEARCH.md
6. Create migration 028 and business_fit_status contract
7. Implement business-opportunity-decision-v2
8. Harden management approval with contact-ready/eligibility/recipient checks
9. Recalculate current decisions and prove 0 Recommended / 0 sends
10. Update and pass Gate 0 tests
11. Freeze stable DOM/API hooks and create component migration map
12. Build Phase 8 tokens and foundation
13. Rebuild shell, navigation and bilingual typography
14. Rebuild Overview from opportunity decision aggregates
15. Rebuild Opportunities status views and progressive filters
16. Build Evidence Required work view
17. Build standalone Contact Queue
18. Simplify Companies directory
19. Replace 15-tab detail with four-section detail workspace
20. Rebuild Research and Jobs flows
21. Rebuild Data Import and Data Export flows
22. Align Customer Match, Evidence and Settings
23. Remove superseded legacy CSS/JS declarations
24. Run unit, API, migration and data-exchange regression
25. Run browser matrix and accessibility checks
26. Verify current real data and zero-send proof
27. Create docs/PHASE8_UI_UX_RESULT.md and update VERSION_CHANGELOG
28. Implementation commit + push + remote verification
29. Documentation handoff commit
30. Annotated tag phase8 + push + peeled-commit verification
31. STOP
```

---

# 24. Deliverables

```text
DPV_PHASE8_UI_UX_CODEX_EXECUTION_PLAN_V1.md
docs/PHASE8_UI_UX_REUSE_RESEARCH.md
docs/PHASE8_VISUAL_AUDIT.md
docs/PHASE8_DESIGN_SYSTEM.md
docs/PHASE8_UI_UX_RESULT.md
docs/UI_SYSTEM.md
docs/VERSION_CHANGELOG.md
database/migrations/028_phase8_contact_ready_recommendation.sql
services/demo-dashboard/public/ui/phase8-tokens.css
services/demo-dashboard/public/ui/phase8-foundation.css
services/demo-dashboard/public/ui/phase8-components.css
services/demo-dashboard/public/ui/phase8-pages.css
services/demo-dashboard/public/ui/phase8-responsive.css
services/demo-dashboard/public/ui/*.js
updated Phase 8 tests
```

测试截图、真实数据导出和临时视觉审计文件进入 Git-ignored 目录；结果文档只记录安全聚合。

---

# 25. PASS Gate

```text
[ ] phase7 main/tag/remote baseline verified
[ ] Phase 7 result plan-version erratum recorded
[ ] Gate 0 implemented before visual work
[ ] missing Buyer/role/VALID email never appears as RECOMMENDED
[ ] management approval requires current contact-ready ELIGIBLE opportunity
[ ] current real Recommended = 0
[ ] current real Management Approved = 0
[ ] current real Provider calls = 0
[ ] current real sends = 0
[ ] Opportunities is the boss decision surface
[ ] Overview priority list is Recommended-only
[ ] Companies remains the full master and has no contact bypass
[ ] Evidence Required has CONTACT / BUYER_ROLE / EMAIL routing
[ ] Contact Queue is a standalone execution view
[ ] Opportunities default view renders a useful true zero state
[ ] 20 filters use progressive disclosure without losing semantics
[ ] default operational table fits at 1440px without page overflow
[ ] Companies no longer renders ordinary attributes as status pills
[ ] detail workspace uses four top-level sections
[ ] import/export state progression is explicit
[ ] visual system matches the adopted Demo principles without copying Landing Page structure
[ ] no gradient/glow/bento/card-wall/emoji anti-patterns
[ ] light/dark and bilingual hierarchy PASS
[ ] accessibility and responsive matrix PASS
[ ] existing Phase 7 APIs/security/data contracts preserved
[ ] migrations 001→028 apply and replay
[ ] npm test 0 failed
[ ] docs/PHASE8_UI_UX_RESULT.md completed
[ ] implementation and handoff commits pushed
[ ] annotated tag phase8 pushed and remote verified
```

Phase 8 可以在真实机会和真实发送都为 0 的条件下 PASS，因为其目标是修正决策门槛并完成可用的管理界面。

最终报告：

```text
CONTACT-READY RECOMMENDATION GATE: PASS
PHASE 8 UI/UX REBUILD: PASS
REAL RECOMMENDED OPPORTUNITIES: 0
REAL PROSPECT SENDS: 0
PHASE 9 ENRICHMENT: NOT STARTED
```

---

# 26. Release and STOP

建议两提交发布：

```text
1. phase8: rebuild opportunity-first management UI and contact-ready recommendation gate
2. docs: record phase8 acceptance and release handoff
3. annotated tag phase8 targets the handoff commit
```

远端核验：

```text
origin/main
tag object
peeled tag commit
clean worktree
secret/data scan
```

Phase 8 PASS 后立即停止：

```text
STOP — Phase 9 real-opportunity enrichment and Phase 10 live-contact pilot not started.
```

Phase 9 必须基于 Phase 8 实际验收文件重新制定；不得直接沿用本计划假设启动真实 Hunter 批量搜索或真实外联。
