# DPV Frontend UI System

版本：Phase 8
日期：2026-08-31
状态：公司工作台前端 Source of Truth

本文件定义现在和以后全部公司可见前端的硬规则。详细 tokens 与组件规范见 [PHASE8_DESIGN_SYSTEM.md](./PHASE8_DESIGN_SYSTEM.md)，基线问题见 [PHASE8_VISUAL_AUDIT.md](./PHASE8_VISUAL_AUDIT.md)，第三方采用边界见 [PHASE8_UI_UX_REUSE_RESEARCH.md](./PHASE8_UI_UX_REUSE_RESEARCH.md)。

## Product direction

- Product：国际贸易公司内部 B2B 客户研究、机会判断、联系准备与数据交换工作台。
- Audience：公司管理层和海外销售人员。
- Product scope：全品类女装与 general merchandise；当前可见市场 `AE / MX`。
- Visual language：calm、operational、human、evidence-first；不是女装商城、营销 Landing Page 或通用 dashboard 模板。
- Design dials：variance 3/10、motion 2/10、density 8/10。
- Existing features 直接使用本系统；未来功能只扩展同一 tokens、components 和 business language。
- BD 继续由 backend/historical model 支持，但由 `public/market-visibility.js` 的单一 `visible` flag 隐藏。恢复时修改该 flag 并重建，不迁移或伪造历史数据。

真实业务事实优先于视觉完整感。`RECOMMENDED=0`、`MANAGEMENT_APPROVED=0`、`Provider calls=0`、`real sends=0` 是合法结果，不得回退到 Tier A、DPV Score、演示记录或虚构图表填充。

## Foundation and dependency boundary

```text
Express static frontend
vanilla HTML / CSS / JavaScript
@tabler/core 1.4.0
@tabler/icons-webfont 3.46.0
native dialog/details/form/table/grid
```

- 不迁移 React、Vue、Svelte 或 Tailwind。
- 不增加 CDN、Google Fonts、遥测或远程 UI assets。
- Tabler/Core 和 Icons 固定版本、本地 `/vendor` 提供，保留 MIT license notices。
- 只使用 Tabler Icons 一套 icon family。
- AG Grid、Grid.js 和另一个 design system 在 Phase 8 不引入。

## CSS layers

Phase 8 最终加载顺序：

1. Local `@tabler/core` CSS。
2. Local `@tabler/icons-webfont` CSS。
3. `public/ui/phase8-tokens.css`：唯一 semantic token source。
4. `public/ui/phase8-foundation.css`：typography、focus、shell foundation。
5. `public/ui/phase8-components.css`：controls、status、chips、tables、dialog、drawer。
6. `public/ui/phase8-pages.css`：page composition。
7. `public/ui/phase8-responsive.css`：breakpoints、mobile decision cards/sheets、safe areas。

Legacy `styles.css`、`bilingual.css`、`contact-results.css`、`phase5.css`、`phase7.css` 只在逐段迁移期间加载。Phase 8 接管某 selector 后，应删除 superseded declaration，禁止用一个新的大型 override 文件盖住旧层。

组件和页面只能引用 semantic tokens。禁止在 page/component 文件新增 raw hex、随机 radius/shadow 或为解决 specificity 大量使用 `!important`。

## Core visual tokens

### Light

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--p8-canvas` | `#F6F5F2` |
| Surface | `--p8-surface` | `#FFFFFF` |
| Surface subtle | `--p8-surface-subtle` | `#F1F2F6` |
| Main ink | `--p8-ink` | `#172033` |
| Muted ink | `--p8-muted` | `#5F6B7A` |
| Border | `--p8-border` | `#DDDDE3` |
| Primary | `--p8-primary` | `#4F46E5` |
| Primary hover | `--p8-primary-hover` | `#4338CA` |
| Success | `--p8-success` | `#166534` |
| Warning | `--p8-warning` | `#92400E` |
| Danger | `--p8-danger` | `#B91C1C` |

### Dark

```text
canvas #10131A
surface #171B24
surface raised #1D2230
main ink #F3F4F6
muted ink #A8B0BF
border #303747
primary #818CF8
```

### Type, shape and spacing

