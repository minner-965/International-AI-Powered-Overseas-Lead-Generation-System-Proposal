# DPV Phase 6.1 V2 — 现有商品数据库驱动的潜客产品匹配与合作门控

## Codex Authoritative Execution Plan

```text
Document version: Phase 6.1 V2
Plan status: READY FOR IMPLEMENTATION
Prepared at: 2026-08-31
Previous accepted release: phase6
Next release tag: phase6.1
```

本文件是 Phase 6.1 的最新权威执行计划。

执行 **Phase 6.1 only**。

Phase 5 已封板，Phase 6 已通过验收并推送 GitHub。不得重做 Phase 5 / Phase 6，不得提前进入 Phase 7。

---

# 1. 本版已冻结的核心决定

## 1.1 DPV 商品匹配来源

产品匹配必须使用公司现有数据库中的真实商品：

```text
leadgen.product_master
+
已关联的 leadgen.historical_order_lines / historical order facts
```

DPV 商品侧不得使用：

```text
AI 生成商品
虚构商品
外部服务返回的替代商品
为了提高匹配分数而补造的分类
未进入 product_master 的临时候选
```

每一个 Top Matched DPV Product 必须引用真实：

```text
product_master.id
```

`product_master` 原始记录是 Source of Truth。Phase 6.1 新增规范化分类和状态分配，但不得覆盖原始名称、原始 product_profile、原始属性或原始来源关系。

## 1.2 潜客商品来源

潜客侧只能使用可追溯的公开商品证据：

1. 企业官网分类页；
2. 企业官网商品页；
3. 企业官方在线目录；
4. 企业官方品牌或部门页；
5. 企业官方年度报告、供应商材料或品类介绍；
6. 企业控制的官方店铺页；
7. 可信的公开经销商或目录页；
8. 搜索结果只作为 discovery hint，不直接成为已验证商品事实。

不得因为公司名称、搜索目标品类或 Management Match 推断客户商品。

## 1.3 匹配运行位置

```text
公开搜索服务：只接收潜客公司名、官网域名、公开品类词
本地数据库：保存 DPV 商品、潜客观察、taxonomy、匹配结果
本地规则引擎：完成最终 Product Match
```

不得向 Tavily、Hunter 或其他外部服务发送：

```text
product_master 行
内部商品名称清单
供应商价格
客户历史价格
利润 / 毛利
历史客户订单
共享盘路径
内部商品描述原文
```

## 1.4 当前 Phase 6 重算范围

固定使用 Phase 6 最终 acceptance job 的 7 家 accepted companies 作为第一批重算输入。

对每家公司分别计算两个产品画像：

```text
7 companies × 2 product profiles = 14 Product Match results
```

产品画像：

```text
WOMENSWEAR
GENERAL_MERCHANDISE
```

不得只按公司现有 `product_categories` 预过滤，也不得只输出一个无产品画像上下文的公司级分数。

---

# 2. 当前已确认的基线

执行前再次核对，不得直接假定：

```text
repository:
https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal

branch:
main

Phase 6 implementation commit:
0abc006ccbeecec4608468a828f187235ea0185a

Phase 6 handoff commit / current baseline:
7896283e3bea5090f2a1820581a14bc9d56e73fa

tag:
phase6
```

已知测试基线：

```text
tests: 238
passed: 235
failed: 0
skipped: 3
```

已知本地商品数据库快照：

```text
product_master total: 366
WOMENSWEAR: 109
GENERAL_MERCHANDISE: 18
UNKNOWN: 239
rows with product_name: 358
normalized category populated: 0
MOQ populated: 0
```

这些数字只用于 preflight 对比。实现时必须重新读取数据库并在本地验收记录中保存 before snapshot。

重要：当前 `companies.product_categories` 可能包含 ResearchJob 请求的目标品类。它不是潜客真实商品证据，不能作为 Phase 6.1 Product Match 的直接输入。

---

# 3. Phase 6.1 范围

本阶段必须完成：

```text
DPV 现有商品 taxonomy v1
DPV 商品规范化分配
潜客商品公开证据采集
Product Match 0–100 / UNKNOWN
Top matched real DPV products
Product Gap
Cooperation Feasibility v2
Supplier Access 独立轴
Product Access Matrix V2
Readiness V2
当前 7 家 × 两产品画像重算
正常新客户路径接入
Opportunities / Company Detail UI
测试、验收、GitHub push/tag
```

本阶段不做：

```text
自动发邮件
自动发送 WhatsApp
自动提交联系表单
自动提交 Supplier Portal
Phase 7 sequence / follow-up
外部 LLM/vector matching service
共享盘重新扫描 Phase
OKKI 重新导入
修改 DPV Score 权重
修改 Management Baseline Match
修改 Mexico Historical Reference Match
```

---

# 4. Reuse-First Preflight

编码前创建：

```text
docs/PHASE6_1_REUSE_RESEARCH.md
```

至少评估并记录：

