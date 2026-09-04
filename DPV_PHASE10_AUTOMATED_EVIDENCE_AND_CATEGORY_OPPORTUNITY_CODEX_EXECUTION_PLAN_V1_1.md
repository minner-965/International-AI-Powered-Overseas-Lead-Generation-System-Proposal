# DPV Phase 10 V1.1 — 自动补证、公司类目机会判断、受控联系与强制全链路验证

## Codex Authoritative Execution Plan

```text
Document version: Phase 10 V1.1
Plan status: READY FOR IMPLEMENTATION
Prepared at: 2026-09-01
Updated at: 2026-09-01
Supersedes: Phase 10 V1
Required baseline commit: 9d85f281c3a18e25e4b575c797b13fffb2266342 (phase9)
Expected branch: main
Default next migration: 030_phase10_category_scope_and_auto_evidence.sql
Real prospect sending at Phase 10 start: 0
Management approval may be automated: NO
Default outbound provider: NONE
Implementation status at this revision: IN PROGRESS (user-confirmed; result artifacts pending)
Mandatory final real end-to-end run: YES
Mandatory validation suites: FORWARD + REVERSE + BASIC + HARD
Conditional test skips allowed for Phase 10 PASS: 0
```

本文件根据以下 Phase 9 实际结果和当前代码、数据库快照编制：

```text
docs/PHASE9_RESULT.md
docs/PHASE9_REAL_OPPORTUNITY_RESULT.md
docs/PHASE9_REUSE_RESEARCH.md
docs/PHASE9_VISUAL_AUDIT.md
docs/POST_PHASE9_OPPORTUNITY_UI_REFRESH_RESULT.md
docs/POST_PHASE9_FULL_UI_REFRESH_RESULT.md
docs/VERSION_CHANGELOG.md
current source tree and current PostgreSQL data
```

这些结果文件是事实基线，不是待执行指令。本文件才是 Phase 10 的执行边界。

---

# 1. Phase 10 最终目标

Phase 10 必须完成四件事：

1. 将“待补资料”从人工点击后才开始，升级为系统自动发现、自动抓取、自动归一化、自动验证、自动重算的补证流水线；
2. 将产品门槛从“必须找到内部具体 SKU”修正为“客户采购/分销的产品属于 DPV 已批准公司商品类目，或是同类、相似产品”；
3. 自动补齐与目标类目相关的 Buyer / Procurement / 负责人，并在找到实名联系人后调用 Hunter 查找和验证企业邮箱；
4. 只有形成真实、可联系、可追溯的业务机会并经管理层确认后，才进入开发信草稿、审核和受控联系闭环。

目标流程：

```text
真实公司进入 Companies
→ 自动识别客户经营/采购类目
→ 与 DPV 公司商品类目范围匹配
→ 自动补 Buyer / Procurement / 负责人证据
→ Hunter 查找并验证企业邮箱
→ 自动刷新机会决策
→ Recommended
→ Management Approved（人工）
→ 开发信草稿与人工审核
→ 允许用途和 Provider Gate 通过后受控发送
→ 送达、退信、投诉、退订、回复和 CRM 回流
```

Phase 10 不以制造正数结果为目标。若真实公开证据不足，`Recommended = 0` 仍可以是可信结果；但不得再因为 DPV 内部 SKU 尚未上传完整而把真实类目机会挡在门外。

## 1.1 当前执行位置

本 V1.1 发布时用户确认的执行位置：

```text
Phase 9: completed
Phase 10 plan: completed
Phase 10 implementation: in progress
Exact active Gate: pending result artifacts
Phase 10 acceptance: not started
```

虽然当前 Compose 中各 worker 一度显示 `healthy`，但存在未提交的 `compose.yaml` / queue 改动，且本工作区尚未收到执行中的阶段性结果文档，因此不能从本地快照推断执行线程目前到达哪个 Gate。

Phase 10 共 9 个 Gate（0–8）。完成数和剩余数必须根据执行结束后的结果文件、Git diff、数据库 revision、Provider events 与测试报告核定，不能以计划文件或进程显示 `healthy` 代替。

---

# 2. Phase 9 核查结论

## 2.1 当前真实数据

2026-09-01 对当前数据库的只读核查结果：

| 项目 | 当前值 |
| --- | ---: |
| 当前公司 × 产品画像机会 | 14 |
| `EVIDENCE_REQUIRED` | 12 |
| `NOT_SUITABLE` | 2 |
| `RECOMMENDED` | 0 |
| `MANAGEMENT_APPROVED` | 0 |
| 可用实名 Buyer / Procurement | 0 |
| Hunter `VALID` 联系路径 | 0 |
| 真实外发 | 0 |

当前最新品类采购判断：

| Product profile | Match status | Count |
| --- | --- | ---: |
| `WOMENSWEAR` | `NEEDS_INTERNAL_CATALOG_EVIDENCE` | 7 |
| `GENERAL_MERCHANDISE` | `NEEDS_PRODUCT_EVIDENCE` | 6 |
| `GENERAL_MERCHANDISE` | `INELIGIBLE_BUYER_MODEL` | 1 |

这证明女装机会正在被“内部目录证据不足”整体阻断，与实际业务要求不符。

## 2.2 当前规则为何过严

当前代码存在两层阻断：

