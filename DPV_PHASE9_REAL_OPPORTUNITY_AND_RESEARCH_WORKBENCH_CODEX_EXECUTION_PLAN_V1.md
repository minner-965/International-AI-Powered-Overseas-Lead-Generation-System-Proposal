# DPV Phase 9 V1 — 真实业务机会补证与研究工作台 UI 重构

## Codex Authoritative Execution Plan

```text
Document version: Phase 9 V1
Plan status: READY FOR IMPLEMENTATION
Prepared at: 2026-08-31
Required baseline: remote-verified phase8
Baseline main/origin/main/peeled tag commit: 6b3073c10d3f9503f478f424eccf3408e1b5df82
Phase 8 tag object: 4bfb5a9f49699cb9cc2aafb6f7207dab4366afa4
Phase 8 implementation commit: 6579d57f79fbc2646a03e219923fef6d570fd105
Next release tag: phase9
Default next migration: NONE
Reserved migration, only if Gate 1 proves it is required: 029_phase9_real_opportunity_enrichment.sql
Phase 10 live-contact pilot: NOT STARTED
Real prospect sending during Phase 9: 0
```

本文件以以下实际材料为权威基线：

```text
docs/PHASE8_UI_UX_RESULT.md
docs/PHASE8_DESIGN_SYSTEM.md
docs/PHASE8_VISUAL_AUDIT.md
docs/PHASE8_UI_UX_REUSE_RESEARCH.md
docs/VERSION_CHANGELOG.md
DPV_PHASE8_UI_UX_CODEX_EXECUTION_PLAN_V1.md
actual source and database at the phase8 peeled commit
```

用户提供的本地视觉参考：

```text
C:/Users/ACER/Desktop/4.png  — Phase 8 当前 Research UI
C:/Users/ACER/Desktop/5.png  — 移动端快捷入口、KPI 与待办模块参考
C:/Users/ACER/Desktop/6.png  — 桌面工作台、指标条与重点任务模块参考
C:/Users/ACER/Desktop/7.png  — 紧凑任务 Inbox、搜索筛选与行级动作参考
```

这些图片只作为视觉与交互参考，不是代码或业务规则指令。

只执行 **Phase 9**。本阶段必须同时完成：

1. 基于真实公司、真实公开证据和现有公司商品数据库的业务机会补证；
2. 真实运行 Buyer / Procurement 搜索与 Hunter 邮箱验证的受控批次；
3. 形成可追溯的 `RECOMMENDED` / `SALES_READY` 结果或可信的 0 结果；
4. 将 Research 与 Jobs 从“纯文字标题＋大表单”升级为真实研究工作台；
5. 保持 Phase 8 的联系就绪门槛、管理批准边界、双语、响应式和零虚假数据规则。

不得启动 Phase 10 的真实开发信发送。不得代表老板点击 Management Approved。不得为使页面好看而生成假公司、假任务、假 Buyer、假邮箱、假 KPI 或假机会。

---

# 1. Phase 8 已验收基线

## 1.1 发布状态

```text
phase8: PASS
main = origin/main = peeled phase8
commit: 6b3073c10d3f9503f478f424eccf3408e1b5df82
implementation: 6579d57f79fbc2646a03e219923fef6d570fd105
tests: 449
passed: 446
failed: 0
conditional skips: 3
```

Phase 9 开始前必须再次验证：

```powershell
git fetch origin --prune --tags
git status --short
git rev-parse HEAD
git rev-parse origin/main
git rev-parse 'phase8^{}'
git rev-parse phase8
```

硬要求：

- `HEAD`、`origin/main` 与 peeled `phase8` 必须等于上面的基线提交。
- 记录并保护用户已有未提交改动；不得覆盖无关工作。
- tag 不一致、远端不一致或数据库迁移状态不一致时先停止实现并写出差异。
- 不移动、不重建、不强推 `phase8`。

## 1.2 当前真实业务数据

```text
companies: 106
product_master: 366
current company × product-profile decisions: 14
business_fit FIT: 0
business_fit EVIDENCE_REQUIRED: 12
business_fit NOT_SUITABLE: 2
display RECOMMENDED: 0
display MANAGEMENT_APPROVED: 0
Contact Queue items: 0
verified named Buyer / Procurement: 0
Hunter VALID: 0
outbound messages: 0
provider sends: 0
```

Phase 9 必须从这些事实继续。任何计数变化都要能追溯到：

```text
research job
→ selected company/profile
→ public source
→ normalized observation
→ deterministic decision revision
→ contact evidence
→ Hunter provider event
```

## 1.3 Phase 8 已建立且不得回退的规则

继续保持：

- 只有联系就绪机会才显示 `RECOMMENDED`。
- 老板批准前必须已有 profile-relevant Buyer / Procurement 和当前 `VALID` 企业邮箱。
- Companies 是累计公司主档，不等于建议联系。
- Opportunities 是老板的业务判断页面。
- Management Approved 才能进入 Contact Queue。
- 真实 0 不用 DPV Score、Tier A、样例公司或 fallback 记录填补。
- 中介、采购代理、OEM-only、历史客户、重复公司和 suppression 不进入推荐。
- 所有外发 provider 继续关闭，Phase 9 真实发送必须为 0。
- Phase 7 的 draft、审批、Resend adapter、webhook、suppression、CRM outbox 和 Excel 导入导出能力继续复用，不在 Phase 9 重做。

---

# 2. Phase 9 完成定义

Phase 9 有两个独立结果门槛。

## 2.1 技术与数据执行门槛

以下全部通过才可标记 `PHASE 9 IMPLEMENTATION: PASS`：

- 真实受控补证批次完成；
- 每个候选公司的选择、搜索、抓取、判断和 Hunter 使用可审计；
- 失败、未知和缺证没有被提升为通过；
- Research Workbench 与 Jobs Inbox 使用真实数据；
- UI、API、数据库、鉴权、响应式和回归测试通过；
- provider sends 与 outbound messages 新增数均为 0。

