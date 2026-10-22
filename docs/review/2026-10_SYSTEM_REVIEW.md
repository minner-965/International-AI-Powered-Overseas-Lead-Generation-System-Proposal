# DPV 海外获客系统 · 2026-10 系统评审

评审日期：2026-10-22 · 读者：Simon（开发 + 业务） · 性质：内部开发文档（允许技术术语）

> 所有结论均已对照仓库只读核验，路径相对仓库根目录；`src/` 指 `services/demo-dashboard/src/`，`public/` 指 `services/demo-dashboard/public/`。
> 运行数据取自 `docs/CURRENT_PROJECT_STATUS.md`（生成于 2026-09-13，此后未重新生成），不是今天的实时数据。

---

## 1. 一句话结论

获客链路的“搜索 → 证据 → 类目评分 → 联系人/Hunter → 首封邮件 → IMAP 回复 → 退订”已全部实现并经测试，但系统目前处于**只读恢复模式**（workers 与 n8n 停止，544/579 条搜索未执行，验收标签未打）；最大的业务短板在**首封邮件之后的销售跟进/CRM**，且存在一个让所有 CRM 同步永久失败的 bug（本批修复中）。

---

## 2. 完成度总览

| 范围 | 状态 | 依据 |
|---|---|---|
| Phase 1–12 | 已验收（Phase 12 标签 `phase12-workspace-ui-v3-accepted-20260907`） | `docs/VERSION_CHANGELOG.md` |
| Phase 12 视觉 QA | **PARTIAL**（辅助技术/对比度、参考稿重新渲染、性能门禁未完成） | `docs/history/phase12/PHASE12_UI_VISUAL_QA_RESULT.md` 第 71 行 |
| Phase 13 MC00–MC07 | 完成（MC07 自动首封 + 自动化控制） | `docs/history/phase13/PHASE13_MC07_*_RESULT.md` |
| 清理 CL00–CL16 | 完成，但全路由验收 **REVIEW_REQUIRED** | `docs/cleanup/FINAL_CLEANUP_RESULT.md` |
| Exa 搜索 | 实测通过：1 次查询、3 条结果、USD 0.007 | `docs/cleanup/FINAL_CLEANUP_RESULT.md` 第 11 行，`docs/EXA_SEARCH_PROVIDER.md` |
| 测试 | 1,257 个：1,203 通过 / 54 跳过 / 0 失败 | `docs/cleanup/FINAL_CLEANUP_RESULT.md` 第 25 行 |
| 路由验收 | 157/158 方法+路径有 HTTP 证据；live-collection 端点未执行 | 同上 第 8–9 行，`docs/cleanup/CL15_ROUTE_COVERAGE.md` |
| 验收标签 | `phase13-cleanup-current-runtime-accepted` **暂缓** | 同上 第 29、39 行 |
| LLM | **未接入**（无 `LLM_API_KEY`/`LLM_MODEL`，无推理适配器） | `docs/LLM_RUNTIME_ACTUAL_STATE.md` |
| 迁移 | 001–063 已应用；下一个为 064 | `database/migrations/` |

### 运行快照（2026-09-13）

| 指标 | 数值 |
|---|---|
| 运行模式 | `compose.readonly-recovery.yaml`，`maintenance_active=true`、`http_read_only=true` |
| 运行中服务 | demo-dashboard、postgres |
| 已停止 | category-worker、data-worker、outreach-worker、n8n、phase7-runtime-init |
| 搜索查询 | 579 条，已完成 35，剩余 **544**（PERSISTED 34 / REVIEW_REQUIRED 23 / RATE_LIMITED 1 / NOT_FOUND 1 / CLAIMED 1） |
| 企业 / 联系人 | 153 / 185 |
| 商机池 | 当前 153，**有效 37**（PRECISION 4、RELEVANT 2、GENERAL_RELEVANT 31；EXPLORATORY 108、NOT_SUITABLE 8） |
| 发信 | SMTP 已配置；PROVIDER_ACCEPTED **4** |
| 回复 | 入站 5、活动 4、销售任务 1、退订/抑制 2 |
| 首封策略 | `MC07_DPV_FIRST_TOUCH_V1`：50 封/天、1 封/分钟、同公司冷却 30 天、`auto_followup=false` |

