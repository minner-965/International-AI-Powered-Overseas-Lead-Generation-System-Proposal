# 机会池新旧规则对比（C2 收紧"泛相关"）

生成时间：2026-10-26T13:24:38.777Z　数据：本机还原的线上数据副本（live_copy，只读）　企业数：138

> 这份对比只是"如果启用新规则会怎样"，**系统现在仍按旧规则运行**，没有改动任何企业的档位。你看完决定是否启用。

## 一、新规则改了什么

1. **"泛相关"必须有类目证据**：企业页面上至少有一条已批准类目（或它的上级类目）的商品证据，或者官网明确写了综合百货/家居日用经营。只有"批发""门店""仓储""综合贸易"这类泛泛经营信号的，降为"待研究"（不删除，补到类目证据后会自动回来）。
2. **导航泛词不再算证据**：网页导航里常见的"locations / ubicaciones""shop online""inventario"单独出现时不再算经营证据，必须带数量（如"25 stores"）或明确上下文（如"our locations""nuestro inventario"）。
3. **连锁零售、百货算有效买家**：有自营门店网络证据 + 已批准类目证据，就算有效买家类型（"供货给零售店"这种说的是客户，不算）。企业本身仍须先通过企业核验；因核验未通过而进不了池的零售连锁单独列在第五节，供决定 C1（核验加"零售连锁"类型）时参考。

规则版本：旧 `v1_MC04` → 新 `v2_MC08`（未启用）。

## 二、各档位数量

| 档位 | 旧规则 | 新规则 | 变化 |
|---|---:|---:|---:|
| 精准（PRECISION） | 4 | 4 | 0 |
| 相关（RELEVANT） | 2 | 2 | 0 |
| 泛相关（GENERAL_RELEVANT） | 22 | 4 | -18 |
| 待研究（EXPLORATORY） | 101 | 119 | +18 |
| 不合适（NOT_SUITABLE） | 9 | 9 | 0 |
| **机会池合计（精准+相关+泛相关）** | **28** | **10** | **-18** |

参考：数据库里当前保存的机会池结果（上次刷新时写入）为 精准 4、相关 2、泛相关 22、待研究 101、不合适 9。上表"旧规则"是用同一份数据现场重算的。逐家核对：保存结果与现场重算不一致 0 家，说明旧规则结果可以复现。

## 三、档位流向（行 = 旧档位，列 = 新档位）

| 旧 \ 新 | 精准 | 相关 | 泛相关 | 待研究 | 不合适 |
|---|---:|---:|---:|---:|---:|
| 精准 | 4 | 0 | 0 | 0 | 0 |
| 相关 | 0 | 2 | 0 | 0 | 0 |
| 泛相关 | 0 | 0 | 4 | **18** | 0 |
| 待研究 | 0 | 0 | 0 | 101 | 0 |
| 不合适 | 0 | 0 | 0 | 0 | 9 |

对角线是档位不变的企业，加粗的是会变化的企业。

## 四、档位会变化的企业（共 18 家）