## 2.2 进入 Phase 10 的业务门槛

只有满足以下条件才可标记 `PHASE 10 ELIGIBLE: YES`：

```text
at least 1 real opportunity
+ business_fit_status = FIT
+ system_recommendation_status = RECOMMENDED
+ contact_readiness = READY
+ opportunity_readiness = SALES_READY
+ profile-relevant named Buyer / Procurement verified
+ current active Hunter VALID business email
+ no historical-customer block
+ no suppression
+ current eligible snapshot
```

如果真实结果仍为 0：

```text
PHASE 9 IMPLEMENTATION: PASS
REAL RECOMMENDED OPPORTUNITIES: 0
PHASE 10 ELIGIBLE: NO
```

此时不得降低门槛。结果文件必须列出候选池、已完成补证、主要阻断原因、Hunter 使用和下一批建议。

---

# 3. 业务机会定义

## 3.1 核心判断

DPV 的产品匹配不是“公司网页出现相似关键词”，而是：

```text
DPV 现有公司商品数据库有该品类商品
+
目标公司在自己的市场采购、经营或分销该品类
+
目标公司属于直接终端采购方或有真实采购与转售证据的分销采购方
```

例如 DPV 提供女装：

- 百货、连锁零售或区域零售集团采购女装并向终端销售，可作为 `DIRECT_END_BUYER`。
- 进口商、批发商、分销商采购女装并在其市场转售或分销，可作为 `DISTRIBUTION_BUYER`。
- 仅写着 distributor/importer，不具备目标品类采购与转售证据，不通过。
- 只提供撮合、找厂、采购代理或佣金中介服务，排除。

## 3.2 Product Match 权威数据

内部商品侧必须来自当前真实表：

```text
leadgen.product_master
→ versioned product-profile catalog snapshot
→ WOMENSWEAR or GENERAL_MERCHANDISE
→ normalized category/subcategory
→ current confirmed or historical-order-supported availability
```

硬规则：

- 每个 Product Opportunity candidate 必须引用真实 `product_master_id`。
- 不把商品图片、价格、成本、利润、历史客户价格或内部报价发给搜索服务或 Hunter。
- `UNKNOWN` 商品不自动推断到女装或日用百货。
- 内部商品目录证据不足时使用 `NEEDS_INTERNAL_CATALOG_EVIDENCE`。
- 外部公司品类证据不足时使用 `NEEDS_PRODUCT_EVIDENCE`。
- Product Match 与 Management Baseline、Mexico Historical Match、Supplier Access 分开保存。

## 3.3 联系就绪顺序

Phase 9 的正确工作流固定为：

```text
搜索真实公司
→ Companies 公司主档
→ 企业真实性与历史关系核验
→ Buyer Model
→ Category Procurement Match
→ Supplier Access
→ 搜索 profile-relevant Buyer / Procurement
→ 验证采购职责
→ 搜索并验证企业邮箱
→ SALES_READY
→ RECOMMENDED
→ 等待老板确认
```

不允许先让老板批准，再去找联系人。

---

# 4. Gate 0 — 只读基线与运行配置检查

实现或真实调用前完成只读检查。

## 4.1 数据库和迁移

记录：

- migration 001–028 的 applied/replay 结果；
- 当前 company、product、decision、contact、suppression、provider event 与 message counts；
- 14 个当前机会的 blocker 分布；
- 每个 profile 的 catalog snapshot coverage；
- 当前 job 状态与遗留失败任务；
- 最新决策 revision 和 eligibility snapshot 是否一致。

不得重写历史结果。不得把本轮运行混入旧 ResearchJob。

## 4.2 Hunter 配置

用户已确认 Hunter API Key 已加入环境。只检查状态，不输出值。

必须验证：

```text
HUNTER_API_KEY present = true
HUNTER_MODE = FREE_FIRST or explicitly approved live mode
endpoint = official Hunter endpoint
timeout configured
per-run cap configured
billing-period cap configured
budget ledger available
provider capability health = ready
```

禁止：

- 在 UI、日志、测试快照、结果 Markdown、Git diff 或错误响应中显示 key；
- 前端直接调用 Hunter；
- 使用 Resend 测试邮箱是否存在；
- 把 `ACCEPT_ALL` 或 `UNKNOWN` 当作 `VALID`；
- 未预留预算就调用；
- 超出单轮或账期上限继续调用。

## 4.3 Search 与 crawler 配置

验证现有 Tavily provider、本地 bounded crawler、超时、域名限制、robots/访问策略和审计能力。

优先证据：

1. 公司官方网站；
2. 官方品类、catalog、品牌、门店、采购或 supplier 页面；
3. 官方公司文件和采购文件；
4. 可核验的行业或注册来源；
5. 搜索结果仅作为发现线索，不直接成为 VERIFIED 事实。

不得登录抓取 LinkedIn。公开 LinkedIn URL 只可作为待核验线索，不能替代官方采购职责或企业邮箱证据。

---

# 5. Gate 1 — Reuse-First 与 Schema Audit

Phase 9 先复用现有能力：

```text
EnrichmentService
HunterProvider
HunterCreditBudget
decisionMakerQueryGenerator
roleNormalizer
procurementExtractor
CooperationFeasibilityEngine
CategoryProcurementService
ProductTaxonomyService
Phase7 opportunity decision V2
pg-boss queues
OpenTelemetry
Tabler Core 1.4.0
Tabler Icons Webfont 3.46.0
native HTML/CSS/JavaScript/dialog/table
```

默认不新增前端框架、表格框架、图表库、字体服务或动画库。

仅当现有表不能表达下列不可变事实时，才创建 migration 029：

