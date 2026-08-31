# Phase 8 Design System

版本：1.0  
日期：2026-08-31  
适用范围：DPV 公司工作台全部页面、弹窗、导入/导出 UI 和今后新增功能

## Design Read

Reading this as: a redesign-preserve of an internal B2B operations workspace for management and overseas sales, with a calm, trustworthy and dense operational language, leaning on the existing Tabler and native web foundation.

```text
DESIGN_VARIANCE = 3 / 10
MOTION_INTENSITY = 2 / 10
VISUAL_DENSITY = 8 / 10
foundation = Tabler 1.4.0 + native HTML/CSS + vanilla JavaScript
theme = system / light / dark
density = comfortable / compact
```

设计目标：Executive first、Opportunities first、Evidence before decoration、一个 screen 一个主要判断、一次一个主要动作、真实 0 不用高分公司或演示数据填补。

## 视觉原则

采用：

- 安静的 warm-neutral canvas、白色或深色 operational surfaces。
- 单一 indigo 主动作、明确深色文字、结构性边框和克制阴影。
- 16-20px major panel 圆角、10px controls。
- 中文主标签、英文 companion 的完整双语结构。
- 一行最多一个主决策状态和一个风险标记。
- 真实公司、机会、证据、任务、导入和导出内容。

禁止：

- gradient headline、neon glow、purple aura、glassmorphism。
- floating orb、sparkle、emoji structural icon。
- marketing hero、pricing/feature section、landing CTA。
- bento wall、三张同权模板卡、每个字段一个 rounded card。
- fake avatar、fake KPI、fake company、fake opportunity、fake chart。
- 缺少数据字段支持的“智能”“AI 自动生成”“领先”“革命性”“无缝”“下一代”措辞。

## Typography

```css
--font-sans: "Inter Var", Inter, "Segoe UI Variable", "Segoe UI",
  "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
--font-mono: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
```

不发起 Google Fonts 或其他外部字体请求。`Inter Var` 只在操作系统或本地已有时使用。

| Role | Desktop | Mobile | Weight / line-height |
| --- | --- | --- | --- |
| Page title `.bi` lines | 28-32px | 24-26px | 650-700 / 1.2 |
| Section title `.bi` lines | 20-24px | 18-22px | 650 / 1.3 |
| Body | 15-16px | 16px | 400-500 / 1.5 |
| Label `.bi` lines | 14-16px | 14-16px | 600 where needed |
| Table metadata | min 12px | min 12px | 500 / 1.35 |
| Number | inherited | inherited | tabular figures |

Rules:

- `.bi` 内中英文上下排列，并在同一组件角色中继承完全相同的字号、字重、行高与颜色。
- 层级由 page/section/label 等组件角色、间距和容器建立，不用语言差异或全大写英文制造层级。
- 状态、错误和操作说明不能低于 12px。
- 普通正文移动端保持 16px。
- URL、邮箱、ID 和证据长 token 使用 `min-width: 0` + `overflow-wrap: anywhere`。
- 公司名、邮箱、电话、URL、产品名和 evidence 原文不翻译、不缩写、不润色。

## Color tokens

Phase 8 tokens 只在 `public/ui/phase8-tokens.css` 定义。组件和页面文件不得直接写 raw hex。

### Light

| Role | Token | Value | Contrast intent |
| --- | --- | --- | --- |
| Canvas | `--p8-canvas` | `#F6F5F2` | quiet background |
| Surface | `--p8-surface` | `#FFFFFF` | operational surface |
| Surface subtle | `--p8-surface-subtle` | `#F1F2F6` | grouped content |
| Main ink | `--p8-ink` | `#172033` | 14.92:1 on canvas |
| Muted ink | `--p8-muted` | `#5F6B7A` | 4.98:1 on canvas |
| Border | `--p8-border` | `#DDDDE3` | structural divider |
| Border strong | `--p8-border-strong` | `#A8ADBA` | control boundary |
| Primary | `--p8-primary` | `#4F46E5` | 6.29:1 with white |
| Primary hover | `--p8-primary-hover` | `#4338CA` | action hover/pressed |
| Primary soft | `--p8-primary-soft` | `#ECEBFF` | selected surface |
| Warm accent | `--p8-warm` | `#B45309` | evidence attention |
| Success | `--p8-success` | `#166534` | 7.13:1 on white |
| Warning | `--p8-warning` | `#92400E` | 7.09:1 on white |
| Danger | `--p8-danger` | `#B91C1C` | 6.47:1 on white |
| Neutral | `--p8-neutral` | `#475569` | hold/reference |
| Focus | `--p8-focus` | `#4338CA` | focus indicator |

