# MC03 机会池分层试算结果

状态：DRY-RUN COMPLETE — 待审阅，未应用。

数据库观察时间：2026-09-08T03:14:41.806Z。覆盖 138 家公司，一家公司一条结果。MC00–02 未重做；本轮未调用搜索、邮箱验证或 SMTP，未修改业务数据库、页面和现有评分。

## 只读验证

事务：on / repeatable read，连接强制 default_transaction_read_only=on。

129 个业务表前后数量和内容哈希一致。5 个运行表中变化项：imap_mailbox_checkpoints；属于既有后台轮询，不是本轮业务写入。核对时段 2026-09-08T03:14:41.806Z 至 2026-09-08T03:26:32.705Z。

| 业务表 | 记录数 |
| --- | --- |
| companies | 138 |
| sources | 438 |
| contacts | 129 |
| research_jobs | 461 |
| outbound_messages | 2 |
| outreach_drafts | 9 |
| outreach_approvals | 9 |
| inbound_messages | 3 |
| provider_usage_events | 842 |

## 汇总

| 分层 | 公司数 |
| --- | --- |
| PRECISION | 4 |
| RELEVANT | 2 |
| GENERAL_RELEVANT | 22 |
| EXPLORATORY | 101 |
| NOT_SUITABLE | 9 |

拟进入活跃机会池：28 家；非明确排除：129 家。

## 六项结论

1. 非明确排除公司：129 家；这包含资料不足的探索公司，不等于全部已核验。
2. 规则试算拟进入活跃机会池：28 家；这不是已批准的名单，仍有下述归属/业务类型风险。
3. 旧 RECOMMENDED 未覆盖的新 RELEVANT / GENERAL_RELEVANT：24 家（包含无旧投影公司；按旧显示状态比较，管理批准单列）。
4. 旧原因中 CATEGORY_CONFIRMATION_REQUIRED 涉及 28 家，联系门槛 CONTACT_ROUTE_REQUIRED 涉及 25 家；全集还有 96 家缺少完成的身份核验。旧阻断和新资料限制分开记录。
5. 确有误归属风险，尚不足以把试算数量当成真实可联系买家数。独立复核检查全部初轮活跃公司和每档前20：博客/目录误归属过滤后有3家由泛相关转探索；剩余目录主体、制冷设备范围及制造/采购角色仍待校准。见[边界复核](PHASE13_MC03_BOUNDARY_REVIEW.md)。这不是已量化的全库误判率。
6. Apply 前重点校准：企业主体与第三方文字归属；泛贸易与明确非目标行业的区分；制造与采购混合角色；旧 REJECTED 的底层证据缺口；历史观察时效。保留无联系方式不降业务分层的规则。

## 旧状态 → 新分层

| 分组 | PRECISION | RELEVANT | GENERAL_RELEVANT | EXPLORATORY | NOT_SUITABLE |
| --- | --- | --- | --- | --- | --- |
| EVIDENCE_REQUIRED | 2 | 2 | 17 | 5 | 5 |
| MANAGEMENT_APPROVED | 1 | 0 | 0 | 0 | 0 |
| NO_CURRENT_DECISION | 1 | 0 | 5 | 96 | 3 |
| NOT_SUITABLE | 0 | 0 | 0 | 0 | 1 |
| RECOMMENDED | 1 | 0 | 0 | 0 | 0 |

公司有多个旧 profile 状态时，在各状态出现一次，因此矩阵合计可能超过公司数。无旧投影单列 NO_CURRENT_DECISION，不伪造旧结论。

## 分组

### 市场

| 分组 | PRECISION | RELEVANT | GENERAL_RELEVANT | EXPLORATORY | NOT_SUITABLE |
| --- | --- | --- | --- | --- | --- |
| AE | 3 | 1 | 19 | 95 | 3 |
| BD | 0 | 0 | 1 | 1 | 0 |
| MX | 1 | 1 | 2 | 5 | 6 |

数据库全部公司均纳入，包括已隐藏市场 BD 的历史记录；本轮不重新启用该市场。

### 公司类型（数据库原值）