- 单次 Phase 9 cohort 与公司/profile 的固定选择快照；
- 每家公司各阶段的 deterministic outcome；
- 真实运行批次的预算、停止原因与审计摘要；
- Research Workbench 所需但现有表无法确定性推导的任务状态。

如果现有 `research_jobs`、`enrichment_job_companies`、category evidence、contact、provider usage 和 opportunity decision 表已经足够：

```text
migration 029: NOT CREATED
reason: existing append-only schema is sufficient
```

不得为了版本号而创建空迁移。

---

# 6. 候选池与受控批次

## 6.1 Cohort 选择

候选池只来自真实数据库，按 company + product profile 去重，并满足：

```text
market in AE / MX
company VERIFIED
company lifecycle ACTIVE
relationship NEW_PROSPECT
not duplicate
not historical customer
not suppressed
target profile WOMENSWEAR or GENERAL_MERCHANDISE
has official domain or a recoverable identity path
```

优先顺序：

1. 已有 Category Match，只缺 Buyer、Buyer Role 或 Email；
2. 已有目标品类证据，只缺采购/转售证据；
3. Buyer Model 合适，只缺品类证据；
4. 资料较完整、官方来源较强的新候选；
5. 资料不足或身份冲突的公司留在 Evidence Required，不消耗高成本 Hunter 调用。

不得按 DPV Score 单独选择。不得为了多出结果重新纳入历史客户或明确中介。

## 6.2 Wave A

第一轮为小批量校准：

```text
maximum companies: 5
maximum product profiles per company: 1
Hunter calls: bounded by configured per-run units
concurrency: existing bounded queue policy
real sending: 0
```

Wave A 完成后必须人工查看聚合结果：

- 公司身份与官网准确率；
- 品类采购证据质量；
- Buyer 名称和职责准确率；
- Hunter VALID / ACCEPT_ALL / UNKNOWN / INVALID 分布；
- provider 暂时错误；
- 每家公司消耗单位；
- 是否出现错误的中介或历史客户。

## 6.3 Wave B

只有 Wave A 没有 gate 违规、没有 key 泄漏、没有预算越界且 evidence quality 可接受时，才继续：

```text
maximum additional companies: 15
same product/profile and contact-ready gates
same per-run and billing-period cap
no automatic Phase 10 action
```

Wave B 的实际数量由剩余合格候选和预算决定，不为达到 20 家而放宽条件。

## 6.4 Stop conditions

以下任一发生立即停止新网络调用，但保留已完成结果：

- Hunter 预算达到 cap；
- Hunter 鉴权失败；
- 连续 provider temporary error 达到配置阈值；
- crawler/search 错误率超过验收阈值；
- 数据关联到错误公司身份；
- 历史客户或 suppression gate 失效；
- source URL、evidence hash 或 captured_at 缺失；
- 出现真实外发调用；
- 运行日志暴露 secret 或敏感内部字段。

---

# 7. 单家公司补证流水线

## 7.1 Stage A — Identity

验证：

- legal/trading name；
- official domain；
- market and operating region；
- website reachable；
- existing company aliases；
- OKKI 与共享盘历史关系；
- duplicate/superseded state；
- company/contact suppression。

结果：

```text
IDENTITY_READY
EVIDENCE_REQUIRED_IDENTITY
HISTORICAL_REVIEW
NOT_SUITABLE
SUPPRESSED
```

## 7.2 Stage B — Buyer Model

允许：

```text
DIRECT_END_BUYER
DISTRIBUTION_BUYER
```

`DISTRIBUTION_BUYER` 必须同时有：

- importer/wholesaler/distributor 的公司身份；
- 目标品类经营或采购；
- 向零售商、门店、经销网络或本地市场转售/分销的证据。

分流：

```text
buyer model clear and eligible → continue
procurement/resale unclear → EVIDENCE_REQUIRED_BUYER_MODEL
sourcing agent/broker/OEM-only → NOT_SUITABLE
```

## 7.3 Stage C — Category Procurement Match

采集并标准化：

- 品类或商品；
- 第三方品牌组合；
- 店铺/零售网络；
- import activity；
- wholesale/distribution activity；
- warehouse/inventory；
- buying department；
- intermediary exclusion。

只有 coverage、score 和真实采购证据达到既有规则时产生：

```text
CATEGORY_PROCUREMENT_MATCH
```

网页上只出现产品名称但没有采购、经营或转售语境时，不通过。

## 7.4 Stage D — Supplier Access

检查：

- supplier/vendor portal；
- procurement page；
- buying office；
-采购部门；
- vendor registration；
-公开 RFQ/RFP/tender；
-正式采购邮箱或 contact route；
-邀请制、approved vendor list、固定供应商或地区限制。

Supplier Access 不补偿 Product Match。高 Product Match + 低 access 可保留为战略长线，但不自动 `SALES_READY`。

## 7.5 Stage E — Buyer / Procurement

搜索对象必须与目标 profile 相关：

- Buyer；
- Category Buyer；
- Merchandise Buyer；
- Procurement Manager；
- Purchasing Manager；
- Sourcing Manager；
- Buying Director；
- Merchandising / Procurement Department responsible person。

接受条件：

```text
named person
+ current company relationship
+ normalized role
+ target product profile relevance
+ public evidence URL
+ captured_at
+ verification_status = VERIFIED
```

仅有 CEO/Founder、销售人员、客服、通用联系人或未知职位，不满足采购负责人门槛。

## 7.6 Stage F — Business Email

顺序：

```text
official public business email
→ Hunter Domain Search / Email Finder when needed
→ existing EmailService format/MX checks
→ Hunter Email Verifier
→ persist append-only verification event
```

状态：