1. `categoryProcurementMatch.js` 在内部目录 `eligible_product_count <= 0` 时返回 `NEEDS_INTERNAL_CATALOG_EVIDENCE`；
2. `productOpportunity.js` 只把同画像、同归一类目、有效且已确认分配的内部具体商品作为候选；没有候选时，合作可行性继续产生 `NEEDS_PRODUCT_RECOMMENDATION`，无法形成 `SALES_READY`。

因此当前实际效果是：

```text
客户确实采购/销售女装
+ DPV 确实经营女装
+ DPV 尚未上传对应具体款式或商品归类不完整
= 机会仍被卡住
```

Phase 10 必须移除这个错误耦合。

## 2.3 “补充资料”当前到底是不是自动

Phase 9 已实现：研究任务一旦创建，Identity、Buyer Model、Category Procurement、Supplier Access、Buyer/Role、Email、Decision Refresh 会由队列自动执行。

但当前页面中的“收集品类资料”等按钮仍负责创建/触发任务，因此尚不是持续运行的后台自动补证。Phase 10 改为：

```text
默认：系统自动补证
人工：只处理自动检索耗尽、证据冲突、身份歧义、邮箱风险等例外
```

## 2.4 当前运行健康问题

当前 `data-worker` 循环重启，日志为：

```text
ERR_MODULE_NOT_FOUND: /app/src/research/ResearchWorkbenchService.js
```

原因是 worker 使用了旧镜像/不完整挂载，而 `server.js` 已引用新增模块。必须在 Gate 0 修复，否则 Excel 导入导出和后台重算不具备稳定运行条件。

---

# 3. Phase 10 权威业务规则

## 3.1 三层产品概念必须分开

### A. DPV 公司商品类目范围（核心内部基线）

表示公司已经确认可以生产、供应或销售的产品画像和商品类目，例如：

```text
WOMENSWEAR
├─ Dresses
├─ Tops
├─ Skirts
├─ Trousers
├─ Knitwear
└─ Outerwear
```

该范围独立于 `product_master` 的完整度。具体商品尚未上传，不代表 DPV 不经营该类目。

### B. 品类采购匹配（核心业务门槛）

客户的公开资料证明其采购、经营、进口、批发或分销的产品满足以下任一条件即可通过：

1. 与 DPV 批准类目相同；
2. 属于同一产品画像下的相似或同类产品；
3. 是批准类目的 taxonomy 上级、下级或明确同义类目，且业务用途一致。

### C. 具体商品机会（非阻断增强项）

表示可从内部 `product_master` 中挑出哪些具体款式或 SKU 给该客户推荐。它用于开发信个性化、报价和选品，不再决定客户是否是一条业务机会。

```text
品类匹配通过 + 暂无具体 SKU
= 业务机会仍可继续
+ 创建内部“补充商品目录/上传商品”任务
```

## 3.2 类目匹配判断

保留现有 `CATEGORY_PROCUREMENT_MATCH` 作为对外兼容的通过状态，新增 `match_basis`：

| `match_basis` | 含义 | 是否通过业务匹配 |
| --- | --- | --- |
| `EXACT_CATEGORY` | 同一归一商品类目 | 是 |
| `SIMILAR_CATEGORY` | 同一商品画像内的相似/同类类目 | 是 |
| `PROFILE_SCOPE` | 公开证据仅到画像级，但属于 DPV 已批准画像 | 是，优先级较低 |
| `AMBIGUOUS_SCOPE` | 可能相关但跨画像或证据冲突 | 否，进入人工例外 |
| `OUT_OF_SCOPE` | 明确不属于 DPV 商品范围 | 否，`PRODUCT_MISMATCH` |

匹配顺序必须是确定性的：

```text
归一化精确类目
→ approved taxonomy parent/child
→ approved alias/synonym
→ 同一 approved product profile
→ ambiguous / out of scope
```

AI/LLM 可以提出类目归一化候选，但不得单独把公司判为通过。最终通过必须引用：

- 客户官网、官方目录、官方商城或可信企业资料中的可复核证据；
- DPV 已批准的类目范围版本；
- 确定性 taxonomy/alias 映射；
- 规则版本和输入摘要。

搜索摘要只能用于发现 URL，不能单独作为通过证据。

## 3.3 Product Opportunity 不再阻断 Recommended

`productOpportunity` 输出调整为：

| 状态 | 含义 | 是否阻断业务机会 |
| --- | --- | --- |
| `SKU_READY` | 有可推荐的具体内部商品 | 否 |
| `SKU_PARTIAL` | 有部分候选，资料仍可补充 | 否 |
| `NO_EXACT_SKU` | 类目匹配，但暂无具体 SKU | 否 |
| `INTERNAL_CATALOG_UPLOAD_REQUIRED` | 需公司补传商品资料 | 否 |
| `OUT_OF_SCOPE` | 类目不属于 DPV 范围 | 是 |

`product_opportunity_count === 0` 不得再产生联系就绪 blocker。它只能：

- 降低个性化丰富度；
- 创建内部目录维护任务；
- 在草稿中禁止引用不存在的具体款式、价格或商品属性。

## 3.4 Supplier Access 的新定位

Supplier Access 用于排序，不再把 `UNKNOWN` 作为品类匹配或 Recommended 的硬阻断：

| Supplier Access | 处理 |
| --- | --- |
| `SUPPORTED/HIGH/MEDIUM` | 提高机会优先级 |
| `UNKNOWN/EVIDENCE_REQUIRED` | 允许继续补联系人并进入 Recommended，标注待确认 |
| 明确关闭供应商申请或不接受该合作方式 | `HOLD`，不自动外发 |

## 3.5 Recommended 的最终门槛

