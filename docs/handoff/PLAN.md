# 开发计划 / Plan — SIM外贸获客系统

写于 2026-10-23，分支 `claude/gifted-hypatia-59rtaf`。配合 `CONTEXT.md`（现状）、`RULES.md`（规则）、`DECISIONS.md`（本轮决定）一起看。

## 第 5 轮（进行中）

1. **开放 SMTP 465（隐式 TLS），保留 587（STARTTLS），IMAP 仍 993。** 按端口决定加密：465→`secure:true`；587→`secure:false,requireTLS:true`。改 `src/outreach/smtpImapProvider.js`、`src/merchant/MerchantService.js`（saveMailbox / providerConfig）、`src/merchant/mailboxPresets.js`（阿里/腾讯/网易改 465）。加测试。
2. **登录加固（防御性，服务端为准）。** migration 067 `login_attempts`（登录失败次数入库，重启/多进程都有效）；对带会话 Cookie 的写请求做 Origin/Referer 校验（可配 `ALLOWED_ORIGINS`）；加安全响应头（nosniff、X-Frame-Options、CSP frame-ancestors、Referrer-Policy、TLS 下 HSTS）；生产不返回堆栈；未知邮箱也走一次 argon2 verify 防时序枚举。文档 `docs/security/HARDENING.md`。
3. **测试覆盖核查**：确认商家首封（从商家邮箱发出、落款、回复归属、每日额度 409）与商家企业详情/时间线隔离已由 `test/merchant-accounts-postgres.test.js` 覆盖；真实 SMTP 投递留给本机真实收发验收。
4. **交接文档**：本 4 份 `docs/handoff/*.md`。

验收见 `DECISIONS.md`。

## 待办（下一步，按优先级）

### 高
- **上线前真实验收（只有 Simon 本机能做）**：建一个试用商家 → 绑定真实邮箱（测试连接、发测试邮件给自己）→ 给自己发一封首封 → 回复 → 确认回到系统；记一条电话跟进，确认 1 分钟内飞书表出现一行；小批量检索确认能找到企业。
- **小语种检索词母语复核**：de/fr/pt/it/tr 现用 Shopify 官方译名，报告里已标"建议母语复核"；找母语者过一遍采购商类型词。
- **管理员 2FA / 更强登录保护**：正式收费前给管理员账号加二步验证（TOTP），考虑给商家可选开启。

### 中
- **在线支付**：目前管理员手动标记付费。接入支付（如 Stripe / 支付宝）后自动开通/续期，并处理发票。
- **迁到云服务器**：有付费客户后从 Simon 电脑迁到小型云服务器（2 核 4G + Docker），步骤见 `docs/deploy/CLOUDFLARE_TUNNEL.md` 第 4 节；商家使用地址不变。
- **商家自助注册 + 审核**：当前只能管理员开号；可做"申请 → 管理员审核 → 开通"。
- **邮箱发信健康度**：预热、每日上限自适应、退信/投诉率监控、SPF/DKIM/DMARC 指引写进绑定邮箱页帮助。

### 低 / 持续
- 复用登记表 `docs/REUSE_CANDIDATE_REGISTRY.md` 保持更新。
- `npm audit` 的 7 条历史告警择机清理。
- 更多市场/类目的检索词与过滤域名策略调优。
- 企业详情、CRM 看板的指标与图表按真实使用反馈迭代。

## 工作方式提醒

- 复用优先、服务端判定一切安全、测试零真实外部调用、不改已应用迁移（见 `RULES.md`）。
- 非简单任务先计划、拆子任务并行。
- 改了代码记得在 `docs/CURRENT_PROJECT_STATUS.md` 追加一行（CI 要求）。