| Hunter 状态 | Phase 9 决策 |
| --- | --- |
| `VALID` | 在 TTL 内可进入联系就绪判断 |
| `ACCEPT_ALL` | `EVIDENCE_REQUIRED_EMAIL`，人工风险审核 |
| `UNKNOWN` | `EVIDENCE_REQUIRED_EMAIL`，继续补证 |
| `TEMPORARY_ERROR` | 延迟重试，不改成 INVALID |
| `INVALID` | 联系人级 suppression，不再使用该邮箱 |
| `NOT_VERIFIED` | `EVIDENCE_REQUIRED_EMAIL` |

邮箱必须属于正式企业联系路径。免费个人邮箱、推测邮箱或与公司域不一致的邮箱不得因格式有效而成为推荐联系人。

## 7.7 Stage G — Decision Refresh

每一阶段成功持久化后运行确定性 decision refresh。

只有全部门槛满足：

```text
business_fit_status = FIT
contact_readiness = READY
opportunity_readiness = SALES_READY
system_recommendation_status = RECOMMENDED
display_opportunity_status = RECOMMENDED
eligibility_status = ELIGIBLE
```

否则保留最具体的 Evidence Required reason。不得把多个缺口压缩成不透明的“AI 评分”。

---

# 8. Evidence Required 工作队列

Phase 9 必须把当前缺证从静态状态变成可执行任务。

确定性任务类型：

```text
VERIFY_COMPANY_IDENTITY
COLLECT_CATEGORY_EVIDENCE
VERIFY_BUYER_MODEL
CONFIRM_DISTRIBUTION_RESALE
CONFIRM_SUPPLIER_ACCESS
FIND_PROFILE_BUYER
VERIFY_BUYER_ROLE
FIND_BUSINESS_EMAIL
VERIFY_EMAIL
REVIEW_HISTORY_CONFLICT
REVIEW_SUPPRESSION
RETRY_TEMPORARY_PROVIDER_ERROR
```

优先级不是人工随意标签，按接近 `RECOMMENDED` 的程度计算：

1. 业务匹配已通过，只缺 VALID 邮箱；
2. 已有 Buyer 和邮箱，只缺 Buyer Role；
3. 已有 Category Match，只缺 Buyer；
4. Buyer Model 与品类接近，只缺明确采购证据；
5. 公司身份或历史关系冲突；
6. 已经 NOT_SUITABLE、SUPPRESSED 或历史客户的记录不进入工作队列。

每个任务显示：

- company；
- product profile；
- current blocker；
- evidence coverage；
- recommended next action；
- owner/role；
- latest activity；
- retry state；
- source count；
- open opportunity/detail action。

---

# 9. UI 结论与参考采用边界

## 9.1 图 4 的实际问题

当前 Research 首屏是：

```text
页面 eyebrow
→ 大号双语标题
→ 双语说明
→ 大块空白
→ 五列字段和 buyer checkbox
```

问题不是单一字号，而是：

- topbar 已显示 Research，内容区又重复 Market Research；
- 三层纯文字纵向堆叠，缺少任务、进度和业务重点；
- 首屏唯一内容是“建立任务”，不像持续工作的研究工作台；
- 表单与当前任务、缺证、Buyer、Hunter 状态没有关联；
- 用户进入页面后看不到“现在最该做什么”；
- 大面积白底、单一卡片和右下按钮造成模板感；
- 移动端仍会把长表单作为主要内容。

Phase 9 必须删除这套 page hero 表达。不是只换字体、阴影或配色。

## 9.2 图 5 的采用部分

采用：

- 移动端顶部紧凑上下文；
- 真实快捷入口；
- 真实 KPI 摘要；
- 待办与最近任务分区；
- 触摸友好的模块和固定主要入口。

不采用：

- 教育业务插画；
- 假仪表盘；
- 装饰性 Banner；
- 与 DPV 无关的底部五栏复制；
- 过多蓝色渐变或悬浮圆形按钮。

## 9.3 图 6 的采用部分

采用：

- 工作台标题与数据更新时间；
- 4 个以内的指标条；
- 一个有明确优先级的重点行动区；
- 重点行动后接紧凑业务列表；
- 顶部主动作与同步状态分离。

重点行动区可以使用 Phase 8 的 solid indigo surface，但：

- 不用渐变；
- 不用 glow；
- 只显示真实任务；
- 空时退回普通 neutral empty state；
- 文字、focus 和状态达到对比要求。

## 9.4 图 7 的采用部分

采用：

- Inbox 式研究任务列表；
- 搜索/快速建立任务；
- 状态、阻断原因、market/profile 筛选；
- 单行主信息、次信息和右侧动作；
- compact/comfortable 两种密度；
- 批量操作只在真实业务需要时出现。

不采用：

- 每行无业务依据的截止日；
- 假项目、假优先级和假负责人；
- icon-only 的不可理解动作；
- 把所有状态做成彩色 pill。

---

# 10. Phase 9 Research Workbench

## 10.1 页面定位

Research 不再等同于“创建研究任务表单”。

新定位：

```text
Research Workbench
= 当前研究状态
+ 最重要的补证动作
+ 新建研究任务入口
+ 最近研究任务
+ 真实 Buyer/Hunter 进展
```

保持导航 key：

```text
data-app-nav="research"
data-app-view="research"
#research-form
#research-job
```

## 10.2 新首屏结构

Desktop 顺序：

1. Compact command header；
2. 4 项真实指标；
3. 当前最重要补证任务；
4. 活跃任务 / 最近任务列表；
5. 新建研究任务 dialog；
6. 错误、预算或配置告警。

不再渲染独立的 `Market Research` eyebrow + 超大双语标题 + 双语长说明。

## 10.3 Compact command header

左侧：

- Tabler `ti-search` 或 `ti-telescope`；
- `市场研究 / Research Workbench`；
- 一句短说明：从真实公司和商品库建立可联系机会；
- 数据更新时间。

右侧：

