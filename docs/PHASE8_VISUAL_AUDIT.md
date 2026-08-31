# Phase 8 基线视觉审计

日期：2026-08-31  
审计基线：`phase7` 发布提交 `bd4af24634069aa3ee9b009c1e8799d627eff118`  
审计模式：浏览器可见页面、DOM 测量、源代码和 CSS 静态计数

## Design Read

Reading this as: a redesign-preserve of an internal B2B operations workspace for management and overseas sales, with a calm, trustworthy and dense operational language, leaning on the existing Tabler and native web foundation.

设计参数：

```text
DESIGN_VARIANCE = 3 / 10
MOTION_INTENSITY = 2 / 10
VISUAL_DENSITY = 8 / 10
```

这是产品后台，不是营销 Landing Page。Phase 8 采用目标参考中的安静画布、单一靛蓝主动作、克制阴影和清晰层级；不采用 Hero、渐变标题、虚构 KPI、头像、客服票据和展示型动效。

## 审计方法与安全边界

- 浏览器在 `http://localhost:3000/` 读取现有真实业务界面，只做查看、导航和 DOM 测量。
- 文档只记录聚合、尺寸、组件数量和非敏感视觉事实。
- 不把邮箱、电话、消息正文、订单、内部路径、token、raw payload 或密钥写入截图清单和文档。
- 浏览器即时截图用于本地审计，不提交真实数据截图；Phase 8 最终验收截图进入 Git-ignored 目录并单独生成安全 manifest。

## 当前技术与体量

```text
Express 5.2.1
vanilla HTML / CSS / JavaScript
Tabler Core 1.4.0
Tabler Icons Webfont 3.46.0
no React / Vue / Svelte / Tailwind runtime
```

| 文件 | Phase 7 体量 |
| --- | ---: |
| `public/index.html` | 56,720 bytes |
| `public/app.js` | 190,768 bytes / 2,196 lines |
| `public/phase7-ui.js` | 59,898 bytes / 847 lines |
| `public/phase5.css` | 48,401 bytes / 584 lines |
| `public/styles.css` | 17,984 bytes / 839 lines |
| `public/contact-results.css` | 14,613 bytes / 580 lines |
| `public/phase7.css` | 8,904 bytes / 346 lines |

CSS 静态计数：

| 项目 | 数量 |
| --- | ---: |
| raw hex colors | 90 |
| `border-radius` declarations | 99 |
| `box-shadow` declarations | 27 |
| `!important` declarations | 34 |
| pill / badge / chip mentions | 27 |

这些计数不是独立失败条件。它们说明同一语义分布在 `styles.css`、`bilingual.css`、`contact-results.css`、`phase5.css` 和 `phase7.css` 多层，继续追加一个总覆盖文件会增加回归风险。

## 当前品牌 tokens

### Phase 7 light baseline

| 角色 | 当前 token/value | 审计判断 |
| --- | --- | --- |
| Canvas | `--paper: #f2f5fa` | 冷蓝底色可用，但 radial gradient 让业务页带展示型装饰 |
| Surface | `--card: #ffffff` | 保留白色业务面 |
| Text | `--ink: #182235` | 对比清晰，保留相近深度 |
| Muted | `--muted: #5d6a7e` | 可用，Phase 8 统一到单一 muted role |
| Brand | `--color-brand: #214a86` | maritime blue 历史色；Phase 8 主动作转为更清晰 indigo |
| Action | `--color-accent: #2f63d9` | 可用但与 brand 双重竞争 |
| Focus | `--focus: #b24b19` | 可见；Phase 8 要验证 light/dark 的 3:1 non-text contrast |
| Card radius | `--radius-card: 16px` | 适合主要 panel |
| Control radius | `--radius-control: 10px` | 适合 controls |
| Shadows | 蓝调 `shadow-sm` / `shadow-lg` | 数量和强度分散；Phase 8 收敛为 panel/popover 两级 |

`phase5.css` 又定义一层 `--crm-*` aliases、`--crm-radius: 8px` 与另一套 dark/status 色。因此 Phase 8 需要 token 迁移，而不是继续混合旧 brand、accent 和 crm aliases。

### 当前字体与双语

```text
"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif
body = 15px in phase5.css
controls = 44px comfortable / 38px compact
```

`.bi > [lang]` 当前强制继承相同字号与重量，这是专案必须保留的双语合同：中文在上、英文在下，同一组件角色内字号、字重、行高和颜色一致，两种语言语义完整。表头、页标题、筛选和状态的视觉重量应通过组件角色、间距、布局与容器调整，不能通过降级任一语言处理。公司名、邮箱、电话、URL、证据原文保持原样，不翻译、不润色。

