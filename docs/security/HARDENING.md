# 安全加固 / Hardening — SIM外贸获客系统

面向开发者。写于 2026-10-24。配合 `docs/handoff/DECISIONS.md`（决定 2）看。

## 威胁模型：客户端逆向（REA 式）

有人可能用 REA（github.com/morluto/rea）这类 AI 逆向分析工具，或浏览器开发者工具，来：

- 下载并阅读我们的前端 JS（`public/`）；
- 观察 `/api/*` 的请求与响应、字段、错误码；
- 抓取网络流量、复制接口调用；

目的通常是**仿制系统**、**找逻辑漏洞**或**绕过前端限制**。

**前端代码挡不住、也不该靠它保密**：任何访问者都能读到前端 JS 和接口形状。真正的防线是——所有安全判定都在服务端。

## 根本原则：安全不依赖前端

系统已满足（本轮再次核验）：

- **鉴权在服务端**：会话中间件 + workspace gate（`src/merchant/auth.js`），商家可访问的路由是服务端白名单 `MERCHANT_ROUTES`，白名单外的 `/api/*` 一律 403 `ADMIN_REQUIRED`。改前端绕不过。
- **数据隔离在服务端**：`src/merchant/scope.js` 的范围过滤按 `merchant_id` 注入每条查询，商家只能读到自己的行；跨商家访问返回 404/空。
- **额度与发信资格在服务端**：月搜索额度、每日发信额度、到期只读、邮箱验证门槛都在服务端判定并返回 409/403。
- **密钥只在服务端**：`SESSION_SECRET`、`MERCHANT_SECRET_KEY` 只从 `.env` 读，绝不下发前端；邮箱密码 AES-256-GCM 加密存库，接口从不回传密码。
- **未打包 source map**：`public/ui/v4/` 下无 `.map`，不额外暴露源码结构（本就是可读的 JS，但不主动提供映射）。

## 本轮（第 5 轮）补齐的层

1. **登录暴力破解防护（持久化）**：迁移 067 `leadgen.login_attempts` 把失败次数入库（按 email 和 ip），8 次/15 分钟触发 429 `AUTH_RATE_LIMITED`；重启和多进程都有效（此前内存限流重启即清零）。未知邮箱也走一次 argon2 verify，消除"邮箱是否注册"的时序差。
2. **跨站写请求保护**：对带会话 Cookie 的 `POST/PUT/PATCH/DELETE /api/*` 校验 `Origin`/`Referer` 主机，同源 + 可配 `ALLOWED_ORIGINS`（容纳 Cloudflare 隧道域名）之外拒 403 `CROSS_ORIGIN_BLOCKED`。webhook / internal-token / `AUTH_REQUIRED=false`（测试、本地）放行。配合 `SameSite=Lax` 会话 Cookie。
3. **安全响应头**（全站，含静态页）：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`（防点击劫持/被套壳仿冒）、`Referrer-Policy`、最小 `Permissions-Policy`、保守 `Content-Security-Policy`；在 TLS（`TRUST_PROXY`）下加 `Strict-Transport-Security`。
4. **错误不泄漏**：生产环境 API 不返回堆栈，只返回结构化 `code` + 通用消息。

## 相关配置（`.env`）

| 变量 | 说明 |
|---|---|
| `AUTH_REQUIRED` | `true`（默认）启用全部登录与跨站保护；`false` 仅供测试/本地开发 |
| `SESSION_SECRET` | 签名会话 Cookie；由安装脚本随机生成，**勿改动**（改了所有人要重新登录） |
| `MERCHANT_SECRET_KEY` | 邮箱密码加密密钥；**勿改动**（改了商家要重新填邮箱密码） |
| `ALLOWED_ORIGINS` | 逗号分隔的额外允许来源主机（如你的 Cloudflare 隧道域名）；同源始终允许 |
| `TRUST_PROXY` | 经隧道/反向代理访问时设 `1`，使 Cookie 走 HTTPS 安全模式并启用 HSTS |
| `SESSION_COOKIE_SECURE` | 默认 `auto`（HTTPS 请求才置 Secure） |

## 上线前自查清单

- [ ] `AUTH_REQUIRED=true`，且未登录时 `/api/auth/me` 返回 401。
- [ ] 管理员密码 ≥12 位、不与其他站点相同；考虑尽快加二步验证（见 `docs/handoff/PLAN.md` 待办）。
- [ ] 经隧道访问时 `.env` 有 `TRUST_PROXY=1`、`ALLOWED_ORIGINS` 含隧道域名；确认响应头里有 HSTS。
- [ ] 用两个商家账号互查：确认看不到对方的机会、客户、任务、回复、草稿、导出。
- [ ] 到期商家只能读不能写；额度用完被 409 拒。
- [ ] 连续错误密码会被 429 锁定，重启服务后仍在锁定窗口内。
- [ ] 浏览器开发者工具里确认：前端从不收到任何密码、密钥；接口对越权请求返回 403/404 而非数据。
- [ ] `.env*` 不在 Git 里（`git status` 不出现）；`git log` 里没有密钥。
- [ ] 定期 `docker compose exec -T postgres pg_dump ...` 备份数据库。

## 不在本轮范围（见 PLAN 待办）

- 管理员/商家二步验证（TOTP）。
- 全局请求限流（当前仅登录限流）。
- CSRF token 双提交（当前靠 SameSite + Origin 校验，足够应对，收费规模扩大后可加）。
- 依赖告警清理（`npm audit` 7 条历史告警，非本轮新依赖引入）。