- Hunter 状态只显示 `Ready / Disabled / Budget hold / Temporary error`，不显示 key；
- 主按钮 `新建研究任务 / New Research Job`；
- 次按钮 `打开全部任务 / Open Jobs`。

一个 screen 只有“新建研究任务”是 primary action。

## 10.4 真实指标条

最多四项：

| 指标 | 权威来源 | 点击动作 |
| --- | --- | --- |
| Active research jobs | 当前 `research_jobs` | 打开 Running 任务 |
| Evidence tasks | 当前 Evidence Required 推导任务 | 打开任务 Inbox |
| Verified profile buyers | 当前 verified named Buyer/Profile role | 打开 Buyer tasks/result |
| Hunter VALID / Contact-ready | 当前有效 VALID 路径或 RECOMMENDED 数 | 打开对应机会 |

规则：

- 数值为 0 就显示 0；
- 每个数值有 `as of` 时间；
- 不用无真实分母的完成率；
- 不用装饰性 gauge；
- 不用虚构趋势箭头；
- 不用“AI 命中率”等不可证明指标。

## 10.5 重点行动区

标题：

```text
本轮最重要的补证工作
Priority Evidence Work
```

最多显示 3 项，由第 8 节确定性优先级生成。每项包含：

- 序号；
- 公司和 profile；
- blocker；
- next action；
- evidence age；
- 打开任务/公司详情动作。

完成动作必须打开对应工作区，不在卡片上用一个勾号直接伪造“已验证”。

## 10.6 活跃与最近任务

首屏显示最多 6 个：

- Running；
- Queued；
- Waiting for evidence；
- Completed；
- Failed/Retryable。

字段：

```text
job objective
market / profile
job type
progress stage
companies selected
category matches
verified buyers
Hunter VALID
blockers/errors
created/updated time
open details
```

使用列表或 table-like rows，不创建六张同权卡片。

---

# 11. 新建研究任务 Dialog

点击主按钮后打开 native `dialog`，保留现有 API payload 和字段 ID。

## 11.1 Step 1 — 市场与商品

- Country；
- City optional；
- Region optional；
- Product profile；
- 当前内部 catalog snapshot summary；
- 最大结果数。

商品 profile 选择时显示真实内部目录摘要，例如：

```text
WOMENSWEAR
real catalog rows: actual count
coverage: actual snapshot coverage
snapshot captured_at
```

不展示价格、成本、利润或历史客户商业条款。

## 11.2 Step 2 — Buyer target

把七个 checkbox 整理为业务分组：

```text
Direct end buyers:
Department Store
Large Retail Group
Regional Retail Chain
Supermarket Buying Organization

Distribution buyers:
Importer
Wholesaler
Distributor
```

Distribution buyer 下显示明确说明：

“只有具备目标品类采购与转售/分销证据才会通过。”

## 11.3 Step 3 — Scope review

提交前显示：

- market；
- product profile；
- buyer types；
- maximum results；
-预计网络调用范围；
- Hunter 是否会启用；
- per-run cap；
- live sends = 0；
- duplicate/idempotency key。

提交反馈：

```text
idle → validating → creating → queued → success/error
```

防止双击，保留 focus，错误与字段关联，成功后关闭 dialog 并把新任务置于工作台首位。

---

# 12. Jobs Inbox 重构

## 12.1 页面定位

Jobs 是完整研究任务 Inbox，不再是“尚未选择任务＋导入批次大表”的混合页。

顶层分为：

```text
Research Jobs
Data Import Batches
Data Export Jobs
```

默认 `Research Jobs`。Import/Export 保留现有入口，但不与研究任务同一列表竞争。

## 12.2 Search 与 filters

常显：

- search job/company；
- status；
- job type；
- market；
- product profile；
- blocker；
- sort。

状态：

```text
ALL
RUNNING
WAITING_EVIDENCE
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
```

保留完整 URL/hash state 和浏览器 Back。

## 12.3 列表行

Desktop 默认列不超过七个决策列：

1. Job / objective；
2. Market / profile；
3. Stage / status；
4. Progress；
5. Result counts；
6. Latest blocker / activity；
7. Action。

二级字段进入详情 drawer/dialog。

Mobile 变为 decision rows：

- job objective；
- status；
- market/profile；
- one primary result；
- one blocker；
- open action。

## 12.4 Job detail

详情按流水线显示：

```text
Identity
Buyer Model
Category Procurement
Supplier Access
Buyer / Role
Email / Hunter
Decision refresh
```

每个阶段显示真实状态、计数、错误和 evidence 链接。不得显示 raw provider payload、key、内部 token、私有文件路径或完整敏感邮件内容。

---

# 13. Opportunities 与 Research 联动

Evidence Required 行的 next action 必须深链到 Research/Jobs：

| Blocker | Action |
| --- | --- |
| PRODUCT | Collect category evidence |
| BUYER_MODEL | Verify buyer model / resale |
| SUPPLIER_ACCESS | Review supplier access |
| CONTACT | Find profile buyer |
| BUYER_ROLE | Verify procurement responsibility |
| EMAIL | Verify business email |
| TEMPORARY_ERROR | Retry provider task |
| HISTORY / IDENTITY | Open company record review |

完成补证后：

- append new evidence；
- refresh category/cooperation/contact decision；
- create new decision revision；
- refresh opportunity list；
- preserve user filter and focus；
- show what changed and what did not change。

如果成为 `RECOMMENDED`，只显示 Management Approval 动作。不得自动批准、自动建 draft 或自动发送。

---

# 14. Bilingual 与视觉层级修正

继续保留完整中英语义，但消除内容重复。

规则：

