# DPV Phase 6.1 V3 — 终端买手优先的品类采购匹配与产品机会推荐

## Codex Authoritative Execution Plan

```text
Document version: Phase 6.1 V3
Plan status: READY FOR IMPLEMENTATION
Prepared at: 2026-08-31
Supersedes: DPV_PHASE6_1_PRODUCT_MATCH_CODEX_PLAN_V2.md
Previous accepted release: phase6
Next release tag: phase6.1
```

本文件是 Phase 6.1 的最新权威执行计划。V2 保留为历史草案，但不再执行。

只执行 **Phase 6.1**。

不得重做 Phase 5 / Phase 6，不得提前进入 Phase 7，不得发送邮件、WhatsApp、表单或 Supplier Portal 请求。

---

# 1. 业务目标

DPV 做女装或日用百货，系统应优先寻找：

```text
真实采购这些品类
+
用于自己的终端零售体系销售
或
进口、批发、持有库存并向当地市场分销
```

的海外 B2B 客户。

系统首先回答：

```text
他们是否采购我们经营的品类？
他们是终端零售体系买家，还是有真实采购能力的渠道买家？
他们能否作为供应商合作对象？
谁负责采购？
如何联系？
```

具体 SKU、属性、价格、MOQ 的相似度用于通过后的销售推荐，不再作为客户进入 Product Match 通过层的第一道硬门槛。

---

# 2. 五个独立判断层

不得合并成一个黑箱成交概率。

```text
1. Category Procurement Match
   是否真实采购/经营 DPV 的产品大类

2. Buyer Business Model
   是终端零售体系买家、渠道买家，还是不明确中间人

3. Product Opportunity
   通过后，具体适合推荐哪些 DPV 商品

4. Cooperation Feasibility / Supplier Access
   DPV 是否有机会进入供应体系

5. Decision Maker / Contactability
   谁负责采购、是否有可用联系路径
```

以下既有分数继续独立：

```text
DPV Score
Management Baseline Match
Mexico Historical Reference Match
```

---

# 3. 目标客户优先级

## 3.1 第一优先级：`DIRECT_END_BUYER`

为自身终端销售体系采购商品的组织：

```text
连锁服装零售商
百货公司
超市 / Hypermarket
Lifestyle / Home 连锁
大型或区域零售集团
有组织采购体系的多门店零售商
拥有自营线上线下销售渠道的零售企业
```

关键特征：

```text
为自己的门店、网站或零售网络采购
官网持续展示目标品类
存在 Buyer / Buying / Category / Merchandising / Procurement 职能
```

## 3.2 第二优先级：`DISTRIBUTION_BUYER`

有真实采购和市场分销能力的渠道客户：

```text
进口商
批发商
分销商
区域经销集团
向零售商或直营网点供货的贸易组织
```

必须同时具备两类公开证据，不能只靠公司名称或自我标签：

```text
A. 采购来源证据（至少一项）
   实际进口相关品类
   实际采购相关品类
   明确存在外部供应商关系

B. 持货/销售渠道证据（至少一项）
   持有或管理库存、仓储或配送
   提供 B2B wholesale ordering / wholesale catalog
   代理或分销多个第三方品牌
   向零售商、门店或经销网络供货
   有 dealer network / distribution territory / distribution coverage
```

仅写有 `trading`、`supplier` 或 `distributor` 名称，不足以判定为 `DISTRIBUTION_BUYER`。

## 3.3 审核层：`UNCLEAR_INTERMEDIARY`

```text
General Trading 但业务内容不清楚
无法确认是否实际采购/持货/分销
只有企业注册信息
只有搜索摘要或目录标签
同时出现代理、顾问、撮合等模糊信号
```

此类对象不得自动进入 Product Match PASS。

## 3.4 排除层

```text
采购代理 / sourcing agent
经纪人 / broker
纯撮合平台
普通消费者
单个小商店
个人卖家
无法验证的社交账号
OEM-only 工厂
仅提供物流、咨询、营销或技术服务
纯小型电商卖家
明确 suppression / opt-out
```

自有品牌或生产型企业如果只生产自己的产品、没有外部采购证据：

```text
Product category may match
Buyer business model does not pass
```

---

# 4. 数据源契约

## 4.1 DPV 商品侧

只使用公司现有数据库：

```text
leadgen.product_master
leadgen.historical_order_lines
与商品可追溯关联的历史订单事实
```

不得使用：

```text
AI 生成商品
虚构商品
外部服务生成的替代商品
未进入 product_master 的临时候选
为了提高分数而猜测的分类
```

## 4.2 潜客侧

优先证据：

1. 企业官网商品分类页；
2. 企业官网产品页；
3. 官方在线目录；
4. 官方品牌/部门页；
5. 官方门店或销售渠道介绍；
6. 官方采购、供应商或年度报告；
7. 官方 wholesale / dealer / distribution 页面；
8. 官方进口、仓储、配送或分销网络说明；
9. 可信行业目录作为支持证据；
10. 搜索结果只作为 discovery hint。

## 4.3 本地处理

外部 provider 只接收：

```text
潜客公司名
潜客官网域名
市场语言的公开品类词
公开采购/进口/分销词
```

不得向外部 provider 发送：

```text
product_master 行
内部商品名称清单
供应商价格
历史客户价格
利润 / 毛利
历史订单
内部商品描述
共享盘路径
```

