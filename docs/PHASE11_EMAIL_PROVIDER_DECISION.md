# Phase 11 公司邮箱 Provider 决策

记录日期：2026-09-05。工作包 WP-C01 / WP-P11-01。

**状态：PROVIDER_CONNECTIVITY_SMOKE_PASS。** 已选择 OquMail SMTP/IMAP 作为公司邮箱连接方式；SMTP 与 IMAP 登录、SMTP 接受及受控外部邮箱收件均已通过。完整应用闭环尚未验证。

| 合同字段 | 本轮结论 |
|---|---|
| SELECTED_PROVIDER | SMTP（OquMail SMTP/IMAP） |
| PREFERRED_PROVIDER | OquMail：SMTP 587 + STARTTLS，IMAP 993 + TLS |
| REJECTED_ALTERNATIVES | Gmail API：保留为历史适配器但不作为本邮箱连接路径；Graph / Zoho：未选用 |
| WHY | 公司已提供 OquMail 服务器参数；现有后台已增加 SMTP/IMAP 适配器与独立连接检查入口 |
| MAILBOX_TYPE | Company Webmail mailbox |
| FROM | 由私密本机配置 `SMTP_FROM_EMAIL` 提供 |
| REPLY_TO | 由私密本机配置 `SMTP_REPLY_TO` 提供 |
| ADMIN_OWNER | UNKNOWN |
| DNS_OWNER | UNKNOWN |
| OAUTH_PATH | 不适用；使用 OquMail mailbox 用户名与 Webmail 密码 |
| INBOUND_PATH | IMAP 连接参数已配置；自动收件、回复分类及 CRM 同步仍保持关闭，待后续工作包实施 |

## 人工事实确认表

| 需要确认的事实 | 当前状态 |
|---|---|
| mail_host_provider | UNKNOWN；历史 MX 指向 Google，尚未确认实际租户 |
| workspace / tenant owner | UNKNOWN |
| administrator identity | UNKNOWN |
| sender mailbox | 历史选择 info@dpvinternational.com |
| sender mailbox type | UNKNOWN；需区分 LICENSED_USER / ALIAS / SHARED_MAILBOX / GROUP / FORWARD_ONLY |
| 是否可独立登录 / 是否 Workspace user | UNKNOWN；此前登录未成功 |
| mailbox license | UNKNOWN |
| OAuth Client 创建及用户授权权限 | UNKNOWN |
| 可否使用该地址 Send As | UNKNOWN |
| reply-to mailbox | 历史选择 info@dpvinternational.com |
| reply monitoring owner | UNKNOWN |
| DNS administrator | UNKNOWN；DNS 服务商不等于管理员身份 |
| business use approved | UNKNOWN；没有逐个用途审批事实 |

私密配置只保存于本机忽略文件 `.env.phase7-outreach`；文档、代码库和导出文件均不记录邮箱密码。

## 来源与证据强度

1. `docs/history/phase10/PHASE10_WP16_GMAIL_DNS_ACCEPTANCE_RESULT.md`：历史 From/Reply-To 选择、Google 登录失败、OAuth 未配置；历史 MX 为 `smtp.google.com`。DNS 结果是历史记录，本轮未重新检测 DNS，更未用 MX 推定账户 license、alias 或管理权限。
2. `docs/history/phase10/DPV_PHASE10_CURRENT_MASTER_HANDOFF.md`：已有 Gmail 实现、历史发件身份和未配置 OAuth 的交接依据。
3. `docs/history/phase10/PHASE10_WP15_GMAIL_API_PROVIDER_RESULT.md`：邮箱身份、Send As、回复监控人及 OAuth 授权仍需确认。
4. 2026-09-05 runtime 快照：实际发送 Provider=NONE，outreach 及 live prospect 开关均关闭。SMTP/IMAP 只支持显式的只读连接检查，不发送邮件。

## 现有能力复用

- `services/demo-dashboard/src/outreach/smtpImapProvider.js`：OquMail SMTP/IMAP 连接契约、只读连接检查、受控发送适配器和幂等 Message-ID。
- `services/demo-dashboard/src/outreach/providers.js`：Provider factory 中的 SMTP 适配器选择与用途限制。
- `services/demo-dashboard/src/phase7/service.js`：发送 Provider 与连接检查 Provider 分离，防止连接检查改变发送状态。
- `services/demo-dashboard/src/phase7/router.js`：`GET /api/outreach/smtp/health` 与显式 `POST /api/outreach/smtp/health-check`。

运行依赖：`nodemailer` 用于 SMTP STARTTLS，`imapflow` 用于 IMAP TLS。端口 587 固定为 `secure=false` 与 `requireTLS=true`；端口 993 固定为 TLS。真实连接检查已经通过；该检查不会发送邮件。

## 本轮停止位置

WP-P11-01 Provider 决策、后台连接检查和受控收件 smoke 已完成。发送、自动收件、回复分类与 CRM 同步均未启用。