`Recommended` 至少满足：

```text
真实企业且官网/身份有效
+ 直接终端采购方或分销采购方
+ 分销采购方存在采购并转售/分销目标类目的证据
+ 客户类目属于 DPV approved category/profile scope
+ 不是历史客户
+ 无公司级或联系人级 suppression
+ 已找到与目标类目相关的实名 Buyer / Procurement / 负责人
+ 采购职责或相关岗位已验证
+ 存在当前有效的 Hunter VALID 企业邮箱或同等级正式联系路径
+ 没有身份、历史客户或合规冲突
```

以下项目不得成为 Recommended 的硬门槛：

- DPV 是否已经上传具体 SKU；
- 内部具体商品候选数量是否大于 0；
- Supplier Access 是否已有正面公开证据。

以下门槛继续严格保留：

- `ACCEPT_ALL`、`UNKNOWN` 不等于 `VALID`；
- 未找到实名相关 Buyer 时不进入老板默认 Recommended 清单；
- 老板确认前不进入正式联系；
- 真实外发前还需逐封邮件审批和 Provider Gate。

---

# 4. 自动补证与人工例外模型

## 4.1 自动触发条件

新增自动调度器，采用“事件触发 + 周期对账”双机制：

### 事件触发

- 新公司进入 Companies；
- 公司产品画像/市场发生变化；
- 新的 DPV 类目范围被批准；
- 新公开证据写入；
- 机会进入 `EVIDENCE_REQUIRED`；
- 联系人、Hunter 或 suppression 状态变化；
- Excel 导入提交后触发重算。

### 周期对账

默认每 30 分钟扫描一次遗漏、过期和可重试任务。周期只负责补漏，不重复创建相同工作。

## 4.2 自动流水线状态

```text
QUEUED
→ DISCOVERING_SOURCES
→ CRAWLING
→ EXTRACTING
→ NORMALIZING_CATEGORY
→ VALIDATING_EVIDENCE
→ FINDING_BUYER
→ VERIFYING_EMAIL
→ REFRESHING_DECISION
→ COMPLETED
```

例外状态：

```text
RETRY_SCHEDULED
EVIDENCE_EXHAUSTED
TEMPORARY_PROVIDER_ERROR
HUMAN_REVIEW_REQUIRED
BUDGET_PAUSED
```

## 4.3 自动执行内容

以下默认由系统完成：

- 搜索并确认企业身份、官网和市场；
- 抓取并保存公开页面证据；
- 提取客户经营/采购类目；
- 与 DPV approved category scope 做确定性匹配；
- 判断直接采购或分销采购模式；
- 查找 Buyer / Procurement / Category Manager / 相关负责人；
- 实名职责通过后调用 Hunter Finder/Verifier；
- 重新计算 Product Match、Business Fit、Contact Readiness 和机会状态；
- 将结果写入 append-only 审计记录。

这里的“自动补证”是系统后台运行的 AI-assisted research，而不是让员工逐条搜索：搜索 Provider 发现来源，crawler 抓取正文，AI/LLM 辅助提取类目、采购语义和岗位候选，确定性规则再验证并形成业务状态。AI 输出必须保存模型/提示版本、来源引用和置信信息；没有可复核来源时不得单独成为通过证据。

## 4.4 只有以下情况进入人工例外

- 两个真实来源对公司身份或采购模式结论冲突；
- 类目跨多个产品画像且 taxonomy 无法确定；
- Buyer 姓名存在同名、任职时间或公司归属冲突；
- Hunter 为 `ACCEPT_ALL` / `UNKNOWN` 且自动重试和替代路径耗尽；
- 历史客户、suppression 或公司合并记录存在冲突；
- 公开证据已耗尽，但业务人员掌握线下证据；
- 需要管理层做 `HOLD / NOT_SUITABLE` 例外判断。

人工不得重复做搜索、抓取和基础归一化工作。

## 4.5 预算、重试和幂等

- 单位工作项：`company_id + product_profile + blocker_type + evidence_revision`；
- 使用稳定 `execution_key` 和 pg-boss singleton key；
- 每家公司/画像设置冷却时间，默认 7 天；
- 临时网络错误使用指数退避，不把 Provider 故障写成业务不匹配；
- Hunter 只在实名、相关职责已证明后调用；
- 保留单批、单日和账期 Hunter/Tavily 预算上限；
- 达到预算时进入 `BUDGET_PAUSED`，不得伪装为 `EVIDENCE_EXHAUSTED`；
- 所有外部调用写 provider event、请求目的、额度消耗、返回类型和时间，但不记录 API Key。

---

# 5. 数据模型和迁移

创建 additive migration：

```text
database/migrations/030_phase10_category_scope_and_auto_evidence.sql
```

## 5.1 新增 DPV 类目范围主档

建议表：

```text
leadgen.dpv_product_category_scopes
leadgen.dpv_product_category_scope_aliases
leadgen.dpv_product_category_scope_revisions
```

核心字段：

```text
id
product_profile
normalized_category
parent_category_id
scope_status              ACTIVE / INACTIVE / REVIEW
approval_status           APPROVED / DRAFT / RETIRED
effective_from
effective_to
source_type               MANAGEMENT_APPROVED / PRODUCT_IMPORT / TAXONOMY
source_reference
revision
approved_by
approved_at
created_at
```

要求：

