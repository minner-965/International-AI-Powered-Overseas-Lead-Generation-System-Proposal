# Phase 7 复用研究记录

日期：2026-08-31

## 结论

Phase 7 采用固定版本的内容规范与邮件工程规范，并在项目内建立 DPV 自有组合规则。第三方 Skill 不参与客户资格判断、评分、审批或发送决策。XLSX 运行时采用 ExcelJS 4.4.0，CSV 继续复用现有解析能力。

生产默认值保持：

~~~text
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
OUTBOUND_EMAIL_PROVIDER=NONE
RESEND_USE_CASE=DISABLED
~~~

## Marketing Skills

来源：[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills/tree/e55de886fe7580ec75cdb7ded5092b33f7d4ed58)

~~~text
commit  e55de886fe7580ec75cdb7ded5092b33f7d4ed58
license MIT
~~~

采用范围：

| Skill | 版本 | Phase 7 使用边界 |
| --- | --- | --- |
| product-marketing | 2.1.0 | 版本化产品定位、Buyer Persona、公开卖点和 CTA |
| cold-email | 2.0.0 | 只生成首封和跟进草稿 |
| copy-editing | 2.0.0 | 清晰度、语气、事实和主张检查 |
| sales-enablement | 2.0.1 | 人工复核后的目录、样品、报价、会议和销售交接 |
| revops | 2.0.0 | Owner、SLA、Pipeline、Next Action 和 CRM outbox |
| prospecting | 1.1.0 | 只使用公开 research signal、联系理由和合规检查 |

未采用整仓，也未采用 SEO、Ads、CRO、Social 或通用 Lead Score。目录固定在 .agents/vendor/marketingskills/，具体目录哈希记录在 skills.lock.json。

## Resend Skills

来源：[resend/resend-skills](https://github.com/resend/resend-skills/tree/828340bd8a361c4e6e0c02bddf1575f131d5d77f)

~~~text
commit  828340bd8a361c4e6e0c02bddf1575f131d5d77f
license MIT
~~~

采用范围：

| Skill | 版本 | Phase 7 使用边界 |
| --- | --- | --- |
| email-best-practices | 1.0.2 | 域名认证、幂等、重试、退信、投诉、抑制和可访问性 |
| agent-email-inbox | 3.0.4 | Webhook 验签、入站清洗、附件隔离、人工复核 |
| resend | 3.6.0 | SDK、Webhook 和幂等工程模式；仅明确同意或事务用途 |

resend-cli 与 react-email 暂不进入 Phase 7 生产路径。

## Resend 服务用途复核

官方 [Acceptable Use Policy](https://resend.com/legal/acceptable-use) 在 2026-08-27 更新。政策明确禁止 unsolicited messages、cold outreach、purchased lists 和 scraped contact data，并要求收件人明确同意接收邮件。

因此 `provider_purpose=COLD_OUTREACH` 进入 ResendProvider 时必须返回：

~~~text
PROVIDER_PURPOSE_NOT_ALLOWED
network_call=0
~~~

`OPT_IN` 只接受 `EXPLICIT_OPT_IN`；`TRANSACTIONAL` 只接受 `EXPLICIT_OPT_IN` 或已有 `TRANSACTIONAL_RELATIONSHIP`，并继续执行抑制、幂等和总开关复核。Resend 的 MIT Skill 许可不改变其 SaaS 服务政策。

## ExcelJS

来源：[exceljs/exceljs](https://github.com/exceljs/exceljs)

~~~text
package  exceljs
version  4.4.0
license  MIT
npm last modified 2024-12-20
~~~

采用理由：

- 当前 dashboard 与 worker 都是 Node 24，加入 Node XLSX 库不需要在容器内增加 Python runtime。
- 支持 XLSX 读写、worksheet、表格、样式和流式接口，可与现有 CSV 解析器并存。
- 版本固定在 package.json 和 package-lock.json，Docker 构建可重放。

限制与控制：

- 不执行或计算导入公式。以 =、+、-、@ 开头的可执行单元格或 CSV 值在导入时拒绝或转义。
- .xlsm、VBA、外部链接、OLE 和加密工作簿在 dry-run 前拒绝；ZIP 内容由应用检查，不信任浏览器上传的标志。
- 文件、sheet、行、列、单元格长度和解压后总量均设上限。
- 大批次通过 worker 处理，API 只返回聚合状态和字段级错误。
- 导出文件写入非 public、Git 忽略的运行目录，并使用短时下载令牌。

回滚方式：

1. 停止新的 XLSX 导入导出任务。
2. 保留已写入的批次、修订和审计记录。
3. 从 package.json 移除 ExcelJS 并重建镜像。
4. 保留 CSV 模板与 CSV 导入导出路径。

## 更新策略

所有第三方目录均由 skills.lock.json 固定 repository、commit、version、license 与目录 SHA-256。上游更新只通过人工审核、锁文件更新和完整回归测试进入项目，不自动跟随主分支。