| Capability | Candidate | Expected decision |
| --- | --- | --- |
| Local fuzzy candidate recall | PostgreSQL `pg_trgm` | Reuse |
| HTML parsing | Cheerio | Reuse |
| Deterministic scoring | GoRules ZEN | Reuse with new versioned rules |
| Domain normalization | tldts / DomainService | Reuse |
| Public search | Existing Tavily adapter | Reuse |
| Bounded crawling | Existing WebsiteReachabilityChecker | Reuse and extend |
| Queue / retry | pg-boss | Reuse with product-match queues |
| Orchestration | n8n | Reuse with Phase 6.1 workflow |
| UI | Existing Tabler CRM system | Reuse |
| PDF catalogs | Existing PDF tooling only if required and approved by source/bounds | Evaluate |
| Browser UI verification | Existing manual/browser flow; evaluate Playwright only if adding a dependency | Evaluate |

每项记录：

```text
license
deployment fit
data privacy
operating cost
maintenance status
integration boundary
adopt / reject reason
```

没有充分理由不得新增外部服务或新的匹配基础设施。

---

# 5. Taxonomy V1

## 5.1 层级

统一使用：

```text
PRODUCT_PROFILE
  → CATEGORY
    → SUBCATEGORY
      → ATTRIBUTE SET
```

示例：

```text
WOMENSWEAR
  → TOPS
    → BLOUSE
      → material / size / color / style / consumer_segment

GENERAL_MERCHANDISE
  → PET
    → PET_PAD
      → material / size / absorbency / pack_format
```

## 5.2 必须版本化

新增受控 taxonomy 数据，不把 taxonomy 硬编码散落在 service 代码中。

建议：

```text
rules/product-taxonomy/v1/taxonomy.json
rules/product-taxonomy/v1/aliases.json
rules/product-taxonomy/v1/metadata.json
```

数据库保存实际使用的 taxonomy version 和 assignment。

## 5.3 别名

至少支持：

```text
English
Spanish
Chinese internal product wording
```

别名必须指向明确 taxonomy node，并标记：

```text
EXACT
PARENT
ADJACENT
AMBIGUOUS
```

## 5.4 UNKNOWN 原则

```text
没有明确文字/属性证据 → UNKNOWN
跨 profile 冲突 → REVIEW
只有文件位置或图片名 → UNKNOWN
只凭历史 profile 标签但商品内容冲突 → REVIEW
```

不得为了提高分类覆盖率批量猜测 239 条 UNKNOWN 商品。

---

# 6. DPV 商品可用性与规范化分配

`product_master` 不自动等于“当前可立即销售”。新增独立状态层，不修改原表事实。

建议状态：

```text
CURRENT_CONFIRMED
HISTORICAL_ORDER_SUPPORTED
REFERENCE_ONLY
REVIEW
EXCLUDED
UNKNOWN
```

Top matched candidates 规则：

```text
taxonomy assignment = CONFIRMED or SUPPORTED
AND catalog status != EXCLUDED
AND real product_master.id exists
```

UI 必须展示安全的来源分类，但不得把历史订单商品描述成已确认当前库存。

同一商品多来源/多版本时，必须通过稳定 canonical key 去重；不得按名称相似度自动合并成同一商品事实。

---

# 7. Database Migration 024

创建：

```text
database/migrations/024_phase6_1_product_match.sql
```

必须：

```text
BEGIN / COMMIT
additive only
不含真实公司 fixture
不含真实商品 fixture
不删除 Phase 6 数据
不修改历史 Phase 6 rule_version
```

## 7.1 `product_taxonomy_nodes`

核心字段：

```text
id
taxonomy_version
product_profile
node_type
canonical_code
canonical_name
parent_id nullable
status
created_at
```

## 7.2 `product_taxonomy_aliases`

```text
id
taxonomy_node_id
taxonomy_version
language
market_code nullable
raw_alias
normalized_alias
alias_match_type
status
created_at
```

## 7.3 `product_master_taxonomy_assignments`

```text
id
product_master_id
taxonomy_node_id nullable
taxonomy_version
assignment_status
catalog_status
classification_version
reason_codes
source_fields
input_digest
created_at
```

`assignment_status`：

```text
CONFIRMED
SUPPORTED
REVIEW
UNKNOWN
```

## 7.4 `prospect_product_sources`

独立保存产品证据页面，避免把产品事实错误挂到 decision-maker sources。

```text
id
research_job_id
company_id
source_url
source_type
source_authority
captured_at
published_at nullable
page_title nullable
evidence_hash
content_fetched
fetch_status
verification_status
created_at
```

## 7.5 `prospect_product_observations`

```text
id
research_job_id
company_id
prospect_product_source_id
raw_product_name nullable
raw_category nullable
raw_brand_or_department nullable
raw_attributes jsonb
normalized_profile
normalized_category nullable
normalized_subcategory nullable
material nullable
size_spec nullable
packaging_format nullable
use_case nullable
consumer_segment nullable
public_price nullable
currency nullable
public_price_type
buy_sell_source_role
evidence_text
evidence_hash
extraction_version
verification_status
data_classification = PUBLIC_WEB
created_at
```