- 类目主档和具体商品主档分离；
- 只有 `APPROVED + ACTIVE` 范围可作为业务匹配基线；
- 初始范围从现有 approved product profiles/taxonomy 和真实商品导入结果生成候选，再由公司负责人一次性确认；
- 不为填满页面创建虚假类目；
- 所有范围变更可审计、可回放旧决策。

## 5.2 扩展品类匹配结果

为 `category_procurement_match_results` 增加或在 JSON 审计中固定：

```text
scope_revision_id
match_basis
matched_scope_ids
observed_customer_category_ids
similarity_rule
catalog_completeness_non_blocking
```

对外继续输出 `CATEGORY_PROCUREMENT_MATCH`，避免破坏现有 UI/API；通过 `match_basis` 展示精确、相似或画像级匹配。

## 5.3 扩展 Product Opportunity

增加：

```text
sku_readiness_status
catalog_enrichment_required
category_scope_match_result_id
```

具体商品结果必须引用相同或更晚的类目范围 revision。

## 5.4 自动补证任务

建议表：

```text
leadgen.auto_evidence_tasks
leadgen.auto_evidence_task_attempts
leadgen.auto_evidence_schedule_events
leadgen.human_evidence_exceptions
```

必须区分：

```text
automation_owner = SYSTEM
human_owner = NULL（直到转入人工例外）
business_blocker
technical_blocker
retry_at
attempt_count
budget_state
last_evidence_revision
```

## 5.5 迁移原则

- 只做 additive migration；
- 不删除 Phase 6.1/7/8/9 的历史结果；
- 不原地改写旧 decision snapshot；
- 使用新规则 append 新 revision；
- migration 可重复执行且包含约束、索引、注释和 schema assertion；
- dry-run 报告必须先展示旧状态 → 新状态，再允许 apply。

---

# 6. 规则与服务实现

## 6.1 规则版本

```text
category-procurement-match-v2
product-opportunity-v2
cooperation-feasibility-v4
business-opportunity-decision-v3
auto-evidence-orchestration-v1
```

修改重点：

### `categoryProcurementMatch.js`

- 不再因 `eligible_product_count <= 0` 返回 `NEEDS_INTERNAL_CATALOG_EVIDENCE`；
- 从 approved DPV category scope 判断内部业务范围；
- 支持 exact / similar / profile scope；
- 对明确 out-of-scope 保留 `PRODUCT_MISMATCH`；
- 客户侧没有真实类目证据时仍返回 `NEEDS_PRODUCT_EVIDENCE`。

### `productOpportunity.js`

- 只负责 SKU/款式推荐；
- 0 个候选输出 `NO_EXACT_SKU` 或 `INTERNAL_CATALOG_UPLOAD_REQUIRED`；
- 0 个候选不得反向改写 category match；
- 只有真实 `product_master.id` 可成为 SKU candidate。

### cooperation feasibility v4

- 删除 `product_opportunity_count === 0` 的 readiness blocker；
- Supplier Access `UNKNOWN` 改为排序信息；
- 明确 closed supplier route 输出 `HOLD` blocker；
- 联系准备度继续要求实名相关联系人和 `VALID` 路径。

### business opportunity decision v3

- 使用 category scope match，而不是 SKU availability，决定 business fit；
- `RECOMMENDED` 仍要求 contact ready；
- `MANAGEMENT_APPROVED` 仍只来自真实管理事件；
- 规则变化不得自动批准历史记录。

## 6.2 多画像处理

自动补证以 `company × active DPV product_profile` 为单位：

- 客户有女装证据时优先处理 `WOMENSWEAR`；
- 不因固定排序而给女装企业只冻结 `GENERAL_MERCHANDISE`；
- 同一公司确有多个相关画像时可形成多个机会，但 UI 按公司分组；
- 联系活动按 `company + campaign purpose` 去重，避免多个画像重复骚扰同一联系人。

## 6.3 复用现有组件

继续复用：

- `TavilySearchProvider`：来源发现；
- 现有 crawler：受控抓取；
- Phase 9 evidence extractor/normalizer：证据归一化；
- `HunterProvider`：Finder/Verifier；
- pg-boss：后台任务、singleton、retry；
- n8n：周期对账和显式编排；
- Phase 7 append-only decisions、approvals、outreach、CRM 和 data exchange；
- 现有 UI 设计系统和 post-Phase9 workspace 组件。

不得引入第二套搜索、邮箱验证、队列、CRM 或导入导出框架。

---

# 7. Worker、Compose 与自动调度

## Gate 0 — 恢复运行健康

1. 重建 `demo-dashboard` 镜像，使所有 worker 包含完整 `src/research/`、`src/categoryProcurement/`、`src/phase7/` 模块；
2. 不再仅挂载 `server.js` 和 `phase5Queue.js` 形成主文件与镜像模块不一致；
3. `data-worker`、`category-worker`、`outreach-worker` 均必须稳定运行；
4. health/readiness 必须检查实际队列处理能力，而不只是 HTTP 进程；
5. Excel staging/export 目录权限和读写测试通过。

验收：连续观察至少 10 分钟，无 restart，无 `ERR_MODULE_NOT_FOUND`，测试导入/导出任务可完成。

## Gate 1 — 自动补证队列

新增 pg-boss 队列：

```text
schedule-auto-evidence
discover-opportunity-evidence
normalize-opportunity-category
refresh-category-scope-match
find-profile-buyer
verify-profile-buyer-email
refresh-business-opportunity-v3
refresh-auto-evidence-exception
```

现有 Phase 9 队列若语义一致则复用并补齐自动调度，不重复造队列。

