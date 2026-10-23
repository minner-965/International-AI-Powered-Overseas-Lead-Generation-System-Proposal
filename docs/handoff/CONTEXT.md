# 上下文记忆 / Context — SIM外贸获客系统

给接手的开发者（本地 Claude Code / Codex）：系统是什么、做到哪、怎么跑、关键文件在哪。写于 2026-10-23，分支 `claude/gifted-hypatia-59rtaf`。

## 1. 系统是什么

面向中小外贸公司的 **AI 海外获客系统**：按批准的商品类目和目标市场在网上找潜在海外客户企业 → 评估类目匹配度 → 核验商务邮箱 → 发开发信（首封 + 跟进）→ 收回复、做 CRM 跟进 → 可导出、可同步飞书多维表。

Simon 是运营者兼管理员，把系统开成**商家账号**给外贸公司试用（7 天）、满意再付费（见 `RULES.md` 第 3 节）。

## 2. 技术栈

- 后端：Node 22/24 + Express 5，PostgreSQL 17（生产）/ 16（本地测试簇），pg-boss 任务队列。
- 前端：原生 JS + 单一样式表 `services/demo-dashboard/public/ui/v4/app.css`（V4 设计体系），无前端框架。
- 部署：Docker Compose（本系统项目名 `dpv-leadgen`；同机 sq-system 是 `hz-leasing`，数据互不影响）。
- 搜索提供方：本地 **SearXNG**（免费，优先）→ Exa → Tavily（付费兜底），另有 Brave / DataForSEO。顺序由 `SEARCH_PROVIDER_ORDER` 控制。
- 登录：express-session + connect-pg-simple（会话存库）+ @node-rs/argon2（密码哈希）。
- 邮箱密码：Node 内置 AES-256-GCM 加密，密钥 `MERCHANT_SECRET_KEY` 只在 `.env`。
- 对外访问（商家外网登录）：Cloudflare Tunnel（cloudflared）。

## 3. 四轮做了什么（到 2026-10-23）

- **前期（Phase 5–13 / MC00–07）**：研究批次与检索计划、类目评分、商务邮箱 Hunter 核验、首封/自动首封、回复桥接、机会池、联系就绪度。大量历史阶段记录在 `AGENTS.md` 和 `docs/` 里。
- **第 1–2 轮**：把品牌从 DPV 全量改名为 SIM；V4 UI 改版（深色侧栏 + 白顶栏 + 浅灰画布，桌面和手机双端）；首封模板落款改 SIM International。
- **第 3 轮**：CRM 销售跟进——管道阶段、阶段历史、电话/任务/时间线、跟进邮件草稿（需人工批准再发）、飞书多维表写入（migration 064）；全球市场与类目、搜索成本上限（migration 065）。
- **第 4 轮**（本会话）：
  - 端口冲突修复：本系统用 **3100**，sq-system 用 3000，两套可同时跑。
  - **SearXNG** 本地搜索，免费优先、失败自动换付费。
  - 4 项优化：de/fr/pt/it/tr 类目检索词用 Shopify 官方译名；总览"本周 x 封 · 上周 y 封"；跟进审批今日额度条；企业详情按设计稿重排。
  - **商家账号**（migration 066）：登录、7 天试用、管理员商家管理（建号/延期/标记付费/停用/重置密码/额度/功能开关/推荐）、商家自助（绑定邮箱 + 测试连接 + 发测试邮件、选类目、选市场、引导清单）、按商家数据隔离与额度、每页悬停说明与意见反馈。
- **第 5 轮**（进行中，见 `PLAN.md` 和 `DECISIONS.md`）：开放 SMTP 465、登录加固（migration 067）、补测试覆盖、交接文档。

## 4. 迁移（database/migrations/）

- 到 066 为止已应用：`064_crm_followup_pipeline`、`065_global_markets_categories_search_cost`、`066_merchant_accounts`。
- 066 建的表（schema `leadgen`）：`merchants`、`workspace_users`、`merchant_mailboxes`、`merchant_scope`、`merchant_feedback`、`workspace_sessions`、`merchant_companies`；业务表加了 `merchant_id`（空 = SIM 自己）。
- 迁移执行器：`services/demo-dashboard/src/phase7/migrationRunner.js`，支持 `--apply` 和新装用的 `--baseline`。
- 新装时 PostgreSQL 的 init 脚本已包含全部迁移文件，`--baseline` 只登记账本；已有库则走 `--apply`。