- topbar 与页面内容不重复同一个三层标题；
- page title 使用一个紧凑 bilingual component；
- 说明最多两行，优先放在组件上下文中；
- 指标、任务和表单标签继续使用统一 `.bi` 合同；
- 公司名、Buyer 名、职位原文、邮箱、URL 和 evidence 原文不翻译；
- 不通过隐藏英文来缩短页面；
- 不在一个标题区同时出现 eyebrow、H1/H2 和同义说明三次。

Phase 9 如需修改 `docs/PHASE8_DESIGN_SYSTEM.md`，必须新增“Research Workbench refinement”章节并说明这是层级与布局调整，不是删除双语或改业务语义。

---

# 15. 视觉系统与组件规则

继续使用 Phase 8 tokens，默认不重新选色。

允许新增：

- `--p9-focus-surface`：由现有 primary 与 surface 组合，必须有 light/dark 对比证明；
- workbench KPI strip；
- priority work panel；
- inbox row；
- progress step；
- safe configuration status；
- mobile quick actions。

禁止：

- gradient；
- glassmorphism；
- neon/glow；
- AI orb/sparkle；
- 大幅插画；
- fake avatar；
- marketing hero；
- 每个字段一张卡；
- 满屏彩色 status pill；
- 纯装饰 gauge/chart；
- 新 icon family；
- CDN/Google Fonts；
- GSAP 或无业务意义的 scroll reveal。

卡片数量规则：

- 指标条内部可有 4 个紧凑 metric cells，但不各自用夸张阴影；
- 页面只有一个重点行动 surface；
- 普通任务使用 row/divider；
- 每屏最多一个 primary action；
- status colour 只表示真实业务状态。

---

# 16. Responsive Contract

验收 viewport：

```text
1440 × 900
1280 × 720
1024 × 768
768 × 900
390 × 844
375 × 667
844 × 390
```

## Desktop

- 工作台最大内容宽度沿用 Phase 8；
- header、metrics、focus panel、inbox 对齐同一 grid；
- 4 个 metric cells 单行；
- priority work 和 active job list 不产生页面级横向滚动；
- Jobs 默认列不超过 7 个。

## Tablet

- metrics 为 2 × 2；
- command header 可换行但 primary action 保持完整；
- priority panel 单列；
- filters 进入可展开区域；
- dialog near-fullscreen。

## Mobile

参考图 5 的模块化结构，但保持 DPV 业务语言：

1. compact title + new job；
2. 2 × 2 real metric cells；
3. 3–4 个真实 quick actions；
4. priority evidence tasks；
5. recent jobs；
6. bottom fixed navigation 只有在现有 sidebar 模式验证不适合时才评估，默认继续 Phase 8 off-canvas navigation。

要求：

- 44 × 44px touch targets；
- 无页面级横向 overflow；
- 任务行不用 hover-only interaction；
- keyboard、Back、dialog focus 和屏幕方向切换正确；
- 375px 不截断 primary action、状态和公司名。

---

# 17. API 与数据合同

优先扩展现有服务，不复制 business logic。

建议只读 endpoints：

```text
GET /api/research/workbench-summary
GET /api/research/tasks
GET /api/research/jobs
GET /api/research/jobs/:id
GET /api/research/jobs/:id/results
```

`/api/research/workbench-summary` 返回：

```json
{
  "as_of": "timestamp",
  "active_jobs": 0,
  "evidence_tasks": 0,
  "verified_profile_buyers": 0,
  "hunter_valid_routes": 0,
  "contact_ready_opportunities": 0,
  "hunter_mode": "FREE_FIRST",
  "hunter_budget_state": "READY"
}
```

不得返回：

```text
HUNTER_API_KEY
raw provider payload
private filesystem path
internal token
email body
supplier cost
customer price
profit
internal notes
```

`/api/research/tasks` 必须服务端确定性生成并支持：

```text
status
task_type
market
product_profile
company_id
opportunity_id
job_id
sort
limit
cursor
```

所有读写路由使用 Phase 7/8 management auth 与 role boundary。浏览器不直接访问 provider。

写入继续复用：

```text
POST /api/research/jobs
POST /api/enrichment/jobs
POST /api/contacts/:id/hunter-verify
existing internal worker callbacks
existing management approval route
```

不得创建前端可调用的任意 URL crawler 或任意 Hunter proxy。

---

# 18. 鉴权、安全、隐私和成本

角色建议：

| Action | Roles |
| --- | --- |
| View workbench and jobs | MANAGEMENT, DATA_ADMIN, approved SALES read role |
| Create research/enrichment job | MANAGEMENT, DATA_ADMIN |
| Retry bounded task | MANAGEMENT, DATA_ADMIN |
| Trigger Hunter verify | approved contact-enrichment role |
| Management approve | MANAGEMENT only |
| Provider send | disabled in Phase 9 |

所有 mutating endpoints：

- auth；
- CSRF；
- role；
- idempotency；
- bounded payload；
- audit；
- rate/cost gate；
- deterministic error code。

日志只保留：

- job/company opaque IDs；
- provider action type；
- result enum；
- used budget units；
- duration；
- error code；
- source counts。

邮箱在普通日志中只保留 masked form 或 hash。key、raw response、完整 message、共享盘路径和内部商业字段不进入日志。

---

# 19. 实现文件边界

建议新增：

```text
services/demo-dashboard/public/ui/phase9-research-workbench.css
services/demo-dashboard/public/ui/phase9-research-workbench.js
services/demo-dashboard/src/research/ResearchWorkbenchService.js
services/demo-dashboard/src/research/researchTaskProjection.js
services/demo-dashboard/src/research/router.js
services/demo-dashboard/test/phase9-research-workbench.test.js
services/demo-dashboard/test/phase9-real-enrichment-gates.test.js
services/demo-dashboard/test/phase9-ui-contract.test.js
docs/PHASE9_REUSE_RESEARCH.md
docs/PHASE9_REAL_OPPORTUNITY_RESULT.md
docs/PHASE9_VISUAL_AUDIT.md
docs/PHASE9_RESULT.md
```