```text
font sans: Inter Var, Inter, Segoe UI Variable, Segoe UI,
  Microsoft YaHei UI, Microsoft YaHei, sans-serif
font mono: Cascadia Mono, SFMono-Regular, Consolas, monospace
page title: 28-32px desktop / 24-26px mobile
body: 15-16px / line-height 1.5
table metadata: minimum 12px
shell radius: 18px
panel radius: 16px
control radius: 10px
base spacing: 4px
page gap: 24px desktop / 16px mobile
panel padding: 20-24px desktop / 16px mobile
touch target: minimum 44 x 44px
```

Panel shadow 只用于真实浮层层级；popover/dialog 使用更强一档。Table cell、KPI 和详情字段不单独做卡片或阴影。

## Information architecture

Primary navigation 按老板的工作路径分组：

```text
决策 / Decide
  总览 / Overview
  业务机会 / Opportunities

执行 / Act
  待联系 / Contact Queue
  市场研究 / Research
  研究任务 / Jobs

资料 / Records
  客户名录 / Companies
  客户匹配 / ICP
  资料依据 / Evidence

数据 / Data
  数据导入 / Data Import
  数据导出 / Data Export

设置 / Settings
```

- Opportunities 是登录后的默认业务决策页。
- Overview 是管理摘要，priority list 只来自 Recommended。
- Companies 是全量主档，出现不代表建议联系。
- Evidence Required 是 Opportunities 一级 view，不是后台错误列表。
- Contact Queue 是独立执行页，只显示当前可执行项。
- 同时只有一个 primary nav item 使用 `aria-current="page"`。
- 所有主要页面保持 URL hash/deep-link，Back 恢复 view、filters、scroll 和触发器 focus。

## Stable hooks and API contracts

Visual refactor 必须保留以下 ID、`data-*`、request fields、enum values 和行为：

```text
[data-app-nav] / [data-app-view]
#sidebar-toggle
#reset and POST /api/live/collect
#research-form and POST /api/research/jobs
#research-job and ResearchJob polling/query/candidate endpoints
#metrics and GET /api/metrics
#leads, #tier, #size and GET /api/leads
#detail and GET /api/leads/:id
#opportunity-table
#opportunity-sort
#opportunity-filters
#start-enrichment
#enrichment-job-status
all data import/export form IDs
all Phase 7 management auth / role / CSRF flows
```

新增 stable hooks：

```text
[data-app-nav="contact-queue"]
[data-app-view="contact-queue"]
#opportunity-status-tabs
#opportunity-primary-filters
#opportunity-advanced-filter-drawer
#evidence-required-list
#contact-queue-list
#detail-section-nav
```

继续保留：

- score/history、Customer Match/history、ICP read endpoints。
- Phase 6 decision-makers、contact-routes、cooperation-feasibility endpoints。
- Phase 6.1 category-procurement、buyer-business-model、product-opportunities endpoints。
- Phase 7 opportunities、decisions、management approval、Contact Queue、draft/message、import/export endpoints。

不得在纯视觉重构中改 endpoint、payload key、returned field、evidence content、product master ID、历史 OKKI fact 或后端 enum。样式使用 class，不把 ID 变成装饰选择器。

## Bilingual presentation

- 公司可见 label 使用 `.bi`，中文在上、英文在下。
- `.bi` 内两行在同一组件角色中使用相同字号、相同字重、相同行高和相同文字颜色。
- 中英文语义同等完整；不得用更小字号、更轻字重或 muted 颜色降级英文。
- 信息层级由 page/section/label 等组件角色、间距、布局与容器建立，而不是由语言差异建立。
- 使用 `lang="zh-CN"` 与 `lang="en"`。
- Native `<option>` 使用简洁 `中文 / English`。
- Internal enum 通过确定性 label map，snake_case 不进入可见文案。
- 不翻译、重写或 embellish 公司名、邮箱、电话、URL、产品名、source finding/evidence 原文。
- Loading、empty、error、disabled reason、success 和 recovery action 全部双语。

## Business wording rule

UI、Excel、CSV 和导出说明必须使用短、具体、可由当前字段证明的业务语言。

不得出现：