## Gate 2 — n8n 周期对账

新增 inactive-first workflow：

```text
workflows/03-phase10-auto-evidence-reconciliation.json
```

要求：

- 先通过 fixture 和数据库 dry-run；
- activation 受 `AUTO_EVIDENCE_ENABLED=false` 总开关控制；
- 默认每 30 分钟；
- 每轮批量上限、每日预算、市场/画像配额均可配置；
- 重复执行不会重复计费或生成重复证据。

建议环境变量：

```makefile
AUTO_EVIDENCE_ENABLED=false
AUTO_EVIDENCE_RECONCILE_MINUTES=30
AUTO_EVIDENCE_BATCH_SIZE=10
AUTO_EVIDENCE_COMPANY_COOLDOWN_HOURS=168
AUTO_EVIDENCE_MAX_ATTEMPTS=3
AUTO_EVIDENCE_SOURCE_TTL_DAYS=90
AUTO_EVIDENCE_HUNTER_ENABLED=true
AUTO_EVIDENCE_TAVILY_ENABLED=true
```

所有 Secret 只保存在环境变量/Secret Store，不进入 Git、前端、日志或结果文档。

---

# 8. UI/UX 调整

本阶段延续 post-Phase9 统一工作台视觉，不回到纯文字堆叠页面。

## 8.1 业务机会首页

将截图中的“待补资料任务 / Evidence Tasks”拆成：

1. `自动补证进度 / Auto Enrichment`：展示系统正在处理的数量和阶段；
2. `需人工复核 / Human Review`：只展示真正需要人处理的例外；
3. `内部商品待完善 / Catalog Maintenance`：展示不阻断机会的 SKU 上传任务。

普通自动任务按钮：

```text
查看补证进度 / View enrichment progress
```

人工例外按钮：

```text
处理例外 / Review exception
```

不得继续把所有记录都显示为“收集品类资料”，造成需要人工逐条查资料的误解。

## 8.2 机会详情

统一显示三块：

```text
客户采购类目
DPV 公司类目范围
具体商品推荐状态
```

示例：

```text
类目匹配：通过（同类女装）
匹配依据：WOMENSWEAR / SIMILAR_CATEGORY
具体商品：尚未上传，不影响业务机会判断
自动补证：正在查找采购负责人
```

仅显示可核查的业务字段、证据和状态，不显示 AI 推理说明、决策长文或面向开发人员的内部字段。

## 8.3 自动化监控

系统设置或 Jobs 页面增加：

- 自动补证总开关；
- 当前运行、等待重试、预算暂停、人工例外数量；
- 最近一次周期对账；
- Provider health 与剩余额度；
- 失败原因和重新运行入口；
- 不显示 API Key。

---

# 9. 开发信 Skill、Hunter 与邮件 Provider

## 9.1 Skill 分工

继续复用 Phase 7 已审计并固定的两组 Skill，不在运行时从网络拉取最新内容：

```text
coreyhaines31/marketingskills
commit: e55de886fe7580ec75cdb7ded5092b33f7d4ed58
license: MIT

resend/resend-skills
commit: 828340bd8a361c4e6e0c02bddf1575f131d5d77f
license: MIT
```

实施时继续执行 Phase 7 的 snapshot、checksum、license、变更审计和允许列表机制。Skill 只参与内容编写与检查，不参与客户资格自动放行，也不持有 Hunter/Resend/API Secret。

采用的能力分工：

```text
product-marketing
→ DPV 类目定位、优势和目标客户背景

prospecting
→ 客户值得联系的公开证据

cold-email
→ 首封开发信和跟进草稿

sales-enablement
→ 产品卖点、案例、异议处理和 CTA

email-best-practices
→ 主题、结构、退订、格式和送达风险检查
```

草稿生成只读取已验证字段。若 `NO_EXACT_SKU`：

- 只写已批准的类目级能力；
- 不杜撰具体商品、库存、价格、材质、交期或客户案例；
- 可以建议对方回复后由销售提供相应目录；
- 草稿状态必须标记 `CATEGORY_LEVEL_PERSONALIZATION`。

## 9.2 Hunter 职责

Hunter 继续负责发送前联系人查找和邮箱验证：

```text
实名 Buyer / Procurement 已证明
→ Hunter Finder
→ Hunter Verifier
→ VALID / ACCEPT_ALL / UNKNOWN / INVALID / TEMPORARY_ERROR
```

- `VALID`：可满足 Contact Ready；
- `ACCEPT_ALL`：人工风险复核；
- `UNKNOWN`：自动补证或重试；
- `TEMPORARY_ERROR`：延迟重试；
- `INVALID`：联系人级 suppression，继续找替代联系人。

## 9.3 Resend 与真实外发边界

Hunter 与 Resend 不冲突：Hunter 负责发送前验证，Resend 负责允许用途下的发送和事件接收。

当前代码和 Phase 7 政策明确：

```text
OUTBOUND_EMAIL_PROVIDER=NONE
OUTREACH_ENABLED=false
Resend cold outreach → PROVIDER_PURPOSE_NOT_ALLOWED，且网络调用为 0
```

Phase 10 不得删除或绕过该 Provider Gate。真实发送只在以下全部成立时启动小批量 pilot：

1. 至少一条真实 `RECOMMENDED`；
2. 管理层对公司机会执行 `Management Approved`；
3. 逐封开发信完成内容审批；
4. 发送用途、同意/关系状态与所选 Provider 的允许用途一致；
5. `LIVE_PROSPECT_SEND_APPROVED=true` 由负责人显式配置；
6. suppression、退订、投诉和退信处理已验证。

