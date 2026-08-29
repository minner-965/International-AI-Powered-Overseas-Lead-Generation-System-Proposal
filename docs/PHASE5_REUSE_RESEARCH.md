# DPV Phase 5+ 成熟模块复用调研

调研日期：2026-08-27
状态：只读调研，尚未安装或接入任何候选模块

## 1. 目的与边界

本文件为 DPV Phase 5 及以后阶段提供“reuse first（优先复用）”技术选型清单，覆盖：

- 有证据支撑的线索评分与资格判定；
- 企业实体解析与重复识别；
- 公司及联系人补全；
- 工作流编排、后台任务与 CRM/导出；
- 邮箱验证；
- 可观测性；
- 文档及报价自动化。

当前项目基线为 Node.js 24、Express 5、PostgreSQL 17 和自托管 n8n 2.36.7。优先选择可嵌入 Node/PostgreSQL、可自托管、许可证清晰且维护活跃的模块，避免为了复用引入比业务本身更重的平台。

本文件不改变 Phase 4 范围。Phase 4 不安装下列依赖、不执行 Phase 5、不开始评分重构、联系人补全、CRM 触达、报价或后续自动化。

## 2. 推荐优先级

### P0：Phase 5 首选组合

Phase 5 建议只增加以下能力，保持基础设施简单：

1. GoRules ZEN Engine：执行最终 100 分评分、Tier 和资格规则；
2. PostgreSQL `pg_trgm`：生成模糊重复候选；
3. pg-boss：执行批量评分、重评和导出等后台任务；
4. OpenTelemetry JS：统一 Express、HTTP、PostgreSQL、队列和供应商调用的追踪；
5. 继续复用现有 n8n：负责跨步骤编排和人工审批，不另换工作流平台。

### P1：Phase 6–7 按需接入

- GLEIF API、OpenCorporates API：法律实体与公司登记信息补全；
- validator.js、Hunter API：邮箱本地预检、联系人查找和可投递性验证；
- n8n HubSpot node、HubSpot 官方 TypeScript SDK：CRM 同步与缺失操作补充。

### P2：规模或业务成熟后

- Splink：多来源、大批量概率实体解析；
- docxtemplater + Gotenberg：报价模板填充及 PDF 生成。

## 3. 模块复用矩阵

