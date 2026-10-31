# 第 3 批：不开模型也要精准 —— 规则改动前后对比（2026-10-29）

给 Simon 看的结论版。数据来自本机 `live_copy`（线上库的只读副本，脚本全程只读，没有写任何东西），用新规则把现有记录重新算一遍，与库里已保存的结果对比。线上库没有动；新规则要等迁移 074 执行、服务重启后才生效。

## 一、一句话结论

| 方面 | 改之前 | 改之后 |
|---|---|---|
| 零售连锁 / 百货能否核验通过 | 不能（没有"零售商"这一类，会被"仅面向消费者"挡掉） | 有自营门店网络证据 + 目标类目证据即可通过；现有数据里 **2 家**（Almaya Group、Walmart in Mexico）从"待核验"变成"已核验"，**3 家**只有门店、没有类目证据的仍留在待核验 |
| 公司分（满分 100） | 产品词会误命中（address→dress、laptop→top）；没有数据的维度按 0 分算 | 词边界匹配；可选维度没数据就不计入；产品/市场/买家类型三项始终计入；46 家里 **14 家换档**，没有一家"没有产品证据"的公司还排在 A 档 |
| 收件人 | 只看排第一的地址；一个地址退信就封整家公司；Hunter 找到的任何地址都算"域名已核验" | 逐个地址评估，跳过被退订/退信/抑制的，用下一个；只有与公司域名一致、或公开在公司官网上的地址才能用；**25 家**有邮箱的公司里，可发的从 12 家变为 **14 家**，没有一家用了"域名不符且官网没公开"的地址 |
| 自动首封选人 | 先取 50 家再筛，前面的公司没有邮箱，后面能发的永远轮不到 | 先排除没有可用邮箱、已抑制、已联系过的公司，再按优先级取；候选从 28 家（其中只有 14 家有可用邮箱）变为 **12 家，全部有可用邮箱** |
| 商品类目评分 | 缺的维度按 0 分；同一条类目证据同时给三项加分；前端筛选和后端档位各算各的 | 按已覆盖维度归一；一条证据只算一次；前后端共用一套档位阈值；5 条已确认结果里 **1 条换档**（Alanic Clothing 高→很高） |
| 邮箱核验有效期 | 3 处写着不同的天数（7/30 天） | 统一一个设置，默认 **90 天**；过期的地址在发信前自动复核一次 |

## 二、零售连锁 / 百货（C1）

**规则**：公司官网上要同时出现
1. **自营门店网络**：带数量的门店说法（如 "operates over 2,600 stores"、"50+ Supermarkets"、"más de 120 tiendas"），或者明确的自营说法（"our stores"、"nuestras sucursales"、"nossas lojas"、"store locator"）；
2. **目标类目证据**（审批过的类目词，含西语、葡语、阿语译名）。

市场统计（"there are 26 supermarket chains with 3,323 stores"、"según ANTAD..."）、单店（"visit our store"）、新闻文章不算。美妆项目遗留的 salons、pharmacies 两个词已删除。"仅面向消费者"不再挡住满足上面两条的 B2B 零售连锁。

**现有数据的变化**（165 条企业核验记录重放，6 条抓取失败/电商平台记录未计入）：

| 企业 | 改前 | 改后 | 依据 |
|---|---|---|---|
| Almaya Group（almaya.ae，同一家在 5 个搜索任务里各有一条） | 待核验：仅面向消费者 | **已核验** | "UAE Kuwait Oman Qatar Bahrain 50+ Supermarkets 100+ Brands…" + 服装类目证据 |
| Walmart in Mexico（walmart.com） | 待核验：仅面向消费者 | **已核验** | "With more than 100 stores in the country, Walmart Express…" + 类目证据 |
| Apparel group and SAVOYE…（savoye.com，物流商文章） | 待核验 | 仍待核验，原因补充"零售连锁缺类目证据" | 只有门店说法，没有类目 |
| 2XL Home、Retail Fashion Group（maje.mx） | 待核验 | 仍待核验，原因同上 | 同上 |
| Beauty Booth | 待核验：仅面向消费者 | 仍待核验，原因改为"业务类型不支持" | 原来命中的是 "salon-quality"，删词后不再算零售渠道 |

已核验的 85 条没有一条被降级。说明：现有证据是旧规则时抓的，没有"门店网络"这一类，这里是用新规则在已存证据原文上识别出来的；正式生效要在 074 之后重新跑核验（会重新抓取）。核验结果会写入新列 `retail_chain_status`，企业类型里显示 "Chain Retailer VERIFIED" / "Department Store VERIFIED"。

## 三、公司分（C4，新版本 `dpv-score-v2`，旧分数全部保留）

改了什么：
- 产品词按整词匹配，并按公司自己的类目取词（不再只认女装词）；来源记录只看正文，不看 JSON 字段名。
- Hunter 返回的大写 `VALID` 算"邮箱已核验"（5 分）；旧表里小写 `valid` 实际只查过域名/MX，算 4 分。
- 规模：中型 10、小型 8、大型 6、微型 4、超大型 3（更适合小出口商）。
- 可选维度（连锁供货、规模、近期信号、决策人、联系方式）没数据就不计入分母；**产品、市场、买家类型三项始终计入**，没有产品证据的公司不会显得"完全匹配"。
- 证据覆盖不足 60 的只能是 C 档；没有任何产品得分的不能进 A 档。

46 家有旧分数的公司：

