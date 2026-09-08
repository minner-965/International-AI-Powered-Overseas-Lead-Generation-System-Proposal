# MC03 存量证据边界复核

日期：2026-09-08。范围仅为已存数据库证据，未访问外部网站、核验邮箱或修改业务数据。本文是分类器迭代中的独立复核，不是全部企业的外部真实性认证。

## 最终试算收尾

最终为 PRECISION 4、RELEVANT 2、GENERAL_RELEVANT 22、EXPLORATORY 101、NOT_SUITABLE 9，拟活跃28家。初轮31家的核对记录保留在下文，未视作已批准名单。

- Better Home、Nihaojewelry、PreHeated：相关跨主体/博客内容过滤后转为 EXPLORATORY。
- Bulk Prices & Deals：过滤目录子页后仍有平台根页的宽泛贸易文字支撑试算；主体为目录/平台的风险仍在，未认可为自营采购公司。
- Kreol：问句被过滤，但还有其他经营观察；仍需区分“自己的渠道”和“面对的客户”，本轮不宣称已排除所有归属错误。
- RYSE：仍为 GENERAL_RELEVANT，但存量证据指向制冷设备；这是保留的范围误判风险，Apply 前需校准广义批发规则。
- Wings2Fashion：仍为 PRECISION 类目匹配；制造商与采购商角色混合，不代表已确认其会采购DPV产品。应核实公司类型解释。
- AXÉ、Distribution and Sales Channels：保留存储的 REJECTED + 具体排除代码；最终 JSON 明记 STORED_REJECTION_NOT_INDEPENDENTLY_REVERIFIED。这只是沿用已存明确决定，底层引用缺口仍然开放。

因此，28是规则试算数，不是“28家已验证可发送客户”。MC03取数与试算完成，生产规则质量未作PASS；停在审阅边界。上述4个仍在活跃分层的重点案例为定向发现，不作为无偏抽样误判率。

## 复核样本

快照：`artifacts/phase13-mc03/2026-09-08T03-14-41-578Z/snapshot.json`，138家公司。检查时分类器 SHA256：`08034eb67fa6d34d013563625a44cb393b65e13d4579be6978eebf1a986e3de1`。

当时结果为 PRECISION4、RELEVANT2、GENERAL_RELEVANT25、EXPLORATORY98、NOT_SUITABLE9。检查全部31个active条目的类别依据及公司类型引用；各band以公司名称、公司ID排序选前20，前三band另扩展至全部active。EXPLORATORY重点检查身份/类别证据缺失，不以知名公司名称补造事实。NOT_SUITABLE检查全部9条的排除依据。

这些是迭代检查时的数量，最终报告应使用修订后重新生成的结果，不能把本文31个active当作已经批准的名单。

## 确切问题：来源归属与范围