### Dark

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--p8-canvas` | `#10131A` |
| Surface | `--p8-surface` | `#171B24` |
| Surface raised | `--p8-surface-raised` | `#1D2230` |
| Surface subtle | `--p8-surface-subtle` | `#202634` |
| Main ink | `--p8-ink` | `#F3F4F6` |
| Muted ink | `--p8-muted` | `#A8B0BF` |
| Border | `--p8-border` | `#303747` |
| Border strong | `--p8-border-strong` | `#566075` |
| Primary | `--p8-primary` | `#818CF8` |
| Primary hover | `--p8-primary-hover` | `#A5B4FC` |
| Primary soft | `--p8-primary-soft` | `#25294D` |
| Success | `--p8-success` | `#6EE7A8` |
| Warning | `--p8-warning` | `#FBBF73` |
| Danger | `--p8-danger` | `#FCA5A5` |
| Neutral | `--p8-neutral` | `#CBD5E1` |
| Focus | `--p8-focus` | `#A5B4FC` |

main ink/canvas 为 16.89:1、muted/canvas 为 8.52:1、primary/canvas 为 6.23:1。状态 tint 仍需在真实 surface 上分别检查。

Theme rules:

- `system` 跟随 `prefers-color-scheme`；root 同时设置匹配的 `color-scheme`。
- 一个页面只有一个 theme，section 不单独反转。
- light/dark 分别测试 text、border、focus、disabled、scrim 和 status。
- 加载前尽早恢复 theme preference，减少 flash。

## Status colors and language

彩色状态仅用于真实业务状态：

| State | Tone | Required label |
| --- | --- | --- |
| `RECOMMENDED` | primary | `推荐联系 / Recommended` |
| `MANAGEMENT_APPROVED` | success | `管理批准 / Management approved` |
| `EVIDENCE_REQUIRED` | warning | 附 CONTACT/BUYER_ROLE/EMAIL 等主原因 |
| `HOLD` | neutral | `暂缓 / Hold` |
| `NOT_SUITABLE` | danger | `不适合 / Not suitable` |
| `SUPPRESSED` | danger | 显示 opt-out/complaint/company suppression |
| hard bounce / complaint / opt-out | danger | 文字 + icon，不能只靠红色 |

Status 背景使用 `color-mix()` 从 tone 与 surface 生成低强度 tint。Company size、market、business type、active data、DPV Score、Tier numeric、product profile 和 source count 不使用彩色 status pill。

## Shape, elevation and spacing

```css
--p8-radius-shell: 18px;
--p8-radius-panel: 16px;
--p8-radius-control: 10px;
--p8-radius-compact: 8px;
--p8-radius-status: 999px;
--p8-shadow-panel: 0 6px 24px rgb(23 32 51 / .06);
--p8-shadow-popover: 0 16px 48px rgb(23 32 51 / .14);
```

- 普通 panel 用 border 或 panel shadow 二选一；popover/drawer/dialog 才用 popover shadow。
- Table cell、KPI 和详情字段不单独加 card/shadow。
- full-pill 只用于 compact status 和 filter chip。
- 基础间距：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`。
- Page gap：desktop 24px，mobile 16px；panel padding：desktop 20-24px，mobile 16px。
- 所有 touch target 最少 44 x 44px。
- `compact` 只收紧 row/cell/form spacing，不缩小 touch target 或整个页面。

## Z-index

```text
base 0
sticky table/header 10
topbar 20
mobile scrim 25
sidebar 30
popover 50
drawer 70
dialog/backdrop 90
toast 100
skip-link 110
```

组件不得自行增加无约束高 z-index。

## Bilingual contract

```html
<span class="bi">
  <span lang="zh-CN">中文标签</span>
  <span lang="en">English label</span>