| 分组 | PRECISION | RELEVANT | GENERAL_RELEVANT | EXPLORATORY | NOT_SUITABLE |
| --- | --- | --- | --- | --- | --- |
| 排除：非女装或 OEM/采购代理模式 | 0 | 0 | 1 | 5 | 0 |
| 全品类女装 B2B 贸易候选 | 0 | 0 | 0 | 10 | 0 |
| 全品类女装进口商/批发商候选 | 0 | 0 | 0 | 12 | 0 |
| 全品类女装零售候选 | 0 | 0 | 0 | 65 | 0 |
| Distributor VERIFIED | 2 | 0 | 3 | 2 | 5 |
| General Trading VERIFIED | 0 | 0 | 5 | 2 | 0 |
| Importer SUPPORTED | 0 | 0 | 1 | 0 | 0 |
| Importer SUPPORTED / Wholesaler VERIFIED / Distributor VERIFIED | 0 | 0 | 1 | 0 | 0 |
| Importer VERIFIED | 0 | 0 | 0 | 2 | 1 |
| Importer VERIFIED / General Trading VERIFIED | 0 | 0 | 2 | 0 | 1 |
| Importer VERIFIED / Wholesaler VERIFIED | 1 | 0 | 0 | 0 | 0 |
| Importer VERIFIED / Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | 0 | 1 | 2 | 0 | 1 |
| Wholesaler VERIFIED | 0 | 0 | 3 | 2 | 0 |
| Wholesaler VERIFIED / Distributor VERIFIED | 1 | 1 | 1 | 1 | 1 |
| Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | 0 | 0 | 1 | 0 | 0 |
| Wholesaler VERIFIED / General Trading VERIFIED | 0 | 0 | 2 | 0 | 0 |

### 评估 profile

| 分组 | PRECISION | RELEVANT | GENERAL_RELEVANT | EXPLORATORY | NOT_SUITABLE |
| --- | --- | --- | --- | --- | --- |
| GENERAL_MERCHANDISE | 0 | 2 | 25 | 102 | 9 |
| WOMENSWEAR | 4 | 0 | 24 | 101 | 9 |

每家公司分别评估两个批准 profile；此表按各 profile 自己的分层计数，不可将两个 profile 相加当作公司数。详见 JSON profile_results。

## 联系方式与邮件资格（独立于业务分层）

| 就绪状态 | 公司数 |
| --- | --- |
| NO_CONTACT_FOUND | 86 |
| PHONE_READY | 35 |
| CONTACT_RESEARCHING | 16 |
| WHATSAPP_READY | 7 |
| FORM_READY | 8 |
| EMAIL_READY | 2 |

| 邮件评估 | 公司数 |
| --- | --- |
| BLOCKED | 138 |

就绪状态可多选。NOT_EVALUATED_FOR_SEND 表示仍需执行原有发送门槛，不表示批准发送。本轮所有 send_authorized 均为 false。

## 资料限制频次

### 当前旧阻断（同公司同原因去重）

| 原因 | 公司数 |
| --- | --- |
| CATEGORY_CONFIRMATION_REQUIRED | 28 |
| EVIDENCE_REQUIRED_CONTACT | 25 |
| CONTACT_ROUTE_REQUIRED | 25 |
| SALES_READINESS_REQUIRED | 25 |
| COMPANY_CONTACT_ROUTE_AVAILABLE | 7 |
| EXCLUDED_BUYER_MODEL | 1 |

### 本次试算资料限制

| 原因 | 公司数 |
| --- | --- |
| BUYER_TYPE_EVIDENCE_INCOMPLETE | 98 |
| IDENTITY_VERIFICATION_INCOMPLETE | 96 |
| BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED | 12 |
| LEGACY_EXCLUSION_REQUIRES_REASON_REVIEW | 4 |
| POSSIBLE_THIRD_PARTY_CONTENT_OR_UNRELATED_PRODUCT_NOT_ASSUMED_AS_BUYER_SCOPE | 2 |
| STORED_REJECTION_NOT_INDEPENDENTLY_REVERIFIED:233cfbea-680a-497c-a697-b103c436d53d:NOT_A_TARGET_COMPANY_PUBLIC_GUIDE | 1 |
| STORED_REJECTION_NOT_INDEPENDENTLY_REVERIFIED:62fd356f-db9e-47ab-ab13-38004a72b873:OEM_ONLY_FINISHED_GOODS_SUPPLIER | 1 |
| MARKET_MISMATCH_RETAINED_SEPARATELY_FROM_BUSINESS_FIT | 1 |

## PRECISION：代表公司

按公司名称、ID 稳定排序取前20，不足20则全部；不是业务评分排行。

| 公司 | 市场 | 旧状态 | 类目依据 | 类型依据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| #1 Clothing Manufacturers Mexico, Garment Textile Apparel Exporter | MX | NO_CURRENT_DECISION | EXACT_CATEGORY | Wholesaler VERIFIED / Distributor VERIFIED | [] |
| Alanic Clothing | AE | MANAGEMENT_APPROVED | EXACT_CATEGORY | Distributor VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| Rizqé | AE | EVIDENCE_REQUIRED, RECOMMENDED | EXACT_CATEGORY | Importer VERIFIED / Wholesaler VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| tradeling | AE | EVIDENCE_REQUIRED | EXACT_CATEGORY | Distributor VERIFIED | [] |

