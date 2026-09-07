# Phase 11 首轮执行结果 — WP-C00 / WP-C01

执行日期：2026-09-05。内部工程验收记录。

| 工作包 | 结果 |
|---|---|
| WP-C00 → 附件正式编号 WP-P11-00 | PASS |
| WP-C01 → 附件正式编号 WP-P11-01 | BLOCKED_PROVIDER_IDENTITY_UNKNOWN |
| Phase 11 技术闭环 / 业务试点 | BLOCKED / BLOCKED；尚未执行 |
| Phase 11 最终验收 | INCOMPLETE |

依据用户指定的 `DPV_PHASE11_CONTROLLED_OUTREACH_REPLY_CRM_FINAL_DEMO_COMPLETION_CODEX_PLAN_V1_0.md` 第一轮范围。用户所写 C00/C01 在附件正文对应 P11-00/P11-01。当前工作停在邮箱身份确认，未进入 P11-02。

## 执行与 Git 基线

- 唯一项目根目录：`D:/codex/International-AI-Powered-Overseas-Lead-Generation-System-Proposal`。
- 分支：`phase10-remove-internal-limits-20260904-112916`。
- 开始 HEAD：`44f5b65753c4d32008c6637684afb2be1da342b1`；首次 `git status --porcelain=v1` 和 `git diff --check` 输出均为空。
- 开始工作区干净；结束时新增本轮审计脚本、报告和状态合同修改，尚未提交。未 stash、reset、清理工作区、push 或创建 tag。
- 当前实现提交仍为 `ce5696e2586cd5e47c8284a6192af992d33ed835`；后续文档提交形成上述开始 HEAD，两者含义不同。
- 规划按“主库只读快照 / 独立规则审计 / 邮箱依据盘点 / 隔离迁移验证”并行分工。本轮是基线验证与决策文件交付，没有邮件系统实现。

## 迁移验收

实际最新迁移是 **051**，不是附件示例中的 050。001–051 共 51 份 SQL 的 SHA256 与开始 HEAD 字节完全一致，本轮未修改 SQL。

| 检查 | 实际结果 |
|---|---|
| 主库迁移账本 | 024–051，28 条，全部 checksum 匹配 |
| 001–023 | 原有初始化阶段没有逐文件 ledger；仅记录真实 Git 字节比较与空库执行结果，未补造账本 |
| 独立空库重建 | 001–051 全部成功 |
| 049 重放 | `SKIPPED_ALREADY_APPLIED`，结构验证通过 |
| 050 重放 | `SKIPPED_ALREADY_APPLIED`，结构验证通过 |
| 重放前后测试账本 | 完整相同 |
| 主库 049/050/051 已安装结构 | 在 `READ ONLY` 事务中调用现有只读验证函数，全部通过 |
| 临时测试库 | 已删除并查证不存在；未复制公司业务数据 |
| 下一个可用编号 | 本次快照为 052，今后仍需按实际最新编号计算 |

049 SHA256：`e16c236f371a3d03872e5a2ade235e81004646f67fd85b7db07460f473b68081`。

050 SHA256：`18a9c4568c4168cd83ca4206b589752a99952c3c577784b1a9f83f075ddf2e5d`。

051 SHA256：`e7769fd806f2f16a004288d1fa10d55cb3cd3215cdf681624e33031fb7cec2fc`。

重放发生在独立测试库。主库只检查现有账本和结构，没有应用任何迁移。

## Phase 10.1 当前业务规则

当前路径为：批准类目 → 公司经营类目匹配 → 联系人或官方公司联系方式 → Opportunity。

- 官方类目匹配无需采购公告、供应商门户、精确 SKU 或 Product Profile。
- 当前代码无 `PRODUCT_SCOPE_REQUIRED`。
- 旧 `CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE` 仅保留历史兼容映射；049 应用后新写入数为 **0**。
- 当前采购 / Supplier / 商品旧硬阻断任务为 **0**。
- 活跃官方采购路径人工任务为 **0**；049 后新建任务为 **0**，数据库禁止此类新增 INSERT。
- 当前机会旧硬阻断码为 **0**。
- 41 项相关现有回归测试全部通过，0 失败、0 跳过。
- 已运行容器的 141 个源代码及前端文件与本地逐文件 SHA256 一致，测试代码与部署代码相符。

代码依据：`src/phase7/opportunityDecision.js`、`src/categoryProcurement/categoryProcurementMatch.js`、`productOpportunity.js`、`targetCategoryContext.js`、`categoryMatchStatus.js`、`src/autoEvidence/AutoEvidenceOrchestrator.js`（均位于 `services/demo-dashboard`）。历史 Supplier Access 展示映射及策略 ID 仍存在，但未作为当前硬门槛或人工任务入口。

已运行测试：`phase10-1-company-category-rule`、`phase10-1-b03-b05-category-contact-flow`、`phase10-a04r1-category-driven-flow`、`phase10-2-category-admission`、`phase10-1-b06-b08-cleanup-dispatch-ui`。本轮未重跑全量测试或启动新业务研究。

## 主库快照与零发送冻结

