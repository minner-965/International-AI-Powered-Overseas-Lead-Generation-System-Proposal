# 跟进邮件模板（待 Simon 审定）

代码位置（在 `claude/gifted-hypatia-59rtaf` 分支，默认分支上还没有）：
[`services/demo-dashboard/src/crm/followupTemplates.js`](https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal/blob/claude/gifted-hypatia-59rtaf/services/demo-dashboard/src/crm/followupTemplates.js)

## 什么时候生成、什么时候不发

| 封次 | 生成时间 | 条件 |
|---|---|---|
| 第 2 封 | 首封发出后第 4 天 | 对方没有回复、没有退订或退信，阶段仍是"待联系 / 已联系" |
| 第 3 封 | 首封发出后第 9 天 | 同上，并且第 2 封已经发出 |

- 系统只生成**草稿**，在"跟进邮件审批"里由人批准（可先改主题和正文）后才发送。
- 发送前再检查一次：对方是否已回复或退订、当天额度（与首封合计每天最多 50 封）、邮件总开关。
- 发出的跟进邮件和首封在对方邮箱里显示在同一个对话里；对方回复后自动归到这家企业的跟进记录。
- 默认关闭，设置 `CRM_FOLLOWUP_DRAFTS_ENABLED=true` 才会生成草稿。

变量：`[Company]` 企业名；`[Category]` 商品类目（womenswear / general merchandise）；`[Reply-To]` 回复邮箱。以下示例用 Al Noor Fashion Trading LLC。

## 第 2 封 · 跟进确认（FOLLOWUP_2_CHECK_IN）

**主题** Following up: womenswear supply for Al Noor Fashion Trading LLC
（跟进：给 Al Noor Fashion Trading LLC 的女装供货）

| English | 中文对照 |
|---|---|
| Hello, | 您好， |
| I wanted to follow up on my earlier email about womenswear supply for Al Noor Fashion Trading LLC. | 想跟进一下我之前关于给贵司供应女装的邮件。 |
| If this category is relevant to your team, I can send a short catalogue for review. | 如果这个类目和贵司相关，我可以发一份简短的产品目录供参考。 |
| Could you let me know whether this is of interest, or point me to the right person? | 能否告诉我是否感兴趣，或者帮我转给负责的同事？ |
| Best regards, / Simon / SIM International / simon@… | 此致 / Simon / SIM International / 回复邮箱 |

## 第 3 封 · 最后一次（FOLLOWUP_3_LAST_NOTE）

**主题** Womenswear catalogue for Al Noor Fashion Trading LLC
（给 Al Noor Fashion Trading LLC 的女装目录）

| English | 中文对照 |
|---|---|
| Hello, | 您好， |
| This is my last note on womenswear supply for Al Noor Fashion Trading LLC. | 这是关于女装供货的最后一封邮件。 |
| If you are reviewing suppliers for this category now or later in the year, I would be glad to send a concise catalogue. | 如果贵司现在或今年晚些时候在找这个类目的供应商，我很乐意发一份简明目录。 |
| If this is not relevant, just reply and I will not follow up again. | 如果不相关，回复一下即可，我不会再跟进。 |
| Best regards, / Simon / SIM International / simon@… | 此致 / Simon / SIM International / 回复邮箱 |

## 写法约束

- 不写价格、起订量、交期、付款条件、认证（发信规则禁止未经批准的商业承诺）。
- 主题不用 "Re:" / "Fwd:" 开头。
- 每封只有一个行动请求（发目录 / 转给负责人）。

首封开发信三套模板（已审定版本）只把落款和自我介绍中的 "DPV International" 改成了 "SIM International"，其余文字未改：[`firstTouchTemplates.js`](https://github.com/minner-965/International-AI-Powered-Overseas-Lead-Generation-System-Proposal/blob/claude/gifted-hypatia-59rtaf/services/demo-dashboard/src/outreach/firstTouchTemplates.js)。

**请审定**：直接回复要改的句子即可，我来改代码和测试。
