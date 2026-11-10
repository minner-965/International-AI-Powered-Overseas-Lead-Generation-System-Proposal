# 本轮决定与测试结论 / Decisions — 2026-10-23

记录 Simon 第 5 轮的两条决定、对测试的回答，以及对应的实现与验收。配合 `PLAN.md` 看。

## 决定 1：开放 SMTP 465

- 背景：系统此前只允许 SMTP 587（STARTTLS）。阿里、腾讯、网易企业邮箱常用 465（隐式 TLS），商家用这些邮箱"测试连接"会失败。
- **Simon：开放 465。** 465 同样是加密连接。
- 实现：按端口选加密方式——465→`secure:true`（隐式 TLS）；587→`secure:false,requireTLS:true`（STARTTLS）。IMAP 仍只 993。阿里/腾讯/网易预设改为 465，Gmail/MS365/Zoho 保持 587。改 `src/outreach/smtpImapProvider.js`、`src/merchant/MerchantService.js`、`src/merchant/mailboxPresets.js`，加测试。

## 决定 2：登录直接加强（抗逆向）

- 背景：Simon 提到有人用 REA（github.com/morluto/rea，MIT 的 AI 逆向分析工具）逆向/仿制 AI 搭的系统，要求加固。
- **威胁模型（核实后）**：REA 这类工具让 agent 去反编译/分析二进制、JS、APK、网站和流量。对我们这种 Web 系统，真实威胁是——有人**下载并阅读我们的前端 JS、观察接口和流量**，用来仿制系统或找逻辑漏洞。前端代码本来就是公开可读的，挡不住也不该靠它保密。
- **根本防线（本系统已满足）**：鉴权、额度、数据隔离、发信资格全部在**服务端**判定，前端只是展示；改前端 JS 绕不过服务端。密钥（`SESSION_SECRET` / `MERCHANT_SECRET_KEY`）只在服务端，绝不下发前端；未打包 source map。
- **本轮补齐的几层**：
  1. 登录失败次数入库（migration 067 `login_attempts`），重启和多进程都有效，防暴力破解。
  2. 带会话 Cookie 的写请求做 Origin/Referer 校验（可配 `ALLOWED_ORIGINS` 容纳 Cloudflare 隧道域名），防跨站伪造请求。
  3. 安全响应头：`X-Content-Type-Options:nosniff`、`X-Frame-Options:DENY` + CSP `frame-ancestors 'none'`（防点击劫持/被套壳仿冒）、`Referrer-Policy`、`Permissions-Policy`、TLS 下 `Strict-Transport-Security`。
  4. 生产环境 API 不返回堆栈；未知邮箱也走一次密码校验，消除"这个邮箱是否注册"的时序差。
- 详见 `docs/security/HARDENING.md`（含自查清单）。
- 说明：我**没有**对任何系统运行 REA 做攻击性逆向；这里只做防御加固。正式收费前建议再加管理员二步验证（见 `PLAN.md` 待办）。

## 对"要不要 Simon 模拟商家测试第 1、2 点"的回答

上一轮列出的两处未验证：① 商家首封从头到尾发出；② 商家视角的企业详情页。

- **逻辑不用你手动测**：自动化 Postgres 测试已覆盖——① 商家首封从商家邮箱发出、落款是商家名/公司、回复归到该商家、每日发信额度用完被 409 拒（见 `test/merchant-accounts-postgres.test.js`）；② 商家只看得到自己企业的详情与时间线，别的商家返回 404。唯一没进自动化测试的是"真实 SMTP 把邮件投递出去"这一步——云端不做真实外部调用，这恰好就是下面只有你能做的真实收发验收。
- **只有你能做的（上线前最终验收）**：云端从不做真实邮件调用。装好后在你电脑上：
  1. 建一个试用商家；
  2. 绑定一个**真实邮箱**，点"测试连接"、"发一封测试邮件给自己"，确认收到；
  3. 给自己（另一个邮箱）发一封首封，回复它，确认回复回到系统里这家企业的跟进记录；
  4. 记一条电话跟进，确认约 1 分钟内飞书多维表出现一行；
  5. "研究任务"选 1 市场 + 1 类目，确认能找到企业。
  这几步真实收发全绿，才算可以给真实商家试用。

## 本轮验收标准

- `npm test` 全绿（`current-project-status` 快照除外，追加状态行即通过）。
- Postgres：migration 067 新装/升级可执行；登录锁定在"重启"后仍生效；商家首封与企业详情用例通过；保存 465 邮箱时 `providerConfig` 返回 `secure:true`，587 仍 STARTTLS。
- 外站 Origin 的写请求被拒；安全响应头存在。
- 零真实外部调用。

## 第 4 批 发信送达率（2026-11-10，按优化方案第四节，Simon 已批准"其余我直接做"）

- **D1 退订**：邮件头早已有一键退订（`List-Unsubscribe` + `List-Unsubscribe-Post`）；现在每封开发信和跟进信签名下方再加一行可见文字："If you would prefer not to receive further emails from us, just reply "unsubscribe" and we will not contact you again." 对方回复 unsubscribe 会被识别为退订。已审定的模板正文没改。
- **D2 域名检查**：绑定邮箱页和设置页显示发信域名的 SPF、DKIM（只查常用选择器）、DMARC 是否设置，缺的给出设置方法。只提醒，不拦截发信。
- **D3 自动暂停**：某个邮箱最近 100 封（从上次恢复算起）里出现投诉，或硬退信超过 3%（且至少 2 封），就暂停这个邮箱——SIM 的通过关闭"自动发送开发信"，商家的只暂停该商家。暂停期间首封、跟进、手动首封都不发。"测试连接"成功不会解除这种暂停，必须有人点"恢复发信"（商家在绑定邮箱页，Simon 在设置页；SIM 自己的是重新打开自动发送开关），恢复后从零重新统计。每次暂停/恢复都留记录（迁移 077，只追加）。
- **D4 逐步放量**：自动首封每个邮箱首周每天最多 10 封，之后每天多 1 封（仍受每日额度限制），两封至少间隔 15 分钟。人工批准的跟进不受放量限制。
- 参数在 `.env.example` 的 `SENDER_*`。
- 顺手修了一个第 1 批遗留问题：浏览器端的商家接口白名单漏了"自动发送开发信"开关的接口，商家点开关会被拦下；现在两份白名单一致，并有测试保证以后不再分叉。