以下数值来自 2026-09-05 10:35–10:36（Asia/Shanghai）两次只读事务，两次业务计数与邮件副作用计数一致。

| 对象 | 数量 |
|---|---:|
| companies | 129 |
| sources | 364 |
| contacts | 113 |
| lead_reviews | 93 |
| collection_runs | 13 |
| research_jobs | 425 |
| 当前公司／类目机会 | 32 |
| decision_makers / decision_maker_contacts | 12 / 83 |
| 公司当前联系渠道 | 83 |
| auto_evidence_tasks | 109 |
| provider_usage_events | 627 |
| 活跃 ResearchJob | 0 |

以下逐表实际计数全部为 **0**：管理事件、营销内容批准、触达草稿、逐封批准、outbound messages、outbound attempts、email message events、webhook inbox、inbound messages、reply classifications、联系人及公司 suppression、CRM outbox、sales tasks、Gmail ambiguous-send events、Gmail mailbox checkpoints。

Provider 使用账本只有 Tavily 搜索：627 条事件、619 已用单位。邮件 Provider 调用事件为 0。

Dashboard 和 outreach worker 均为：

```text
OUTBOUND_EMAIL_PROVIDER=NONE
GMAIL_API_ENABLED=false
GMAIL_INBOUND_SYNC_ENABLED=false
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
```

`GMAIL_CONTROLLED_TEST_MODE=true` 是已有偏好，未更改；上述关闭门槛仍生效。category/data worker 没有设置这组邮件变量，原始快照使用 null，如实区别于显式 false。

Dashboard、category/data/outreach worker、PostgreSQL 健康，n8n 运行中；首页及 `/api/health` 均 HTTP 200。本轮未修改服务、DNS、OAuth、n8n 或共享源文件。

## 当前机会与邮箱候选

口径：按当前公司／类目机会计数，同一公司多个类目分别计数；共涉及 25 家公司。完整逐机会 ID 清单保留在本地忽略的审计目录。

| 分类 | 机会数 |
|---|---:|
| RECOMMENDED | 2 |
| EVIDENCE_REQUIRED | 28 |
| NOT_SUITABLE | 2 |
| MANAGEMENT_APPROVED | 0 |
| 有已验证实名人员关联邮箱 | 0 |
| 有官网来源邮箱 | 13 |
| 只有电话 / WhatsApp / Form | 3 |
| 没有当前联系渠道 | 16 |
| suppressed / 历史成交客户 / 历史待核实 | 0 / 0 / 0 |
| RECOMMENDED 且有官网来源邮箱 | 2 |
| EMAIL_SEND_ELIGIBLE_CANDIDATES | **0** |

83 条当前渠道中，20 条邮箱（9 BUSINESS_EMAIL、11 GENERIC_BUSINESS_EMAIL）均为 `OFFICIAL_SITE_OBSERVED / NOT_VERIFIED`；另外 24 电话、11 WhatsApp、28 Form。旧 contacts 表中有邮箱的 39 条记录为 34 `DOMAIN_MX_VERIFIED`、5 `PUBLICLY_OBSERVED`。两类存储都没有当前邮箱级验证通过的证据。

因此“推荐”与“邮箱发送资格”分开：现行 `evaluateContactVerification` 要求有效且在 30 天内验证的邮箱，MX 或官网出现本身不足以通过。这里仅做零候选盘点，没有持久化新的 eligibility、选择收件人或批准机会。未来 P11-04 仍需补齐官方公司邮箱与实名 Buyer 的独立发送合同；现有邮件 gate 的 Buyer route 要求保留为后续待办。

## Provider 决策与 STOP

详见 `PHASE11_EMAIL_PROVIDER_DECISION.md`。历史发件及 Reply-To 选择为公司 `info@dpvinternational.com`。目前邮箱宿主、账号类型、管理员、许可、Send As 与回复监控责任尚未形成可靠确认，状态为 `BLOCKED_PROVIDER_IDENTITY_UNKNOWN`。

Gmail API 是待身份确认后的首选复用路径；**正式 Provider 尚未选定**。未启动 Graph、Zoho 或 SMTP/IMAP 的实现。

本轮结果：C00 PASS，C01 完成资料盘点和决策记录但验收 BLOCKED。等待邮箱管理员身份依据，STOP；P11-02 及以后未启动。

## 文件与复核入口

- `scripts/phase11-readonly-baseline.mjs`：主库 repeatable-read/read-only 快照、文件 checksum、部署代码和开关检查。
- `scripts/phase11-c00-migration-replay.mjs`：独立空库重建与 049/050 重放，保护主库并核验临时库清理。
- 本地原始证据：`artifacts/phase11-controlled-outreach/2026-09-05T02-35-23-699Z/`、`2026-09-05T02-36-27-392Z/`。
- 独立重放结果：`artifacts/phase11-controlled-outreach/wp-c00-migration-replay-result.json`。
- `CURRENT_PROJECT_STATUS.md` 及其 schema/validator 已同步 Phase 11 首轮边界；历史 Phase 10 通过结论保留。
- 当前状态验证脚本 PASS，`git diff --check` 通过。
- 审计目录加入 Git ignore。报告不包含客户收件地址、凭据或邮箱正文。