若当前 Provider 不允许该用途，则保留在 `APPROVED_DRAFT / READY_FOR_MANUAL_CHANNEL`，不伪造发送结果。

---

# 10. 当前 14 条机会的重算方案

## 10.1 Dry-run

先对当前 14 条 `company × profile` 生成只读差异报告：

```text
company_id
product_profile
old_category_status
new_category_status
old_business_fit
new_business_fit
match_basis
matched_scope
remaining_evidence_blockers
contact_readiness
sku_readiness_status
```

重点确认：

- 7 条 `WOMENSWEAR / NEEDS_INTERNAL_CATALOG_EVIDENCE` 不再因内部 SKU 缺失被阻断；
- 没有真实客户类目证据的记录仍保持 `NEEDS_PRODUCT_EVIDENCE`；
- 不合格采购模式不因新类目规则被放行；
- 没有实名 Buyer 和 `VALID` 邮箱的记录仍不得成为 Recommended。

## 10.2 Apply

负责人确认 dry-run 后：

1. append 新的 category match v2；
2. append product opportunity v2；
3. append cooperation feasibility v4；
4. append business opportunity decision v3；
5. 将剩余 blocker 自动排入补证；
6. 不代表管理层创建 approval event。

## 10.3 自动补证受控批次

首批从当前记录中按以下顺序处理：

```text
类目范围已通过但缺 Buyer
→ 有实名 Buyer 但缺 VALID email
→ 采购模式需补证
→ 客户类目资料不足
→ Supplier Access 排序证据
```

先补最可能转化为可联系机会的 blocker，避免先花预算查低价值资料。

---

# 11. Excel 导入导出与数据回流

Phase 7 已建立的数据交换继续保留，并与新规则接通：

## 导入

- 公司商品上传：写入 `product_master`，同时提出类目范围候选，但不得自动批准新 DPV 类目；
- 公司类目范围上传：单独模板，必须经过预览和负责人批准；
- 历史客户/成交上传：更新 relationship 和 historical match，触发机会重算；
- 客户联系人上传：进入身份、职责和邮箱验证，不直接标记 `VALID`；
- suppression/退订上传：立即阻断后续自动联系。

## 导出

- 总客户线索表；
- 业务机会表；
- 自动补证任务与人工例外表；
- 联系人验证结果；
- Contact Queue；
- 管理批准与开发信审批记录；
- 联系、回复、成交和 suppression 记录。

导出必须支持筛选条件、生成时间、规则版本、证据时间和状态说明，不导出 Secret。

---

# 12. 测试矩阵

## 12.1 规则单元测试

必须覆盖：

1. DPV 有 WOMENSWEAR 范围、内部 SKU 为 0、客户经营连衣裙 → `CATEGORY_PROCUREMENT_MATCH / SIMILAR_CATEGORY`；
2. 客户经营女装、内部仅上传部分上衣 → 仍通过类目匹配；
3. 客户只经营不相关工业设备 → `PRODUCT_MISMATCH`；
4. 客户类目证据为空 → `NEEDS_PRODUCT_EVIDENCE`；
5. 类目匹配通过、SKU 候选为 0 → business fit 可为 FIT，SKU 状态为 `NO_EXACT_SKU`；
6. 类目匹配通过但无实名 Buyer → `EVIDENCE_REQUIRED_CONTACT`，不是 Recommended；
7. Buyer 相关但 Hunter `UNKNOWN` → 不是 Recommended；
8. Buyer 相关且 Hunter `VALID` → 满足 Contact Ready；
9. 分销商无采购/转售证据 → 不通过 buyer gate；
10. Supplier Access UNKNOWN → 不阻断 Recommended，但影响排序；
11. 明确 supplier route closed → Hold；
12. 历史客户或 suppression → 不进入 Recommended。

## 12.2 自动补证测试

- event trigger 和 30 分钟 reconcile 不重复排队；
- 同一 execution key 重跑不重复计费；
- 临时错误进入 retry，不改业务状态；
- 预算耗尽进入 `BUDGET_PAUSED`；
- Hunter 只在 buyer gate 后调用；
- `ACCEPT_ALL` / `UNKNOWN` 正确转人工或重试；
- source/evidence/decision lineage 完整；
- 任务耗尽时不创建假证据。

## 12.3 Worker 与 Compose 测试

- 全部 worker 模块可解析；
- 三个 worker 连续运行无 restart；
- category/data/outreach queue allowlist 正确；
- Excel import/export smoke test；
- n8n workflow inactive-first、activation gate、幂等和批量上限测试。

## 12.4 UI 测试

- 1440、1280、1024、768 宽度无重叠和横向文字挤压；
- 自动补证与人工例外清楚分开；
- 状态、表格、详情抽屉采用统一设计系统；
- 无 AI 解释长文、开发内部字段或虚假 KPI；
- 中文为主、英文辅助，信息层级清晰；
- 键盘、焦点、对比度和 reduced-motion 通过。

## 12.5 外发测试

- 默认开关关闭且 provider 为 NONE；
- 未管理批准、未邮件批准、非 VALID、suppressed、stale decision 均硬阻断；
- Resend cold outreach 保持 0 网络调用；
- 允许用途 fixture 的 delivered/bounced/complained/unsubscribed/replied 幂等处理；
- 任何投诉、退订或硬退信立即进入 suppression。