---

# 5. 当前基线

执行前重新核对：

```text
branch: main
Phase 6 implementation commit: 0abc006ccbeecec4608468a828f187235ea0185a
Phase 6 handoff baseline: 7896283e3bea5090f2a1820581a14bc9d56e73fa
tag: phase6
```

测试基线：

```text
238 tests
235 passed
0 failed
3 conditional skips
```

当前商品快照：

```text
product_master: 366
WOMENSWEAR: 109
GENERAL_MERCHANDISE: 18
UNKNOWN: 239
rows with product name: 358
category populated: 0
MOQ populated: 0
```

当前 Phase 6 acceptance set：

```text
7 companies
AE: 6
MX: 1
```

第一批仍计算：

```text
7 companies × 2 product profiles = 14 Category Procurement Match results
```

`companies.product_categories` 可能来自 ResearchJob 请求目标，不是客户真实经营证据。不得直接用于 PASS。

---

# 6. Phase 6.1 范围

必须完成：

```text
Buyer Business Model classification
Category Procurement Match
DPV product-profile catalog snapshot
Prospect category / retail / distribution evidence
Product Opportunity candidates
Supplier Access independent axis
Product Access Matrix V3
Readiness V3
7 × 2 recalculation
Fresh discovery integration
API / UI / tests / GitHub release
```

不做：

```text
全量 SKU 精确匹配作为硬门槛
外部向量数据库
外部 LLM matching service
自动外联
Phase 7
修改 DPV Score 权重
修改 Management Baseline Match
修改 Mexico Historical Reference Match
```

---

# 7. Reuse-First

编码前创建：

```text
docs/PHASE6_1_REUSE_RESEARCH.md
```

评估并记录：

```text
PostgreSQL / pg_trgm
Cheerio
GoRules ZEN
tldts / DomainService
现有 Tavily adapter
WebsiteReachabilityChecker
pg-boss
n8n
Tabler UI system
```

每项记录：

```text
license
deployment fit
privacy
cost
maintenance
integration boundary
decision
```

优先复用现有组件，不引入新的外部匹配平台。

---

# 8. DPV Product-Profile Catalog Snapshot

Category Procurement Match 只需先证明 DPV 当前数据库中存在目标产品大类，不要求先完成全部 366 个商品的 SKU taxonomy。

创建版本化快照：

```text
product_profile_catalog_snapshots
```

字段建议：

```text
id
snapshot_version
product_profile
eligible_product_count
classified_product_count
unknown_product_count
source_digest
coverage_percent
created_at
```

商品资格状态：

```text
CURRENT_CONFIRMED
HISTORICAL_ORDER_SUPPORTED
REFERENCE_ONLY
REVIEW
EXCLUDED
UNKNOWN
```

不得覆盖原始 `product_master`。

对于 Category Procurement Match：

```text
只要对应 profile 有经过确认/支持的真实商品集合，即可作为 DPV category side
```

对于 Product Opportunity：

```text
只有有明确分类和真实 product_master.id 的商品才能成为推荐候选
```

239 条 UNKNOWN 不强制分类，也不阻止已确认大类的 Category Procurement Match。

---

# 9. 受控 Category Taxonomy

创建最小可用、版本化 taxonomy：

```text
PRODUCT_PROFILE
  → CATEGORY
    → SUBCATEGORY
```

用途：

```text
规范化潜客公开品类
支持 DPV 商品大类快照
生成通过后的 Product Opportunity
```

建议文件：

```text
rules/product-taxonomy/v1/taxonomy.json
rules/product-taxonomy/v1/aliases.json
rules/product-taxonomy/v1/metadata.json
```

语言：

```text
English
Spanish
Chinese internal wording
```

状态：

```text
CONFIRMED
SUPPORTED
REVIEW
UNKNOWN
```

规则：

```text
明确商品文字/属性 → CONFIRMED or SUPPORTED
跨 profile 冲突 → REVIEW
只有文件路径/图片名 → UNKNOWN
证据不足 → UNKNOWN
```

---

# 10. Buyer Business Model

创建独立、可解释的分类结果：

```text
DIRECT_END_BUYER
DISTRIBUTION_BUYER
UNCLEAR_INTERMEDIARY
EXCLUDED_INTERMEDIARY
UNKNOWN
```

同时保存 subtype：

```text
CHAIN_RETAILER
DEPARTMENT_STORE
SUPERMARKET_HYPERMARKET
LIFESTYLE_RETAILER
ORGANIZED_ECOM_RETAILER
IMPORTER
WHOLESALER
DISTRIBUTOR
GENERAL_TRADING
SOURCING_AGENT
BROKER
OEM_ONLY
OTHER
```

## 10.1 `DIRECT_END_BUYER` 证据门槛

必须同时满足：

```text
组织化零售/百货/超市/Lifestyle 商业模式有明确证据
AND
目标品类在其自营销售渠道持续出现
```

企业官网持续销售该品类，可支持“存在该品类采购需求”，但不等于具名 Buyer 已验证。

## 10.2 `DISTRIBUTION_BUYER` 证据门槛

必须满足：

```text
目标品类证据
AND
至少一个采购/进口/外部供应商关系证据
AND
至少一个库存/仓储/B2B 订货/分销网络证据
```

强证据示例：

```text
official importer statement
official wholesale catalog
warehouse / inventory operation
dealer / retailer supply network
multi-brand distribution portfolio
import/export record from approved public source
```