---

## 3. 获客链路逐段状态

| # | 环节 | 状态 | 关键文件 | 缺口 |
|---|---|---|---|---|
| 1 | 搜索 | 已实现，**暂停** | `src/search/`（Exa/Tavily/Brave/DataForSEO、`FrozenSearchPlanExecutor.js`）、`src/searchPlanning/`（`queryPlanner.js`、`domainPolicy.js`） | 544 条积压未执行；`provider_spend_mode=NO_NEW_PAID_SPEND`；Exa 账户状态 NOT_CHECKED |
| 2 | 证据 / 研究 | 已实现 | `src/autoEvidence/`、`src/research/`、`src/researchBatch/`、`src/verification/` | 依赖 worker，当前停止 |
| 3 | 类目评分 / 商机池 | 已实现（规则化、确定性） | `src/categoryProcurement/`、`src/opportunityPool/`、`src/scoring/`（GoRules `zenRulesAdapter.js`）、`rules/*`、`docs/rules/PHASE13_*.md` | 无 LLM 辅助；EXPLORATORY 占 108/153 |
| 4 | 联系人 + Hunter 验证 | 已实现 | `src/enrichment/HunterProvider.js`、`src/contact/`、`src/opportunityPool/contactReadiness.js` | 无具名采购人；以官方部门邮箱为主 |
| 5 | 首封邮件（SMTP） | 已实现，**暂停** | `src/outreach/AutoFirstTouchService.js`、`firstTouchTemplates.js`、`phase13EmailEligibility.js`、`suppression.js` | 静态模板，无个性化起草；仅 4 封被服务商接收 |
| 6 | IMAP 回复 | 已实现（规则分类） | `src/outreach/inbound.js`（`classifyInboundReply`，第 47 行） | 无人工复核分类的接口；不确定回复只标 REVIEW |
| 7 | 退订 / 抑制 | 已实现 | `src/outreach/suppression.js`、`applyInboundCrmEffects`（`src/phase7/repository.js` 约 1496 行起） | — |
| 8 | 跟进 | **部分** | `outreach_drafts.followups`（`database/migrations/025_*.sql` 第 193 行）、`src/outreach/draftValidator.js` | 跟进内容只存储/校验，从不排期发送；`auto_followup=false`（`src/automation/Phase13AutomationFacade.js` 第 56 行） |
| 9 | CRM / 导出 | **部分** | `src/dataExchange/`（CSV/XLSX）、`src/phase7/service.js` `processCrmSyncWork`（第 1177 行） | 通用 HTTP 适配器依赖 `CRM_BASE_URL`（未配置）；所有 UPDATE_ACTIVITY 同步会失败（见 §5.1） |

编排：Express + PostgreSQL 事务 outbox + pg-boss 12.28.0（`services/demo-dashboard/package.json`）；n8n 工作流（`workflows/`）只做协调/对账，非核心路径。

---

## 4. 未完成与阻塞项

### P0（影响业务闭环或正确性）

| 项 | 说明 | 依据 |
|---|---|---|
| CRM 同步 bug | 每条 UPDATE_ACTIVITY outbox 都会 `CRM_PAYLOAD_FIELD_FORBIDDEN` → PERMANENT_ERROR | §5.1 |
| 销售跟进缺失 | 无任务管理/阶段推进/手工活动/跟进起草 | §5.2 |
| 执行暂停 | workers 与 n8n 停止；恢复需先完成待办审查，不能直接重启 | `AGENTS.md` CL16 规则、`docs/cleanup/FINAL_CLEANUP_RESULT.md` 第 35 行 |

### P1（影响验收与可用性）