| 优先级 | 能力与官方来源 | 许可证 / 部署 / 维护 | 与当前架构的适配 | 数据隐私与成本 | 推荐阶段与边界 |
| --- | --- | --- | --- | --- | --- |
| P0 | [GoRules ZEN Engine](https://github.com/gorules/zen) / [Node.js SDK 说明](https://gorules.io/open-source/javascript-rules-engine) | MIT；Rust 内核和 Node 原生绑定，进程内执行；截至调研日仍持续更新 | 可直接嵌入 Node 24；JSON 决策图、决策表和逐节点 trace 适合可回放评分 | 本地执行，无按次费用，事实不外传 | Phase 5 用作评分执行内核。DPV 自己定义分值、证据门槛、Tier 和 reason code，不照搬通用销售评分模板 |
| P0 | [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) | PostgreSQL License；PostgreSQL 官方可信扩展；数据库内运行 | 与 PostgreSQL 17 原生适配，支持 similarity、GIN/GiST 索引 | 无外传、无新增服务 | Phase 5 用于公司名和地址的模糊候选召回；最终是否合并仍由域名、国家、电话、邮箱、地址和保守阈值共同决定 |
| P1 | [Splink](https://github.com/moj-analytical-services/splink) | MIT；Python 3.9+，支持 PostgreSQL 后端；v4 系列持续维护 | 可读取 PostgreSQL，但会增加 Python worker 和模型校准 | 可完全本地；增加部署和验证成本 | 候选达到数万级、来源明显增多后再引入；只有单一公司名称字段时不适合 |
| P0 | [pg-boss](https://github.com/timgit/pg-boss) / [官方介绍](https://pgboss.io/introduction) | MIT；Node >=22.12、PostgreSQL >=13；维护活跃 | 与 Node 24/PostgreSQL 17 精确匹配，无需 Redis | 数据与任务留在 PostgreSQL；无软件费用 | Phase 5 处理批量重评、enrichment、导出及文档生成。任务仍须幂等，并限制重试和并发 |
| P0 | [n8n](https://github.com/n8n-io/n8n) / [Queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/) | Sustainable Use License；现有自托管实例；发布活跃 | 项目已经使用，继续承担步骤编排、等待和人工审批；规模扩大时 queue mode 需要 Redis | 内部自动化通常无新增软件费；对外产品化或转售前复核许可 | Phase 5+ 继续复用，不引入 Temporal。业务计算、实体解析和评分留在应用服务，n8n 不承载核心领域规则 |
| P1 | [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) | GLEIF 官方生产 API；JSON；免费且无需注册 | 可用 Node `fetch` 或 n8n HTTP Request 实现薄适配器 | 主要是法律实体数据；免费；覆盖范围限于拥有 LEI 的企业 | Phase 6 优先查询法律名称、地址、LEI 和母子公司关系；结果保存来源与抓取时间，不把无结果解释为公司不存在 |
| P1 | [OpenCorporates API](https://api.opencorporates.com/documentation/API-Reference) | 官方托管 REST API；API key；商业与开放数据许可并存 | 通过统一 `CompanyEnrichmentProvider` 接口接入，不直接耦合路由或评分逻辑 | 免费使用带 share-alike/署名条件；闭源商业使用通常需付费。结果可能含高管信息 | Phase 6 用于公司登记核验和来源追溯；签约前确认数据展示、缓存、再分发和删除条款 |
| P0/P1 | [validator.js](https://github.com/validatorjs/validator.js) + [Hunter API](https://hunter.io/api-documentation) | validator.js 为 MIT 本地 Node 库；Hunter 为官方托管 REST 服务、按 credits 使用 | 先本地标准化/语法验证，再调用 Hunter Domain Search、Email Finder、Company Enrichment 或 Email Verifier | Hunter 会接收域名、姓名或邮箱；需要 DPA、用途限制、访问控制、缓存期限和删除策略；按调用计费 | Phase 6–7。validator.js 只证明格式有效，不代表邮箱存在；Hunter 的 `accept-all`、`unknown` 不可当作已验证可投递 |
| P0 | [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) / [n8n Monitoring](https://docs.n8n.io/hosting/logging-monitoring/monitoring/) | Apache-2.0；Node SDK 和自动插桩；维护活跃 | 可覆盖 Express、HTTP、PostgreSQL 和 worker，并与 n8n 指标并行 | 本地采集无外传；仅当配置云 exporter 时产生数据外传和费用 | Phase 5 即接入。统一记录 `research_job_id`、`company_id`、provider、rule version、耗时、状态和费用，不在 trace 中写 API key 或完整个人资料 |
| P1 | [n8n HubSpot node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.hubspot/) + [HubSpot TypeScript SDK](https://github.com/HubSpot/hubspot-sdk-typescript) | n8n 内置节点；官方 SDK Apache-2.0、Node >=20 | 优先用 n8n 节点；节点缺少的批量、关联、分页或重试操作再用官方 SDK | HubSpot 套餐和 API 限额另计；联系人数据进入第三方 CRM | Phase 7，在人工审批后同步。以 DPV 数据库为证据和评分主记录，CRM 保存业务副本及外部 ID，避免双向覆盖 |
| P2 | [docxtemplater](https://github.com/open-xml-templating/docxtemplater) + [Gotenberg](https://github.com/gotenberg/gotenberg) | docxtemplater 核心双许可 MIT/GPLv3，部分图片/XLSX等高级模块付费；Gotenberg MIT Docker，维护活跃 | Node 生成 DOCX，再通过 Gotenberg HTTP API 转 PDF；可由 pg-boss 执行、n8n 发起审批 | 可全本地；需限制模板和临时文件访问。Gotenberg 应隔离网络，防止不受信 HTML 访问内网 | Phase 8 报价自动化。价格、币种、税费、有效期和审批状态必须来自结构化字段，不让模板或 LLM 自行计算 |

## 4. Phase 5 评分的证据契约

规则引擎只负责确定性计算，不能替代 DPV 的证据模型。进入评分引擎的每项事实至少包含：

```text
value
confidence
evidence_ids[]
captured_at
```

评分结果至少保存：

```text
final_score
tier
dimension_scores
reason_codes[]
fired_rules[]
rule_version
evidence_ids[]
trace
```

约束：

- 没有对应 evidence ID 的事实不得贡献“已验证”分数；
- 证据不足时输出 `UNKNOWN` 或 `REVIEW`，不补猜默认分；
- 模型可把网页文本映射为候选事实，但最终分值、Tier 和 reason code 由版本化规则产生；
- 每次重评保留规则版本、输入事实版本和逐维度贡献，支持历史回放；
- 规则变化必须用已标注历史样本做新旧结果对比后再启用。

## 5. 后续阶段建议顺序

### Phase 5：评分与工程基础

```text
现有证据表
→ 事实快照
→ GoRules ZEN 决策
→ 分数 / Tier / reason codes / trace
→ pg-boss 批量重评
→ OpenTelemetry 观测
→ n8n 编排
```

### Phase 6：企业及决策人补全

```text
GLEIF（免费、法律实体）
→ OpenCorporates（登记核验，许可确认后）
→ Hunter（按需付费联系人/公司/邮箱）
→ 人工复核
```

所有供应商都通过适配器接口接入。核心 Company、Contact、Evidence、Score 表不得依赖供应商字段名。

### Phase 7：CRM 与触达准备

```text
validator.js 本地预检
→ Hunter 可投递性验证
→ 人工审批
→ n8n HubSpot node
→ 必要时官方 HubSpot SDK
```

CRM 同步、导出和触达必须分别记录状态；“进入 CRM”不等于“批准发送”。

### Phase 8：报价和跟进

```text
结构化产品/价格/币种/条款
→ docxtemplater
→ Gotenberg PDF
→ 人工审批
→ CRM 附件或受控下载
```

## 6. 当前不优先采用的候选

| 候选 | 暂缓原因 |
| --- | --- |
| [Zingg](https://github.com/zinggAI/zingg) | AGPL-3.0 且以 Spark/数据平台为中心；当前数据规模下部署和许可负担高于 `pg_trgm`，后续大规模场景再评估 |
| [Dedupe](https://github.com/dedupeio/dedupe) | MIT、功能成熟，但需要 Python 与人工训练；当前维护节奏和 PostgreSQL 直接适配弱于 Splink |
| [Reacher](https://github.com/reacherhq/check-if-email-exists) | 开源部分为 AGPL-3.0，闭源商业应用需商业许可；SMTP 25 端口、IP 信誉和代理会增加运营复杂度 |
| [Carbone](https://github.com/carboneio/carbone) | 文档能力强，但 Community 版采用自定义 CCL 且比企业版落后一个主版本；先选许可证更直接的 docxtemplater + Gotenberg |
| [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript) | MIT 且成熟，但会增加 Temporal Server/Cloud；当前与 n8n 职责重叠，只有长周期、强确定性重放需求超过 n8n 时再评估 |
| [BullMQ](https://docs.bullmq.io/) | MIT 且成熟，但要求 Redis；当前 pg-boss 可直接复用现有 PostgreSQL，运维更轻 |
| [People Data Labs](https://docs.peopledatalabs.com/docs/introduction) | 公司/个人补全能力完整，但付费和个人资料合规负担较高；先验证 Hunter 与公开公司数据的覆盖和 ROI |

## 7. 每次正式采用前的复核清单

```text
[ ] 业务能力确实需要，且现有模块没有同等功能
[ ] 官方仓库/文档仍维护，版本已固定并通过最小验证
[ ] 许可证允许 DPV 的内部和商业使用方式
[ ] 明确自托管、云服务或混合部署方式
[ ] 明确会发送哪些公司/联系人数据及处理地区
[ ] 已确认 DPA、用途、保留、删除、再分发和审计要求
[ ] 已估算按调用、按用户、基础设施和人工复核成本
[ ] 通过适配器接入，不把供应商字段写死到核心模型
[ ] 有超时、限流、重试、熔断、缓存和费用上限
[ ] 有来源、captured_at、provider request ID 和失败状态
[ ] 有回滚路径，供应商不可用时核心流程仍可运行
[ ] 单元测试默认使用 mock，不消耗第三方 credits
```

## 8. Phase 4 隔离门

在 Phase 4 完成并明确开始 Phase 5 前：

```text
DO NOT install Phase 5+ candidate dependencies
DO NOT add provider credentials
DO NOT enable CRM or outreach
DO NOT generate quotations
DO NOT change Phase 4 acceptance scope
```

Phase 4 只需保留可扩展接口和数据来源追踪能力，不提前实现本文件中的后续功能。