| 档位变化 | 家数 |
|---|---|
| A→A | 9 |
| B→A | 10 |
| B→B | 7 |
| B→C | 2 |
| C→B | 3 |
| C→A | 1 |
| C→C | 14 |

典型例子：
- **Apparel Group**：旧版产品分 20（来源记录里 "address" 命中了 "dress"），新版产品分 0，总档位 B→C（覆盖 45%）。这正是要修的误判。
- **ELK Fashion Dubai**：产品分 20→12（页面没有女装词，只有泛服装词），仍是 A。
- **Magnolia Fashion Wholesale**：B(59)→A(97)。旧版因为决策人、近期信号两项没数据被扣满 20 分，新版这两项不计入。
- **UAE's Leading Travel Retail Distributor（Denaster）**：新版 75 分，但没有产品得分，留在 B 档。
- 平均分 56→77，是因为缺数据的维度不再按 0 分；排序看档位和覆盖率。

## 四、收件人逐条评估（C3/C7）

规则（含 Simon 10-26 的补充）：任何公司商务邮箱都可以，不要求是具体负责人；地址要么与公司域名一致（info@、sales@、compras@ 等），要么公开在公司官网上（这时 Gmail/Hotmail 也可以）；每个地址单独检查退订、退信、抑制、30 天内被别的发件人联系过、核验状态和有效期，不合格就跳过，换下一个。硬退信只封这个地址。

现有 25 家有邮箱的公司：
- 可发的从 12 家变为 **14 家**：Rizqé（info@rizqe.co）、Alanic Clothing（info@alanic.clothing）原来因 30 天有效期过期被挡，现在在 90 天内。
- 换了地址的 2 家：MA General Trading 从 info@ 换成同域名的 director@（核验时间更新）；"Distribution and Sales Channels"（trade.gov 页面）两个地址都不可用。
- 公司域名不符、官网也没公开的地址：0 个被选用。Marchante MX 的 info@coveme.mx、RYSE 的 tiendavirtual@ryse.com.mx 等域名不一致，但公开在公司官网，仍要先完成邮箱核验。
- 首封模板：14 家里 13 家用 C 模板（公司公共邮箱），MA General Trading 用 B 模板（贸易商的个人业务邮箱）。零售连锁的公共/采购邮箱一律用 C 模板（Simon 10-26 的决定）；已核实姓名的采购负责人仍用 A 模板。

catch-all（ACCEPT_ALL）：Hunter 邮箱核验分数 ≥85 可自动发，80–84 转人工确认，<80 或没有分数不发；只认 Email Verifier 的分数（Domain Search / Email Finder 给的是找人置信度，单独保存）。现有数据里没有 catch-all 地址，所以这项暂时不改变任何公司。

## 五、自动首封选人（C5）

现在先排除：没有已核验邮箱（VALID / ACCEPT_ALL 且未被抑制）、公司被抑制、该发件人已联系过、买家类型被排除的公司，再按 **档位 → 买家模式 → 规模（中型优先）→ 进口证据 → 联系就绪度** 排序取批次，不再按名字。

现有数据：旧查询 28 家候选，其中只有 14 家有可用邮箱；新查询 12 家，**全部**有可用邮箱。少掉的 2 家（Rizqé、Alanic Clothing）以前已经发过首封，按规则不再重复联系。新顺序前几家：#1 Clothing Manufacturers Mexico、Fakhruddin Souq、Denaster、Find General Trading、NOWA General Trading、Alanic、Apparel Group、MA General Trading…

## 六、商品类目评分（C6，版本 `category-company-match-v4`）

- 按已覆盖维度归一（和公司分一致），没数据的维度不再按 0 分；
- 同一条类目证据只给"类目证据"一项加分：品类广度需要至少 2 条观测，"近期活动"需要带发布日期的观测；
- 档位阈值只有一套（很高 ≥80，高 65–79，中 60–64，低 30–59，很低 <30），后端筛选和页面显示都按分数用这一套算。

5 条已确认的类目结果：NBF 68→74（高）、Rizqé 87→96（很高）、Marchante MX 92→92、6Wresearch 82→96、Alanic Clothing 77→85（**高→很高**）。

## 七、更多市场和多语言证据词（C8）

- 新增巴西、澳大利亚、加拿大、新加坡市场档案（公司后缀、电话格式、目录/新闻/电商网站、页面角色词；巴西用葡语，加拿大加法语）。
- 类目证据词：西语、葡语取自已导入的 Shopify 官方多语言类目名；导入文件没有阿语，阿语暂用一份短的人工词表（导入阿语文件后可替换）。
- 单独的 "locations"、"shop online"、"inventario" 不再算经营证据，必须带数量（"35 locations across Mexico"）或自营说法（"our locations"、"inventario propio"）；与机会池新规则（classifierV2）一致。补了葡语、阿语的进口/批发/分销/仓库说法。
- 通用邮箱名补充 compras、ventas、vendas、purchasing、buying 等。

## 八、生效前要做的

1. 执行迁移 `074_scoring_accuracy.sql`（只加证据类型和一列，不改旧数据）。
2. 把 `.env*` 里的 `CONTACT_VERIFICATION_TTL_DAYS=30` 改成 90（或删掉，用默认 90），`OUTREACH_VERIFICATION_TTL_DAYS` 可删。
3. 重启后对现有企业补跑一次核验和评分（新版本追加记录，旧记录保留）。

对比脚本（只读）：会话草稿目录 `b3/report.mjs`，结果 `b3/report.json`。
