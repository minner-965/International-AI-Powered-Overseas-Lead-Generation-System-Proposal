# Phase 5 V2.3.1 结果

## STATUS

PASS

## OKKI IMPORT

- Batch：`phase5-v2.3.1-okki-history-001`
- 数据类别：`INTERNAL_BUSINESS`
- 46 个历史 CRM 客户/线索、248 个联系人、83 条活动已写入 PostgreSQL。
- 原始两份工作簿保持只读；Git 忽略的 staging 副本用于解析和审计。

## CUSTOMER DATA

- 客户身份：46；公司：46
- `OKKI:int:1` 与 `OKKI:text:'0001` 保持为两个不同来源身份
- 45 个历史跟进中线索；1 个历史 CRM 线索
- 国家资料保留；出现某国家不会自动启用新的研究市场

## CONTACT DATA

- 联系人：248
- 唯一邮箱：248
- 通用业务邮箱仍保留，并与决策人语义分开
- 联系人未写入公开研究 `contacts` 表，不参与公开联系方式核验证据

## ACTIVITY DATA

- 营销邮件发送：82
- 人工跟进：1
- 有活动客户：39；无活动客户：7
- 内部链接和附件只保存在内部活动表，读取接口不投影这些字段

## WIN/LOSS DATA

- WON：0
- LOST：0
- Loss reasons：0
- `win_loss_coverage = NONE`

## MEXICO HISTORICAL ICP IMPACT

- Mexico OKKI 历史线索：1
- 已成交客户样本：5（未变）
- 已成交订单样本：13（未变）
- 特征：11（未变）
- 覆盖率：63.21（未变）
- Profile ID 与 build key 均未变，重建返回幂等结果

## UAE HISTORICAL CRM IMPACT

- UAE 历史 CRM 线索：7
- 只用于既往目标、联系和活动上下文
- 不标记为 UAE 成交客户历史

## EXISTING CUSTOMER / HISTORICAL LEAD CLASSIFICATION

- `INTERNAL_EXISTING_CUSTOMER`：仅有强独立成交证据时使用
- `HISTORICAL_OPEN_LEAD`：45
- `HISTORICAL_CRM_LEAD`：1
- `historical_contacted = true`：39
- Public strong / review：0 / 0
- Converted strong / review：0 / 0

## DATABASE COUNTS BEFORE / AFTER

| 表 | Before | After |
|---|---:|---:|
| companies | 97 | 97 |
| sources | 137 | 137 |
| contacts（公开研究） | 31 | 31 |
| lead_reviews | 93 | 93 |
| collection_runs | 12 | 12 |
| research_jobs | 16 | 16 |
| historical_customers | 5 | 51 |
| historical_customer_contacts | 0 | 248 |
| historical_customer_activities | 0 | 83 |
| historical_orders | 17 | 17 |
| historical_order_lines | 92 | 92 |
| product_master | 366 | 366 |
| historical_lead_outcomes | 0 | 0 |
| historical_customer_company_links | 0 | 0 |
| reference_data_import_batches | 1 | 2 |
| reference_data_source_files | 54 | 56 |
| reference_data_imports | 117 | 120 |
| reference_data_import_rows | 766 | 1143 |

## UI CHANGES

- Jobs 新增“历史客户记录 / Historical CRM Records”列表和 46/248/83 导入汇总
- 历史客户详情复用现有详情窗：概览、联系概况、历史活动
- 历史详情提供返回、关闭、Esc 和遮罩退出，不显示批准/拒绝
- 公开公司只有强关联时才在 History 页签显示对应 OKKI 历史
- 390px 视图保留公司、历史状态、分类、最近活动、操作；次要字段在详情展示
- 长表格使用组件内部滚动；活动正文使用展开显示；原生缩放保留
- 电话展示清理 Excel 文本标记，不改写数据库原始值
- Evidence 和 Customer Match 的原有语义保持不变

## TESTS

- 172 tests：169 passed，0 failed，3 skipped
- Docker：PostgreSQL、dashboard、n8n 正常运行
- 数据库计数、ICP 不变、幂等重放、ID 碰撞、活动语义、API 白名单均通过
- 浏览器桌面和 390 × 844 手机检查通过；页面无整体横向溢出

## BLOCKERS

无。

## GITHUB

repository: `https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal`
branch: `main`
commit: `2734ed2a0dc2cbfad14e92a4f8e206ca5afefdf2`
tag: `phase5-v2.3.1`
push_status: `PASS`
pushed_at: `2026-08-29T10:16:19+08:00`

## READY FOR PHASE 6

YES — Phase 5 V2.3.1 已完成 GitHub handoff；本次没有开始 Phase 6。

STOP — Phase 6 not started.