</span>
```

- 中文在上、英文在下，两种语言语义完整。
- `.bi` 的两行必须使用相同字号、相同字重、相同行高和相同文字颜色；不得用语言样式降级英文。
- 信息层级由组件角色、间距、布局与容器建立，而不是由中英文视觉差异建立。
- native `<option>` 使用 `中文 / English`。
- 状态、错误、disabled reason、loading 和 empty state 全部双语。
- internal enum 通过确定性 label map；snake_case 不进入公司界面。

## Icon contract

- 只使用 Tabler Icons Webfont 3.46.0。
- 大小：16px inline、20px control、24px empty state。
- 可见文字旁的 icon 使用 `aria-hidden="true"`。
- icon-only button 有双语 accessible name，并暴露适用的 `aria-expanded`/`aria-pressed`/`aria-current`。
- 状态必须有文字，icon 不单独承担语义。
- 不用 emoji、手绘 SVG 或混合 icon family。

## Component semantics

### Badge and chip

```text
badge = static business state
chip = selected filter/value/action
```

- 每行最多一个主 status + 一个 risk marker。
- Filter chips 可换行且显示完整 label；移除动作 44px hit area。
- 不可避免的长值提供 keyboard/touch 可操作的完整 disclosure，不用 hover-only tooltip。
- Chip collection 优先 wrap；`+n` 必须是可展开按钮。

### Buttons

- 每 screen 一个 primary action；secondary、ghost、danger-secondary 层级清楚。
- Desktop label 不换行；缩短文案或增宽 control。
- Async 时只禁用相关 action group，设置 `disabled` + `aria-busy`，同一区域显示进度和恢复动作。
- pressed feedback 使用颜色/opacity/elevation，不移动布局。

### Forms and filters

- Visible label；placeholder 不是 label。
- Helper text 位于复杂字段下；error 紧随字段并由 `aria-describedby` 关联。
- 多错误提交 focus error summary，并保留 inline errors。
- Disabled control 同时说明缺少什么。
- Opportunities 常显 Search、Status、Market、Product Profile、Sort；其余进入 advanced drawer。
- Active filters 显示 removable chips，保留所有 query semantics。

### Tables and decision lists

- 真正二维比较使用 semantic `<table>`。
- 默认业务表最多 7 个决策列；secondary fields 进入 detail/disclosure。
- 1440px 默认 Opportunities/Companies 无页面级横向滚动。
- Technical/audit view 可在标记和 keyboard-focusable 的组件内横向滚动。
- 0 行不渲染宽空 table，显示 compact empty state + next action。
- 移动端变 decision cards/reduced columns，保留 status、company、profile、Buyer/contact、action。

### Panels

Card 只用于独立决策区、当前表单步骤、汇总区和有操作的业务对象。普通字段组用 section heading、description list、divider 和 whitespace，禁止 card-in-card。

### Loading, empty, error, success

- Loading skeleton 匹配最终形状，region `aria-busy="true"`。
- Empty state 说明真实原因和一个安全下一步，不插入示例公司/机会。
- Error 说明发生什么、未发生什么、如何重试，不显示 stack/token/path/raw payload。
- Success 说明持久化结果和后续动作，不夸大为成交或已联系。
- `READY 0 rows` export 不显示正常 download success。
- 每个 operation 只用一个 contextual live region。

### Dialog, drawer and sheet

- 使用 native `<dialog>` + `showModal()`。
- 打开时 focus title/Back 或最合适动作；Tab 保持在 dialog；Escape 在无未保存操作时关闭。
- 始终有双语 Back/Close 和 icon close；关闭后恢复准确触发器或其刷新后替代元素。
- 一个 scroll container；header/nav/footer 在 body 外。
- Sticky footer 只在有效动作存在时显示，并用 scroll padding 保证 focus 完全可见。
- Desktop content-sized，max 1,200-1,280px；Tablet near-fullscreen；Mobile 单栏 full-height + safe area。

### Navigation

- Desktop grouped sidebar；Tablet/Mobile off-canvas sidebar。
- 同时只有一个 `[data-app-nav]` `aria-current="page"`。
- Hash/deep link 保持；Back 恢复 view/filter/scroll state。
- View 变化后 focus `#main-content` 或新 page title。
- Sidebar 只放 top-level navigation，不放 Confirm Contact 等业务动作。

## Page contracts

### Overview

4 个指标：Recommended、Management Approved/Contact Queue、Evidence Required、Active Companies。主列表最多 5 条且只来自 Recommended。0 状态显示确定性缺证汇总和 View Evidence Required。

### Opportunities

默认 `RECOMMENDED`。Tabs：Recommended、Evidence Required、Management Approved、Hold、Not Suitable、All。7 个列：Company；Market/Profile；Status；Buyer Model/role；Product Match；Buyer/VALID contact；Supplier Access/action。Confirm Contact 只在 Gate 0 当前全部通过时出现。

### Evidence Required

按 PRODUCT、BUYER、CONTACT、BUYER_ROLE、EMAIL、IDENTITY、HISTORY 分组。每行只展示 business fit、一个主 blocker、owner、last checked、next safe action。Phase 8 不自动启动 Phase 9 批量补证。

### Contact Queue

只显示 current MANAGEMENT_APPROVED 且 Gate 0 仍有效项。空状态不创建示例记录。

### Companies and detail

Companies 是完整主档，出现不代表建议联系；无 Confirm Contact/message/send。Legacy data action 使用 Confirm Company Record / Exclude Company Record。Detail 只有 Snapshot、Business Fit、Buyer & Contact、Activity & Records 四区，顶部只保留一个 status 和一个 blocker。

### Research / Jobs / Data Exchange