| 项 | 说明 |
|---|---|
| 路由验收 157/158 | live-collection 端点未执行，验收标签暂缓 |
| 搜索积压 544 条 | 需按预算分批释放，不能一次性恢复（`AGENTS.md`） |
| Phase 12 视觉 QA PARTIAL | 对比度/读屏、参考稿渲染、性能门禁 |
| 无 LLM | 起草、回复意图、页面摘要均为规则/模板 |
| 状态快照过期 | `docs/CURRENT_PROJECT_STATUS.md` 停留在 2026-09-13，需重新生成 |

### P2（工程健康）

| 项 | 说明 |
|---|---|
| 样式层叠 | 21 张应用样式表叠加（§6） |
| 根目录重复产物、超大文件 | 见 §7 |

---

## 5. CRM 销售跟进缺口与本批修复范围

### 5.1 已确认 bug：CRM 活动同步全部永久失败

- 白名单：`src/phase7/service.js` 第 89–95 行 `CRM_OPERATION_FIELDS.UPDATE_ACTIVITY` 只允许 `activity_type, occurred_at, summary, owner, source_reference, external_crm_id`。
- 写入方 1：`src/phase7/repository.js` 约第 1506 行 payload 含 `activity_id, inbound_message_id, classification_id, opportunity_snapshot_id, funnel_status, due_at`。
- 写入方 2：`src/outreach/AutoFirstTouchService.js` 约第 96–97 行同样写入 UPDATE_ACTIVITY outbox。
- 结果：`validateCrmPayload`（第 99–104 行）抛出 `CRM_PAYLOAD_FIELD_FORBIDDEN` → 每次首封/回复的 CRM 同步都进入 PERMANENT_ERROR。
- 状态：**本批修复中**（另一 agent 负责 `services/`）。修复须对已存在的 outbox 行保留历史，只追加重放，不改写。

### 5.2 跟进缺口清单

| 缺口 | 现状 | 依据 |
|---|---|---|
| 任务管理 API | 无 list/assign/complete/reschedule；`sales_tasks` 只由回复自动创建 | `src/phase7/router.js` 仅有 `/api/crm-sync-outbox*` |
| 销售阶段 | `funnel_status` 仅 `CONTACTED/REPLIED/OPTED_OUT/BOUNCED`，无询价/样品/报价/成交 | `database/migrations/053_phase11_oqumail_inbound_crm.sql` 第 93 行 |
| 手工活动记录 | 无（电话、WhatsApp、会议无法录入） | — |
| 逾期提醒 | 无 | — |
| 跟进邮件 | `outreach_drafts.followups` 只存储与校验，从不排期；`auto_followup=false` | §3 第 8 行 |
| 回复分类复核 | 无复核/改判端点 | `src/outreach/inbound.js` |
| 外部 CRM | 仅通用 HTTP，`CRM_BASE_URL` 未配置 | `src/phase7/service.js` 第 1187 行 |
| 回复页面 | `public/ui/v3/replies.js` 只读（无写请求） | — |

### 5.3 本批范围（第一批）

| 交付 | 要点 |
|---|---|
| bug 修复 | 统一 UPDATE_ACTIVITY payload 与白名单 |
| 迁移 064 | 销售阶段（追加，不改 053 约束语义）、阶段历史、手工活动、跟进草稿表；不改写 001–063 |
| `/api/crm/*` | 任务（列表/分配/完成/改期）、阶段推进、活动录入、时间线、回复分类复核、跟进草稿 |
| 跟进草稿扫描队列 | 定时扫描待跟进对象生成**草稿**，必须人工审批后才能进入发送；不改变 MC07 首封行为 |
| 飞书多维表格适配器 | 作为 CRM 同步目标之一，复用现有 outbox/白名单 |
| 生产 UI 接入 | **暂不做**，等 `docs/ui/mockup-v4/` 样稿确认后再接 |

---

## 6. UI 问题与改版方向

### 6.1 现状问题（已重新计数）