允许修改：

```text
services/demo-dashboard/public/index.html
services/demo-dashboard/public/app.js
services/demo-dashboard/public/crm-shell.js
services/demo-dashboard/src/server.js
existing enrichment/category services where a verified gap exists
docs/PHASE8_DESIGN_SYSTEM.md
docs/UI_SYSTEM.md
docs/VERSION_CHANGELOG.md
```

原则：

- 业务计算留在服务层；
- UI module 只做 fetch、render、focus 和 state；
- CSS selector 不承担业务 API；
- 保留 Phase 8 stable IDs；
- 不把所有改动继续堆到旧 `phase5.css` / `phase7.css`；
- 如果拆分 `app.js`，先用 contract tests 固定行为，再机械迁移。

---

# 20. UI/UX Pro Max 使用要求

Phase 9 实现时继续使用本地 `ui-ux-pro-max`，但 Phase 8 Design System 是主基线。

必须执行：

1. 系统级检索，参数约为 variance 4、motion 2、density 8；
2. task dashboard、form feedback、mobile workbench、heading hierarchy 的 targeted UX 检索；
3. 检查当前 vanilla HTML/CSS/JS + Tabler stack；
4. 将可用规则记录到 `docs/PHASE9_REUSE_RESEARCH.md`；
5. 对 landing page、Google Fonts、GSAP、渐变、假 KPI 等不适合结果明确记录为未采用。

本阶段已确认的适用规则：

- sequential heading hierarchy；
- consistent type scale；
- visible form labels；
- submit loading/success/error feedback；
- mobile-first；
- no hover-only primary interaction；
- stable loading layout；
- 44px touch target；
- Back/history preservation；
- bulk action 只在真实需要时出现。

---

# 21. Tests

## 21.1 Business gates

至少覆盖：

- distributor label without target-category resale evidence is not eligible；
- direct retailer with verified target-category buying evidence can pass Buyer Model；
- product match references real current catalog snapshot；
- Product Match cannot be compensated by Supplier Access；
- missing named profile Buyer remains Evidence Required；
- unclear role remains Evidence Required Buyer Role；
- Hunter ACCEPT_ALL/UNKNOWN does not become contact-ready；
- current Hunter VALID + verified role can satisfy email/contact gate；
- expired VALID does not pass；
- INVALID creates contact-level suppression；
- historical customer and suppression always block；
- decision refresh is append-only and idempotent；
- no management approval is created by enrichment；
- no provider send is called。

## 21.2 Cohort and provider bounds

覆盖：

- only AE/MX active new prospects selected；
- duplicate company/profile not selected twice；
- Wave A cap；
- Wave B requires Wave A gate；
- per-run and billing cap；
- provider replay/idempotency；
- temporary errors retry without false invalidation；
- key never appears in logs/responses；
- stop conditions preserve completed work；
- Hunter used units reconcile with ledger。

## 21.3 Workbench API

覆盖：

- all counts are database-derived；
- 0 remains 0；
- task priority deterministic；
- source filters and cursor bounds；
- no private fields in summary/task payload；
- auth/role/CSRF；
- no arbitrary crawler/provider proxy；
- status and error enums mapped to bilingual labels。

## 21.4 UI contracts

覆盖：

- no old plain Research hero structure；
- command header exists；
- four metrics use real endpoint；
- priority work renders max 3；
- new-job dialog retains field IDs and payload；
- Job Inbox search and filters；
- existing stable hooks remain；
- one primary action per screen；
- no fake gauge/avatar/company/task；
- no gradient, external font or extra icon family；
- loading/error/empty/success states；
- focus restoration；
- reduced motion；
- mobile decision rows。

## 21.5 Regression

运行：

```powershell
cd services/demo-dashboard
npm test
npm audit --omit=dev
```

并执行：

- migrations apply/replay；
- Phase 5/6/6.1 matching tests；
- Phase 7 outreach/data exchange tests；
- Phase 8 contact-ready/UI tests；
- Excel import/export deployed test；
- Docker health；
- n8n workflow 04 remains inactive；
- provider sends remain 0。

现有 conditional skips 必须说明原因；不得将新失败改成 skip。

---

# 22. Browser 与视觉验收

## 22.1 对照方法

在相同 viewport 保存：

```text
BEFORE: C:/Users/ACER/Desktop/4.png
AFTER: runtime/phase9-visual-audit/research-workbench-*.png
REFERENCE: C:/Users/ACER/Desktop/5.png
REFERENCE: C:/Users/ACER/Desktop/6.png
REFERENCE: C:/Users/ACER/Desktop/7.png
```

截图目录保持 Git-ignored，只提交不含敏感数据的 manifest 和审计结论。

## 22.2 必验状态

Research Workbench：

- real zero；
- running job；
- priority evidence tasks；
- Hunter ready；
- Hunter budget hold；
- temporary provider error；
- new job dialog each step；
- successful create；
- failed create；
- mobile portrait；
- mobile landscape；
- dark/compact。

Jobs Inbox：

- all；
- running；
- waiting evidence；
- completed；
- failed retryable；
- search no result；
- long company name；
- long evidence URL in detail；
- keyboard-only；
- browser Back。

## 22.3 视觉 PASS 判断

PASS 必须满足：

- 图 4 中被圈出的三层纯文字 hero 已消失；
- 首屏在不滚动时能看到真实指标、一个主要任务区和至少部分任务列表；
- 新建任务表单不再永久占据整个首屏；
- desktop 接近图 6/7 的工作台与 Inbox 层级；
- mobile 接近图 5 的模块化信息组织，但没有业务无关装饰；
- 不因参考图而引入渐变、假 KPI、插画墙或卡片墙；
- 真实 0 仍然诚实、清楚且可执行；
- light/dark、comfortable/compact 和 7 个 viewport 均通过；
- 无页面级横向 overflow；
- 中英文语义完整。