允许：

```text
normalized_profile = UNKNOWN
```

## 7.6 `product_match_results`

```text
id
research_job_id
company_id
product_profile
score nullable
score_min nullable
score_max nullable
band
match_type
coverage_percent
known_weight
calculation_version
taxonomy_version
product_master_snapshot_digest
observation_set_digest
execution_key
reason_codes
missing_evidence
created_at
```

`band`：

```text
VERY_HIGH
HIGH
MEDIUM
LOW
VERY_LOW
UNKNOWN
```

同一 `execution_key` replay 返回现有结果；输入摘要或规则版本变化则新增结果。结果必须 append-only。

## 7.7 子表

```text
product_match_dimensions
product_match_dimension_evidence
product_match_candidates
product_match_gaps
product_match_gap_evidence
```

关键外键：

```text
product_match_candidates.product_master_id
  → product_master.id

product_match_dimension_evidence.prospect_product_observation_id
  → prospect_product_observations.id

product_match_gap_evidence.prospect_product_observation_id
  → prospect_product_observations.id
```

## 7.8 Cooperation V2 扩展

在新版本结果中增加：

```text
product_match_result_id
cooperation_calculation_version
supplier_access_score nullable
supplier_access_band
supplier_access_coverage
product_access_matrix
readiness_blockers
```

旧 Phase 6 行保持原值和 null 新字段。

## 7.9 ResearchJob 扩展

新增 job type：

```text
PRODUCT_MATCH_ENRICHMENT
```

新增 query types：

```text
product_category_official
product_catalog_official
product_page_official
product_brand_department
product_sourcing_signal
```

新增安全 aggregate counters，不保存敏感内部商品 payload。

---

# 8. 现有数据库迁移应用机制

当前 Compose 把 migrations 挂到：

```text
/docker-entrypoint-initdb.d
```

它只对空 PostgreSQL volume 自动执行。不得假设新增 `024` 会自动应用到现有数据库。

Phase 6.1 必须增加显式、可审计的 migration apply 流程：

1. 校验目标数据库和当前 schema；
2. 计算 migration 文件 SHA-256；
3. 使用数据库 advisory lock 防止并发应用；
4. 在事务内应用；
5. 记录 migration key、checksum、applied_at；
6. 重复运行相同 checksum 时安全跳过；
7. key 相同但 checksum 不同时失败；
8. 应用后验证新增表、约束和索引；
9. 不删除或重建现有 volume。

正式应用前记录 before counts，应用后记录 after counts。

---

# 9. 商品证据采集

## 9.1 先复用已有公开证据

Phase 4 的 `PRODUCT_CATEGORY` verification evidence 可以作为第一批输入，但必须经过 Phase 6.1 的 source authority、URL、captured_at 和 observation 提取规则。

不得把 SearchJob 请求参数当成 observation。

## 9.2 MarketProfile 词汇

把词汇放入 MarketProfile/config，不散落在 service。

AE 示例：

```text
site:<domain> women clothing
site:<domain> dresses
site:<domain> tops
site:<domain> home living
site:<domain> household
site:<domain> pet
site:<domain> products
site:<domain> brands
```

MX 示例：

```text
site:<domain> ropa de mujer
site:<domain> vestidos
site:<domain> blusas
site:<domain> hogar
site:<domain> artículos para el hogar
site:<domain> mascotas
site:<domain> categorías
site:<domain> marcas
```

## 9.3 运行边界

实现前把最终边界写入 config 并测试。建议默认：

```text
max product queries per company/profile: 4
max unique product queries per company: 8
max official product pages per company: 12
max same-site discovery depth: 2
max redirects: reuse current crawler bound
max response size: reuse current crawler bound
robots: required
cross-domain redirect: rejected unless explicitly allowed source type
search result snippet: discovery hint only
```

PDF/大型 catalog：

```text
仅处理公开、可访问、在大小/页数限制内的文件
保存 URL、抓取时间、页码或结构化位置
超出限制时标记 PARTIAL，不绕过限制
```

## 9.4 Source Authority

```text
OFFICIAL_PRODUCT_PAGE
OFFICIAL_CATEGORY_PAGE
OFFICIAL_CATALOG
OFFICIAL_DOCUMENT
OFFICIAL_STOREFRONT
SUPPORTED_DISTRIBUTOR_CATALOG
SEARCH_DISCOVERY
OTHER_PUBLIC
```

`SEARCH_DISCOVERY` 不能单独支持 VERIFIED observation。

---

# 10. Product Match 计算发布门槛

## 10.1 UNKNOWN 与 NO_MATCH

完全缺少核心证据时：

```text
score = NULL
band = UNKNOWN
match_type = UNKNOWN
readiness blocker = NEEDS_PRODUCT_EVIDENCE
```

只有存在充分的潜客实际商品组合证据、且确认没有重合时，才允许：

