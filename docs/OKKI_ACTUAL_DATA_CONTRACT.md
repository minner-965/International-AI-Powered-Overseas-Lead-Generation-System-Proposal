# OKKI 实际数据契约

## STATUS

PASS — 已按两份工作簿的实际结构完成只读解析、字段归类和约束确认。

## SOURCE FILES

| 文件角色 | Sheet | 维度 | 数据行 |
|---|---:|---:|---:|
| OKKI CRM 客户导出（仅本地来源，不进入 Git） | 1 | 249 × 109（含表头） | 248 |
| OKKI CRM 活动导出（仅本地来源，不进入 Git） | 1 | 84 × 12（含表头） | 83 |

客户表是“客户/公司 × 联系人”的展开表，不代表 248 家公司。重复表头按列位置读取：`国家地区` 第二列为空；`原跟进人`、`移入公海原因` 均保留重复列的原始值。

## CUSTOMER ID SEMANTICS

- 原始值和 Excel 单元格类型分别保存为 `source_customer_id_raw`、`source_customer_id_type`。
- 数值 `1` 的键为 `OKKI:int:1`。
- 文本 `'0001` 的键为 `OKKI:text:'0001`。
- 活动表文本 `0001` 只移除/补齐 Excel 文本标记的表示差异，以便关联到 `OKKI:text:'0001`；原始活动值仍保留。
- 46 个客户身份和 39 个活动客户均正确关联；两项碰撞测试保持为两个不同客户。

## CUSTOMER EXPORT

- 唯一来源客户：46
- 唯一公司：46
- 联系人行：248
- 唯一邮箱：248；邮箱覆盖客户 46/46
- 公司网站覆盖：38/46
- `联系电话` 覆盖：19/46
- `座机` 覆盖：39/46
- 任一电话覆盖：40/46
- 按当前通用业务邮箱前缀规则识别：14/248；保留为业务邮箱，但不标记为决策人
- 客户来源：`OKKI Leads` 46/46

国家分布（公司口径）：

| 国家代码 | 客户数 |
|---|---:|
| RU | 19 |
| GB | 12 |
| AE | 7 |
| ID | 2 |
| AU / BR / IE / JO / MX / ZA | 各 1 |

CRM 状态分布（公司口径）：

| 原状态 | 客户数 | 规范状态 |
|---|---:|---|
| 在跟进 | 40 | `OPEN / IN_PROGRESS` |
| 待跟进 | 5 | `OPEN / PENDING` |
| 无 | 1 | `UNKNOWN / NO_STATUS` |

社交资料覆盖（公司口径）：Facebook 8、LinkedIn 7、Instagram 7、Twitter 8、Pinterest 4、YouTube 2、WhatsApp 1、Crunchbase 1、AngelList 1。

## TRAIL EXPORT

- 活动行：83
- 涉及客户：39/46；无活动客户 7；活动孤儿 0
- 活动时间范围按来源值保存在内部数据库，不写入公开交接文档。

| 源活动 | 规范活动 | 数量 |
|---|---|---:|
| `EDM / 发送了一次营销` | `OUTBOUND_MARKETING_EMAIL_SENT` | 82 |
| `跟进 / 新建了快速记录跟进` | `MANUAL_FOLLOW_UP` | 1 |

人工跟进正文仅作为内部活动内容保存，不创建报价或成交事实。

## OUTCOME COVERAGE

- 明确 WON：0
- 明确 LOST：0
- 明确 loss reason：0
- `win_loss_coverage = NONE`
- 订单：0；产品：0；报价实体：0

`年采购额`、`首次成交订单金额(USD)`、CRM 状态、邮件发送和跟进文本均按原值保存，但不用于推断成交、失败或订单。