| 对象 | 存量证据与判断 |
| --- | --- |
| Better Home General Trading LLC | `5ad424e1-454c-4abf-9086-32f72657e6e4` 实际写 Fashion Gallery General Trading，是另一家公司；[记录来源](https://2gis.ae/dubai/firm/70000001088782860)。不应合并为本公司的服装经营证明 |
| Bulk Prices & Deals | `2999e67d-74f5-4bbf-bd69-7ec324bb90f0` 是供应商目录的行业与城市筛选文字；[记录来源](https://www.go4worldbusiness.com/suppliers/bangladesh/dhaka/cosmetics-beauty-products.html)。不能据列表内容证明目录本身采购该品类 |
| PreHeated | `1c380774-36ac-48bc-ad3b-1744f1f8e482` 及 `7e0c4995-7be0-4248-93b6-797cb2f58859` 描述文章中的食品企业及PepsiCo；[记录来源](https://thepreheated.com/los-10-principales-fabricantes-y-proveedores-de-alimentos-y-bebidas-en-mexico)。不是出版者自己的分销业务 |
| Nihaojewelry | `1c893a55-2fc5-4d50-adc9-c5d28beab5e6` 描述Grupo Sottarriva，`bff01455-9364-4d7a-9610-bb54c17c105e` 描述Moda Quetzal；[记录来源](https://blog.nihaojewelry.com/wholesale-womens-clothing-in-mexico-city/)。需要其自身业务来源，不能借被介绍企业的能力入池 |
| RYSE | `84234aa2-a99d-4654-993c-d658be600ce9` 描述批发制冷设备与解决方案；[记录来源](https://mayoristas.rysemexico.com/)。一般“批发”身份不能单独证明覆盖DPV百货类别 |
| Kreol Group | `dd870c6b-fcec-4312-be8c-446b77fdfe0c` 是询问访客是否为经销商/品牌主；[记录来源](https://www.kreolgroup.com/modern-trade)。问句不能独立证明网站主体是经销商 |

以上问题已发送分类器负责人。必须以归属、来源及经营范围规则解决，不使用公司名称黑名单。

## 排除与保留的反向检查

- NBF：`28e78eac-1582-4575-8e92-f829c3b80be7` 明确健康食品原料制造分销；NotCo：`5acdf756-7710-4f9e-ad3e-cf2882cd78e5` 明确食品行业。食品原料不等同于获批泛百货范围。
- IMARC：`bf47c64d-c07b-4a91-810a-70093643127a` 与官网标题支持研究/报告服务；TurkExim：`c56477f0-a2e0-41b4-bbab-24bd1f689be5` 明确提单数据库。6Wresearch的行业报告、Opportimes引用ANTAD的超市统计不构成其自身商品经营。
- NovaLink：`37a703f5-4378-44aa-89cb-2429de0b8925` 支持nearshore manufacturing身份。Wings2Fashion同时存在制造和批发页面，需区分自身供货商角色与目标采购商角色，不能只凭商品页面定为高精度买家。
- ELK：`09a29d45-25bd-4216-8482-0b36397ddb67` 支持女装批发，`eaa2ff7e-a432-46e2-9747-556c64dfa376` 描述自身服装批发/贸易及大宗订单；不应仅因其他页面出现定制/Private Label词语整体排除。
- AXÉ、Distribution and Sales Channels：检查版本直接以旧排除代码加REJECTED状态输出NOT_SUITABLE且引用为空。旧结论并非底层证据，需要补用已存来源验证；不足时保留待核查，而非凭旧标签证明新排除。

## 全active覆盖记录

除上表重点外，已检查对应分类输出及首要存量类型/类别引用：Alanic Clothing、Rizqé、tradeling、Fakhruddin Souq、Marchante MX、© 2026 Alanic、AFS、Almaya、Apparel Group、Bismi、Bright Eazy、Earthmech、Emirates Apparel、Find General Trading、FMCG Goods Wholesaler、Home Design México、MA General Trading、Murex、NOWA、Right Face、UAE's Leading Travel Retail Distributor、United General Trading、Urban Lifestyle。涉及日化、办公、家居、FMCG或泛贸易的记录仍应以获批范围核实，不把“GENERAL_RELEVANT”理解为已证实采购意向。

EXPLORATORY前20：Accurate Edge、Al Ashi General Trading、Al Awali Trading、Al Fareej grocery building、Al Hala Trading Establishment、Al Kabayal Discount Center、al karama、Al Sammran Garments Trading LLC、ApparelnBags.com、Armani Exchange、Babyshop、Bait Al Marjaan Garments、Bin Hindi Outlet、Bollywood Burjuman、Brands For Less、Burberry、CG Mall、Cotton & Silk Trading LLC、Day to Day、Day to Day supermarket。这里的证据不足不等于已证明不适合；未用品牌常识替代数据库事实。

## 适用限制

当前检查结果仍为31个active（4/2/25），存在上列未闭合的归属及范围风险。**不建议直接Apply，不标记生产规则可启用。** 后续如修订分类器，应重新生成并复核；本文不代替用户批准。

## 只读前后验证

前置 `03:14:41.806Z`、后置 `03:21:41.277Z`：129个业务基础表数量及整表内容哈希完全一致，其中服务用量、发件、收件、草稿、审批及抑制相关表均未变化。5个运行表中仅 `imap_mailbox_checkpoints` 内容哈希变化，行数仍为1，符合既有收信轮询继续运行；不是本轮业务写入。

证据：`artifacts/phase13-mc03/2026-09-08T03-21-41-080Z/verification.json`，同目录后置snapshot保留。事务均明确 `READ ONLY`、`repeatable read`，执行路径不调用任何Provider或SMTP。

本轮抽取式复核未逐字阅读所有原始页面及所有历史版本；只核对当前分类依据、所引用记录并追查高风险归属问题。历史证据可能误抽取、过期或不完整。此复核不证明邮箱可投递、采购意向或准许发送。所有建议仅用于MC03离线结果修订；MC04仍需用户审阅后明确批准。