```text
score = 0–29
band = VERY_LOW
match_type = NO_MATCH
```

不得把“没有找到”解释为“不销售”。

## 10.2 最低可评分条件

发布 0–100 分数必须同时满足：

```text
Category Overlap 可判断
Assortment Depth / Relevance 可判断
coverage_percent >= 50
DPV 对应 profile 至少有一个 CONFIRMED/SUPPORTED taxonomy product
```

可评分后：

```text
known_weight = 已有可靠证据维度的权重总和
score = round(sum(known_dimension_points) / known_weight × 100)
score_min = sum(known_dimension_points)
score_max = score_min + sum(unknown_dimension_max_points)
coverage_percent = known_weight
```

未知维度不计 0 分，也不当作已确认匹配；它们从 score 的已知维度分母中排除，同时列入 `missing_evidence` 并通过 coverage、score_min、score_max 显示不确定范围。

Product Match band 使用 `score`，但任何排序、Readiness 或 Cooperation V2 使用该分数时都必须同时检查 coverage gate。不得只取高分而忽略低覆盖率。

`score_min` 是在完整 100 分权重下的保守下界；`score_max` 是未知维度全部满足时的理论上界。二者不替代正式 `score`，仅用于解释资料不完整性。

---

# 11. Product Match V1 评分规则

创建：

```text
rules/product-match/v1/decision.json
rules/product-match/v1/metadata.json
```

总权重：

```text
Category Overlap                      35
Assortment Depth / Relevance          15
Commercial Positioning / Price Band  15
Attribute / Specification Fit         10
MOQ / Order Format Compatibility      10
Import / Sourcing Model Fit           10
Recent Product Signal                  5
────────────────────────────────────────
Total                                100
```

## 11.1 Category Overlap — 35

建议确定性分值：

```text
same normalized subcategory: 35
same normalized category, different subcategory: 27
same parent category: 18
explicit adjacent category: 8
confirmed unrelated assortment: 0
insufficient evidence: UNKNOWN
```

多品类时保留所有 matched categories，并以最强匹配为主分，同时由 Assortment Depth 反映广度。

## 11.2 Assortment Depth / Relevance — 15

以去重后的当前 observation、官方页面和专门部门证据计算：

```text
dedicated category/department + broad repeated assortment: 15
dedicated category + multiple distinct observations: 12
multiple relevant observations/pages: 8
single incidental relevant product: 4
confirmed no relevant assortment: 0
insufficient evidence: UNKNOWN
```

具体 SKU/page 阈值必须写入 metadata 和测试，不只写在代码注释中。

## 11.3 Commercial Positioning / Price Band — 15

允许比较：

```text
相同价格语义
相同或明确可比单位
相同货币
明确的商品/品类对应关系
```

Phase 6.1 V1 不做实时汇率换算。

```text
prospect retail price != DPV supplier cost
prospect retail price != automatically comparable DPV customer sales price
```

只有明确的 wholesale/export comparable facts 或明确的 value/mid/premium positioning 证据才评分。否则 UNKNOWN。

## 11.4 Attribute / Specification Fit — 10

比较：

```text
material
fabric
size/specification
packaging format
style/use case
consumer segment
```

只比较双方都有明确值的属性。

## 11.5 MOQ / Order Format Compatibility — 10

当前 DPV `moq` 全为空，因此不得产生 MOQ fit 分数。

只有未来双方都有明确 MOQ / case pack / carton / order format 证据时评分。

```text
missing supplier requirement != mismatch
missing DPV MOQ != compatible
```

## 11.6 Import / Sourcing Model Fit — 10

只使用明确公开证据：

```text
international sourcing
imported assortment
multi-country suppliers
third-party brands
external vendor program
relevant-category import evidence
```

## 11.7 Recent Product Signal — 5

允许：

```text
当前可访问的官方 category/product page
有日期的近期 catalog
近期新品或品类推广
```

`captured_at` 只表示何时看到页面，不自动等于 published_at。

---

# 12. Match Band 与 Match Type

## 12.1 Band

```text
80–100 = VERY_HIGH
65–79  = HIGH
50–64  = MEDIUM
30–49  = LOW
0–29   = VERY_LOW
NULL   = UNKNOWN
```

## 12.2 Match Type

```text
DIRECT_MATCH
ADJACENT_MATCH
WEAK_MATCH
NO_MATCH
UNKNOWN
```

确定性规则：

```text
DIRECT_MATCH:
  exact subcategory or same-category evidence with published score >= 50

ADJACENT_MATCH:
  strongest valid relation is parent/adjacent and score >= 30

WEAK_MATCH:
  some overlap exists but score < 50

NO_MATCH:
  sufficient assortment evidence + confirmed category overlap = 0

UNKNOWN:
  score is NULL or core evidence gate not met
```

---

# 13. Top Matched DPV Products

每个 company × product_profile 返回：

```text
up to 20 candidates
```

不是强制至少 5 个。真实匹配只有 0–4 个时不得补齐。

字段：