```text
AI-powered / AI generated
智能生成 / 自动智能推荐
革命性 / 赋能 / 下一代 / 无缝
Demo / phase number / provider name
raw enum / snake_case / not_checked
internal queue / token / path / hash / stack trace
```

不要重复用 “real” 表现真实性。通过来源、captured/verified time、verification status、SHA/audit 和业务计数证明。机会建议只来自 current deterministic decision 和 Gate，不从 Tier/DPV Score 语言暗示建议联系。

## Status, badge and chip

```text
badge = static business state
chip = selected filter/value/action
```

可使用状态色：`RECOMMENDED`、`MANAGEMENT_APPROVED`、`EVIDENCE_REQUIRED`、`HOLD`、`NOT_SUITABLE`、`SUPPRESSED`、hard bounce、complaint、opt-out。

普通属性不使用彩色 pill：company size、market、business type、data active、DPV Score、Tier numeric、product profile、source count。

每个列表行最多一个主 decision status + 一个 blocker/risk marker。状态必须有可见中英文字或 icon + text，颜色不是唯一信号。Filter chips 可换行；unavoidable truncation 必须有 keyboard/touch 可操作的完整 disclosure，不能只用 hover tooltip。

## Page contracts

### Overview

- Page header + one-sentence operating summary + last refresh + one primary action。
- 4 个指标：Recommended、Management Approved/Contact Queue、Evidence Required、Active Companies。
- Recommended list 最多 5 条，只来自 opportunities decision。
- 0 时显示“尚无联系就绪机会”和 CONTACT/BUYER_ROLE/EMAIL/PRODUCT/COMPANY 聚合原因；不回退 Tier A/DPV Score。
- 不显示无业务动作含义的装饰图表。

### Opportunities

- 默认 status = `RECOMMENDED`。
- Tabs：Recommended、Evidence Required、Management Approved、Hold、Not Suitable、All。
- 常显 Search、Status、Market、Product Profile、Sort；其他 15 个参数进入 advanced drawer。
- Active filters 以 removable chips 显示，保留所有现有 query semantics。
- 默认 7 列：Company；Market/Profile；Opportunity Status；Buyer Model/role；Product Category Score；Buyer/VALID contact；Supplier Access/action。
- Secondary score、matrix、full reasons、freshness 和 routes 进入 detail。
- Recommended 为 0 时不渲染宽空 table，显示 compact empty state + View Evidence Required。
- Confirm Contact 只在 Gate 0 当前全部通过时出现。

### Evidence Required

按 Product/Category、Buyer model、Contact missing、Buyer role、Email、Identity、History 主阻断原因分组。每行只显示 Company/Profile、business fit、一个 blocker、owner、last checked、next safe action。Phase 8 不自动启动 Phase 9 批量补证。

## New-customer product opportunity scoring

- 公司商品资料和历史客户成交资料只用于形成 DPV 批准供货类目/画像、历史 ICP 与目标客户评分基准。
- 新客户的商品机会按类目评分：核验目标客户公开的采购需求或经营商品类目，再与 DPV 批准供货类目比较。
- 相同类目、相似类目或同一批准产品画像表示公司具备供货能力，因此存在类目级合作机会。
- 新客户机会不要求匹配某个精确 SKU 或单款商品，不生成商品候选，也不创建“补充对应商品”的人工任务。
- 客户侧采购需求或经营类目资料不足时保持 `NEEDS_PRODUCT_EVIDENCE`；已确认超出公司批准类目时使用 `PRODUCT_MISMATCH`。
- 公司可见标签统一使用 `商品类目评分 / Product Category Score`，不得用容易被理解为精确商品匹配的标签。

### Contact Queue

只显示当前 `MANAGEMENT_APPROVED` 且 Gate 0 仍有效记录。包含 Buyer/role、VALID contact expiry、approver/time、draft/message state、last contact/reply、owner/next action。空时显示真实业务状态，不生成示例记录。

### Companies

- 标题为 Company Directory，说明“出现在此处不代表建议联系”。
- 默认列：Company/Website、Market、Business Type、Verification、Relationship、Latest Evidence、Related Opportunity、Action。
- 无 Confirm Contact、message approval 或 send 入口。
- Legacy company review 叫 Confirm Company Record / Exclude Company Record，不叫 Opportunity approval。