## 12.6 强制四象限验证

测试清单必须由版本化 manifest 固定，执行器和 AI 不得根据时间、成本、成功概率或实现难度删减用例。四个象限必须全部执行：

| 象限 | 验证方向 | 必做场景 |
| --- | --- | --- |
| `FORWARD_BASIC` | 正向简单 | 清晰类目、清晰 Buyer、VALID 邮箱、管理批准、草稿批准、允许用途发送、送达、回复、CRM 跟进 |
| `FORWARD_HARD` | 正向困难 | 相似类目但无内部 SKU、多画像公司、多来源归一、替代联系人、重试恢复后最终 Recommended/发送 |
| `REVERSE_BASIC` | 逆向简单 | 不匹配类目、历史客户、suppression、INVALID 邮箱、未批准草稿均必须被阻断 |
| `REVERSE_HARD` | 逆向困难 | 冲突证据、ACCEPT_ALL/UNKNOWN、stale approval、类目范围撤销、并发重复任务、乱序 webhook、worker 中断恢复、预算暂停/恢复 |

最低困难验证集：

1. DPV 没有具体 SKU，但客户经营同类女装，品类通过且 SKU 非阻断；
2. 同一家公司同时命中两个画像，机会可分画像审计，联系活动不重复发送；
3. 两个来源给出冲突 Buyer 任职信息，自动流程不得擅自放行；
4. Hunter 第一次临时错误、第二次成功，额度只按真实调用记录且决策只 append 一次有效 revision；
5. Hunter `ACCEPT_ALL/UNKNOWN` 后自动寻找替代实名联系人，仍无 VALID 时进入人工例外；
6. 两个 scheduler 同时扫描同一 blocker，只生成一个有效 singleton 任务；
7. 自动补证过程中导入历史客户或 suppression，正在排队的联系立即失效；
8. 管理批准后证据过期或类目范围被撤销，旧批准变为 stale，发送被阻断；
9. webhook 重复、延迟和乱序到达，最终状态一致且副作用只发生一次；
10. worker 在关键阶段重启，任务恢复后不重复调用 Provider、不重复发送、不丢审计链；
11. 达到 Hunter/Tavily 预算后进入 `BUDGET_PAUSED`，额度恢复后从正确 checkpoint 继续；
12. 真实回复、退订、硬退信和投诉事件分别驱动正确 CRM/suppression 结果。

规则：

- 不设置 `easy-only`、`smoke-only` 或由模型自由选择用例的默认路径；
- hard suite 与 basic suite 同级，均为发布阻断项；
- 任一必须用例未执行，Phase 10 状态只能是 `INCOMPLETE`；
- 任一失败不得用“AI 判断风险较低”降级为 warning；
- fixture 可以验证确定性边界，但不得替代最终真实环境端到端运行；
- 最终报告逐项列出输入、预期、实际、证据、日志、数据库 revision 和 PASS/FAIL。

## 12.7 最终真实端到端运行

代码、迁移、UI 和自动化测试全部完成后，必须在实际部署栈真实运行一次，不以 mock、截图或单元测试代替：

```text
真实 Excel/系统数据导入
→ 真实公司自动补证
→ 真实搜索和网页证据抓取
→ 真实类目范围匹配
→ 真实 Buyer / Procurement 发现
→ 真实 Hunter Finder/Verifier 调用
→ 真实机会决策重算
→ 真实管理账号确认
→ 真实草稿生成与逐封批准
→ 真实 Provider 允许用途邮件投递
→ 真实 delivered/replied 或其他 Provider 事件
→ 真实 CRM 跟进/成交状态回流
→ 真实 Excel 导出并与数据库核对
```

真实运行分两层：

1. `CONTROLLED LIVE E2E`：使用公司控制且已批准的真实收件地址，强制验证发送、回复、退订/抑制、重复事件和逆向阻断；
2. `APPROVED OPPORTUNITY PILOT`：仅对真实 `Management Approved` 且 Provider 用途允许的业务机会发送小批量邮件，观察真实送达与回复。

两层均完成才可报告“真实联系闭环已验证”。若 Provider 用途门槛未通过，第二层状态为 `BLOCKED`，Phase 10 不得宣称完整 Business-result PASS。

---

# 13. 执行 Gate 顺序

严格按顺序执行：

## Gate 0 — Baseline 与运行健康

- 保护当前 dirty worktree；
- 记录 HEAD、Phase 9 文档和当前数据库计数；
- 修复 `data-worker` 模块缺失和 worker 镜像漂移；
- 验证 Excel import/export 基线。

## Gate 1 — 类目范围模型

- migration 030；
- approved DPV scope 管理、导入和审计；
- 初始范围候选生成与人工一次性批准。

## Gate 2 — 产品与机会规则 v2/v3/v4

- category match v2；
- product opportunity v2；
- cooperation v4；
- opportunity decision v3；
- 全部单元/集成测试。

## Gate 3 — 自动补证

- pg-boss orchestration；
- n8n reconcile；
- 预算、重试、幂等、provider event；
- 自动任务和人工例外分流。

## Gate 4 — UI/UX 与数据交换

- 自动补证进度；
- 人工例外 Inbox；
- 类目匹配与 SKU readiness 分开显示；
- Excel 类目、商品、联系人、成交导入导出。

## Gate 5 — 当前数据 Dry-run 与 Apply

- 对当前 14 条生成 old/new diff；
- 负责人确认后 append 新 revision；
- 启动受控自动补证批次；
- 记录 Hunter 调用和真实结果。