## 10.3 `UNCLEAR_INTERMEDIARY`

以下单独出现时只能 REVIEW：

```text
公司名含 Trading
目录称 Distributor
搜索摘要称 Wholesaler
官网只写 general products
无具体商品/品牌/渠道/进口事实
```

## 10.4 排除

一旦明确：

```text
sourcing agent
broker
consultant
marketplace-only intermediary
OEM-only producer without external buying
```

分类为：

```text
EXCLUDED_INTERMEDIARY
```

同时映射：

```text
eligibility_status = INELIGIBLE
category_procurement_match_status = INELIGIBLE_BUYER_MODEL
```

并从新客户 Product Match PASS pool 排除。

---

# 11. Category Procurement Match Score

新增独立：

```text
CATEGORY_PROCUREMENT_MATCH_SCORE
0–100 or NULL
```

公司端 UI 可显示为：

```text
产品匹配 / Product Match
```

但 API/数据库必须保留其准确业务语义。

## 11.1 权重

```text
Target Category Procurement Evidence       45
Buyer Business Model Fit                   25
Assortment Depth / Category Importance     15
External Sourcing / Import Evidence        10
Recent Category Activity                    5
─────────────────────────────────────────────
Total                                     100
```

## 11.2 Target Category Procurement Evidence — 45

```text
official active category + multiple products/brands: 45
official dedicated category/department: 40
multiple official relevant product pages: 35
one official relevant product: 20
supported third-party evidence only: 10
confirmed unrelated assortment: 0
insufficient evidence: UNKNOWN
```

对于组织化终端零售商：

```text
持续销售目标品类
→ 支持存在该品类采购需求
```

但不证明具名 Buyer、供应商开放度或外部采购来源。

## 11.3 Buyer Business Model Fit — 25

```text
DIRECT_END_BUYER: 25
DISTRIBUTION_BUYER with strong procurement/import + operating evidence: 22
DISTRIBUTION_BUYER with supported procurement/import + operating evidence: 18
UNCLEAR_INTERMEDIARY: UNKNOWN; do not publish a numeric score
UNKNOWN: UNKNOWN; do not publish a numeric score
EXCLUDED_INTERMEDIARY: 0 and excluded
```

## 11.4 Assortment Depth — 15

```text
dedicated department + broad repeated assortment: 15
multiple brands/subcategories and active pages: 12
several relevant products/pages: 8
single incidental product: 3
confirmed no relevant assortment: 0
insufficient evidence: UNKNOWN
```

## 11.5 External Sourcing / Import — 10

```text
explicit relevant-category import/international sourcing: 10
explicit external supplier or multi-country sourcing: 8
third-party brand / distribution portfolio supports sourcing: 5
local/self-produced only: 0
insufficient evidence: UNKNOWN
```

## 11.6 Recent Category Activity — 5

```text
current accessible official category/product pages: 5
dated activity within 12 months: 5
dated activity within 24 months: 3
confirmed stale/discontinued category: 0
insufficient evidence: UNKNOWN
```

`captured_at` 不自动等于 `published_at`，但当前仍可访问的官方商品页可以作为 current assortment evidence。

---

# 12. Score 发布门槛与状态

## 12.1 计算与 Coverage

每个维度必须保存：

```text
state = OBSERVED / UNKNOWN / NOT_APPLICABLE
points
maximum
reason_codes
evidence_ids
```

计算：

```text
score = 所有 OBSERVED 维度实际 points 之和
coverage_percent = 所有 OBSERVED 维度 maximum 之和
```

UNKNOWN 维度不产生正向分，也不产生“不匹配”结论；它只降低 coverage 并进入 `missing_evidence`。

两个核心维度的 maximum 合计为 70。只有这两个核心维度都已观察，才达到发布 Product Match 分数的最低 coverage；其他维度负责提高证据完整度与排序：

```text
确认客户采购/销售 DPV 品类
+
确认是终端零售买家或真实渠道采购客户
→ Product Match 可以通过
```

可选的 assortment depth、external sourcing 和 recent activity 用于提高证据完整度与排序，不得补偿缺失的两个核心门槛。

## 12.2 必须条件

Product Match PASS 必须同时满足：

```text
DPV 对应 product profile 有真实商品快照
AND
Target Category Procurement Evidence 可判断
AND
Buyer Business Model = DIRECT_END_BUYER or DISTRIBUTION_BUYER
AND
coverage_percent >= 70
AND
score >= 60
```

`score >= 60` 但 Buyer Business Model 不明确，仍不得 PASS。

## 12.3 UNKNOWN

```text
核心品类证据缺失
OR
Buyer Business Model = UNKNOWN or UNCLEAR_INTERMEDIARY
OR
coverage < 70
```

结果：

```text
score = NULL
band = UNKNOWN
match_status = NEEDS_PRODUCT_EVIDENCE
```

## 12.4 状态

```text
CATEGORY_PROCUREMENT_MATCH
CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE
WEAK_CATEGORY_MATCH
PRODUCT_MISMATCH
NEEDS_PRODUCT_EVIDENCE
NEEDS_INTERNAL_CATALOG_EVIDENCE
INELIGIBLE_BUYER_MODEL
```

判定：

