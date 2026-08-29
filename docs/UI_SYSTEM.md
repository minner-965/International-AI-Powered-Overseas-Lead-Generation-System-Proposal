# DPV Frontend UI System

This document is the source of truth for company-facing frontend work in this repository.

## Product direction

- Product: internal B2B prospect research and lead review workspace for an international trading business covering full-category womenswear and general merchandise.
- Audience: company management and overseas sales users.
- Visual language: trustworthy, modern, compact, and operational. It must read as a working business system, not a consumer fashion store or a generic analytics template.
- Theme: maritime blue, mist-blue surfaces and neutral text, with System, Light and Dark modes.
- Design dials: variance 3/10, motion 2/10, density 8/10.
- Existing features receive this UI directly. Future features must extend the same tokens and component patterns.
- Current visible market context is `AE / MX`. BD remains supported by the backend and historical model but is temporarily hidden by `public/market-visibility.js`; the same flag filters the selector, sidebar summary, ICP display, management metrics, company directory, opportunities, lead detail and export. Set its single `visible` flag to `true` and rebuild the dashboard to restore those surfaces without migrating historical data.

## CSS layers

Styles load in this order:

1. Local `@tabler/core` and `@tabler/icons-webfont` assets: base controls, tables and icons.
2. `services/demo-dashboard/public/styles.css`: legacy-compatible tokens and business components.
3. `services/demo-dashboard/public/bilingual.css`: bilingual layout plus ResearchJob, tier, status, and candidate-table components.
4. `services/demo-dashboard/public/contact-results.css`: contact and evidence result components.
5. `services/demo-dashboard/public/phase5.css`: authoritative CRM shell, responsive layout, theme and density specialization.

Later files may specialize a component but must not redefine global brand or spacing tokens.

## Core tokens

New UI must reuse semantic tokens instead of adding raw component colors.

| Role | Token | Value |
| --- | --- | --- |
| Brand | `--color-brand` | `#214a86` |
| Brand strong | `--color-brand-strong` | `#173f75` |
| Brand soft | `--color-brand-soft` | `#e7effb` |
| Primary action | `--color-accent` | `#2f63d9` |
| Selected surface | `--color-accent-soft` | `#edf3ff` |
| Main text | `--ink` | `#182235` |
| Secondary text | `--ink-soft` | `#34435a` |
| Muted text | `--muted` | `#5d6a7e` |
| Canvas | `--paper` | `#f2f5fa` |
| Surface | `--card` | `#ffffff` |
| Subtle surface | `--card-subtle` | `#f7f9fc` |
| Control border | `--color-control-border` | `#8293a9` |
| Divider | `--line-soft` | `#d8e0eb` |
| Focus | `--focus` | `#b24b19` |

Status colors are semantic exceptions. Tier A is green, Tier B is amber, and Tier C is red. Every state must also include a visible letter or text label; color is never the only signal.

Use `--radius-card` for major panels, `--radius-control` for inputs and buttons, and a full pill radius only for compact status labels. Use the existing shadow tokens.

## Reusable components

- App shell: `.crm-shell`, `.crm-sidebar`, `.crm-topbar`, `.crm-main`, `.crm-content`
- Primary navigation: `[data-app-nav]` and matching `[data-app-view]`
- Brand and market context: `.crm-brand`, `.crm-brand-mark`, `.market-code`
- Section heading and commands: `.crm-section-head`, `.crm-command-bar`, `.crm-context`, `.crm-description`
- Panels: `.crm-panel`, `.research-panel`, `.list-panel`
- Forms and filters: `.research-form`, `.filter-control`
- KPI overview: `.metrics`, `.metric`
- Lead review: `.table-wrap`, `#leads`, `.lead-select`, `.tier-score`, `.pill`, `.size-tag`
- Data quality states: `.data-state-badge` with visible Verification and Lifecycle text
- Lead detail: `.crm-detail-drawer`, `.crm-detail-header`, `.crm-detail-tabs`, `.crm-tab-panel`, `.crm-detail-score-set`
- Tables: `.crm-table` inside `.table-responsive`
- Display controls: `#theme-toggle`, `#theme-mode`, `#density-toggle`, `#density-mode`
- Research results: `.research-job`, `.research-job-grid`, `.candidate-*`, `.contact-*`, `.result-status`
- Import batches: the Jobs view reuses `.crm-panel`, `.crm-table`, `.table-responsive` and existing state badges; it displays aggregate counts only
- ICP comparison: the Customer Match view uses equal profile cards for Womenswear Management Baseline, General Merchandise Management Baseline and Mexico Historical Customer ICP
- Dual match: Opportunities and company detail display Management Baseline Match and Mexico Historical Reference Match in separate columns/cards
- Phase 6 opportunity controls: `#opportunity-filter-disclosure`, `#opportunity-filters`, `#opportunity-sort`, `#start-enrichment` and `#enrichment-job-status`
- Phase 6 opportunity columns: `.op-col-company`, `.op-col-market-product`, `.op-col-feasibility`, `.op-col-readiness`, `.op-col-contact` and `.op-col-secondary`
- Phase 6 detail: the reusable company dialog adds Buying Contacts and Cooperation Feasibility tabs using `.crm-decision-maker-*`, `.crm-contact-route-*` and `.crm-feasibility-*`