---

# 23. Implementation Order

严格按以下顺序：

1. Git、tag、数据库、测试与 runtime 基线；
2. 写 `docs/PHASE9_REUSE_RESEARCH.md`；
3. Gate 1 schema audit；
4. 固定 cohort selection 与 task priority tests；
5. 完成 workbench summary/task read models；
6. 完成 auth、privacy、budget 和 no-send gates；
7. 制作 Phase 9 Workbench 线框与 component inventory；
8. 重构 Research command header、metrics、priority work、recent jobs；
9. 把研究表单移入三步 dialog；
10. 重构 Jobs Inbox 和 job detail；
11. 打通 Opportunities blocker deep links；
12. 完成 mobile/dark/compact/accessibility；
13. 用 synthetic fixtures 完成全部自动测试；
14. 执行 Wave A 真实受控补证；
15. 审查 Wave A evidence、Hunter 与预算；
16. 条件满足后执行 Wave B；
17. refresh decisions and eligibility；
18. 验证 Recommended/SALES_READY 真实结果；
19. 执行 deployed browser、Excel、Docker 和 no-send 验收；
20. 编写结果、视觉审计与 changelog；
21. commit、push、remote verify、annotated tag `phase9`；
22. STOP。

UI 可以先用 synthetic fixtures 测试，但最终截图和计数必须来自真实数据库状态；synthetic 数据不得进入生产业务表。

---

# 24. Deliverables

必须提交：

```text
DPV_PHASE9_REAL_OPPORTUNITY_AND_RESEARCH_WORKBENCH_CODEX_EXECUTION_PLAN_V1.md
docs/PHASE9_REUSE_RESEARCH.md
docs/PHASE9_REAL_OPPORTUNITY_RESULT.md
docs/PHASE9_VISUAL_AUDIT.md
docs/PHASE9_RESULT.md
docs/PHASE8_DESIGN_SYSTEM.md updated with Phase 9 refinement
docs/UI_SYSTEM.md updated
docs/VERSION_CHANGELOG.md updated
source and tests
optional migration 029 only if Gate 1 proves it necessary
```

`docs/PHASE9_REAL_OPPORTUNITY_RESULT.md` 至少记录聚合：

- cohort selection count；
- Wave A/B started/completed/stopped；
- public sources and verified evidence counts；
- buyer model distribution；
- Category Procurement Match distribution；
- Supplier Access distribution；
- named profile Buyer distribution；
- Hunter call/status/used-unit distribution；
- SALES_READY/RECOMMENDED counts；
- top blocker distribution；
- historical/suppression exclusions；
- provider sends and outbound messages；
- any remaining evidence queue。

不得记录 key、完整邮箱、内部商业价格、共享盘路径或 raw provider payload。

---

# 25. PASS Gate

## 25.1 Phase 9 implementation PASS

- [ ] Baseline equals peeled phase8
- [ ] Existing user changes preserved
- [ ] Schema audit completed
- [ ] No unnecessary migration/package/framework
- [ ] Cohort selection deterministic
- [ ] Wave A bounded and audited
- [ ] Wave B only after Wave A gate
- [ ] Product Match uses real product database
- [ ] Distribution buyers require procurement-and-resale evidence
- [ ] Named profile Buyer and role evidence required
- [ ] Hunter VALID required and inside TTL
- [ ] ACCEPT_ALL/UNKNOWN do not pass
- [ ] Historical customer/suppression gates hold
- [ ] Decision revisions append-only
- [ ] Management approval not automated
- [ ] Provider sends = 0
- [ ] Research plain-text hero removed
- [ ] Research Workbench uses real metrics/tasks
- [ ] New job is a three-step dialog
- [ ] Jobs is an Inbox
- [ ] Opportunity blockers deep-link correctly
- [ ] No fake KPI/company/task/gauge
- [ ] No gradients/external fonts/new icon family
- [ ] Seven viewport matrix passes
- [ ] Accessibility and focus contracts pass
- [ ] Full tests have 0 failures
- [ ] Migration replay passes or no migration is documented
- [ ] Deployed Excel and Docker regression passes
- [ ] Result and visual audit documents complete
- [ ] main/origin/main/tag remote verification passes

## 25.2 Phase 10 eligibility

- [ ] At least one real `RECOMMENDED`
- [ ] At least one real `SALES_READY`
- [ ] Verified named profile Buyer exists
- [ ] Current Hunter `VALID` route exists
- [ ] Current eligible snapshot exists
- [ ] No suppression or history block
- [ ] Boss has a truthful opportunity to review

如果本节不全通过：

```text
PHASE 10 ELIGIBLE: NO
```

不得通过发送测试邮件、批准低门槛机会或使用通用邮箱来补齐。

---

# 26. Release and STOP

完成后：

```powershell
git status --short
git diff --check
git diff --stat
git add <explicit Phase 9 files>
git commit -m "phase9: deliver real opportunity enrichment and research workbench"
git push origin main
git tag -a phase9 -m "Phase 9 real opportunity enrichment and research workbench release"
git push origin phase9
git fetch origin --prune --tags
git rev-parse HEAD
git rev-parse origin/main
git rev-parse 'phase9^{}'
git rev-parse phase9
```

结果文件记录：

```text
PHASE 9 IMPLEMENTATION: PASS / FAIL
REAL RECOMMENDED OPPORTUNITIES: actual count
REAL SALES_READY OPPORTUNITIES: actual count
REAL VERIFIED PROFILE BUYERS: actual count
REAL HUNTER VALID ROUTES: actual count
REAL PROSPECT SENDS: 0
PHASE 10 ELIGIBLE: YES / NO
```

STOP — Phase 10 live-contact pilot、真实开发信外发、自动跟进与成交闭环未开始。