```text
CATEGORY_PROCUREMENT_MATCH:
  mandatory gates passed + score >= 60

CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE:
  target category is confirmed but buyer/distribution model is unclear

WEAK_CATEGORY_MATCH:
  some category evidence exists but score < 60

PRODUCT_MISMATCH:
  sufficient assortment evidence confirms no relevant category

NEEDS_PRODUCT_EVIDENCE:
  core evidence or coverage is insufficient

NEEDS_INTERNAL_CATALOG_EVIDENCE:
  DPV database lacks a CONFIRMED/SUPPORTED catalog snapshot for this product profile

INELIGIBLE_BUYER_MODEL:
  agent/broker/OEM-only/other excluded model is confirmed
```

## 12.5 Band

只对已发布分数：

```text
80–100 = VERY_HIGH
65–79  = HIGH
60–64  = MEDIUM
30–59  = LOW
0–29   = VERY_LOW
NULL   = UNKNOWN
```

---

# 13. Product Opportunity — 二级推荐层

只有 `CATEGORY_PROCUREMENT_MATCH` 通过后，才计算具体 Product Opportunity。

它回答：

```text
客户主要经营哪些子品类？
DPV 数据库有哪些真实商品可推荐？
哪些商品需要业务人员进一步确认？
```

Product Opportunity 不决定客户是否进入目标客户池。

每 company × profile 返回：

```text
0–20 real product candidates
```

同时返回 recommendation status：

```text
READY
PARTIAL_INTERNAL_CATALOG
NO_REAL_CANDIDATE
NOT_RUN_GATE_FAILED
```

`NOT_RUN_GATE_FAILED` 表示第一层 Category Procurement Match 未通过，因此不运行具体商品推荐；不得把它误写成商品库中没有商品。

候选必须：

```text
引用真实 product_master.id
有 CONFIRMED/SUPPORTED taxonomy assignment
catalog status != EXCLUDED
与潜客 observed category/subcategory 有明确关系
```

不足 5 个时不得补齐。

普通 UI 可显示：

```text
安全商品名
产品画像
category / subcategory
推荐理由
属性重合
catalog status
```

禁止显示：

```text
supplier cost
customer-specific historic price
profit
margin
historical customer identity
private order detail
source path
raw payload
```

具体价格、MOQ、认证、属性不明时：

```text
missing information
```

不得反向把已经通过的 Category Procurement Match 改成 PRODUCT_MISMATCH。

---

# 14. Product Opportunity Gap

状态：

```text
CONFIRMED_GAP
POSSIBLE_GAP
UNKNOWN
```

只有双方都有明确事实才能形成 `CONFIRMED_GAP`。

```text
missing DPV MOQ != MOQ mismatch
missing certification != certification gap
retail price != directly comparable supplier cost
different currency/unit != price mismatch
```

Gap 用于销售准备，不用于推翻已经确认的品类采购关系。

---

# 15. 数据库 Migration 024

创建：

```text
database/migrations/024_phase6_1_category_procurement_match.sql
```

事务化、additive only，不包含真实 fixture，不修改 Phase 6 历史结果。

## 15.1 建议实体

```text
product_profile_catalog_snapshots
product_taxonomy_nodes
product_taxonomy_aliases
product_master_taxonomy_assignments

prospect_category_sources
prospect_category_observations
buyer_business_model_results

category_procurement_match_results
category_procurement_match_dimensions
category_procurement_match_evidence

product_opportunity_candidates
product_opportunity_results
product_opportunity_gaps
product_opportunity_gap_evidence
```

## 15.2 `prospect_category_observations`

至少包含：

```text
id
research_job_id
company_id
source_id
observation_type
raw_category
raw_product_name nullable
raw_brand_or_department nullable
normalized_profile
normalized_category nullable
normalized_subcategory nullable
business_activity_role
evidence_text
source_authority
verification_status
captured_at
published_at nullable
evidence_hash
extraction_version
data_classification = PUBLIC_WEB
created_at
```

`observation_type`：

```text
PRODUCT_CATEGORY
PRODUCT_ITEM
RETAIL_CHANNEL
STORE_NETWORK
IMPORT_ACTIVITY
WHOLESALE_ACTIVITY
DISTRIBUTION_NETWORK
WAREHOUSE_INVENTORY
THIRD_PARTY_BRAND_PORTFOLIO
BUYING_DEPARTMENT
INTERMEDIARY_EXCLUSION
```

## 15.3 `buyer_business_model_results`

```text
id
research_job_id
company_id
buyer_model
buyer_subtype
eligibility_status
priority_tier
confidence_band
reason_codes
evidence_count
calculation_version
input_digest
created_at
```

枚举：

```text
eligibility_status = ELIGIBLE / NEEDS_EVIDENCE / INELIGIBLE
priority_tier = P1_DIRECT / P2_DISTRIBUTION / REVIEW / EXCLUDED
```

## 15.4 `category_procurement_match_results`

```text
id
research_job_id
company_id
product_profile
buyer_business_model_result_id
product_profile_catalog_snapshot_id
score nullable
band
match_status
coverage_percent
calculation_version
taxonomy_version
input_digest
execution_key
reason_codes
missing_evidence
created_at
```

必须 append-only。相同 execution key 安全 replay；输入或版本变化新增结果。

## 15.5 `product_opportunity_results`

```text
id
research_job_id
company_id
product_profile
category_procurement_match_result_id
recommendation_status
candidate_count
reason_codes
missing_catalog_evidence
calculation_version
input_digest
execution_key
created_at
```