## RELEVANT：代表公司

按公司名称、ID 稳定排序取前20，不足20则全部；不是业务评分排行。

| 公司 | 市场 | 旧状态 | 类目依据 | 类型依据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Fakhruddin Souq | AE | EVIDENCE_REQUIRED | PROFILE_SCOPE | Importer VERIFIED / Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | [] |
| Marchante MX | MX | EVIDENCE_REQUIRED | PROFILE_SCOPE | Wholesaler VERIFIED / Distributor VERIFIED | [] |

## GENERAL_RELEVANT：代表公司

按公司名称、ID 稳定排序取前20，不足20则全部；不是业务评分排行。

| 公司 | 市场 | 旧状态 | 类目依据 | 类型依据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| © 2026 Alanic | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED / Distributor VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| © 2026 RYSE SA de CV | MX | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED | [] |
| AFS General Trading LLC | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | [] |
| Almaya Group | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | General Trading VERIFIED | [] |
| Apparel Group | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Importer SUPPORTED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| Bismi Group | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Importer SUPPORTED / Wholesaler VERIFIED / Distributor VERIFIED | [] |
| Bright Eazy | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED / General Trading VERIFIED | [] |
| Bulk Prices & Deals | BD | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | Importer VERIFIED / General Trading VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| Earthmech | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | General Trading VERIFIED | ["BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| ELK Fashion Dubai | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | 排除：非女装或 OEM/采购代理模式 | [] |
| Emirates Apparel | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Distributor VERIFIED | [] |
| Find General Trading LLC | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | General Trading VERIFIED | [] |
| FMCG Goods Wholesaler | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED | [] |
| Home Design México® | MX | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED | [] |
| Kreol Group | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Distributor VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| MA General Trading | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Importer VERIFIED / Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | [] |
| Murex Trading LLC | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Wholesaler VERIFIED / General Trading VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| NOWA General Trading LLC | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Importer VERIFIED / Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | [] |
| Right Face General Trading LLC | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | General Trading VERIFIED | ["BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| UAE's Leading Travel Retail Distributor | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | Distributor VERIFIED | [] |

## EXPLORATORY：代表公司

按公司名称、ID 稳定排序取前20，不足20则全部；不是业务评分排行。

| 公司 | 市场 | 旧状态 | 类目依据 | 类型依据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Accurate Edge | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Al Ashi General Trading | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装 B2B 贸易候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Al Awali Trading | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装进口商/批发商候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Al Fareej grocery building | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Al Hala Trading Establishment | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装 B2B 贸易候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Al Kabayal Discount Center | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| al karama | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Al Sammran Garments Trading LLC | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装进口商/批发商候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| ApparelnBags.com | MX | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | Distributor VERIFIED | ["LEGACY_EXCLUSION_REQUIRES_REASON_REVIEW","MARKET_MISMATCH_RETAINED_SEPARATELY_FROM_BUSINESS_FIT","IDENTITY_VERIFICATION_INCOMPLETE"] |
| Armani Exchange | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Babyshop | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 排除：非女装或 OEM/采购代理模式 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Bait Al Marjaan Garments | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装进口商/批发商候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Better Home General Trading LLC | AE | EVIDENCE_REQUIRED | NO_CURRENT_CATEGORY_EVIDENCE | General Trading VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Bin Hindi Outlet | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Bollywood Burjuman | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Brands For Less | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Burberry | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| CG Mall | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Cotton & Silk Trading LLC | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装 B2B 贸易候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |
| Day to Day | AE | NO_CURRENT_DECISION | NO_CURRENT_CATEGORY_EVIDENCE | 全品类女装零售候选 | ["IDENTITY_VERIFICATION_INCOMPLETE","BUYER_TYPE_EVIDENCE_INCOMPLETE"] |

## NOT_SUITABLE：代表公司

按公司名称、ID 稳定排序取前20，不足20则全部；不是业务评分排行。

| 公司 | 市场 | 旧状态 | 类目依据 | 类型依据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 6Wresearch | AE | EVIDENCE_REQUIRED | OFFICIAL_IDENTITY_NON_TARGET_BUSINESS | Importer VERIFIED / Wholesaler VERIFIED / Distributor VERIFIED / General Trading VERIFIED | [] |
| AXÉ Ropa Deportiva - Ropa Deportiva Mujer | MX | NO_CURRENT_DECISION | OEM_ONLY_FINISHED_GOODS_SUPPLIER | Wholesaler VERIFIED / Distributor VERIFIED | ["LEGACY_EXCLUSION_REQUIRES_REASON_REVIEW","STORED_REJECTION_NOT_INDEPENDENTLY_REVERIFIED:62fd356f-db9e-47ab-ab13-38004a72b873:OEM_ONLY_FINISHED_GOODS_SUPPLIER","IDENTITY_VERIFICATION_INCOMPLETE"] |
| Copyright IMARC Services Private Limited 2026 | MX | EVIDENCE_REQUIRED | OFFICIAL_IDENTITY_NON_TARGET_BUSINESS | Distributor VERIFIED | [] |
| Distribution and Sales Channels | MX | NO_CURRENT_DECISION | NOT_A_TARGET_COMPANY_PUBLIC_GUIDE | Distributor VERIFIED | ["LEGACY_EXCLUSION_REQUIRES_REASON_REVIEW","STORED_REJECTION_NOT_INDEPENDENTLY_REVERIFIED:233cfbea-680a-497c-a697-b103c436d53d:NOT_A_TARGET_COMPANY_PUBLIC_GUIDE","IDENTITY_VERIFICATION_INCOMPLETE"] |
| Fair Trading International | AE | NOT_SUITABLE | EXPLICIT_DISALLOWED_BUYER_EVIDENCE | Distributor VERIFIED | [] |
| NBF | MX | EVIDENCE_REQUIRED | OFFICIAL_IDENTITY_NON_TARGET_BUSINESS | Distributor VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| NotCo | MX | EVIDENCE_REQUIRED | OFFICIAL_IDENTITY_NON_TARGET_BUSINESS | Distributor VERIFIED | [] |
| NovaLink | MX | EVIDENCE_REQUIRED | OFFICIAL_IDENTITY_NON_TARGET_BUSINESS | Importer VERIFIED | ["BUSINESS_ATTRIBUTION_REVIEW:NON_SELF_OPERATING_EVIDENCE_EXCLUDED"] |
| TurkExim Importers Search Engine | AE | NO_CURRENT_DECISION | OFFICIAL_IDENTITY_NON_TARGET_BUSINESS | Importer VERIFIED / General Trading VERIFIED | [] |

## 所有旧 NOT_SUITABLE 转为非排除

共 0 家，含 EXPLORATORY（不进入活跃池）。逐条保留旧阻断与新依据，不将“重新研究”描述为可发送。

| 公司 | 新分层 | 旧阻断 | 旧排除 | 新依据 | 完整备注 |
| --- | --- | --- | --- | --- | --- |


## 原 RECOMMENDED 意外降档

0 家降为非活跃分层。

## 本地明细与重跑

- JSON：D:/codex/International-AI-Powered-Overseas-Lead-Generation-System-Proposal/artifacts/phase13-mc03/2026-09-08T03-14-41-578Z/opportunity-pool-dry-run.json
- 源快照 SHA-256：65673d57e45b4f35a3defb7732dae085dc3d2c3820867e509c4e6bd0387ac86b
- JSON 含全部公司及证据索引，位于 Git 忽略目录；本报告不列私人邮箱、邮件正文或凭据。
- 执行：先运行 scripts/phase13-mc03-snapshot.mjs，再以 snapshot.json 为参数运行 scripts/phase13-mc03-report.mjs。全部分类为离线纯计算。
- 复用现有 pg、已批准类目及存量证据，无新增依赖或运行时路由。

## 本次验收记录

- 分层专项13项、联系资格专项16项，共29项通过。
- 全量测试1014项：960通过、0失败、54跳过。跳过项未计为通过；本轮未重新执行浏览器或真实邮件测试。
- 首轮全量测试仅冻结状态的 dirty 标志失败；更新实际工作树状态后重跑以上全量测试通过。
- 最终前后只读核对：129业务表一致；验证文件 `artifacts/phase13-mc03/2026-09-08T03-26-32-516Z/verification.json`。
- 规则、独立脚本与测试将纳入同一本地提交。未部署、未push、未创建Phase13标签。
- 试算流程完成不等于新规则生产验收：边界复核仍保留4个活跃候选的重点疑点。邮件资格138家均显示阻断；2家有有效邮箱，但存在既往发送记录，不是可再次首封发送的名单。

## 执行边界

停在 MC03。用户审阅并明确批准后，才可执行 MC04；本轮未启用自动发信。