| 问题 | 数据 | 依据 |
|---|---|---|
| 样式表堆叠 | `public/index.html` 在 Tabler 之上加载 **21** 张应用样式表：旧版 5（styles/bilingual/contact-results/phase5/phase7）+ phase8×3 + opportunity-workspace + phase10-workbench + phase9-research-workbench + V3×10 | `public/index.html` |
| 旧样式靠 token 别名“换肤” | 旧页面未真正迁移，靠 `ui/v3/tokens.css` 映射旧变量 | `public/ui/v3/tokens.css` |
| token 外原始色值 | 约 **85** 处（styles 27、phase5 32、bilingual 12、contact-results 8、v3/shell 6） | grep 统计 |
| `!important` | **36** 处（分布在 18 行；phase5/styles/v3 foundation 等） | grep 统计 |
| 单文件脚本 | `public/app.js` 2,480 行 / **206 KB** | — |
| 视觉 QA | PARTIAL | §2 |

### 6.2 改版方向：采用 sq-system 风格

参考 `/home/user/minner-965/sq-system/CLAUDE.md` §5：

- 布局：深色侧边栏、白色顶栏、浅灰底、白色圆角业务卡片；总览 = 指标卡 + 漏斗 + 分布图 + 任务进度 + 待跟进线索。
- 克制的商务办公风格：不要蓝紫渐变、发光阴影、闪光动画、装饰性大图标、AI 徽标、假数据、写死百分比。
- 主色 `#2563EB`，中性灰阶为主，状态色只表示状态；字体 `"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif`。
- 流程：先出静态样稿（`docs/ui/mockup-v4/`，进行中）→ Simon 确认 → 再接数据；验收 1440px 与 390px 截图、无横向滚动、键盘可操作、加载/空/错误状态齐全。

### 6.3 与本项目的差异与需同步的规则

| 项 | sq-system | 本项目做法 |
|---|---|---|
| 双语 | 仅中文 | **保留双语**：中文为主，英文较小、灰色 |
| 规则冲突 | — | 现行 `AGENTS.md` 与 `docs/UI_SYSTEM_V3.md` 要求“中英等大等重”。样稿确认后需同步修订这两份规则，否则新 UI 无法通过现行验收 |
| 迁移方式 | — | 新页面按 V4 组件重建，旧 CSS 在 HTML/JS/测试引用全部清零后才删除；不新增覆盖样式表 |

---

## 7. 技术债清单

| 类别 | 项 | 数据 | 建议 |
|---|---|---|---|
| 根目录重复产物 | `final/`、`final_updated/`、`final_updated_v2/`、`final_updated_v3/`、`deliverables/`、`demo_build/`、`n8n_edit_build/`、`management_demo/`、`outputs/` | 前 5 个各约 1.3–1.5 MB | 保留最终版，其余归档到 `docs/history/` 或 release 附件 |
| 根目录计划文件 | `DPV_PHASE*_CODEX_*.md` | **6** 份（原记 7 份，已更正） | 移入 `docs/history/plans/` |
| 超大文件 | `src/server.js` 2,664 行；`src/phase7/repository.js` 2,345 行；`src/phase7/service.js` 1,449 行；`public/app.js` 2,480 行 / 206 KB | — | 按领域拆分路由/仓储（crm、outreach、dataExchange） |
| 大型清单 | `docs/cleanup/CL01_DATABASE_ORCHESTRATION_INVENTORY.json`（约 987 KB）、`CL13_DATABASE_INVENTORY.json`（约 958 KB） | — | 移出主仓或压缩归档 |
| 一次性脚本 | `scripts/` 84 个 + `services/demo-dashboard/scripts/` 5 个 ≈ 89 | — | 区分运维常用与历史一次性，后者归档 |
| 旧测试 | 根目录 `tests/`（phase1–4 acceptance 等）不在 CI；CI 只跑 `services/demo-dashboard` 的 `node --test test/*.test.js` | `.github/workflows/native-and-test.yml` | 迁入或标记归档 |
| 命名 | `phase5.css`、`phase7/`、`Phase13AutomationFacade` 等阶段编号命名 | — | 新代码按领域命名，旧名随重构逐步替换 |
| 服务名 | 生产服务仍叫 `demo-dashboard` | `services/demo-dashboard`、`compose.yaml` | 远期改名（涉及 compose/镜像/文档，需单独计划） |

