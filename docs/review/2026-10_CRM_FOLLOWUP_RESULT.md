# CRM 销售跟进 — 第一批结果（2026-10-22）

分支 `claude/gifted-hypatia-59rtaf`。开发者文档，可含技术术语。

## 本批完成

| 项 | 内容 | 位置 |
|---|---|---|
| 同步 bug 修复 | 回复和首封邮件写入的 `UPDATE_ACTIVITY` 只放白名单字段；已排队的旧记录在同步时折叠内部 ID，不改写历史 | `src/crm/outboxPayloads.js`、`src/phase7/repository.js`、`src/outreach/AutoFirstTouchService.js`、`src/phase7/service.js` |
| 迁移 064 | 销售阶段 `pipeline_stage`（NEW→CONTACTED→REPLIED→QUOTED→SAMPLE→NEGOTIATING→WON/LOST）+ 触发器自动推进早期阶段并写 `opportunity_stage_history`；手动活动类型 CALL/WHATSAPP/MEETING/NOTE/EMAIL_MANUAL；`crm_followup_drafts`；`outbound_messages.followup_draft_id` 作为第三种发信授权来源；`crm_sync_outbox.external_record_id` | `database/migrations/064_crm_followup_pipeline.sql`、`src/phase7/migrationRunner.js` |
| CRM 接口 | 见下表，全部走现有登录与角色；维护只读模式下写接口返回 503 | `src/crm/router.js`、`service.js`、`repository.js` |
| 跟进邮件 | 首封后第 4 / 9 天未回复、未退订、阶段仍在 NEW/CONTACTED 时生成草稿（待批准）。批准后进入发送队列；发送前再查会话、退订、每日额度（与首封合计）和邮件总开关；带 `In-Reply-To/References` 指向首封，回复能关联回原会话；发送失败自动暂停邮件 | `src/crm/followupTemplates.js`、`service.js` |
| 飞书多维表格 | `CRM_PROVIDER=feishu` 时每条同步记录追加一行到飞书表（只追加，不改旧行），`client_token` 防重复，记录 ID 回写；列名在配置文件里改 | `src/crm/feishuBitableAdapter.js`、`config/crm/feishu-bitable-map.json` |
| 设计稿 | sq-system 风格，6 页，1440/390 截图 | `docs/ui/mockup-v4/` |

### 接口

| 方法 | 路径 | 角色 |
|---|---|---|
| GET | `/api/crm/pipeline?stage&owner&q` | 登录用户 |
| POST | `/api/crm/opportunities/:id/stage` `{stage,lost_reason,note,owner,next_action,next_action_due_at,expected_version}` | SALES / MANAGEMENT |
| POST | `/api/crm/opportunities/:id/activities` `{activity_type,summary,result,occurred_at,next_follow_up_at}` | SALES / MANAGEMENT |
| GET | `/api/crm/companies/:id/timeline` | 登录用户 |
| GET | `/api/crm/tasks?due=overdue\|today\|week&mine=true&status` | 登录用户 |
| POST / PATCH | `/api/crm/tasks`、`/api/crm/tasks/:id` `{task_status,owner,due_at,note}` | SALES / MANAGEMENT |
| POST | `/api/crm/replies/:classificationId/review` `{decision:CONFIRM\|CORRECT,intent}` | SALES / MANAGEMENT |
| GET | `/api/crm/followup-drafts?status` | 登录用户 |
| POST | `/api/crm/followup-drafts/:id/decision` `{decision:APPROVE\|DISCARD,subject,body_text,reason}` | MANAGEMENT / OUTREACH_APPROVER |

回复纠正不覆盖原分类：原记录标记 CORRECTED，新增一条 `HUMAN_REVIEW_V1` 版本，原任务取消、按新意图建任务。

## 验证

- 单元测试：`test/crm-outbox-payload.test.js`、`test/crm-followup-unit.test.js`（飞书接口全部用模拟 fetch，零真实调用）。
- Postgres 端到端：`test/crm-followup-pipeline-postgres.test.js`，在隔离 PostgreSQL 16 上从 001–063 模板克隆库，经迁移执行器应用 064（含重放 SKIPPED）、回填、触发器、接口、草稿扫描→批准→模拟 SMTP 发送→回复关联、回复纠正、旧同步记录。**PASS**。生产是 PostgreSQL 17，未在 17 上跑。
  运行：`CRM_PIPELINE_TEST_ADMIN_URL=postgresql://postgres@HOST:PORT/postgres CRM_PIPELINE_TEST_TEMPLATE=<已应用001-063的库> npm test`
- 全量 `npm test`：1,272 项，1,216 通过，55 跳过，**1 失败**：`current-project-status.test.js`，原因是有了新的实现提交而 `docs/CURRENT_PROJECT_STATUS.md` 需要在公司电脑上连生产库重新生成（见下）。不是代码错误；该快照不能在云端伪造。
- `scripts/cleanup-maintenance-guard.mjs` 需要 Docker 守护进程，云端容器没有，**未执行**。
- 零真实 SMTP、Hunter、Exa、飞书调用；未解除维护模式；未放出检索积压。

## 在公司电脑上部署（按顺序）

1. `git fetch && git checkout claude/gifted-hypatia-59rtaf`
2. `node scripts/cleanup-maintenance-guard.mjs`
3. 备份数据库后在隔离库重放 064，再对生产库执行 `cd services/demo-dashboard && npm run phase7:migrate`（按顺序应用到 064）。
4. `node scripts/generate-current-project-status.mjs`，提交 `docs/CURRENT_PROJECT_STATUS.md`，CI 恢复全绿。
5. 飞书：在飞书开放平台建企业自建应用，开通多维表格权限，把应用加为表格协作者；表格列名按 `config/crm/feishu-bitable-map.json`（可改）。在 `.env.phase7-outreach` 填 `CRM_PROVIDER=feishu` 和四个 `FEISHU_*`，重建 `outreach-worker`。
6. 跟进草稿：确认模板文字后设 `CRM_FOLLOWUP_DRAFTS_ENABLED=true`。草稿每小时扫描一次，**只生成待批准草稿**。

## 待确认 / 未做

- 跟进邮件两封模板（`FOLLOWUP_2_CHECK_IN`、`FOLLOWUP_3_LAST_NOTE`）是拟稿，需 Simon 审定文字。
- 生产界面（`public/`）尚未接入这些接口——等设计稿确认后第二批做。
- `AGENTS.md` 和 `docs/UI_SYSTEM_V3.md` 的"中英等大"规则与新设计稿不一致，设计稿确认后一并更新。