`recommendation_status` 只允许：

```text
READY
PARTIAL_INTERNAL_CATALOG
NO_REAL_CANDIDATE
NOT_RUN_GATE_FAILED
```

## 15.6 Cooperation V3 扩展

新增字段：

```text
category_procurement_match_result_id
supplier_access_score nullable
supplier_access_band
supplier_access_coverage
product_access_matrix
readiness_blockers
cooperation_calculation_version
```

旧 Phase 6 行保持不变。

---

# 16. 现有数据库迁移机制

Compose 的 `/docker-entrypoint-initdb.d` 只在空 volume 生效。

必须增加显式 migration runner / ledger：

```text
验证目标数据库
数据库 advisory lock
migration SHA-256
事务内应用
记录 key/checksum/applied_at
相同 checksum replay 安全跳过
key 相同 checksum 不同则失败
应用后验证表/约束/索引
不删除或重建 volume
```

正式应用前后记录 aggregate counts。

---

# 17. Category / Buyer Evidence Discovery

## 17.1 搜索方向

AE：

```text
site:<domain> women clothing
site:<domain> dresses
site:<domain> brands women
site:<domain> stores
site:<domain> retail group
site:<domain> wholesale
site:<domain> distributor
site:<domain> importer
site:<domain> warehouse
site:<domain> dealer network
```

MX：

```text
site:<domain> ropa de mujer
site:<domain> vestidos
site:<domain> marcas mujer
site:<domain> tiendas
site:<domain> cadena minorista
site:<domain> mayorista
site:<domain> distribuidor
site:<domain> importador
site:<domain> almacén
site:<domain> red de distribuidores
```

## 17.2 边界

建议默认：

```text
max category/buyer queries per company/profile: 4
max unique queries per company: 8
max official pages per company: 12
max same-site discovery depth: 2
robots required
reuse crawler redirect/size/timeout limits
search snippets = discovery hints only
```

MarketProfile 保存各市场词汇，不散落硬编码。

## 17.3 强证据优先

终端买手证据优先搜索：

```text
store network
official category/department
official brands
retail channel
buying/category/merchandising department
```

渠道买家证据优先搜索：

```text
import activity
warehouse/inventory
wholesale catalog
distribution territory
dealer/retailer network
third-party brand portfolio
```

---

# 18. Job / Queue / n8n

新增 job type：

```text
CATEGORY_PROCUREMENT_ENRICHMENT
```

新增 query types：

```text
category_assortment
retail_channel
store_network
import_activity
wholesale_activity
distribution_network
inventory_warehouse
intermediary_exclusion
```

新增队列：

```text
collect-category-buyer-evidence
classify-buyer-business-model
calculate-category-procurement-match
calculate-product-opportunities
recalculate-cooperation-v3
```

粒度：

```text
company_id × product_profile
```

新增：

```text
workflows/03-phase6_1-category-procurement-match.json
```

浏览器 → Express → n8n → pg-boss → PostgreSQL 的现有边界保持不变。

不得把最多 100 家公司塞入一个长时间串行 worker。

---

# 19. Fresh Discovery

新公司 VERIFIED + ACTIVE 且通过基本组织资格后：

```text
enqueue category/buyer evidence
→ classify Buyer Business Model
→ calculate Category Procurement Match
→ if PASS: calculate Product Opportunity
→ calculate Supplier Access / Cooperation
→ Decision Maker / Contact readiness
```

不得按现有 `companies.product_categories` 预过滤后直接判定产品匹配。

没有证据的公司必须显示：

```text
NEEDS_PRODUCT_EVIDENCE
```

而不是从列表静默消失。

---

# 20. Cooperation Feasibility 与 Supplier Access

Product Match 和 Supplier Access 必须独立。

例如：

```text
大型女装连锁零售商
Category Procurement Match = PASS
但供应商体系邀请制
→ Product Match 高，Supplier Access 低
```

新增独立 Supplier Access 轴，仅使用：

```text
External Supplier Openness
Supplier Onboarding Accessibility
Buying / Procurement Accessibility
Commercial / Operational Feasibility
Supplier Lock-In Barrier
```

不把 Category Procurement Match 再算进 access score。

保存：

```text
supplier_access_score nullable
supplier_access_band = HIGH / MEDIUM / LOW_MEDIUM / LOW / UNKNOWN
supplier_access_coverage
```

Cooperation V3 可以引用 Category Procurement Match，但不得改写该结果。

---

# 21. Product Access Matrix V3

新增独立字段：

```text
product_access_matrix
```

不得重定义：

```text
Customer Match opportunity_matrix
Phase 6 access_opportunity_matrix
API cooperation_matrix historical semantics
```

枚举：

```text
DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS
DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS
DIRECT_BUYER_HIGH_PRODUCT_LOW_ACCESS

DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS
DISTRIBUTION_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS
DISTRIBUTION_BUYER_HIGH_PRODUCT_LOW_ACCESS

MEDIUM_PRODUCT_HIGH_ACCESS
MEDIUM_PRODUCT_MEDIUM_ACCESS
LOW_PRODUCT
UNKNOWN_PRODUCT
INELIGIBLE_BUYER_MODEL
```

同等产品匹配和 access 下：

```text
DIRECT_END_BUYER
>
DISTRIBUTION_BUYER
>
UNCLEAR_INTERMEDIARY
```

