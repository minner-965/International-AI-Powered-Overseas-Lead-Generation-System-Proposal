# Phase 7 业务数据交换合同

版本：`phase7-v1`
日期：2026-08-31

## 目标与边界

Phase 7 支持客户线索、公司商品和客户成交/订单的 CSV/XLSX 受控导入，以及获授权业务数据的异步导出。PostgreSQL 是业务主记录；浏览器、n8n 和共享目录都不直接写 canonical 表。

所有导入固定经过：

~~~text
上传或只读发现
→ 本地 staging 副本
→ 文件与结构检查
→ dry-run
→ 逐行 ACCEPTED / REVIEW / REJECTED / DUPLICATE
→ 提交审批
→ 精确 hash 审批
→ commit
→ 受影响实体重算
~~~

dry-run 不写 canonical 业务数据；发现共享文件也不自动 commit。

## 导入类型

| import type | dataset role | 用途 |
| --- | --- | --- |
| `PROSPECT_LEADS` | `PROSPECT_IMPORT` | 外部线索进入待核验主档，不直接获得联系资格 |
| `PRODUCT_MASTER_UPDATE` | `PRODUCT_CATALOG_UPDATE` | 为现有 `product_master.id` 建立版本化修订 |
| `CUSTOMER_DEALS` | `CONVERTED_ORDER_HISTORY` | 客户/成交头信息；确认成交后阻止新潜客外联 |
| `CUSTOMER_DEAL_LINES` | `CONVERTED_ORDER_HISTORY` | 订单行和商品引用 |

旧的历史客户、订单、CRM、OKKI 和参考数据 import type/role 继续保留。

## 字段合同

### PROSPECT_LEADS

必填：`external_lead_id`, `company_name`, `country_code`, `source_reference`。

允许：website、city、company type、contact name/title、business email/phone、product profile、owner 和 notes。导入邮箱保留来源状态，不能自动映射为 Hunter `VALID`。

### PRODUCT_MASTER_UPDATE

必填：`external_product_id`, `product_name`, `product_profile`, `catalog_status`。

允许：SKU、category/subcategory、material、size specification、color、MOQ、packing、certification、批准销售卖点和 effective date。未知属性保持空值或 `UNKNOWN`，不补写。

每次 commit 创建 `product_master_revisions`；最新获批修订由 `product_master_current_revisions` 投影，原 `product_master.id` 保持不变。

### CUSTOMER_DEALS / CUSTOMER_DEAL_LINES

必填：`external_customer_id`, `company_name`, `country_code`, `external_deal_or_order_id`, `deal_status`, `source_reference`。

客户销售价格和供应商成本是不同字段，currency 缺失时保持未知。仅确定的 `WON`、`CONFIRMED`、`CONFIRMED_ORDER` 或 `ORDER_CONFIRMED` 触发现有客户关系处理。

## 文件限制

默认限制：

| 项目 | 上限 |
| --- | ---: |
| 文件大小 | 10 MiB |
| worksheets | 10 |
| 每 sheet 行数 | 25,000 |
| 列数 | 100 |
| 单元格字符 | 32,000 |
| 公式单元格 | 0 |
| 并发导入任务 | 2 |

只接受匹配的扩展名、MIME、文件签名和 schema version。拒绝密码保护、宏、VBA、外部链接、OLE/嵌入对象、过量压缩和超限文件。公式不计算；以 `=`, `+`, `-`, `@` 开头的 CSV/XLSX 可执行值在导入时拒绝或按文本处理。

## 幂等、审批与 commit

导入记录保存 source SHA-256、dry-run digest、schema version 和逐行结果。同一内容 hash 重放不得重复写入；文件内容改变产生新版本。

`import_approvals` 绑定：

~~~text
import id
dry-run digest
source SHA-256
approver identity + role
decision + time
idempotency key
~~~

迁移 025 的 commit guard 只允许 dry-run 已通过，且存在与当前 dry-run digest 和 source hash 完全匹配的 `APPROVED` 记录时进入 `COMMITTED`。

模糊公司/客户匹配、未知 taxonomy、缺失关键币种或冲突字段保持 `REVIEW`/`UNKNOWN`，不自动归并。

## 共享目录只读合同

- 只扫描配置允许列表中的来源；
- 先读取源文件 hash，复制到本地 staging，再读取源文件 hash；
- `before == local == after` 才允许解析；
- 只解析本地 staging 副本；
- 源文件创建、修改、重命名、移动和删除计数均必须为零；
- 源目录和 staging 路径不出现在普通 API、UI、导出、草稿或日志中；
- 财务、HR、系统和凭据类文件不进入 Phase 7 自动导入范围。

## 导出合同

导出类型：

~~~text
LEAD_MASTER_INTERNAL
SALES_OPPORTUNITY
PRODUCT_CATALOG_INTERNAL
CUSTOMER_DEAL_HISTORY
IMPORT_ERROR_REPORT
~~~

导出模式：

~~~text
CURRENT_FILTER
SELECTED_ROWS
FULL_AUTHORIZED_MASTER
~~~

`CURRENT_FILTER` 必须复用 `/api/opportunities` 相同筛选语义。选择行模式必须包含至少一个实体 ID。

导出 job 保存 requester identity/role、请求列、实际应用列、筛选、快照时间、行数、文件 SHA-256、状态和过期时间。文件位于非 public、Git 忽略的本地目录，通过短时 token 下载；token 只保存 hash。每次允许、拒绝或过期下载都写 `data_export_download_events`。

CSV/XLSX 输出对公式前缀进行文本化。API 只返回逻辑文件名、聚合状态、列权限、行数和过期时间，不返回 `internal_file_path`、storage key、UNC/staging path 或源 payload。

## 列级权限

| 数据范围 | SALES | MANAGEMENT | DATA_ADMIN | FINANCE |
| --- | --- | --- | --- | --- |
| 业务机会公开/验证摘要 | 允许 | 允许 | 按任务需要 | 按任务需要 |
| 联系方式 | 只限分配对象 | 允许 | 仅导入核验 | 按职责需要 |
| 商品目录 | 允许 | 允许 | 允许 | 允许 |
| 客户成交与销售价格 | 不默认开放 | 明确授权 | 导入核验 | 允许 |
| 供应商成本 | 不开放 | 不默认开放 | 不默认开放 | 明确授权 |
| 内部路径、secret、raw payload | 不开放 | 不开放 | 不开放 | 不开放 |

具体 applied columns 由服务端重新计算，浏览器提交的 requested columns 不构成授权。

## 当前实现状态

导入状态机、字段合同、共享文件 hash 清单、CSV/XLSX 生成与解析、导出投影、ExcelJS 4.4.0 和 migration 025 已写入工作树。Express API、队列持久化、真实文件 round-trip、共享目录三 hash 运行证明、迁移应用/回放和浏览器下载验收仍为 `pending`。