```text
product_master_id
safe product name
product_profile
normalized category
normalized subcategory
match_strength
match_reason_codes
attribute_overlap
catalog_status
source_classification
rank
```

排序 tie-break：

```text
match_strength DESC
taxonomy specificity DESC
attribute overlap count DESC
catalog status priority
stable product_master_id ASC
```

普通 UI / API 禁止返回：

```text
supplier_price
supplier_currency
customer-specific historic price
profit
margin
historical customer/order identity
source_import_row_id
shared-folder path
asset_reference
raw internal payload
```

---

# 14. Product Gap

状态：

```text
CONFIRMED_GAP
POSSIBLE_GAP
UNKNOWN
```

`CONFIRMED_GAP` 必须同时有：

```text
明确潜客要求
+
明确 DPV 商品事实
+
可追溯的 incompatibility reason
```

缺少资料只能是：

```text
UNKNOWN
```

可能存在但证据不足：

```text
POSSIBLE_GAP
```

Gap 类型至少包括：

```text
CATEGORY_GAP
PRICE_POSITIONING_GAP
ATTRIBUTE_GAP
CERTIFICATION_GAP
MOQ_GAP
ORDER_FORMAT_GAP
SOURCING_MODEL_GAP
```

---

# 15. Cooperation Feasibility V2

不得原地修改：

```text
rules/cooperation-feasibility/v1
```

新增：

```text
rules/cooperation-feasibility/v2/decision.json
rules/cooperation-feasibility/v2/metadata.json
```

## 15.1 Product Dimension 消费独立 Product Match

```text
80–100 → 15/15
65–79  → 12/15
50–64  → 9/15
30–49  → 4/15
0–29   → 0/15
UNKNOWN → state UNKNOWN; do not invent positive or negative evidence
```

V2 行必须引用：

```text
product_match_result_id
product match calculation_version
```

Product Match evidence 不再链接到 `decision_maker_sources`。

## 15.2 Supplier Access 独立轴

Matrix V2 不能使用已经包含 Product Match 的完整 Cooperation 分数作为 access 轴，否则会重复计算产品。

从以下五个非产品维度计算独立 Supplier Access：

```text
External Supplier Openness
Supplier Onboarding Accessibility
Buying / Procurement Accessibility
Commercial / Operational Feasibility
Supplier Lock-In Barrier
```

保存：

```text
supplier_access_score nullable
supplier_access_band = HIGH / MEDIUM / LOW_MEDIUM / LOW / UNKNOWN
supplier_access_coverage
```

coverage 不足时 band = UNKNOWN，不把一组 UNKNOWN 中性分伪装成已知中等可行性。

---

# 16. Product Access Matrix V2

新增独立字段：

```text
product_access_matrix
```

不得覆盖：

```text
Customer Match opportunity_matrix
Phase 6 access_opportunity_matrix
API cooperation_matrix historical meaning
```

V2 枚举：

```text
HIGH_PRODUCT_HIGH_ACCESS
HIGH_PRODUCT_MEDIUM_ACCESS
HIGH_PRODUCT_LOW_ACCESS
MEDIUM_PRODUCT_HIGH_ACCESS
MEDIUM_PRODUCT_MEDIUM_ACCESS
LOW_PRODUCT
UNKNOWN_PRODUCT
```

建议映射：

```text
Product VERY_HIGH/HIGH + Access HIGH       → HIGH_PRODUCT_HIGH_ACCESS
Product VERY_HIGH/HIGH + Access MEDIUM     → HIGH_PRODUCT_MEDIUM_ACCESS
Product VERY_HIGH/HIGH + Access LOW*       → HIGH_PRODUCT_LOW_ACCESS
Product MEDIUM + Access HIGH               → MEDIUM_PRODUCT_HIGH_ACCESS
Product MEDIUM + Access MEDIUM/LOW_MEDIUM  → MEDIUM_PRODUCT_MEDIUM_ACCESS
Product LOW/VERY_LOW                       → LOW_PRODUCT
Product UNKNOWN                            → UNKNOWN_PRODUCT
```

Access UNKNOWN 时不得归入 HIGH access。

---

# 17. Readiness V2

新增状态：

```text
PRODUCT_MISMATCH
WEAK_PRODUCT_MATCH
NEEDS_PRODUCT_EVIDENCE
```

保留原状态。

## 17.1 Primary State 优先级

```text
1. SUPPRESSED
2. EXISTING_CUSTOMER
3. HISTORICAL_REVIEW
4. NEEDS_PRODUCT_EVIDENCE
5. PRODUCT_MISMATCH
6. WEAK_PRODUCT_MATCH
7. NEEDS_DECISION_MAKER
8. NEEDS_CONTACT_ROUTE
9. NEEDS_VERIFICATION
10. STRATEGIC_LONG_SHOT / REVIEW
11. SALES_READY
```

同时保存所有适用：

```text
readiness_blockers[]
```

## 17.2 SALES_READY 最低门槛