## 5. 关键文件地图（services/demo-dashboard/）

- `src/server.js`：Express 入口；挂载各路由、`/api/health`（返回 `service:"sim-leadgen"`）、队列处理器。
- `src/merchant/`：商家与登录全套。`MerchantService.js`（账号/认证/邮箱/额度/scope）、`auth.js`（session 中间件、workspace gate、商家可访问路由白名单 `MERCHANT_ROUTES`）、`router.js`（/api/auth、/api/admin/merchants、/api/merchant/*、/api/feedback、登录限流）、`scope.js`（数据隔离过滤）、`secretBox.js`（AES-256-GCM）、`mailboxPresets.js`（常见邮箱预设）、`referenceNames.js`（市场/类目中文名）。
- `src/outreach/`：发信收信。`smtpImapProvider.js`（nodemailer + imapflow 适配器，587/465 传输契约）、`firstTouchTemplates.js`（首封三套模板）。
- `src/crm/`：CRM 管道、跟进草稿模板、飞书多维表适配器、crm-outbox 分发。
- `src/search/`：搜索提供方与路由（`SearxngSearchProvider.js`、容量路由）。
- `public/`：前端。入口 `index.html`、`login.html`；模块在 `public/ui/v4/*.js`；样式 `public/ui/v4/app.css`。商家相关：`login.js`、`account.js`、`mailbox.js`、`merchant-scope.js`、`merchants-admin.js`、`onboarding.js`、`session.js`、`toast.js`。
- `scripts/`（仓库根）：`local-setup.ps1`（Windows 一键安装）、`setup-supply-categories.mjs`（批准类目，需管理员登录）；`services/demo-dashboard/scripts/create-admin.mjs`（建/重置管理员，`--check` 查是否存在）。
- `docs/`：`CURRENT_PROJECT_STATUS.md`（CI 要求随代码更新）、`deploy/WINDOWS_LOCAL_SETUP.md`、`deploy/CLOUDFLARE_TUNNEL.md`、`review/2026-10_MERCHANT_API_CONTRACT.md`（前后端接口约定）、`ui/mockup-v4/`（设计稿）、`ui/v4-implementation/screenshots/`（截图）、`REUSE_CANDIDATE_REGISTRY.md`。

## 6. 本地怎么跑（Windows + Docker Desktop）

```powershell
cd E:\claude\SIM        # 或你的克隆目录
git pull
powershell -ExecutionPolicy Bypass -File scripts\local-setup.ps1
```
脚本：检查 Git/Docker → 生成 `.env*`（随机数据库密码、`SESSION_SECRET`、`MERCHANT_SECRET_KEY`、`SEARXNG_SECRET`）→ 构建并启动 postgres / searxng / 工作台 / 后台任务 → 等工作台应答（校验 `service=sim-leadgen`）→ 登记或执行迁移 → 首次运行请你建管理员。完成后开 **http://localhost:3100** 登录。批准类目：`node scripts\setup-supply-categories.mjs --all --email <邮箱> --password <密码>`。

凭证都在本机 `.env*`，见 `docs/deploy/WINDOWS_LOCAL_SETUP.md` 第 3 节。真实发信/收信要填 `.env.phase7-outreach`（SMTP 587 STARTTLS 或 465 TLS、IMAP 993 TLS）。

## 7. 测试

- 全量：`cd services/demo-dashboard && npm test`（当前约 1340 条）。唯一"预期可忽略"的失败是 `current-project-status`（状态文件要随代码更新，追加一行即可）。
- 需真实数据库的 Postgres 测试（文件名含 `-postgres`）靠环境变量开启，例：`MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/merchant-accounts-postgres.test.js`。没设就自动跳过。
- 测试不碰真实外部服务（见 `RULES.md` 第 2 节）。

## 8. 还没验证 / 已知弱点

- 商家首封真实发信、真实收信、真实飞书、真实搜索与 Hunter：云端从未真实调用，须在本机验证。
- 登录防护第 5 轮加固前较基础（内存限流、无 CSRF、无安全响应头）——第 5 轮解决，见 `DECISIONS.md`。
- `npm audit --omit=dev` 有 7 条历史告警（非本轮新依赖引入）。
- 阿里/腾讯/网易企业邮箱常用 465，第 5 轮开放。