### Detail workspace

4 个一级区域：

```text
Snapshot
Business Fit
Buyer & Contact
Activity & Records
```

Desktop content-sized，max 1,200-1,280px，left section nav + main content + optional 260px sticky summary。Tablet near-fullscreen；Mobile 单栏 full-height，Back 固定，section nav 变 select/accordion。

顶部只显示 Company、Market/Profile、一个 primary status、一个 blocker、source freshness。一个 scroll container；Back/Close 始终可见；sticky footer 只在 valid action 存在时显示。

Legacy data actions 使用 Confirm Company Record / Exclude Company Record，与 Management Approval 完全分离。

### Research and Jobs

- Research：Market & Product -> Buyer target -> Scope review & create job。
- 所有 input name/value 和 `POST /api/research/jobs` 不变。
- Jobs 区分 Research Jobs、Import Jobs、Export Jobs。
- UI 不显示内部 token、queue、path 或 raw payload。

### Data Import

```text
Select Type & File
-> Check
-> Review Rows
-> Submit Approval
-> Approve Version
-> Commit
```

一次只突出当前动作；disabled 同时解释缺少什么。常显 accepted/review/rejected/duplicate summary，row table 按需展开。保留 Phase 7 type、template、approval、commit、result report 和 service-side validation。

### Data Export

```text
Dataset -> Scope -> Format -> Column preview -> Generate -> Download
```

保留 Phase 7 field allowlist、role projection、token expiry、SHA、download audit 和 private path boundary。0 行结果不显示正常 download success；Column Permission 是 form 下方普通 summary，不做同权空卡。

### Customer Match / Evidence / Settings

- ICP 三套 profile 保持独立，使用对齐 comparison rows，不做三张重复装饰卡。
- Evidence 是按 company/opportunity 的 reader，显示 evidence type、finding、source、freshness、supports/contradicts；不是共享目录浏览器。
- Settings 保留 system/light/dark、comfortable/compact；新增 bilingual detail standard/compact。偏好只在浏览器保存，不改变数据库资格、机会或审批状态。

## Dialog and interaction

- 使用 native `<dialog>` + `showModal()`。
- 打开时 focus title/Back 或最合适动作；Tab/Shift+Tab 留在 dialog；Escape 在无未保存操作时关闭。
- 始终有可见双语 Back/Close 和独立 icon close。
- 关闭恢复到准确触发器或其 table refresh 后 replacement。
- 一个 scroll container；header/nav/footer 在滚动 body 外，focused content 不被 sticky footer 遮挡。
- 无未保存操作时可 backdrop dismiss；有 unsaved action 先确认。
- Async 只禁用相关 action group，设置 `aria-busy`，在同一区域显示 progress/success/recoverable error。
- Destructive action 使用 danger-secondary，与 primary action 分离。

## Responsive contract

验收 viewport：

```text
1440 x 900
1024 x 768
768 x 900
390 x 844
375 x 667
844 x 390
```

- Desktop >=1024px：grouped fixed sidebar、sticky topbar、content max 1600px、default operational table 无页面级横向 overflow。
- Tablet 768-1023px：collapsible sidebar、filters 两行、detail near-fullscreen、sticky action 可见且不遮 focus。
- Mobile <768px：off-canvas nav、decision cards/reduced columns、advanced filter full-height sheet、44px targets、safe-area padding。
- Mobile 不把 11 列表格缩小；保留 status、company、profile、Buyer/contact、action，secondary information 进入 detail。
- 长 company、URL、email、phone、bilingual reason 使用 `min-width:0` + `overflow-wrap:anywhere`。
- 使用 `100dvh`；禁止 `h-screen`、page scale hack、`maximum-scale` 或 `user-scalable=no`。
- Browser zoom、Ctrl/Command zoom 和 mobile pinch zoom 保持可用。
- Comfortable/Compact 只改 spacing，不缩放 document。

## Accessibility