Research 三步但保留 input/API。Jobs 区分 Research/Import/Export。Import 为 Select/Check/Review/Submit/Approve/Commit stepper。Export 为 Dataset/Scope/Format/Column preview/Generate/Download。所有 API、白名单、token expiry、SHA、audit 与私有路径边界保持 Phase 7 语义。

## Responsive contract

验收：`1440x900`、`1024x768`、`768x900`、`390x844`、`375x667`、`844x390`。

- Desktop：fixed quiet sidebar、sticky topbar、max content 1600px；默认业务表不横向 overflow。
- Tablet：collapsible sidebar、filters 两行、detail near-fullscreen，sticky action 不遮 focus。
- Mobile：off-canvas nav、单一 page title、decision cards、full-height advanced sheet、44px targets、safe-area padding。
- 使用 `100dvh`，不用 `h-screen`；浏览器 zoom/pinch zoom 保持；不设置 `maximum-scale`/`user-scalable=no`。
- 公司名、URL 和双语 reason 使用可重排布局，页面不得横向 overflow。

## Motion contract

```text
hover/focus/selection: 120-180ms
drawer/dialog entry: 180-220ms
page scroll reveal: none
animated gradient: none
bouncing counter: none
```

- 只动画 opacity/transform，不动画 width/height/top/left。
- Motion 只表达 feedback、state transition 或 hierarchy。
- `prefers-reduced-motion: reduce` 移除非必要 transition、animation 和 smooth scroll。
- Correctness 不依赖 animation end；快速状态变更取消旧 transition 并明确最终状态。

## Accessibility contract

- WCAG AA normal text >= 4.5:1；large text/non-text boundary >= 3:1。
- 项目采用强于 WCAG 2.2 AA 24px 的 44 x 44px touch target policy。
- 每个 action 有 visible focus；目标至少 2px perimeter，并与背景/未聚焦状态有足够对比。
- Sticky UI 不得完全遮 focus，Phase 8 目标是整个 focus target 可见。
- Logical headings；dialog focus trap、Escape、Back/Close、exact restoration。
- 状态永远不是 color-only；async 更新只使用一个 contextual live region。
- Keyboard-only 完成筛选、drawer、detail、pagination、import/export 和返回路径。
- Reduced motion、200% zoom、screen reader labels、mobile landscape 全部验收。

## Business wording and AI wording rule

所有 UI、Excel、CSV 列标题和导出说明遵循：

- 使用短、具体、可由当前字段证明的业务语言。
- 不显示 “AI-powered”“AI generated”“智能生成”“自动智能推荐”“革命性”“赋能”“下一代”“无缝”。
- 不把 `Demo`、phase number、provider name、internal queue、raw enum、token、path、hash 或技术日志当作公司用户文案。
- 不反复写 “real”；直接展示来源、更新时间、验证状态和审计结果。
- `not_checked`、snake_case 和内部错误码必须映射为完整中英业务状态。
- 机会建议只来自当前 decision/Gate，不从 Tier/DPV Score 暗示建议联系。
- 空状态使用事实，如“尚无联系就绪机会”，不用宣传或拟人化话术。

## Implementation map

```text
public/ui/phase8-tokens.css       semantic tokens
public/ui/phase8-foundation.css   typography, focus, shell base
public/ui/phase8-components.css   controls, status, chips, table, dialog, drawer
public/ui/phase8-pages.css        page compositions
public/ui/phase8-responsive.css   breakpoints, cards/sheets, safe areas

public/ui/shell.js
public/ui/status.js
public/ui/filters.js
public/ui/opportunities.js
public/ui/contact-queue.js
public/ui/companies.js
public/ui/detail.js
public/ui/data-exchange.js
```

Load order：Tabler Core、Tabler Icons、Phase 8 tokens、foundation、components、pages、responsive。Legacy CSS 只在迁移期保留，并逐段删除已接管 declaration。

## Pre-delivery checklist

- [ ] 一套 design system、一个 icon family、一个 primary accent。
- [ ] light/dark/system 与 comfortable/compact 全部通过。
- [ ] 六个 viewport 和 200% zoom 无页面级 overflow/遮挡。
- [ ] 每个 view 一个 primary action；每行最多一个 status + 一个 risk。
- [ ] loading/empty/error/success/disabled 有双语和恢复动作。
- [ ] Opportunities 真实 0 不渲染宽空表或虚构项。
- [ ] Detail 4 区、Back/Close、focus trap/restoration 通过。
- [ ] 20 filters API semantics 保持。
- [ ] Import/Export API、white list、token、SHA、audit 与私有路径边界保持。
- [ ] 无 emoji、gradient、glow、glass、fake KPI/avatar/company/opportunity。
- [ ] UI 和导出没有 AI 化宣传、snake_case 或乱码。
- [ ] Phase 7 既有测试 0 failed，Provider calls/sends 继续为 0。