---

# 22. Readiness V3

保存：

```text
primary readiness
readiness_blockers[]
```

优先级：

```text
1. SUPPRESSED
2. EXISTING_CUSTOMER
3. INELIGIBLE_BUYER_MODEL
4. HISTORICAL_REVIEW
5. NEEDS_INTERNAL_CATALOG_EVIDENCE
6. NEEDS_PRODUCT_EVIDENCE
7. CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE
8. PRODUCT_MISMATCH
9. WEAK_CATEGORY_MATCH
10. NEEDS_DECISION_MAKER
11. NEEDS_CONTACT_ROUTE
12. NEEDS_VERIFICATION
13. STRATEGIC_LONG_SHOT / REVIEW
14. SALES_READY
```

`SALES_READY` 必须满足：

```text
company VERIFIED + ACTIVE
AND eligible organization
AND buyer_model IN (DIRECT_END_BUYER, DISTRIBUTION_BUYER)
AND category_procurement_match_status = CATEGORY_PROCUREMENT_MATCH
AND category_procurement_match_score >= 60
AND coverage >= 70
AND not existing customer
AND not suppressed
AND verified named buyer OR verified buying/procurement department
AND usable business contact route
AND traceable evidence
AND Cooperation Feasibility != LOW
```

Product Opportunity 候选数为 0 不单独阻止 SALES_READY，但应显示：

```text
NEEDS_PRODUCT_RECOMMENDATION
```

作为次级 blocker/销售准备提示，而不是 Product Match failure。

对应的推荐层状态为：

```text
READY                     = 有可用真实候选
PARTIAL_INTERNAL_CATALOG  = 有候选，但内部 catalog/taxonomy 覆盖不完整
NO_REAL_CANDIDATE         = 品类门槛已通过，但暂时没有真实 product_master 候选
NOT_RUN_GATE_FAILED       = 品类采购门槛未通过，未运行推荐层
```

---

# 23. 默认机会优先级

```text
1. Category Procurement Match PASS
2. Buyer Business Model: DIRECT_END_BUYER first
3. Category Procurement Match band / score
4. Verified profile-relevant Buyer / buying department
5. Contact quality
6. Supplier Access band
7. Product Access Matrix
8. Management Baseline Match
9. Mexico Historical Reference Match
10. DPV Score
11. Evidence recency
12. Company name
```

渠道买家仍保留并可成为高价值机会，但在同等条件下排在终端零售体系买家之后。

---

# 24. API

新增：

```text
GET /api/companies/:id/category-procurement-matches
GET /api/companies/:id/buyer-business-model
GET /api/companies/:id/product-opportunities

POST /api/category-procurement/jobs
GET /api/category-procurement/jobs/:id
GET /api/category-procurement/jobs/:id/results
POST /api/internal/category-procurement/jobs/:id/run
```

`GET /api/opportunities` 使用：

```text
one row per company × product_profile
```

返回：

```text
opportunity_key
product_profile
category_procurement_match_score
category_procurement_match_band
category_procurement_match_status
category_procurement_coverage
buyer_business_model
buyer_subtype
observed_categories
top_product_opportunity
product_opportunity_count
product_opportunity_status
supplier_access_band
product_access_matrix
readiness
readiness_blockers
```

新增筛选：

```text
buyer_business_model
buyer_subtype
category_procurement_match_band
category_procurement_match_status
product_access_matrix
```

API 使用字段白名单，禁止返回内部价格、客户订单、利润或供应商数据。

---

# 25. UI

必须先读：

```text
docs/UI_SYSTEM.md
```

## 25.1 Opportunities

推荐关键列：

```text
Company
Market / Product Profile
Buyer Model
Product Match
Product Opportunity
Supplier Access
Product Access Matrix
Buyer / Department
Best Contact
Secondary Scores
Readiness
```

`Product Match` 实际展示 Category Procurement Match：

```text
score / band
match status
coverage
```

`Buyer Model` 展示：

```text
终端零售买家 / Direct end buyer
渠道采购客户 / Distribution buyer
渠道模式待确认 / Channel model to confirm
已排除中间人 / Excluded intermediary
```

`Product Opportunity` 展示：

```text
Matched Category
Top recommended DPV product/category
Product recommendation gap
```

## 25.2 Mobile

390px / 375px 保留：

```text
Company
Product Profile
Buyer Model
Product Match
Supplier Access
Readiness
```

不得把 Buyer Model 或 Product Match 放入移动端隐藏列。

## 25.3 Company Detail

在 Overview 后新增：

```text
产品匹配 / Product Match
```

每个 profile 显示：

```text
Category Procurement Match
Buyer Business Model
Observed categories
Retail/store/distribution evidence
Product Opportunity candidates
Supplier Access
Missing evidence
Public source references
Last assessed
```

具名 Buyer 继续放在 Buying Contacts，不把“公司存在采购需求”显示成“已找到 Buyer”。

API error、缺证据、弱匹配、已确认不匹配和排除中间人必须是不同 UI 状态。

---

# 26. Deterministic Management Summary

根据结构化结果生成，不调用外部 LLM。

模板：