- WCAG AA normal text >=4.5:1；non-text/control boundary >=3:1。
- Web target 使用更强的 44 x 44px 项目标准。
- 每个 interactive element 有 visible `:focus-visible`；focus 不被 sticky UI 隐藏。
- Logical heading hierarchy；view change 后 focus main/page title。
- Visible input labels、inline validation、cause + recovery error。
- Multi-error form focus error summary，同时保留 inline errors。
- Icon-only control 有 accessible name；visible text 旁 decorative icon `aria-hidden="true"`。
- Status 不是 color-only；async operation 一个 contextual live region。
- `prefers-reduced-motion` 移除非必要 transition/animation/smooth scroll。
- Keyboard-only 完成 navigation、filters、drawer、detail、pagination、import/export 和返回路径。

## Motion

```text
hover/focus/selection 120-180ms
drawer/modal entry 180-220ms
no page scroll reveal
no bouncing counters
no animated gradients
```

只动画 opacity/transform，不动画 width/height/top/left。Motion 只表达 feedback/state transition/hierarchy，correctness 不依赖 animation end。

## Data and security boundaries

Ordinary UI 不显示：

```text
shared-folder path / staging path
raw filename for sensitive internal source
source or evidence hash outside approved audit view
raw payload
internal OKKI link
supplier cost / margin / internal order identity
token / credential / key
private export path
email body outside approved message workflow
```

Phase 8 保持：

```text
OUTREACH_ENABLED=false
LIVE_PROSPECT_SEND_APPROVED=false
OUTBOUND_EMAIL_PROVIDER=NONE
RESEND_USE_CASE=DISABLED
```

UI 不直接调用 n8n、Hunter 或 outbound Provider。Phase 7 import/export/approval/suppression/webhook/CRM 行为与共享目录严格只读边界保持不变。

## Extension checklist

每个未来功能必须：

1. 先复用现有 token 和最接近 component。
2. 保持 API/data semantics，不把 UI preference 写成业务状态。
3. 使用中文主标签 + 英文 companion，enum 有确定性映射。
4. 定义 loading、empty、error、success、disabled、keyboard 和 recovery。
5. 每 screen 一个 primary action，每 row 最多一个 status + 一个 risk。
6. 测试七个 viewport（增加 1280 × 720）、light/dark、comfortable/compact、200% zoom、reduced motion。
7. 确认无 page-level horizontal overflow、clipped bilingual label 或被 sticky UI 遮挡的 focus。
8. 确认真实 counts 和 business decisions 在 UI 前后相同。
9. 确认 UI、Excel、CSV 没有 AI 宣传、snake_case、乱码、内部路径或私密内容。
10. 第三方依赖先记录 version、license、cost、privacy、maintenance、deployment 和 integration boundary，固定版本后才能引入。

## Phase 9 Research and Jobs contract

Research 和 Jobs 已由 Phase 9 统一为同一套证据工作流：

1. Research Workbench 只读取真实聚合：active jobs、Evidence Required opportunities、verified profile buyers、contact-ready opportunities。
2. Priority Evidence Work 最多三项，排序由当前 blocker、contact proximity 和 evidence age 确定，不使用 DPV Score 或 Tier 代替机会判断。
3. New Research Job 是三步 native dialog，保留原字段、POST payload、唯一 dispatch 和轮询链路。
4. Jobs Inbox 包含 Research/Data/Outreach 三类任务；Research 行固定七列，detail 固定七个 evidence stages。
5. Browser Back、URL state、exact opener focus、safe evidence links、loading/empty/error/retry 都是稳定合同。
6. 手机长列表和弹窗内容使用内部滚动；页面级横向 overflow、document scale hack 和禁止缩放属性不允许出现。
7. 公司可见状态写“邮箱核验 / Email verification”，不显示 provider 名称、key、credits、raw payload 或内部错误。

Stable management read endpoints:

```text
GET /api/research/workbench-summary
GET /api/research/tasks
GET /api/research/jobs?view=inbox
GET /api/research/jobs/:id
GET /api/research/jobs/:id/results
```

Stable frontend hooks include `#research-form`, `#research-job`, `#research-job-dialog`, `#research-workbench-summary`, `#research-priority-tasks`, `#research-recent-jobs`, `#jobs-inbox-tabs`, `#jobs-list-body` and `#research-job-detail`.