## 当前信息架构

现有 sidebar 是 10 个同层项目：

```text
Overview
Research
Companies
Opportunities
Customer Match / ICP
Evidence
Jobs
Data Import
Data Export
Settings
```

审计问题：

- 业务判断、执行、资料和数据交换没有分组。
- Overview 为默认入口，但主要内容仍是公司名录和 DPV Score，不是老板可批准的机会。
- Contact Queue 已有后端实体，却没有独立导航面。
- Evidence Required 被隐藏在筛选和详情中，不是可工作的例外队列。
- Companies 文案 “Companies and Prospect Review” 把全量主档和联系建议混为一体。

Phase 8 目标 IA：

```text
Decide: Overview / Opportunities
Act: Contact Queue / Research / Jobs
Records: Companies / Customer Match / Evidence
Data: Data Import / Data Export
Settings
```

`Opportunities` 成为默认业务决策页；Overview 仍是管理摘要。`[data-app-nav]`、`[data-app-view]` 和 URL hash 继续作为稳定入口。

## 页面审计

### Overview

浏览器实测：

```text
KPI cells: 7
Priority list rows: 5
Priority source: current DPV score
Primary action: Update Company Directory
```

问题：

- 7 个等权 KPI 横排，业务重要性相同。
- “Priority companies / Top five by current score” 把高分公司表现为优先机会，与 Phase 7 `RECOMMENDED=0` 的真实事实不一致。
- 右侧 Directory status 与 KPI 重复。
- 双语标题、说明、更新时间和主按钮在同一横排，窄屏挤压。

保留：数据更新时间、真实计数、跳转到业务页的动作。  
淘汰：DPV Score 优先榜、重复名录指标、装饰图表。  
Phase 8：4 个管理指标 + 最多 5 条真实 Recommended；为 0 时显示确定性缺证原因，绝不回退 Tier A/DPV Score。

### Opportunities

浏览器在 1280 x 720 实测：

```text
filter controls: 20
desktop columns: 11
table rendered width: 2,199px
page body width: 1,280px
current Recommended rows: 0
```

页面外层没有横向 overflow，但默认视图仍是一张内部 2,199px 宽的空表和横向滚动条。宽表把 Buyer Model、Product Match、Product Opportunity、Supplier Access、Product Access Matrix、Buyer、Contact、Secondary Scores 和 Readiness 同时放到第一层。

问题：

- `RECOMMENDED=0` 时空表仍占据主要画面。
- Opportunity Status 没有作为第一决策信号。
- 20 个筛选都藏在一个 disclosure，缺少 primary/advanced 层级和 active filter summary。
- “Update Buying Contacts” 在老板默认页上比真实 0 状态更突出。
- 当前 table min-width CSS 为 1,840px，真实内容进一步扩展到 2,199px。

保留：所有 20 个 query 参数、原生表单语义、排序、深链、详情入口。  
淘汰：默认 11 列、空宽表、同权 filter wall、Secondary Scores 第一层。  
Phase 8：六态 status tabs、5 个 primary filters、advanced drawer、7 个决策列和真实 0 空状态。

### Companies

当前桌面 11 列：Company、Market、Business Type、Size、Verification、Data Status、Last verified、Sources、Customer Match、DPV Score、Tier。

问题：

- 普通属性和真实状态都以 badge/pill 形式出现，颜色密度过高。
- 公司主档和机会管理的边界不清。
- 默认排序仍是 score，强化了“高分等于应联系”。

保留：全量 106 公司、分页、核验/生命周期/规模/Tier 筛选、公司详情。  
淘汰：Confirm Contact 或消息动作、普通属性胶囊、把 legacy review 叫批准/拒绝。  
Phase 8：8 个主档列，legacy action 改为 Confirm Company Record / Exclude Company Record。

### Company Detail

浏览器实测首家公司：

```text
dialog: 960 x 619px at 1280 x 720
top-level tabs: 15
top score cards: 5
top meta badges: 3
legacy review buttons: 2
```

当前优点：有可见 Back、独立 close icon、一个受控 dialog、sticky decision footer 和原触发器恢复代码。当前问题：

- 15 个 tabs 横向滚动，阅读和键盘定位成本高。
- 顶部 5 张评分卡、状态 badges、网站链接同时竞争。
- 窗口固定 960px，不随短/长内容建立更合适的 workspace。
- “Reject / Approve manually” 容易被理解成 Opportunity Management Approval，实际只是 legacy company data review。
- 页面底部操作区与滚动内容在小 viewport 容易遮挡焦点。