When a future feature matches one of these roles, extend the existing component rather than creating a visually separate card, button, badge, or table system.

### Detail windows and decision actions

- Desktop detail windows are centered and content-sized. Use a practical minimum width, a bounded maximum width and `max-height` below the viewport; short content must not be stretched to full screen.
- Every detail window keeps an always-visible bilingual Back or Close action and a separate icon close button. Escape and backdrop click dismiss when no unsaved operation is in progress.
- Use one scroll container only: the toolbar and decision footer remain outside the scrolling body. Focused content must never be hidden behind the footer.
- Closing restores focus to the exact company or action that opened the window, or to its refreshed replacement after a table rerender.
- On phones, the window may become near-fullscreen but must respect safe-area insets. Tabs may scroll horizontally; decision buttons stay visible with at least 44px touch targets.
- Approval is the primary action. Rejection is a clearly labelled danger-secondary action. While saving, disable only the decision group, expose `aria-busy`, and show bilingual progress, success and recoverable error feedback inside the window.

## Stable functionality hooks

Visual work must preserve these hooks and their behavior:

- `#reset` and `POST /api/live/collect`
- `#research-form` and all existing input IDs, names, option values, request fields, and `POST /api/research/jobs`
- `#metrics` and `GET /api/metrics`
- `#leads`, `#tier`, `#size`, and `GET /api/leads`
- `#detail` and `GET /api/leads/:id`
- score, score-history, Customer Match, match-history and ICP read endpoints
- `[data-app-nav]`, `[data-app-view]`, `#sidebar-toggle` and the eight-page information architecture
- `.actions button[data-status]` and approval updates
- `#research-job` plus ResearchJob polling, query, and candidate endpoints
- `#opportunity-table`, `#opportunity-sort`, `#opportunity-filters` and `GET /api/opportunities`
- `#start-enrichment`, `#enrichment-job-status`, `POST /api/enrichment/jobs` and `GET /api/enrichment/jobs/:id`
- `GET /api/leads/:id/decision-makers`, `GET /api/leads/:id/contact-routes` and `GET /api/companies/:id/cooperation-feasibility`

IDs are JavaScript and accessibility hooks. New styling should use classes. Do not rename endpoints, payload keys, returned fields, or source evidence during a visual refactor.

## Bilingual presentation

- Company-facing labels use `.bi` with Chinese above English.
- Both languages use the same inherited font size and weight.
- Add `lang="zh-CN"` and `lang="en"` to the respective lines.
- Use short functional business wording.
- Do not rewrite, translate, or embellish company names, emails, phones, URLs, source evidence, or other returned business data.
- Native select options may use concise `中文 / English` text because nested markup is not supported.
- Internal enum values must be converted to readable labels before display; snake-case database codes do not appear as customer-facing copy.

## Responsive rules