---

## 8. 对 Gemini 建议的取舍

| 建议 | 结论 | 理由 / 条件 |
|---|---|---|
| 同步回复到 Notion/Airtable/飞书 | **采纳（飞书，本批进行中）** | 复用 CRM outbox + 白名单，先修 §5.1 bug |
| LLM 起草 + LLM 评审质量门禁 | **采纳（下一批）** | 必须保留人工审批、MC04 商机规则、MC07 首封门禁、抑制检查；LLM 只出草稿与评分建议，不得自动发送；按 `docs/LLM_RUNTIME_ACTUAL_STATE.md` 如实标注 |
| 转化指标看板（打开率/回复率/每条合格线索成本） | **部分采纳** | 回复率可由出站与入站表计算；成本可由 `leadgen.provider_usage_events`（迁移 023）汇总。打开率需追踪像素，影响送达率与隐私合规，且 Apple MPP 会造成虚高——建议不做或默认关闭 |
| “169 元首周试用包”（3–5 家广州外贸中小企业，300–500 潜客，1,000 封定制邮件） | **暂缓，需架构变更** | 系统当前为单公司（DPV）：类目范围、模板、发件域、抑制名单、报表都是单租户。多客户试用需租户隔离（数据、配额、发件身份、导出），属于重大改造，应单独立项 |
| 本地/Zeabur 部署 n8n + Google Cloud 凭据 + Gmail/OpenAI 节点 + 轮询 | **不采纳为核心** | pg-boss + 事务 outbox 已负责编排、幂等与审计；核心迁到 n8n 会丢失现有门禁与测试覆盖。n8n 保持可选的协调/对账角色 |

### 批量冷邮件合规提醒

- 现有护栏需保留：50 封/天、1 封/分钟、同公司 30 天冷却、地址级抑制、退订即停。
- 每封必须有退订方式与真实发件身份；遵守 GDPR（欧盟/英国，合法利益评估）、CAN-SPAM（美国）、阿联酋相关电子通信规范。
- 发件域需 SPF / DKIM / DMARC 齐全，并做域名预热。
- **新域名一周发 1,000 封极易进黑名单**，会连带影响 DPV 自身的正常邮件；试用包若推进，应使用独立发件域并逐周放量。

---

## 9. 建议路线图（第二批起）

| 批次 | 内容 | 前置条件 / 验收 |
|---|---|---|
| 第 1 批（进行中） | CRM bug、迁移 064、`/api/crm/*`、跟进草稿队列、飞书适配器、V4 样稿 | 隔离数据库回放迁移 064；零真实 SMTP/Hunter/外部 CRM 调用 |
| 第 2 批 | 生产 UI 迁移到 V4（先总览、回复/跟进、商机），删除被替换的旧样式 | 样稿确认；先修订 `AGENTS.md`/`docs/UI_SYSTEM_V3.md` 双语规则；1440/390 截图对比 |
| 第 3 批 | LLM 起草 + LLM 质量门禁 + 回复意图辅助 | 复用评估登记（`docs/REUSE_CANDIDATE_REGISTRY.md`）；人工审批不可绕过；成本记账 |
| 第 4 批 | 转化指标：回复率、阶段转化、每条合格线索成本 | 基于现有表计算，不做打开追踪 |
| 第 5 批 | 多客户试用包（租户隔离、独立发件域、按客户报表/导出） | 单独架构立项与评审 |
| 并行 | 补齐 live-collection 路由验收 → 打验收标签；按预算分批释放 544 条搜索；重新生成状态快照 | 路由 158/158；恢复前完成待办审查 |
| 并行 | 清理根目录重复产物与计划文件、拆分超大文件、归档旧测试与一次性脚本 | 不删除迁移、审计、发信/回复/抑制历史 |
