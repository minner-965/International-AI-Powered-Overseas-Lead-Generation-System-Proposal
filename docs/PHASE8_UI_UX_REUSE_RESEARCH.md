# Phase 8 UI/UX 复用研究

日期：2026-08-31  
范围：Phase 8 界面重构，不改变 Phase 7 业务、权限、数据交换与发送边界

## 结论

Phase 8 继续使用已经固定并本地部署的 Tabler Core、Tabler Icons Webfont、原生 HTML/CSS 和分模块 vanilla JavaScript。不会引入 React、Vue、Svelte、Tailwind、外部字体、CDN 资源或新的数据表格运行时。

本阶段采用“复用现有基础组件，重写业务信息架构和视觉层”的策略：

- Tabler 提供按钮、表单、表格、导航、空状态、分页、步骤、抽屉和模态框的基础样式语汇。
- 原生 `<dialog>`、`<details>`、`<select>`、CSS Grid、CSS custom properties 和媒体查询承担交互与响应式基础。
- 现有 Express API、稳定 DOM hooks、权限、CSRF、数据白名单和审计语义保持不变。
- WAI-ARIA APG 只作为交互规范来源，不复制不必要的组件运行时。
- 用户指定的 Customer Support CRM Demo 只作为视觉方向参考，不复制其代码、图片、文案、虚构指标或 Landing Page 结构。

## 实际技术基线

| 项目 | 当前值 | Phase 8 决定 |
| --- | --- | --- |
| 前端框架 | 无，vanilla HTML/CSS/JavaScript | 保留 |
| 服务 | Express 5.2.1 静态服务 | 保留 |
| UI 基础 | `@tabler/core` 1.4.0 | 固定并复用 |
| 图标 | `@tabler/icons-webfont` 3.46.0 | 固定并复用 |
| 主题 | 浏览器偏好 + Light/Dark | 保留并统一 token |
| 字体 | 系统字体栈 | 保留，无网络字体 |
| 数据表格 | 原生 `<table>` + 现有分页/API | 保留，决策视图缩减列数 |
| 对话框 | 原生 `<dialog>` + 现有 vanilla 控制 | 保留并校正 focus/close/back |

项目中的两个 Tabler package 均从本机 `node_modules` 核对到固定版本；Core 的 package metadata 为 MIT，Icons Webfont 自带 `LICENSE` 文件。运行时资源由 Express 从本地 `/vendor` 路径提供，不依赖 CDN。

## 复用决策矩阵