- At 992px and above: fixed vertical sidebar, sticky top bar and full-width management workspace.
- Below 992px: sidebar becomes off canvas with a scrim and explicit menu button; main content occupies the full viewport.
- At 768px and below: section headers, command actions, filters and forms stack without overlapping.
- At 390px: filters use two columns where possible, the third control spans the row, KPI facts use two columns, and long company tables stay inside a horizontal scroll container.
- At 390px, customer and opportunity tables show the decision-critical columns first. Secondary evidence, freshness and reference fields remain available in the detail window instead of forcing a 1,000px-wide first view. The View action stays next to the company name.
- At 390px, Phase 6 opportunities retain Company, Market / Product, Cooperation Feasibility and Readiness. Buying-contact, supplier-access, barrier and score details remain in the horizontally scrollable desktop table and the detail window.
- Customer details use a viewport-contained native dialog with nine tabs and vertical scrolling when required.
- Comfortable and Compact change row/cell/form spacing only; they never scale the whole document.
- Wide data tables remain inside labeled, keyboard-focusable horizontal scroll regions. They must never expand the page viewport.
- The Customer Match / ICP view renders the active Womenswear, General Merchandise and Mexico Historical profiles as equal cards on desktop and stacked cards on mobile.
- Browser zoom, Ctrl/Command zoom, and mobile pinch zoom must remain available. Never add `maximum-scale`, `user-scalable=no`, fixed page scaling, or viewport rules that prevent reflow.

## Accessibility and interaction

- All text and controls must meet WCAG AA contrast.
- Inputs and primary controls use a minimum 44px target height.
- Every interactive element has a visible `:focus-visible` ring.
- Customer selection must work from a native button and keyboard.
- Async buttons expose disabled and busy states.
- Short status text may use `role="status"`; do not announce an entire polling result panel on every refresh.
- Respect `prefers-reduced-motion`.
- Do not use emoji as structural icons or add decorative charts that are not backed by actual business data.

## Extension checklist

Before adding a new feature:

1. Reuse the tokens and closest existing component.
2. Preserve the feature's API and data semantics.
3. Add equal-size Chinese and English labels.
4. Define loading, empty, error, success, keyboard, and disabled states when applicable.
5. Test at desktop, 1024px, 768px, and 390px widths.
6. Confirm there is no page-level horizontal overflow and no clipped long company name, URL, phone, or email.
7. Verify existing lead counts and data still match before and after the UI change.
8. For internal imports, expose aggregate batch status and counts only; never render shared-folder paths, raw filenames, raw row payloads, HR/finance content or passwords.
## Phase 5 V2.3.1：历史 CRM

- Jobs 页面承载“历史客户记录 / Historical CRM Records”列表与导入汇总，避免把内部 CRM 资料混入 Evidence 或 Customer Match。
- 历史详情复用 `#detail.crm-detail-drawer`，包含概览、联系概况、历史活动三个页签；没有 `lead_review` 时不显示批准与拒绝。
- 活动类型只显示“营销邮件已发送 / Marketing email sent”和“人工跟进 / Manual follow-up”等已支持语义。
- 服务端对详情响应使用字段白名单；内部链接、附件、来源路径、文件哈希和原始 payload 不进入 API/DOM。
- 390px 仅保留公司、历史状态、分类、最近活动和操作；其他字段在详情查看，表格横向滚动限制在组件内。
- 手机详情窗按内容高度显示并受 `100dvh` 安全区限制；返回与关闭按钮保持至少 44px，原生浏览器缩放不受限制。

## Phase 6：采购联系人与合作可行性

- Phase 6 extends the existing Opportunities page and company detail dialog. It does not add a separate navigation system.
- The default opportunity ordering is `feasibility_desc`. Cooperation Feasibility, Cooperation Matrix, Management Baseline Match, Mexico Historical Reference Match and DPV Score remain separate visible signals.
- `cooperation_matrix` is the supplier-access matrix (`HIGH_FIT_HIGH_ACCESS`, `HIGH_FIT_LOW_ACCESS` and related states). It must not replace the existing Customer Match `opportunity_matrix` field.
- Opportunity filters use the reusable disclosure and filter-grid pattern. The active filter count is visible, all fields retain native select semantics, and Clear Filters restores `feasibility_desc`.
- The Buying Contacts tab shows named people or buying departments, raw job titles, normalized roles, role and product relevance, business contact routes, verification and clickable source references.
- The Cooperation Feasibility tab shows the score and band, cooperation matrix, readiness, relationship context, supplier onboarding routes, known barriers, missing evidence, six dimension rows and source references.
- LinkedIn and other professional-profile URLs may be displayed only as source references for manual review. They never replace independent role or contact verification.
- The ordinary UI must not expose internal OKKI links, source hashes, evidence hashes, shared-folder paths, staging paths or raw record payloads.
- The `#start-enrichment` action calls Express `POST /api/enrichment/jobs`; the browser never calls n8n or an enrichment provider directly. Its live region reports persisted job state and safe aggregate counters only.
- Enrichment controls do not send email, WhatsApp, forms, supplier registrations or professional-network messages.