```text
company VERIFIED + ACTIVE
AND eligible target organization
AND not INTERNAL_EXISTING_CUSTOMER
AND not SUPPRESSED
AND Product Match score >= 50
AND Product Match coverage gate passed
AND Product Match band != UNKNOWN
AND (
  verified named buyer
  OR verified buying/procurement department
)
AND usable business contact route
AND traceable evidence
AND Cooperation Feasibility != LOW
```

---

# 18. Job / Queue / n8n

新增产品匹配编排，不重建现有架构。

建议队列：

```text
collect-product-evidence
calculate-product-match
recalculate-cooperation-v2
```

粒度：

```text
company_id × product_profile
```

使用 execution key / singleton key，保证：

```text
相同输入 replay 不重复外部调用
相同结果不重复插入
规则或输入变化产生新版本结果
```

新增 n8n workflow：

```text
workflows/03-phase6_1-product-match.json
```

浏览器继续只调用 Express；Express 创建 ResearchJob；n8n 编排；pg-boss 执行有界工作；PostgreSQL 保存状态。

不得把最多 100 家公司的产品查询全部塞入一个长时间串行 worker。必须拆成 company/profile 工作项，避免现有 600/900 秒边界超时。

---

# 19. Fresh Discovery 接入

新 prospect 在 VERIFIED + ACTIVE 且通过目标组织门槛后：

```text
enqueue Product Match evidence collection
→ calculate Product Match for requested profiles
→ calculate Cooperation V2 with latest valid buyer/access evidence
→ readiness / matrix / priority
```

不得因为：

```text
companies.product_categories missing
```

而完全跳过 Product Match。缺证据应产生：

```text
NEEDS_PRODUCT_EVIDENCE
```

不是静默消失。

---

# 20. API

新增：

```text
GET /api/companies/:id/product-matches
GET /api/companies/:id/product-matches/:resultId
POST /api/product-match/jobs
GET /api/product-match/jobs/:id
GET /api/product-match/jobs/:id/results
POST /api/internal/product-match/jobs/:id/run
```

所有内部 mutation 保持 internal token 边界。

## 20.1 Opportunities 粒度

`GET /api/opportunities` 使用：

```text
one row per company × product_profile
```

返回稳定：

```text
opportunity_key = company_id + ':' + product_profile
```

同一公司两个产品画像不得互相覆盖。

## 20.2 Opportunities 新字段

```text
product_match_result_id
product_profile
product_match_score
product_match_band
product_match_type
product_match_coverage
matched_categories
top_product_opportunity
product_gap_status
product_access_matrix
supplier_access_band
readiness_blockers
product_match_calculated_at
```

## 20.3 新筛选

```text
product_match_band
product_match_type
product_gap_status
product_access_matrix
```

## 20.4 默认排序

```text
1. Product Match band
2. Product Match score
3. Product Match coverage
4. Cooperation Feasibility band
5. Product Access Matrix
6. Management Baseline Match
7. Mexico Historical Reference Match
8. DPV Score
9. Buyer / role relevance
10. Contact quality
11. Evidence recency
12. Company name
```

UNKNOWN 排在已评分结果后，但必须可见。

---

# 21. UI

必须先读：

```text
docs/UI_SYSTEM.md
```

复用现有 tokens、`.bi` 双语结构、详情窗、表格和响应式规则。

## 21.1 Opportunities Table

不要在现有 2280px 宽表格后机械追加四个独立宽列。

推荐关键列：

```text
Company
Market / Product Profile
Product Match
Product Opportunity
Cooperation Feasibility
Product Access Matrix
Buyer / Department
Best Contact
Secondary Scores
Readiness
```

其中 `Product Opportunity` 复合展示：

```text
Matched Category
Top Product Opportunity
Product Gap
```

`Secondary Scores` 可紧凑展示：

```text
Management Match
MX Historical Match
DPV Score / Tier
```

## 21.2 Mobile

390px / 375px 必须保留：

```text
Company
Product Profile
Product Match
Cooperation Feasibility
Readiness
```

Product Match 不得使用会在 560px 以下隐藏的 `.op-col-secondary`。

## 21.3 Company Detail

在 Overview 后新增第十个 tab：

```text
产品匹配 / Product Match
```

展示两个 profile 的独立卡片：

```text
score / band / type / coverage
prospect observed categories
matched DPV categories
top matched real DPV products
seven dimensions
public source references
gaps
missing information
last assessed
```

顶部 Product Match 分数必须带 product profile 上下文。

API error 与 `NEEDS_PRODUCT_EVIDENCE` 必须是两个不同 UI 状态。

## 21.4 公司端文案

使用：

```text
产品匹配 / Product Match
匹配品类 / Matched Category
优先产品机会 / Top Product Opportunity
产品适配缺口 / Product Fit Gap
待补资料 / Missing Information
最近评估 / Last Assessed
资料来源 / Source References
```

不得显示内部实现说明、数据库字段名、snake_case 枚举或敏感内部商品字段。

---

# 22. Deterministic Management Summary