| 候选 | 决定 | License / cost | 部署适配 | 隐私 | 维护与集成边界 |
| --- | --- | --- | --- | --- | --- |
| Tabler Core 1.4.0 | **采用，保持固定版本** | MIT；无运行许可费；保留版权与许可文本 | 已安装，Bootstrap 5 系，适合现有 HTML/CSS；继续本地静态交付 | 无遥测、无外部请求；不使用 CDN | 复用基础类，不把 Tabler 示例页当成业务信息架构；升级必须单独评估 breaking changes |
| Tabler Icons Webfont 3.46.0 | **采用，保持固定版本** | MIT；无运行许可费 | 已安装并由 `/vendor/tabler-icons` 本地提供 | 字体文件本地加载，不传输业务数据 | 一个图标家族；图标随可见文字时 `aria-hidden="true"`，独立图标按钮必须有可访问名称 |
| HTML `<dialog>` / `<details>` / native form controls | **采用** | Web platform，无第三方包与许可费 | 与当前 vanilla 栈直接适配，浏览器支持满足项目目标 | 全部本机运行 | 使用 `showModal()`、明确关闭按钮、焦点恢复、Escape 和无未保存操作时的 backdrop 行为；不用另一套 modal runtime |
| CSS Grid / custom properties / media queries | **采用** | Web platform，无第三方包与许可费 | 直接用于现有 CSS 分层与六个验收 viewport | 无外部请求 | token 单一来源；避免组件内 raw hex；移动端先定义，再按 breakpoint 扩展 |
| WAI-ARIA APG | **采用为规范，不作为依赖** | W3C 文档与示例条款；本项目不 vendoring 示例代码 | 指导 dialog、tabs、disclosure、focus 与 keyboard contract | 不产生网络运行时 | 规范性要求优先于视觉参考；APG 示例需要结合真实浏览器和辅助技术测试 |
| Customer Support CRM Demo | **视觉参考，只取原则** | 未假设其代码或资产许可；复制成本为 0，因为不复制 | 借用安静画布、白色浮层、靛蓝主动作、16-20px 圆角和克制阴影 | 不向参考站发送项目数据 | 不复制 60px Hero、渐变标题、营销 CTA、虚构 KPI、票据、头像、客户支持字段或素材 |
| UI/UX Pro Max + Design Taste | **设计审计辅助，不进入生产运行时** | 本地已安装 Skill；不作为前端 package | 用于检索设计方向、可访问性和反模板规则 | 检索词不包含公司私有数据 | Skill 输出是建议，必须以仓库实际栈、业务事实和 W3C/上游资料复核 |
| Tabler/Bootstrap JavaScript bundle | **Phase 8 不启用** | 随现有 MIT package，无新增许可费 | 可提供 offcanvas/modal 行为，但会与现有 `<dialog>`、sidebar 和 focus 控制重叠 | 本地运行 | 避免双重 backdrop、焦点与 lifecycle；未来如启用，应逐组件迁移并增加 keyboard regression |
| AG Grid Community | **Phase 8 不采用** | Community 为 MIT；Enterprise 为商业许可 | 支持 plain JavaScript，功能完整，但会接管表格 DOM 和状态 | 可本地运行 | 当前 106 公司与 14 个机会不需要 grid runtime；会破坏稳定 hooks、双语 cell 与现有 API/分页测试；只有 50+ 高频交互行或服务端 grid 模型出现时再评估 |
| Grid.js | **Phase 8 不采用** | MIT；无运行许可费 | 支持 VanillaJS，接入成本低于框架型组件 | 可本地运行 | 仍会创建第二套表格、主题和事件生命周期；Phase 8 用缩列、渐进筛选和移动端决策卡即可解决问题 |
| React/Vue/Svelte/Tailwind 迁移 | **明确排除** | 各自许可不是当前阻点 | 与当前 Express 静态页面和大量稳定 hooks 不匹配 | 可能引入新构建链和供应链面 | Phase 8 是业务界面重构，不是框架迁移；不重写已通过的 427 项 Phase 7 测试边界 |

## Skill 检索结果及采用边界

使用 UI/UX Pro Max 的系统检索，参数为 `variance=3`、`motion=2`、`density=8`，返回的可用方向是 **Minimalism & Swiss Style**：清晰网格、高对比、功能层级、低装饰。下列返回内容未采用：

- `Trust & Authority + Conversion` 页面结构属于营销 Landing Page，不适用于业务后台。
- Calistoga/Google Fonts 会增加不必要的网络字体依赖，也不适合中英双语高密度工作台。
- GSAP scroll reveal 不承担业务含义，不引入。
- 检索得到的 navy/blue palette 只作为对照，最终使用 Phase 8 已批准的 quiet neutral + indigo tokens。

`html-tailwind` stack 对 “mobile first dashboard” 返回 3 条通用建议：mobile-first、响应式宽度、44px 触摸目标。这些规则被转译为原生 CSS；项目没有因此引入 Tailwind。

专门 UX 检索确认：

- sticky footer 不得遮挡键盘焦点；Phase 8 目标是整个焦点控件可见。
- dialog 内每个控件有可见 focus，关闭后恢复到准确触发器。
- badge 表示静态状态，chip 表示筛选值或可操作值。
- compact label 尽量保持完整；无法避免时必须提供 keyboard/touch 可操作的完整值 disclosure，不能只用 hover tooltip。
- 一个操作只用一个 contextual live region，不能让每个 badge 同时广播。

## 页面复用映射