```text
客户类型：
<终端零售买家 / 渠道采购客户 / 待确认>

为什么匹配：
<目标品类与采购/销售渠道证据>

主要可切入品类：
<最多 3 个 category/subcategory>

优先推荐产品：
<0–3 个真实 product_master 候选；不足时不补造>

主要待确认：
<Buyer / supplier access / product recommendation gaps>

结论：
<优先继续 / 补证据 / 低优先级 / 排除>
```

---

# 27. 当前 7 家重算

固定使用 Phase 6 final acceptance job 的 7 家公司。

运行开始时将真实 company IDs 写入本地 ResearchJob 输入快照，不写入 Git 文档。

计算：

```text
7 companies × WOMENSWEAR
7 companies × GENERAL_MERCHANDISE
= 14 results
```

每条结果包含：

```text
Buyer Business Model
Category Procurement Match
Product Opportunity
Supplier Access
Product Access Matrix V3
Readiness V3
```

不得覆盖：

```text
Phase 6 acceptance job
Phase 6 feasibility v1
DPV Score
Management Baseline Match
Mexico Historical Reference Match
decision-maker evidence history
```

---

# 28. Tests

## 28.1 Buyer Business Model

```text
chain retailer + target category -> DIRECT_END_BUYER
department store + target department -> DIRECT_END_BUYER
supermarket/lifestyle chain + relevant category -> DIRECT_END_BUYER
importer + import evidence + retailer supply network -> DISTRIBUTION_BUYER
wholesaler + warehouse/catalog/network -> DISTRIBUTION_BUYER
distributor name only -> UNCLEAR_INTERMEDIARY
distributor self-claim without procurement/import evidence -> UNCLEAR_INTERMEDIARY, score NULL
distributor with procurement evidence but no stock/B2B/network evidence -> UNCLEAR_INTERMEDIARY, score NULL
general trading name only -> UNCLEAR_INTERMEDIARY
sourcing agent -> EXCLUDED_INTERMEDIARY
sourcing agent with many target-category pages -> EXCLUDED_INTERMEDIARY
broker -> EXCLUDED_INTERMEDIARY
OEM-only manufacturer without external buying -> EXCLUDED/NOT_ELIGIBLE
```

## 28.2 Category Procurement Match

```text
retailer sells womenswear across official categories -> PASS
retailer sells general merchandise category -> PASS for relevant profile
distributor imports target category and supplies retailers -> PASS
target category confirmed but buyer model unclear -> NEEDS_BUYING_EVIDENCE
direct retailer with target-category match but no named buyer -> Product Match PASS + NEEDS_DECISION_MAKER
single incidental product -> WEAK
electronics assortment with sufficient evidence -> PRODUCT_MISMATCH
missing assortment -> NEEDS_PRODUCT_EVIDENCE
DPV profile catalog snapshot missing or taxonomy insufficient -> NEEDS_INTERNAL_CATALOG_EVIDENCE
company name/search target alone -> no PASS
```

## 28.3 Separation Tests

```text
category match PASS without named buyer
named buyer still required for SALES_READY
category match PASS + closed supplier network -> high product / low access
no SKU candidate does not reverse category match PASS
precise SKU match cannot rescue an agent/broker/OEM-only buyer model
Product Opportunity cannot create a new company/category fact
Management Match does not create Category Procurement Match
companies.product_categories does not create Category Procurement Match
```

## 28.4 Product Opportunity

```text
all candidates reference real product_master.id
UNKNOWN products not fabricated into taxonomy
0 candidates allowed
fewer than 5 candidates not padded
supplier/customer prices absent from API/UI
missing MOQ/certification remains missing information
missing warehouse information remains UNKNOWN/review; it is not proof of exclusion
```

## 28.5 Readiness / Matrix

```text
DIRECT_END_BUYER ranks above equal DISTRIBUTION_BUYER
DISTRIBUTION_BUYER remains eligible for SALES_READY
UNCLEAR_INTERMEDIARY cannot become SALES_READY
EXCLUDED_INTERMEDIARY cannot become SALES_READY
equal match/access/contact tie resolves DIRECT_END_BUYER before DISTRIBUTION_BUYER
score >=60 + mandatory gates required
readiness precedence table
all blockers retained
Supplier Access independent from Product Match
Matrix V3 deterministic
```

## 28.6 Data Isolation

```text
external provider payload contains no internal product rows
no supplier price
no customer-specific history
no order payload
no private source path
Git fixtures synthetic only
telemetry aggregate only
```

## 28.7 Migration / Jobs

```text
migration applies to new and existing DB
advisory lock/checksum replay
append-only results
same execution key idempotent
7 × 2 results preserved
partial/timeout/retry
fresh discovery enqueue
Express/n8n/pg-boss boundaries
```

## 28.8 UI

```text
Buyer Model visible desktop/mobile
Product Match visible desktop/mobile
two profiles visible
error / unknown / weak / mismatch / excluded distinct
keyboard/focus/loading/empty/long content
light/dark
comfortable/compact
reduced motion
no page-level horizontal overflow
BD hidden
```

尺寸：

```text
1440×900
1024×768
768×900
390×844
375×667
844×390
```

最终：

```text
npm test
0 failed
```

---

# 29. Acceptance Report

创建：

```text
docs/PHASE6_1_PRODUCT_MATCH_RESULT.md
```

报告安全聚合：

