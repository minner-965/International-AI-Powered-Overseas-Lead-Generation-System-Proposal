# DPV UI System V3

Date: 2026-09-07. Status: implemented V3 runtime contract; WP-UI15/16 cleanup and handoff. Historical preparatory wording below describes WP-UI00–02 only. Full-phase acceptance limitations and final evidence are recorded in PHASE12_UI_RESULT.md.

## Visual authority

Sole visual reference: [archived user HTML](ui/reference/dpv-workspace-reference-dashboard.html), supplied as `saas_ui.html` (one file actually received). SHA-256: `e0a780180bbd444e962e8b0099a9a8fa5bbd3c725378ae9dddf36c243b237788`.

The V1_1-named execution plan contains a V1.0 heading. The user's explicit correction controls: preserve the technology and behavior, replace **all** Phase 8/post-Phase 9 visual styling. The HTML is a visual example, not a production template or source of business facts. It is archived unchanged outside the served frontend, including its prohibited sample code for traceability.

Product identity: **DPV International / Overseas Sales Workspace**. This is an internal overseas-sales workspace for women's apparel and approved general-merchandise supply categories, not a fashion store or AI marketing landing page.

## Reference geometry and adaptation

Observed HTML classes specify a 256px (`w-64`) dark sidebar, 64px (`h-16`) header, 24px/32px content padding, 1280px maximum content (`max-w-7xl`), 24px section gaps, 20px KPI gaps/padding, 24px analytical card padding, 12px panel radius and 8px controls. Overview has four KPIs, a 2:1 main-analysis/distribution row, then a 1:1 task/attention row.

Use those proportions as desktop targets. Preserve balanced compact density without forcing exact fixed widths on bilingual or smaller layouts. White topbar, light-gray canvas and dark sidebar remain the common shell for every page. Mobile uses offcanvas navigation and vertically arranged business cards; do not shrink the desktop document. Dialogs fit their content with bounded internal scrolling and visible return/close controls. User preference changes must not resurrect the old palette.

## Semantic tokens (implemented runtime contract)

| Token | Value | Meaning |
| --- | --- | --- |
| --dpv-canvas | #F4F6F8 | Main canvas |
| --dpv-surface | #FFFFFF | Topbar and business panels |
| --dpv-surface-subtle | #F8FAFC | Subtle grouped background |
| --dpv-sidebar | #0F172A | Navigation background |
| --dpv-sidebar-hover | #1E293B | Navigation interaction |
| --dpv-border | #E2E8F0 | Light separators |
| --dpv-ink | #0F172A | Main text |
| --dpv-muted | #64748B | Secondary business text |
| --dpv-primary | #2563EB | Primary action/current navigation |
| --dpv-primary-hover | #1D4ED8 | Primary interaction |
| --dpv-success | #059669 | Success or actual reply |
| --dpv-warning | #D97706 | Awaiting action |
| --dpv-danger | #DC2626 | Error, opt-out, hard bounce |
| --dpv-info | #0284C7 | Information indicator |
| --dpv-violet-data | #7C3AED | Second actual chart series only |

Use accessible foreground/background pairings; accent tokens are not automatically valid small-text colors. Validate normal text 4.5:1 and interactive boundaries 3:1. Light separators are not a substitute for visible control boundaries. No old purple primary, glow, animated gradient or hover-lift cards. Light card shadows only.

System/local font: Inter if already local, Segoe UI, Microsoft YaHei, sans-serif. Main heading around 24px, section heading 16px, body 14–16px with 1.5 line height, metadata at least 12px. Equal-size/equal-weight/equal-color Chinese above English within each role; layout hierarchy must not demote English. Targets at least 44px; keyboard focus visible and unobscured. Native options may use `中文 / English`.

## Preserved technical and business contracts

Native HTML/CSS/JS, Express static frontend, local Tabler Core/Icons. Keep `data-app-nav`, `data-app-view`, hash routes, browser Back, exact opener focus restoration, form IDs/names/values, API payloads and polling. Keep deterministic scoring/category scope, provenance, current projections, existing history, approval gates, exactly-once mail state, reply linkage, shared CRM, suppression and export security.

Do not infer delivery, reply or purchase from SMTP acceptance. Keep PROSPECT and CONTROLLED scopes separate. No fake metrics, no Tier-to-opportunity fallback, no invented samples or ETA. Missing history displays “暂无历史对比 / No historical comparison”; insufficient data displays “— / 暂无足够样本”. No raw payloads, paths, credentials or internal enums in ordinary pages. Source evidence remains verbatim.

## Implementation and reuse

Target layers: `public/ui/v3/{tokens,foundation,shell,components,pages,responsive}.css` and small `charts.js`, `components.js`, `views.js` adapters where needed. This list is a later implementation target, not permission to scaffold runtime in WP-UI02.

Use native tables/pagination/mobile cards and native dialog/Tabler interactions. Evaluate existing Tabler chart assets before Chart.js; registry owns actual dependency findings. No new framework, table framework or CDN by default. Every component defines all nine states in the component catalog.

Old `UI_SYSTEM.md` and `PHASE8_DESIGN_SYSTEM.md` remain historical evidence only. During preparatory packages the old frontend is untouched. Later migrate pages into one new visual family and remove replaced declarations/renderers/assets after HTML/JS/test/runtime references reach zero. Never solve the migration with a giant override stylesheet. Full visual acceptance requires every page, not a redesigned overview alone.

See [components](UI_COMPONENT_CATALOG_V3.md), [page contracts](UI_PAGE_CONTRACTS_V3.md), [QA](UI_VISUAL_QA_PROTOCOL.md), [reuse audit](PHASE12_UI_REUSE_AUDIT_RESULT.md).