| Phase 8 页面/组件 | 复用内容 | Phase 8 业务专用层 |
| --- | --- | --- |
| App shell | Tabler sidebar/nav/button/icon 基础；现有 `crm-shell.js` focus/hash 逻辑 | 按 Decide/Act/Records/Data 分组；Opportunities 为默认业务页；新增 Contact Queue |
| Overview | Tabler page header、plain metric strip、table/empty state | 只展示真实 Recommended、Approved、Evidence Required、Active Companies；Priority list 只来自 Recommended |
| Opportunities | 原生 form/select/details、Tabler table/button/status | 六态 tabs、5 个 primary filters、advanced drawer、7 个决策列、真实 0 状态 |
| Evidence Required | Tabler list group/empty state/icon | 按 PRODUCT/BUYER/CONTACT/EMAIL/IDENTITY/HISTORY 主阻断原因组织 |
| Contact Queue | Tabler table/list/button | 只显示 MANAGEMENT_APPROVED 且 Gate 0 当前有效记录，不生成演示项 |
| Companies | Tabler table/pagination/detail trigger | 作为完整主档；不出现 Confirm Contact；ordinary attributes 使用文字而非状态 pill |
| Detail | native `<dialog>`、Tabler buttons/forms、左侧 nav | 4 个一级区域；一个 scroll container；Back/Close；只有有效动作时 sticky footer |
| Research / Jobs | fieldset、native controls、steps/placeholder | 研究三步；Research/Import/Export Jobs 分组；隐藏内部 token/path/raw payload |
| Data Import / Export | forms, steps, table, status, download button | 保留 Phase 7 服务端白名单、审批、SHA、token expiry、审计；只突出当前可执行步骤 |
| Settings | native select + localStorage | system/light/dark、comfortable/compact、bilingual detail preference；不改变数据库决策 |

## 集成硬边界

1. 不改 API endpoint、payload key、枚举值、evidence 原文或 Phase 7 鉴权/CSRF 流程。
2. 保留 `[data-app-nav]`、`[data-app-view]`、`#sidebar-toggle`、`#opportunity-table`、`#opportunity-sort`、`#opportunity-filters`、`#start-enrichment`、`#leads`、`#detail`、`#research-form`、`#research-job` 与数据交换表单 ID。
3. 新增业务组件使用 stable `data-*`/ID；样式只绑定 class，避免把样式选择器变成业务 API。
4. 所有第三方资源必须固定版本、本地提供、进入 lockfile/许可审查；不使用 `@latest` 或 CDN。
5. 生产 UI、Excel 和导出内容不加入“AI 自动生成”“智能推荐”“革命性”“下一代”等无法由真实字段证明的措辞。
6. 不显示真实邮箱正文、内部订单、supplier cost、internal notes、共享目录路径、token、raw payload 或文件系统路径。
7. Phase 8 保持 Provider NONE、总发送开关关闭、真实 prospect sends 为 0。

## 官方与上游资料

- [Tabler documentation](https://docs.tabler.io/): 官方组件目录包含 layout、navs/tabs、cards、data grid、empty states、modals、offcanvas、steps、tables、forms 与 webfont。
- [Tabler upstream repository](https://github.com/tabler/tabler): 官方说明其为 Bootstrap 基础的响应式 HTML dashboard kit，支持 npm 安装并采用 MIT License。
- [Tabler license](https://tabler.io/license): Core 与 Icons 均为 MIT；保留版权和许可文本。
- [Tabler 1.4.0 release](https://github.com/tabler/tabler/releases): 当前项目固定版本的上游 release 记录。
- [WAI-ARIA APG Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): modal inert、focus containment、Escape、明确关闭按钮和 focus restoration。
- [WAI-ARIA APG Patterns](https://www.w3.org/WAI/ARIA/apg/patterns/): tabs、disclosure、table、toolbar 等交互语义参考。
- [WCAG 2.2 changes](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/): Focus Not Obscured 和 Target Size 的标准边界。
- [MDN dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog): `showModal()`、明确关闭机制、Escape 与浏览器 inert 行为。
- [MDN CSS Grid](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout): 原生响应式主区域与组件布局。
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion): 非必要 motion 降级。
- [MDN color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme): 浏览器原生控件、滚动条和 canvas 的明暗模式配合。
- [AG Grid upstream](https://github.com/ag-grid/ag-grid) 与 [license split](https://github.com/ag-grid/ag-grid/blob/latest/LICENSE.txt): Community MIT、Enterprise commercial；本阶段评估后不引入。
- [Grid.js upstream](https://github.com/grid-js/gridjs): MIT、支持 VanillaJS；本阶段评估后不引入。

## 复用验收

- [ ] 新 package 数量保持 0，除非后续出现经批准的新要求。
- [ ] Tabler/Core 与 Icons 继续本地加载，无 CDN/font request。
- [ ] 只使用一个图标家族与一个视觉系统。
- [ ] CSS/JS 按职责拆分，不新增全局 override 堆栈。
- [ ] 业务页不复制 Landing Page Hero、虚构 KPI、头像或渐变宣传语言。
- [ ] 任何未来第三方升级单独记录版本、license、bundle、隐私、维护与回归结果。