```text
STATUS / versions / job ID
companies and 14 profile results

DIRECT_END_BUYER count
DISTRIBUTION_BUYER count
UNCLEAR_INTERMEDIARY count
EXCLUDED_INTERMEDIARY count

CATEGORY_PROCUREMENT_MATCH
CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE
WEAK_CATEGORY_MATCH
PRODUCT_MISMATCH
NEEDS_PRODUCT_EVIDENCE
NEEDS_INTERNAL_CATALOG_EVIDENCE
INELIGIBLE_BUYER_MODEL

Product Opportunity candidate aggregate
Product Opportunity status distribution
Supplier Access distribution
Matrix V3 distribution
Readiness changes
evidence URL count
missing evidence
errors/timeouts
tests
GitHub metadata
```

GitHub 报告禁止列出真实内部商品 ID、名称、价格或订单明细。

同时更新：

```text
docs/PHASE6_RESULT.md
docs/PHASE6_DECISION_MAKER_DATA_CONTRACT.md
docs/UI_SYSTEM.md
docs/VERSION_CHANGELOG.md
workflows/README.md
```

---

# 30. PASS Gate

```text
[ ] Product Match 核心语义是“目标品类采购 + Buyer Business Model”
[ ] DIRECT_END_BUYER 为最高优先级
[ ] DISTRIBUTION_BUYER 同时有采购/进口/外部供应商关系证据与持货/B2B/分销网络证据
[ ] Importer/wholesaler/distributor 仍可成为合格客户
[ ] Trading/distributor 名称本身不构成通过证据
[ ] UNCLEAR_INTERMEDIARY 不发布数值 Product Match 分数
[ ] Agents/brokers/OEM-only 被正确排除
[ ] DPV 商品侧只使用现有 product_master / historical product facts
[ ] DPV 内部 profile catalog/taxonomy 不足时返回 NEEDS_INTERNAL_CATALOG_EVIDENCE
[ ] 内部商品数据未发送给外部 provider
[ ] 原始 product_master 未被覆盖
[ ] UNKNOWN 未被强制分类
[ ] Category Procurement Match 按 company × profile 计算
[ ] 当前 7 家产生 14 个结果
[ ] coverage >=70、score >=60 且 Buyer Business Model gate 通过才 Product Match PASS
[ ] 没有证据不是 PRODUCT_MISMATCH
[ ] Product Opportunity 是二级推荐，不是第一道硬门槛
[ ] Product Opportunity candidates 全部引用真实 product_master.id
[ ] 0 个候选不会反向推翻 Category Procurement Match
[ ] Product Opportunity recommendation status 四态已实现
[ ] Supplier Access 与 Product Match 独立
[ ] Product Access Matrix V3 不重定义旧矩阵
[ ] Named Buyer 继续作为 SALES_READY 独立门槛
[ ] API/UI 显示 Buyer Model、Product Match、Supplier Access
[ ] API/UI/Git 不暴露内部限制字段
[ ] Phase 6 历史结果保持不变
[ ] Fresh discovery 已接入
[ ] 现有数据库 migration apply PASS
[ ] tests 0 failed
[ ] browser matrix PASS
[ ] GitHub main push PASS
[ ] annotated tag phase6.1 push PASS
```

---

# 31. GitHub Release

采用两提交协议。

## 31.1 Implementation Commit

发布前：

```text
git diff --check
git status
staged diff sensitive-data scan
```

确认没有：

```text
.env / secrets
raw Excel
shared-folder files
OKKI exports
staging
database dumps
real internal product detail exports
customer/order payloads
```

提交：

```text
phase6.1: add buyer-first category procurement matching
```

push `main` 并远端核验。

## 31.2 Handoff Commit

结果文档记录：

```text
implementation_commit
implementation_push_status
implementation_pushed_at
repository
branch
```

提交：

```text
docs: record phase6.1 GitHub handoff
```

## 31.3 Tag

创建 annotated tag：

```text
phase6.1
```

tag 指向 handoff commit。push 后远端核验 main、tag object 和 peeled commit。

最终工作树干净。

---

# 32. Execution Order

```text
1. Preflight Git / DB / tests
2. Reuse-first research
3. Freeze Buyer Business Model evidence contract
4. Freeze Category Procurement Match rules
5. Build minimal taxonomy and product-profile catalog snapshot
6. Add explicit existing-DB migration runner
7. Add migration 024
8. Build prospect category/channel evidence collection
9. Build Buyer Business Model classifier
10. Build Category Procurement Match GoRules v1
11. Build Product Opportunity candidate service
12. Build Supplier Access independent axis
13. Build Matrix V3 and Readiness V3
14. Add job / queues / n8n / fresh-discovery hook
15. Update APIs and ordering
16. Update Opportunities and Company Detail UI
17. Run synthetic and regression tests
18. Apply migration to existing DB
19. Recalculate fixed Phase 6 acceptance set: 7 × 2
20. Run live acceptance and browser matrix
21. Create/update reports
22. Implementation commit + push + verify
23. Handoff commit
24. Annotated tag phase6.1 + push + verify
25. STOP
```

---

# 33. STOP

Phase 6.1 PASS 后立即停止：

```text
STOP — Phase 7 not started.
```

交付：

```text
docs/PHASE6_1_PRODUCT_MATCH_RESULT.md
updated docs/PHASE6_RESULT.md
updated docs/PHASE6_DECISION_MAKER_DATA_CONTRACT.md
updated docs/UI_SYSTEM.md
updated docs/VERSION_CHANGELOG.md
phase6.1 GitHub tag verification
```
