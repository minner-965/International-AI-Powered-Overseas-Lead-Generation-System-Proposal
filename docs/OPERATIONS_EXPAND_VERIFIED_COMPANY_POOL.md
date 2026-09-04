# 扩大已验证公司池操作手册

本手册用于从公开来源发现新公司，并逐步推进身份核验、类目证据、Buyer 证据和联系路径验证。候选公司不等于已验证机会；任何外发仍受独立的管理审批和发送门槛控制。

## 1. 阶段边界

1. Discovery：搜索并保存候选公司及来源。
2. Identity verification：确认公司身份、官网、市场和 B2B 业务类型。
3. Category evidence：确认客户公开经营或采购类目与 DPV 已批准供货类目是否匹配。
4. Buyer evidence：寻找实名、在任且与目标类目相关的采购负责人，并单独验证企业邮箱。

任何一个阶段的结果都不会替代后续阶段的证据。

## 2. 部署前检查

- PostgreSQL、n8n、dashboard、category worker、data worker 和 outreach worker 均为 healthy。
- n8n 的 research workflow 与自动补证 reconciliation workflow 均已导入并启用；执行前确认心跳新鲜。
- 本地部署环境已配置搜索 Provider、管理认证和 CSRF；只检查配置是否存在，不在终端打印值。
- `AUTO_EVIDENCE_ENABLED=true`，并以 Settings 返回的 effective state 为准。
- DPV 系统不设置 Tavily 每日、单任务或单家公司搜索额度上限，以 Tavily 账户自身的可用额度为准。
- 每次调用仍保留用量审计、请求指纹和防重复扣费；供应商额度耗尽或接口报错时按真实错误暂停或重试。

## 3. 从 Dashboard 创建发现任务

1. 打开 dashboard，进入 Research。
2. 选择 New research job。
3. 选择市场、产品类目和 Buyer 类型。
4. WP11 首轮 canary 固定为 AE/MX × WOMENSWEAR/GENERAL_MERCHANDISE，每组最多 5 个候选。
5. 提交后观察 `QUEUED → CRAWLING → COMPLETED/PARTIAL/FAILED`。

当前 route 接受：

- `country_code`：两位国家代码；当前可见市场仅为 AE、MX，BD 配置保留但在界面隐藏且不属于本轮扩池范围。
- `product_category`：必须能映射到 `WOMENSWEAR` 或 `GENERAL_MERCHANDISE`。
- `product_profile`：可选；提供时必须是 `WOMENSWEAR` 或 `GENERAL_MERCHANDISE`，并与类目映射一致。
- `buyer_types`：非空数组。
- `max_results`：1–100 的整数。

## 4. 通过工作区 API 创建发现任务

浏览器令牌和 CSRF 输入已移除。当前工作区直接调用业务接口，服务端附加审计身份：

```powershell
$body = @{
  country_code = 'AE'
  product_category = "Women's Apparel"
  buyer_types = @('Importer', 'Wholesaler', 'Distributor')
  max_results = 5
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/research/jobs `
  -ContentType 'application/json' -Body $body
```

查询任务和候选：

```powershell
Invoke-RestMethod http://localhost:3000/api/research/jobs
Invoke-RestMethod http://localhost:3000/api/research/jobs/JOB_ID/candidates
Invoke-RestMethod http://localhost:3000/api/metrics
```

WP11 canary 必须分别创建以下四个任务，且每个任务的 `max_results` 都为 5：

| 市场 | 产品画像 | 产品类目 |
|---|---|---|
| AE | WOMENSWEAR | Women's Apparel |
| AE | GENERAL_MERCHANDISE | General Merchandise |
| MX | WOMENSWEAR | Women's Apparel |
| MX | GENERAL_MERCHANDISE | General Merchandise |

这 20 条只是候选上限。目录托管页（例如 Kompass）必须先解析到企业自己的官方域名；没有独立官方域名时保留为待复核，不作为已验证企业写入。

## 5. 已验证公司类目研究

`POST /api/category-procurement/jobs` 只研究已入库公司，不执行新公司 discovery。可传入 `company_ids`，空数组按当前服务规则选择符合条件的公司。

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/category-procurement/jobs `
  -ContentType 'application/json' -Body '{"company_ids":[],"max_results":20}'
```

## 6. 自动补证 canary

周期自动补证已经启用。系统按 blocker 自动选择策略；工作区仍可使用 `POST /api/auto-evidence/controlled-batch` 发起受控批次：

```powershell
Invoke-RestMethod http://localhost:3000/api/auto-evidence/summary
Invoke-RestMethod http://localhost:3000/api/auto-evidence/tasks
```

只有以下条件全部满足，才进入后续激活步骤：

- n8n workflow 已导入并 active；
- reconciliation heartbeat 新鲜；
- workers healthy，PostgreSQL ready；
- 每日和单 ResearchJob 预算生效；
- 一个 canary task 到达 terminal state；
- 没有重复 task 或重复 Provider billing；
- Settings 显示的 effective enabled state 正确。

配置变更后必须重启相关服务，并再次确认 Settings effective state；本地环境文件不提交 Git。

## 7. Blocker 专用路由

- `NEEDS_PRODUCT_EVIDENCE` / `CATEGORY_EVIDENCE`：只运行 S01、S02、S05，且 S05 只提取类目或采购信号；类目门槛通过前不进入 Buyer、Hunter 或草稿流程。
- `CATEGORY_PROCUREMENT_MATCH`：按当前缺口运行 S03–S10；S09 只在已有实名候选时执行。先确认实名 Buyer 职责，再进入 Finder/Verifier。
- `NOT_SUITABLE`：停止自动 Provider 调用；只有新 evidence revision 或经审计的人工 reopen 才重新评估。

扩池顺序固定为：公开来源发现 → 官方域名/企业身份核验 → 域名、法定名称、历史客户及 suppression 检查 → Buyer 业务模型 → 公开类目证据 → company × profile opportunity → blocker 专用补证。未知事实保持未知，不补写推测值。

## 8. 结果判读

- 公司总数增加只代表 discovery 有新增候选。
- `VERIFIED` 需要独立身份和业务证据。
- `CATEGORY_PROCUREMENT_MATCH` 需要客户侧公开类目证据。
- `RECOMMENDED` 还需要实名相关 Buyer、当前有效企业邮箱、历史关系与 suppression 检查。
- Management Approved、草稿审批和 Provider 用途门槛仍是独立外发条件。

## 9. 相关实现

- 本地运行：`runbooks/LOCAL_DEVELOPMENT.md`
- 管理认证：`docs/PHASE7_MANAGEMENT_AUTH_CONTRACT.md`
- Discovery：`services/demo-dashboard/src/search/discoveryService.js`
- Tavily Provider：`services/demo-dashboard/src/search/TavilySearchProvider.js`
- 自动补证：`services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js`