| # | 企业 | 国家 | 旧 → 新 | 原因 | 关键证据 | 可能补回 |
|---:|---|---|---|---|---|---|
| 1 | © 2026 Alanic | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | DISTRIBUTOR：“Request For Catalog Low MOQ for Startups Products search Private Label Catalog Download mail us Togg…” | 是：官网写了“Womens Wear” |
| 2 | © 2026 RYSE SA de CV | 墨西哥 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | WHOLESALER：“Refrigeración Por eso ofrecemos equipos y soluciones de refrigeración diseñados para el canal mayori…” | — |
| 3 | AFS General Trading LLC | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | WHOLESALER：“Skip to content Products search – Login / Register Dashboard – Login / Register Dashboard Products s…” | — |
| 4 | Almaya Group | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“Growth and Diversification Into a Major FMCG Trading Company in Dubai Al Maya Group understood that …” | — |
| 5 | Bright Eazy | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“United Arab Emirates dirham United States (US) dollar About Us Contact us Blogs Become A Seller Blog…” | — |
| 6 | Bulk Prices & Deals | 孟加拉国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“25 minutes ago Supplier From Dubai, United Arab Emirates Report Post Block User Professional Touchsc…” | — |
| 7 | Earthmech | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“Being a general trading company we deal in all types of commodities, consumables, spare parts etc.” | — |
| 8 | ELK Fashion Dubai | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | STORE_NETWORK：“rives consistent year-round demand across all six Gulf states are exactly the categories where Dubai…” | 是：官网写了“Women's Wholesale” |
| 9 | Emirates Apparel | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 唯一的经营证据是网页导航里的泛词（如"locations""shop online""inventario"）或只是在说它的客户是零售店，新规则不再算它自己的经营证据。 | RETAIL_CHANNEL：“uits Hoodies T Shirts Polo Shirts Sweatshirts Shorts Accesories Services Printing Embroidery Manufac…” | — |
| 10 | Find General Trading LLC | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“At Find General Trading, we believe office procurement should be organized, dependable, and tailored…” | — |
| 11 | Home Design México® | 墨西哥 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | WHOLESALER：“Ir directamente al contenido Desarrollo y Mayorista MADERASCASTELBONITAHELVEXWASSERMABEGABINETESLAMB…” | — |
| 12 | MA General Trading | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | DISTRIBUTOR：“Our professionally managed company is entirely devoted to meeting the needs of our customers.Our vis…” | — |
| 13 | Murex Trading LLC | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | STORE_NETWORK：“esence: Serving customers across Africa, CIS, GCC, and Arab countries. Extensive Inventory: Over 12,…” | — |
| 14 | NOWA General Trading LLC | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | DISTRIBUTOR：“Wholesale distribution since 2017 +971 4 852 0964 info@nowa.ae WhatsApp Wholesale Point About us Who…” | — |
| 15 | Right Face General Trading LLC | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“Get Quote Home About Us Products Foodstuff Dental Hygiene Products Industrial Spare Parts Medical Co…” | — |
| 16 | UAE's Leading Travel Retail Distributor | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | STORE_NETWORK：“travel lifestyle sectors. Duty Free Operation Leading travel retail for 20 brands in high-traffic in…” | — |
| 17 | United General Trading FZCO | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | GENERAL_TRADING：“Get In Touch Abid@unitedfmcg.com S51202, Street No 12, Jafza South,Near Gate No 12, Jebel AliDubai, …” | — |
| 18 | Urban Lifestyle General Trading LLC | 阿拉伯联合酋长国 | 泛相关 → 待研究 | 只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。 | STORE_NETWORK：“rab Emirates (U.A.E.) is our Country of Domicile. The Company controls this Site from the U.A.E. The…” | — |

"可能补回"＝官网文字里已经出现已批准类目的词（如女装、连衣裙、家居用品），但系统还没把它整理成类目证据。共 2 家：© 2026 Alanic、ELK Fashion Dubai。这些更像"证据没整理好"而不是"不合适"，补齐类目证据（计划 C8 多语言类目词）后会自动回到机会池；如果你希望启用新规则前先补这一步，告诉我。

## 五、零售连锁因企业核验未通过而未进池（共 0 家）

这批数据里没有"有门店网络 + 已批准类目、但企业核验未通过"的零售连锁。原因是：93 家待核验企业里有 92 家在系统里没有任何官网证据记录（核验没通过时，证据只记在研究候选上，没有挂到企业上），所以现在无法判断其中有多少是零售连锁。C1 把"零售连锁/百货"加进核验后，要等下一轮研究重新核验这些企业才能看到效果。

## 六、需要你决定的

- 新规则会让 18 家企业降档、0 家升档，机会池合计 28 → 10 家。
- 降为"待研究"的企业不会被删除，历史档位、证据、首封记录都保留；以后补到类目证据会自动回到机会池。
- 同意启用后：规则版本升到 `v2_MC08`，机会池决策表照旧只追加新记录，旧记录不改。

---
重新生成：`cd services/demo-dashboard && node scripts/compare-opportunity-pool.mjs`（只读）。
