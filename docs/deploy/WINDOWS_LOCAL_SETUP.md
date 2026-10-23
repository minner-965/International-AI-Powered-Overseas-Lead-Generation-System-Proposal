# 在 Windows 电脑上安装 SIM外贸获客系统

适用：Windows 10/11，已装 Docker Desktop。全新安装、空数据库。所有密钥只保存在这台电脑的 `.env*` 文件里，不进 Git。

## 0. 用 Claude Code 桌面端在这台电脑上操作

云端会话控制不了你的电脑。要让 Claude 在电脑上执行下面的步骤：
1. Claude Code 桌面端 → 新建会话 → 环境选 **本地（Local）**，文件夹选 `E:\claude`。
2. 在那个会话里说："克隆 `https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal` 的 `claude/gifted-hypatia-59rtaf` 分支，按 `docs/deploy/WINDOWS_LOCAL_SETUP.md` 安装"。

也可以自己在 PowerShell 里按下面做。

## 1. 下载并安装

```powershell
New-Item -ItemType Directory -Force E:\claude | Out-Null
cd E:\claude
git clone -b claude/gifted-hypatia-59rtaf https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal.git SIM
cd SIM
powershell -ExecutionPolicy Bypass -File scripts\local-setup.ps1
```

以后更新：在 `E:\claude\SIM` 里 `git pull`，再运行一次 `scripts\local-setup.ps1`（数据保留）。

脚本会：检查 Git 和 Docker → 生成 `.env`、`.env.phase2`（随机数据库密码和内部令牌）、`.env.phase7-outreach`、`.env.phase7-api` → 构建并启动数据库、工作台和后台任务 → 等工作台能打开 → 登记或执行数据库迁移 → 列出可批准的供应类目。完成后打开 **http://localhost:3000**。

可以重复运行：已有的 `.env*` 会保留，数据库不会被清空。更新后再运行时，脚本会执行新增的数据库迁移并重启服务。

端口 3000 已被其他程序占用时，脚本会停下并提示：在根目录 `.env` 里把 `DASHBOARD_PORT=3000` 改成空闲端口（例如 `DASHBOARD_PORT=3100`），再运行一次脚本，之后用 http://localhost:3100 打开。`setup-supply-categories.mjs` 也会自动使用这个端口。

## 2. 批准供应类目（新装必做）

新库没有已批准的供应类目，系统不知道要找哪类客户。先看候选：

```powershell
node scripts\setup-supply-categories.mjs --list
```

当前决定：**女装全品类 + 百货**，即批准全部候选：

```powershell
node scripts\setup-supply-categories.mjs --all
```

只做部分类目时用 `--categories WOMENSWEAR:DRESSES,WOMENSWEAR:TOPS` 这种写法。

（电脑没装 Node.js 时，把 `node scripts\` 换成 `docker compose exec -T demo-dashboard node project-scripts/`，并加 `--base http://127.0.0.1:3000`。）

市场默认已开放 阿联酋 AE、墨西哥 MX；其他国家在工作台 系统设置 → 目标市场 里打开。

## 3. 填写凭证

| 用途 | 文件 | 变量 |
|---|---|---|
| 搜索客户 | `.env.phase2` | `EXA_ENABLED=true`、`EXA_API_KEY`；备用 `TAVILY_API_KEY` |
| 核验商务邮箱 | `.env`（根目录这个文件） | `HUNTER_MODE=FREE_FIRST`、`HUNTER_API_KEY`（这两项由 compose 从 `.env` 读取，写在其他文件不生效） |
| 发信与收回复 | `.env.phase7-outreach` | `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM_EMAIL`、`SMTP_REPLY_TO`（与 `SMTP_USER` 相同）、`SMTP_UNSUBSCRIBE_EMAIL`、`SMTP_MESSAGE_ID_DOMAIN`（你的邮箱域名）、`IMAP_HOST`、`IMAP_USER`、`IMAP_PASSWORD`。要求 SMTP 587 STARTTLS、IMAP 993 TLS |
| 飞书跟进表 | `.env.phase7-outreach` | 见 `docs/crm/feishu/飞书配置步骤.md` |
| 跟进邮件草稿 | `.env.phase7-outreach` | `CRM_FOLLOWUP_DRAFTS_ENABLED=true`（模板审定后） |

改完后让设置生效：

```powershell
docker compose up -d --force-recreate demo-dashboard category-worker outreach-worker data-worker
```

## 4. 上线前验证（按顺序）

1. **发信测试**：在 `.env.phase7-outreach` 保持 `SMTP_CONTROLLED_TEST_MODE=true`，`SMTP_CONTROLLED_RECIPIENT_ALLOWLIST=你自己的另一个邮箱`，`SMTP_ENABLED=true`，只给自己发一封，确认收到、落款是 SIM International、回复后系统里出现回复。
2. **小批量检索**：工作台"研究任务"里选 1 个市场 + 1 个类目，确认能找到企业。
3. **飞书**：记一条电话跟进，1 分钟内飞书表出现一行。
4. 都正常后再把 `SMTP_CONTROLLED_TEST_MODE=false`、`SMTP_USE_CASE_APPROVED=true`，在工作台"系统设置"打开自动化。每天发信上限默认 50 封。

## 5. 日常命令

```powershell
docker compose ps                      # 看各服务状态
docker compose logs --tail 80 outreach-worker
docker compose stop                    # 停止（数据保留）
docker compose up -d postgres demo-dashboard category-worker outreach-worker data-worker   # 再启动
git pull                               # 更新代码后再执行 local-setup.ps1
```

备份数据库：

```powershell
docker compose exec -T postgres pg_dump -U leadgen_app -d lead_generation -Fc > backup_$(Get-Date -Format yyyyMMdd).dump
```

## 6. 已验证 / 未验证

- 云端演练（2026-10-22）：全新数据库执行全部 64 个迁移 → 登记迁移账本 → 启动工作台 → 13 个页面桌面和手机宽度均可打开 → 批准 4 个类目后生成检索计划（2 市场 × 4 类目 = 168 条检索）→ CRM 改阶段、记电话、任务、跟进草稿批准、飞书写入（本地模拟）均正常。详见 `docs/review/2026-10_CLOUD_REHEARSAL.md`。
- 安装脚本：云端用 PowerShell 7 实测到"生成配置文件"一步；**Docker 构建与启动部分只能在你的电脑上第一次运行时验证**。
- 真实发信、真实收信、真实飞书、真实搜索与 Hunter：**都未在云端调用**，按第 4 节在电脑上验证。
