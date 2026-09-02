# Phase 10 复用组件核验 / Reuse Research

核验日期：2026-09-01
范围：自动补证、周期对账、联系人查找与验证、工作台状态展示、Excel 数据交换。

## 结论

Phase 10 继续使用项目内已经锁定、已测试的组件，不增加第二套搜索、队列、邮箱验证、工作流、表格导出或 UI 框架。这样可以保留 Phase 7–9 已有的数据谱系、预算、重试、幂等、管理审批和外发保护。

| 能力 | 复用项 | 本地版本/状态 | Phase 10 用法 | 结论 |
| --- | --- | --- | --- | --- |
| 持久化任务队列 | `pg-boss` | 12.28.0，MIT | 复用现有队列工厂，增加 8 个自动补证队列；沿用 retry、heartbeat、dead-letter、singleton key | 直接复用，不升级 |
| 周期对账 | n8n | 当前 Compose 固定镜像；工作流默认 inactive | 新增一个 inactive-first 对账工作流，只调用 Express 内部端点；总开关仍由后端校验 | 直接复用，不新增调度框架 |
| 公开网页搜索 | 项目内 Tavily adapter | 已在 Phase 3–9 使用 | 只用于发现可复核来源 URL；搜索摘要不直接成为通过证据 | 直接复用 |
| 实名联系人邮箱 | 项目内 Hunter adapter | 已实现 Finder、Verifier、额度和 provider event | 仅在实名、相关 Buyer/Procurement gate 通过后调用；异常进入重试/预算暂停/人工例外 | 直接复用 |
| Excel 交换 | `exceljs` | 4.4.0，MIT | 延续 Phase 7 的 staging、preview、commit、export 和审计链路 | 直接复用，不引入 SheetJS |
| 管理工作台 | Tabler + 本地统一工作台组件 | Tabler 1.4.0，MIT | 在现有机会、研究、Jobs 页面增加自动补证、人工例外、目录维护状态 | 直接复用，不建立第二套设计系统 |
| 邮件及 CRM | Phase 7 provider gate、审批、suppression、CRM service | 已有 | 本阶段保持 `OUTBOUND_EMAIL_PROVIDER=NONE`、`OUTREACH_ENABLED=false`；不绕过既有门槛 | 直接复用 |

## 采用依据

### pg-boss

官方文档支持队列级 retry、指数退避、heartbeat、任务保留、dead-letter、延迟执行和 singleton key；这些能力与 Phase 10 的幂等、预算暂停和定时对账要求一致。当前项目已经锁定并验证 12.28.0。npm 在核验日显示 12.29.0 为最新版本，本阶段不为非必要版本升级扩大变更范围。

- 官方 jobs 文档：<https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md>
- 官方仓库：<https://github.com/timgit/pg-boss>
- 本地许可证：MIT

### Hunter

Hunter 官方 API 将 Email Finder 与 Email Verifier 明确区分，并要求 API Key 保密；错误码包含额度限制和服务端临时错误。Phase 10 继续用现有 adapter 的 Finder → Verifier 顺序、额度事件和延迟重试，不把 provider 异常写成业务不合格。

- 官方 API：<https://hunter.io/api-documentation/v2>
- Secret 处理：只通过服务端环境变量，前端、日志和结果文档均不输出 Key。

### Tavily

Tavily Search API 可以返回查询结果及来源 URL。Phase 10 限定其职责为发现网页来源；最终类目匹配继续依赖可访问页面证据、批准的 DPV 类目范围和确定性 taxonomy/alias 规则。

- 官方 Search API：<https://docs.tavily.com/documentation/api-reference/endpoint/search>

### n8n

n8n 只保留为编排层，不承担业务判定、数据持久化或权限放行。新工作流提交到仓库时保持 inactive，并由 `AUTO_EVIDENCE_ENABLED=false` 和 Express 内部鉴权形成双重保护。

- 官方文档：<https://docs.n8n.io/>
- 本阶段不安装社区节点，不在 workflow JSON 中写入 Secret。

### ExcelJS 与 Tabler

两者均已存在于本地 lockfile 和镜像构建中。ExcelJS 延续现有业务数据导入导出；Tabler 延续统一工作台的响应式、可访问性和状态组件。核验日 npm 最新版本分别为 ExcelJS 4.4.0、Tabler 1.4.0，与项目锁定版本一致。

## 排除项

- 未引入新的队列、搜索、邮箱验证、CRM、导入导出或 UI 依赖。
- 未采用运行时联网加载的 Skill、组件或脚本。
- 未把第三方 provider 的自然语言结果用于自动通过公司、类目、联系人或外发审批。
- 未因 npm 存在新版本而升级 `pg-boss`；升级应单列兼容性变更并完成独立回归。

## 审计结果

复用决策符合 Phase 10 的 additive-change 原则：业务规则和审计模型新增，底层可靠组件延续；具体实现、数据库 dry-run、真实批次和运行结果分别记录在其他 Phase 10 结果文件中。