根据已保存 reason codes 和模板生成，不调用外部 LLM。

示例结构：

```text
为什么适合：
<基于已保存 category / depth 事实>

主要可切入产品：
<最多 3 个安全商品品类或候选>

主要缺口：
<CONFIRMED / POSSIBLE / UNKNOWN 的准确表达>

结论：
<继续采购人搜索 / 补充产品证据 / 低产品优先级>
```

总结必须可从结构化结果完全重建。

---

# 23. 当前 Phase 6 机会重算

## 23.1 固定输入

使用 `docs/PHASE6_RESULT.md` 中记录的最终 acceptance job 作为公司清单来源。

不得用“当前所有数据库公司”替换第一批 acceptance 对比。

运行开始时把这 7 个 company IDs 固定写入本次 ResearchJob 的 `requested_company_ids` 或等价本地输入快照；不得把真实 ID 列表写入 Git 结果文档。

## 23.2 重算

对 7 家公司分别运行：

```text
WOMENSWEAR
GENERAL_MERCHANDISE
```

生成 14 个 Product Match 结果，并重新计算：

```text
Cooperation Feasibility V2
Supplier Access band
Product Access Matrix V2
Opportunity Readiness V2
Default priority
```

## 23.3 历史保护

不得更新或删除：

```text
Phase 6 acceptance job
Phase 6 cooperation-feasibility-v1 rows
Phase 5 DPV Score rows
Management Baseline Match rows
Mexico Historical Reference Match rows
decision-maker evidence history
```

Phase 6.1 新结果必须是新 job / 新 version / 新行。

---

# 24. Tests

## 24.1 Taxonomy / Internal Catalog

```text
exact alias assignment
Spanish/English/Chinese alias mapping
ambiguous alias -> REVIEW
UNKNOWN remains UNKNOWN
cross-profile conflict -> REVIEW
raw product_master unchanged
real product_master FK required
duplicate product candidates deterministic
catalog status respected
```

## 24.2 Product Evidence

```text
official category page observation
official product page observation
search snippet remains discovery hint
company name alone produces no product fact
job requested category produces no product fact
URL / captured_at / evidence text traceable
robots / same-site / redirect / response-size bounds
replay does not refetch identical source
```

## 24.3 Product Match

```text
exact subcategory overlap
same-category overlap
parent-category overlap
adjacent-category match
confirmed no match
unknown product evidence
coverage below threshold -> score NULL
same company WOMENSWEAR high + GENERAL_MERCHANDISE low
unknown optional dimensions do not become confirmed mismatch
unknown optional dimensions are not scored as zero
score / score_min / score_max / coverage are deterministic
top candidate count may be below 5
all candidates are real product_master rows
```

## 24.4 Price / MOQ / Attributes

```text
supplier cost never used for prospect-facing price fit
retail price not directly compared with wholesale/export price
unknown currency not compared
different unit not compared
no FX conversion in v1
MOQ unknown remains unknown
missing prospect requirement != mismatch
attribute comparison uses explicit values only
```

## 24.5 Readiness / Matrix / Feasibility

```text
score NULL -> NEEDS_PRODUCT_EVIDENCE
score 0–29 -> PRODUCT_MISMATCH
score 30–49 -> WEAK_PRODUCT_MATCH
score >= 50 required for SALES_READY
relationship precedence table
all readiness blocker combinations
Cooperation V2 references Product Match result
Product dimension not double counted in access matrix
Product Access Matrix V2 mapping
Access UNKNOWN never becomes HIGH access
DPV Score unchanged
Management Match unchanged
MX Historical Match unchanged
```

## 24.6 Data Isolation

```text
no internal product rows sent to public provider
no supplier price in provider payload
no customer history in provider payload
ordinary API whitelist excludes restricted fields
ordinary UI excludes restricted fields
telemetry excludes internal product payload
Git fixtures are synthetic only
```

## 24.7 Job / Database

```text
migration 024 transactional
existing database explicit migration apply
migration checksum replay
product match append-only
same execution key idempotent
input/version change appends new result
7 × 2 profile results do not overwrite each other
queue retry / partial / timeout
n8n / Express / internal-token boundaries
fresh discovery enqueue behavior
```

## 24.8 UI

```text
all Product Match labels bilingual
all new enum labels deterministic
UNKNOWN / error / empty distinct
two profiles visible
mobile Product Match remains visible
loading / empty / error / long content
keyboard tabs / focus restore
light / dark
comfortable / compact
reduced motion
no page-level horizontal overflow
BD remains hidden
```

浏览器验收尺寸：

```text
1440 × 900
1024 × 768
768 × 900
390 × 844
375 × 667
844 × 390
```

最终：

```text
npm test
0 failed
```

现有 3 个 conditional skips 必须单独说明，不得写成 PASS assertions。

---

# 25. Acceptance Report

创建：

```text
docs/PHASE6_1_PRODUCT_MATCH_RESULT.md
```

必须包含安全聚合：