## Gate 6 — 管理确认与草稿

仅当至少一条真实 `RECOMMENDED`：

- 管理层在 UI 中确认；
- Skill 生成类目级或 SKU 级草稿；
- 人工逐封审核；
- 不自动批准、不自动发送。

## Gate 7 — 受控联系 Pilot

仅当 Provider 用途和全部外发门槛真实通过：

- 小批量、低速率、单市场；
- 发送、webhook、回复、销售任务、CRM 回流闭环；
- 出现投诉、退订或异常退信立即停止批次；
- Provider Gate 不通过时 Gate 7 记录为 `NOT ELIGIBLE`，不得模拟完成。

## Gate 8 — 强制真实全链路与反向验收

Gate 0–7 的实现和自动测试通过后，执行第 12.6、12.7 节固定清单：

- 完整执行 `FORWARD_BASIC`；
- 完整执行 `FORWARD_HARD`；
- 完整执行 `REVERSE_BASIC`；
- 完整执行 `REVERSE_HARD`；
- 完成 `CONTROLLED LIVE E2E`；
- 完成满足用途门槛的 `APPROVED OPPORTUNITY PILOT`；
- 核对前端状态、API、队列、数据库、Provider event、CRM 和 Excel 导出一致性；
- 失败注入后验证系统可恢复且无重复外部副作用。

Gate 8 不允许执行器只选简单验证。任何 hard/reverse/real-run 项缺失，Phase 10 均不得最终验收。

---

# 14. 验收标准

## Implementation PASS

必须全部满足：

- `data-worker`、`category-worker`、`outreach-worker` 运行稳定；
- 类目范围与具体 SKU 完全解耦；
- 相同/相似/同画像商品可形成 category match；
- 内部 SKU 不完整不再阻断 business fit；
- 自动补证默认工作，人工只处理例外；
- Hunter gate、管理批准、邮件审批和 suppression 门槛未降低；
- 当前 14 条均产生可审计的新规则 dry-run；
- 迁移、后端、队列、UI、Excel 和外发保护测试全部通过；
- `FORWARD_BASIC / FORWARD_HARD / REVERSE_BASIC / REVERSE_HARD` 全部执行且通过；
- 条件跳过数为 0；
- CONTROLLED LIVE E2E 完成并有真实 Provider、回复、CRM 和导出证据；
- APPROVED OPPORTUNITY PILOT 满足用途门槛后完成；若被门槛阻断则不得宣称完整 Business-result PASS；
- 无虚假公司、证据、Buyer、邮箱、机会或发送记录。

## Business-result PASS

真实数据结果分开报告：

```text
category scope matched count
exact/similar/profile match distribution
auto evidence completed count
human exception count
named relevant Buyer count
Hunter VALID count
Recommended count
Management Approved count
approved draft count
provider-eligible send count
delivered / bounced / complained / unsubscribed / replied
CRM follow-up / won / lost feedback
```

不得把 Implementation PASS 写成“已经产生真实业务机会”或“已经完成真实外发”。

---

# 15. Phase 10 交付文件

执行完成后至少生成：

```text
docs/PHASE10_RESULT.md
docs/PHASE10_CATEGORY_SCOPE_RESULT.md
docs/PHASE10_AUTO_EVIDENCE_RESULT.md
docs/PHASE10_CONTROLLED_OUTREACH_RESULT.md
docs/PHASE10_REAL_END_TO_END_VALIDATION_RESULT.md
docs/PHASE10_FORWARD_REVERSE_VALIDATION_MATRIX.md
docs/PHASE10_VISUAL_AUDIT.md
docs/PHASE10_REUSE_RESEARCH.md
docs/VERSION_CHANGELOG.md update
```

`PHASE10_RESULT.md` 必须明确回答：

1. 当前多少机会因新类目规则从内部目录 blocker 中释放；
2. 多少记录仍因客户侧证据不足被保留；
3. 自动补证执行了什么，哪些才需要人工；
4. Hunter 实际调用次数、额度和结果；
5. Recommended、Approved、草稿和真实发送的真实数量；
6. 所有真实外发是否满足 Provider 用途门槛；
7. 是否达到 Phase 10 Implementation PASS 和 Business-result PASS。
8. 四象限验证是否逐项执行，是否存在任何 skip、warning 降级或未验证困难场景；
9. 真实端到端运行的公司、机会、联系人、Provider event、回复、CRM 和 Excel lineage。

---

# 16. 明确不做

- 不要求每个机会都匹配到内部具体 SKU；
- 不把公司内部商品上传缺失当作客户不匹配；
- 不让人工逐条完成系统本可自动搜索和归一化的工作；
- 不使用 AI 推断替代公开证据；
- 不降低实名 Buyer 和 Hunter VALID 门槛；
- 不自动执行 Management Approved；
- 不自动批准开发信；
- 不绕过 Resend/Provider 用途限制；
- 不为达到 KPI 生成虚假联系人、邮箱、机会、回复或成交；
- 不覆盖当前未提交 UI 改动，不提交无关文件。

---

# 17. 一句话执行结论

```text
Phase 10 将“人工点击补资料 + 具体 SKU 阻断机会”改为“系统自动补证 + DPV 公司类目范围匹配”；相同、相似或同画像产品即可通过产品业务匹配，具体 SKU 只用于后续选品和个性化；实名采购联系人、Hunter VALID、管理确认和逐封邮件审批仍是正式联系前的硬门槛。
```