Phase 8 把 15 tabs 重组为 Snapshot、Business Fit、Buyer & Contact、Activity & Records 四区；桌面最大 1,200-1,280px，左侧 section nav + main + 可选 260px sticky summary；移动端单栏全屏，并保持 Back/Close。

### Research / Jobs

当前 Research 将多个市场、产品和 buyer fields 放在一个五列 form；Jobs 同时承载 ResearchJob 和历史 import batches。

保留所有 field name/value 和 API。Phase 8 把 Research 呈现为 Market & Product、Buyer target、Scope review 三步；Jobs 明确分为 Research/Import/Export，不显示内部 queue token、path 或 raw payload。

### Data Import

当前用三块同权 panel 表达 form、summary/actions 和 row check。Submit Approval、Approve Version、Commit 主要通过 disabled 外观区分，缺少“为什么还不能进行”的文字。

保留 Phase 7 type/file contract、check、row results、approval、commit 和 report。Phase 8 改为一次突出一个 step；accepted/review/rejected/duplicate summary 常驻，逐行 table 按需展开。

### Data Export

当前 form、Column Permission 和 Current Export Job 是三块同权 panel。功能链路已在 Phase 7 验证为真实可下载，但初始空状态和 column panel 占据过多空间。

保留服务端 projection、角色白名单、token expiry、SHA、download audit 和私有路径边界。Phase 8 依序展示 Dataset、Scope、Format、Column preview、Generate、Download；0 行不显示可下载成功状态。

### Settings / Evidence / ICP

- Settings 已有 system/light/dark 与 comfortable/compact，保留。新增 bilingual detail preference 只影响显示，不改数据库。
- Evidence 当前只是“从 Companies 打开详情”的空入口，Phase 8 提供按公司/机会的 evidence reader，不变成文件仓库。
- ICP 当前为三张同权 profile cards，Phase 8 使用对齐 comparison rows，保持三套 profile 独立。

## 保留模式

- 本地 Tabler Core 与 Tabler Icons。
- Sidebar + sticky topbar + hash navigation。
- 中文在上、英文在下的完整信息。
- 原生 button/select/dialog/details/table 的语义。
- 可见 focus ring、skip link、`touch-action: manipulation`、`100dvh`、浏览器缩放。
- table responsive region 只用于 technical/audit 宽表。
- 明确 loading/empty/error/success 业务状态。
- 公司、机会、Buyer Model、Product Match、Supplier Access、联系方式和 evidence 的独立语义。

## 淘汰模式

- radial/gradient 装饰背景和渐变标题。
- 7 个等权 KPI 与大面积 card wall。
- 每个字段、数值和普通属性使用 pill/badge。
- 以颜色作为唯一状态信号。
- 11 列默认决策表与 20 filter 同层展示。
- 空数据仍呈现宽空表。
- 15 个横向详情 tabs。
- legacy company review 使用 “Approve/Reject” 机会措辞。
- raw hex、radius、shadow 和 `!important` 继续散落到页面级文件。
- emoji、AI orb、glow、fake avatar、fake KPI、fake opportunity 和宣传型措辞。

## 现有设计 dials 与目标

| Dial | 当前判断 | Phase 8 目标 | 原因 |
| --- | ---: | ---: | --- |
| Variance | 3 | 3 | 内部业务系统需要稳定网格和一致路径 |
| Motion | 2 | 2 | 只保留 hover/focus/drawer/modal/state feedback |
| Density | 8 | 8 | 数据密集，但通过 progressive disclosure 降低首屏负担 |

## Phase 8 验收基线

- [ ] Overview 不再显示按 DPV Score 的 Priority companies。
- [ ] Recommended 为 0 时显示有用的真实空状态，不渲染 2,199px 空表。
- [ ] Opportunities 默认业务表在 1,440px 无页面级或默认表格横向滚动。
- [ ] 所有 20 个筛选参数通过 primary + advanced 保留。
- [ ] Companies 无 Confirm Contact bypass，ordinary attributes 不使用状态 pill。
- [ ] Detail 只有 4 个一级区域，并保留 Back/Close/focus restoration。
- [ ] Data Import/Export 的当前步骤、阻断原因和恢复动作清楚。
- [ ] 六个目标 viewport 无页面级横向 overflow；浏览器 zoom/pinch zoom 保持可用。
- [ ] light/dark、comfortable/compact 与中英层级分别检查。
- [ ] 真实 Recommended、Management Approved、Provider calls 和 sends 继续为 0。