```text
STATUS
taxonomy version
product match calculation version
cooperation calculation version
job ID

companies recalculated
company × profile results
AE / MX

VERY_HIGH / HIGH / MEDIUM / LOW / VERY_LOW / UNKNOWN
DIRECT / ADJACENT / WEAK / NO_MATCH / UNKNOWN

top matched category aggregates
candidate count aggregates
gap status aggregates

PRODUCT_MISMATCH
WEAK_PRODUCT_MATCH
NEEDS_PRODUCT_EVIDENCE

readiness changes from Phase 6
feasibility changes from Phase 6
matrix changes from Phase 6

public product evidence URL count
missing evidence aggregates
errors / timeouts / partials
test result
GitHub metadata
```

GitHub 结果文档禁止写入：

```text
真实内部 product_master ID 列表
真实内部商品名称明细
内部商品价格
客户订单明细
供应商信息
共享盘路径
数据库 dump
```

完整内部候选明细只留在本地数据库和公司内部 UI。

同时更新：

```text
docs/PHASE6_RESULT.md
docs/PHASE6_DECISION_MAKER_DATA_CONTRACT.md
docs/UI_SYSTEM.md
docs/VERSION_CHANGELOG.md
workflows/README.md
```

只追加 Phase 6.1 引用，不重写历史 Phase 6 事实。

---

# 26. PASS Gate

Phase 6.1 只有全部满足才可 PASS：

```text
[ ] DPV 商品侧只使用现有 product_master / historical product facts
[ ] 原始 product_master 未被 taxonomy 覆写
[ ] taxonomy v1 版本化
[ ] UNKNOWN 未被强制分类
[ ] 潜客商品来自可追溯公开证据
[ ] SearchJob 目标品类未被当作客户商品证据
[ ] Product Match 按 company × product_profile 计算
[ ] 当前 7 家产生 14 个 profile-specific results
[ ] 缺核心证据时 score=NULL / UNKNOWN
[ ] NO_MATCH 有充分的确认性证据
[ ] Top candidates 全部引用真实 product_master.id
[ ] Top candidates 不强制补足数量
[ ] Product Gaps 区分 CONFIRMED / POSSIBLE / UNKNOWN
[ ] Product Match 独立于其他分数
[ ] Cooperation V2 引用 Product Match result
[ ] Supplier Access 独立轴避免 double counting
[ ] Product Access Matrix V2 使用新字段
[ ] Product Match < 50 阻止 SALES_READY
[ ] missing product evidence 可见
[ ] Phase 6 历史结果保持不变
[ ] fresh discovery 已接入
[ ] API/UI 不暴露限制字段
[ ] Product Match 在移动端可见
[ ] migrations 可应用到现有数据库
[ ] tests 0 failed
[ ] real browser verification PASS
[ ] GitHub implementation push PASS
[ ] phase6.1 annotated tag push PASS
```

---

# 27. GitHub Release Protocol

Phase 6.1 采用两提交协议，解决结果文档无法记录自身 commit hash 的问题。

## 27.1 Implementation Commit

完成实现、live recalculation、测试和初版结果文档后：

```text
git diff --check
git status
```

检查 staged diff：

```text
no .env
no keys/tokens/passwords
no raw xlsx
no shared-folder files
no OKKI exports
no staging
no dumps
no internal product detail export
no real customer/order payload
```

提交：

```text
phase6.1: add evidence-backed product matching from existing catalog
```

push `main` 并远端核验。

## 27.2 Handoff Metadata Commit

把以下写入结果文档：

```text
implementation_commit
implementation_push_status
implementation_pushed_at
repository
branch
```

再提交：

```text
docs: record phase6.1 GitHub handoff
```

## 27.3 Tag

创建 annotated tag：

```text
phase6.1
```

tag 指向 handoff metadata commit。

push tag 后使用远端命令核验：

```text
origin/main
refs/tags/phase6.1
peeled tag commit
```

最终工作树必须干净。

---

# 28. Execution Order

严格按以下顺序：

```text
1. Preflight / Git / DB / tests
2. Phase 6.1 reuse research
3. Freeze taxonomy v1 and scoring metadata
4. Add explicit existing-DB migration mechanism
5. Add migration 024
6. Build product_master taxonomy assignments
7. Backfill reusable Phase 4 product evidence
8. Build bounded public product discovery
9. Build local ProductMatchService + GoRules v1
10. Persist candidates / dimensions / gaps
11. Build Cooperation Feasibility v2 + Supplier Access axis
12. Build Product Access Matrix V2 + Readiness V2
13. Add job / queues / n8n / fresh discovery hook
14. Update APIs and default sorting
15. Update Opportunities and Company Detail UI
16. Run all synthetic tests
17. Apply migration to existing DB
18. Recalculate fixed Phase 6 accepted set: 7 × 2
19. Run live acceptance and browser matrix
20. Create/update reports and contracts
21. Implementation commit + push + verify
22. Handoff metadata commit
23. Annotated tag phase6.1 + push + verify
24. STOP
```

---

# 29. STOP

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
