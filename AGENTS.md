# DPV Company-Facing Copy Rules

## Current execution boundary — CL14–CL16 and Exa verification

- CL12–CL13 are checkpointed at `e0edadf`. The user now authorizes CL14–CL16, followed by completion and bounded verification of the configured Exa integration. Earlier package STOP statements below are historical, not the current boundary. Preserve MC04 rules, MC07 first-touch behavior and immutable history. Final push/tag must reflect actual acceptance, never an unverified PASS.
- Never delete or rewrite an applied migration.
- Never delete business/audit history merely because its rule is retired.
- Never delete source/evidence lineage referenced by current or historical decisions.
- Never delete outbound/inbound/suppression/Activity/SalesTask history.
- Never delete a queue/table just because its current count is zero without proving zero runtime/FK/audit references.
- Never treat a historical name as permission to edit immutable history.
- During cleanup acceptance, run `node scripts/cleanup-maintenance-guard.mjs` before diagnostics. Preserve PostgreSQL and persisted automation intent; use isolated databases/providers and intercepted browser tests. Zero live SMTP, Hunter, WhatsApp or external CRM calls during acceptance. CL16 restoration follows verified tests and a pending-work review, not a blind service restart. Exa live verification is a separate bounded action after cleanup; do not use it to resume the entire historical search backlog or implicitly send email. Migration 063 requires isolated replay before production restoration.

These rules apply to every company-facing page, spreadsheet, report, slide, export, screenshot, and presentation in this repository.

## Required tone

- Write concise business language for management and sales users.
- Present business facts, customer information, evaluation results, and next actions directly.
- Use stable labels such as `客户名录`, `客户评估`, `数据更新`, `资料来源`, `商务邮箱`, and `跟进建议`.
- Keep Chinese and English wording professional and equivalent.

## Prohibited company-facing wording

Do not display implementation narration or AI-style explanations, including:

- `Demo`, `真实数据`, `真实线索`, `公开数据`, `Real Data`, `Real public data`
- `外联已禁用`, `Outreach disabled`, `send_status=disabled`
- `抓取`, `采集`, `爬取`, `去重`, `合并历史数据`, `历史数据持续保留`
- `规则评分`, `推断不视为已验证事实`, `系统保持`, `不会自动发送`
- explanations of databases, Docker, PostgreSQL, GitHub ignore rules, crawlers, storage mechanisms, or internal processing
- conversational or defensive wording that explains how the system works instead of showing the business result

## Approved replacements

- `更新客户名录 / Update Company Directory`
- `数据更新 / Data updated`
- `企业总数 / Total companies`
- `客户评估与跟进 / Prospect Review & Follow-up`
- `资料来源 / Source references`
- `联系前请确认企业信息与业务需求 / Confirm company information and requirements before contact`

Technical terms may appear only in developer documentation, logs, source code identifiers, or internal administration screens that are not part of company-facing deliverables.

## Task planning and parallel delegation

At the start of every task, complete both checks below before implementation begins and briefly state the decision in the working update.

### Plan-mode check

- Assess the task's complexity, uncertainty, dependencies, risk, and verification needs.
- Use Plan mode for multi-step, ambiguous, high-risk, architectural, migration, deployment, or cross-cutting work. Keep the plan current while executing it.
- A clear, atomic, low-risk task may proceed directly. When Plan mode is unavailable, use the available structured planning mechanism for any non-trivial task.

### Sub-agent check

- Actively decompose every task into independent, bounded workstreams and look for work that can run concurrently.
- Sub-agent use is the default for non-trivial tasks. If at least one meaningful independent subtask exists, start the appropriate sub-agent early instead of waiting until the main work is nearly complete.
- Prefer parallel sub-agents when two or more useful workstreams can proceed concurrently, such as codebase inspection, frontend/backend changes, database review, test design, documentation, or verification.
- Skip spawning only for a genuinely trivial atomic task, tightly coupled work that cannot progress independently, or work where coordination would cost more than execution. The primary agent must still perform and record this check.
- Give every sub-agent a concrete scope, expected output, and clear ownership. All agents share the same workspace: parallelize read-only analysis freely, assign non-overlapping files or components for edits, and serialize overlapping edits.
- The primary agent remains responsible for coordination, integration, conflict resolution, final verification, and confirming that the complete user request has been satisfied.
- Applicable skill instructions must be read and interpreted by the primary agent; task execution may be delegated only when those instructions permit it.

## Frontend UI system

- Before changing company-facing frontend files, explicitly use `$dpv-workspace-ui` at `.agents/skills/dpv-workspace-ui/SKILL.md` and read `docs/UI_SYSTEM_V3.md`. `docs/history/reference/UI_SYSTEM.md` and Phase 8/post-Phase 9 visual conventions are superseded; do not reuse their visual styling.
- Existing features receive the shared UI without changing their APIs, data semantics, form names or values, request payloads, endpoints, or stable DOM hooks.
- Future features must extend the same UI system. Reuse an existing component pattern before adding a new visual pattern.
- Use semantic design tokens for colors, borders, radii, shadows, and states. Do not introduce raw component colors when an existing token covers the role.
- Company-facing labels use the established `.bi` structure with Chinese above English at equal size and weight. Do not rewrite source evidence or returned business data.
- Verify frontend changes in the browser at desktop and mobile widths, including keyboard focus, loading, empty, error, long-content, and reduced-motion states.

## DPV user-visible frontend — Phase 12 authority

- User correction (2026-09-07): faithfully reproduce the reference's content layout, proportions, density, spacing, typography hierarchy, cards and chart forms—not merely its shell or colors. Compare reference and implementation at the same viewport, inspect the actual screenshots, and record deviations. A page is not complete before this visual comparison passes. Preserve actual data, original business functionality and equal-size bilingual labels; explicitly document adaptations required by these constraints. Where the supplied reference does not contain a page, extend its exact shared component language rather than claiming an unseen page was reproduced pixel-for-pixel.
- Mobile correction (2026-09-07): use a compact list-to-detail composition, not every desktop table field stacked into an oversized card. Prioritize company/job identity, main status, essential channel and next action; disclose secondary facts in the existing details, drawers or expandable sections. Keep bilingual labels equal and readable, retain 44px interactive targets and native zoom. Validate actual 375/390px screenshots after transitions and loading finish; an overflow check alone is not visual acceptance.

- Before changing `public/`, frontend templates, workspace CSS, dashboard charts, user-visible labels or interaction flows, use `$dpv-workspace-ui`.
- The sole visual reference is `docs/ui/reference/dpv-workspace-reference-dashboard.html`. Preserve its dark sidebar, white topbar, light-gray canvas, white rounded business cards, proportions, spacing, hierarchy and operational density. The user's explicit corrections override decorative examples in that file.
- Retaining the stack means preserving business code, APIs, database, stable hooks, HTML/CSS/JS runtime and mature component interaction capabilities, **not the old UI appearance**. Sidebar, Topbar, colors, cards, KPI, tables, Company Detail, Opportunities, Contact Queue and Settings must all migrate into one V3 product family. No mixed old/new visual acceptance.
- Do not copy sample companies, fake metrics, AI marketing copy, remote CDN dependencies, Google Fonts, Font Awesome, remote avatars, gradients/glow, shimmer or hardcoded percentages from the reference into production.
- Preserve Phase 10 research and Phase 11 approval/SMTP/IMAP/reply/suppression/CRM/export semantics, API payloads, stable hooks, accessibility, mobile and keyboard support. UI work does not authorize new emails, approvals, database edits or research jobs.
- Before adding a production dependency, complete `docs/REUSE_CANDIDATE_REGISTRY.md` using official sources and explain why current Tabler/native capabilities do not satisfy the requirement. Prefer a thin adapter and pinned local dependencies.
- Every implementation handoff requires actual browser screenshots, console/network checks, keyboard/focus checks, no page-level overflow, no synthetic production data and applicable business regression. Baseline screenshots record old defects; they do not constitute V3 acceptance.
- Remove replaced old CSS/JS/assets only after HTML, JS, tests and runtime references are all absent and regression passes. Do not add a giant override stylesheet. WP-UI00–02 install rules and preserve the old runtime unchanged; implementation starts only with subsequent authorization.

## Phase 5+ reuse-first rule

- Before implementing any Phase 5 or later capability, evaluate mature official/open-source modules first. Record the candidate's license, deployment fit, data privacy, operating cost, maintenance activity, and integration boundary, and reuse a suitable module instead of rebuilding the same infrastructure.
- Use `docs/PHASE5_REUSE_RESEARCH.md` as the initial shortlist, then re-check current official documentation and release status before adoption.
- This rule does not authorize Phase 5 work during Phase 4: do not add these dependencies, change Phase 4 scope, or begin Phase 5 until Phase 4 has passed and Phase 5 is explicitly started.

## New-customer product opportunity rule

- Treat new-customer product scoring as a category-level supply-opportunity decision.
- Compare the target company's public procurement demand or operated product categories with DPV's approved supply categories/profile scope.
- Exact, similar, or same approved profile scope means DPV can supply that category and therefore has a product-category cooperation opportunity.
- Do not require or present an exact individual SKU match. Do not create product-master candidates or manual tasks to supplement a corresponding product.
- Product and historical customer-deal imports are inputs for approved category/profile scope, historical ICP, and customer scoring baselines only.
- Keep customer-side missing procurement/category evidence as `NEEDS_PRODUCT_EVIDENCE`; keep confirmed out-of-scope categories as `PRODUCT_MISMATCH`.
- Company-facing wording must use `商品类目评分 / Product Category Score` for this score.

## Opportunity email rule

## Phase 13 rule-reading and dry-run boundary

- Before Phase 13 business/category/contact work, read `docs/rules/PHASE13_BUSINESS_SCOPE.md`, `docs/rules/PHASE13_OPPORTUNITY_POOL_RULES.md` and `docs/rules/PHASE13_CONTACT_READINESS_RULES.md`.
- V2.1 MC03 is the historical opportunity-pool read-only comparison, superseding old search-shadow numbering. The user approved MC04: PRECISION/RELEVANT/GENERAL_RELEVANT enter Active Business Opportunity directly; no manual Opportunity Confirmation; review flags are nonblocking. Keep Business Opportunity, Contact Readiness and Email Eligibility independent across V3 UI/API/export. Append new pool revisions, preserve legacy rows and email approval/security gates. Do not redo MC00–03, call providers, send mail or begin MC05. STOP after MC04.
- Keep rule documentation, standalone implementation and tests consistent. Later work packages need their own explicit activation and applicable rule files; a broad future plan is not permission to run later work.

## MC05 execution boundary — 2026-09-08

- MC04 was accepted and checkpointed locally at `69b55bcb247459b085ca6e784207d6616692eac7`. Preserve its Opportunity Pool rules and stored projections; do not recalculate them during MC05 verification.
- The user authorizes V2.1 MC05 only: active/search-enabled Market Registry and active/approved target-category selection, immutable scope snapshot, parent ResearchBatch and existing single-scope ResearchJob fan-out/reuse. Reuse the transactional outbox, pg-boss, worker/checkpoints and provider ledger. Preserve single/multiple selections and V3 UI.
- Registry updates must not mutate historical snapshots. Repeated creation and identical active scopes must dedupe. Verify charge prevention without triggering live provider execution.
- No Brave activation, 24-hour search, email, Phase13 final push/tag or MC06. STOP after MC05. The earlier MC04 STOP is historical, superseded only for this explicitly authorized work package.

## Existing opportunity email behavior

## MC06 execution boundary — 2026-09-08

- MC05 accepted working tree is checkpointed at `cf559d6db0b7b4baa68cc41af54a246b3fba97e0`. This explicit authorization supersedes the historical MC05 STOP only for MC06.
- Implement deterministic frozen-scope query planning, Precision/Coverage lanes, versioned domain policy, discovery corroboration and V3 planning previews. Preserve MC04 classifications and MC05 batch/fan-out/idempotency semantics.
- No live Brave/Tavily search, Hunter, SMTP, LLM, automatic outreach or production QA batch creation. Report existing startup metadata probes separately from search calls.
- Preserve migrations 001–059. Any needed schema is latest + 1. Complete isolated/database/browser regression, result documents and local checkpoint; no push/tag. STOP before MC07.

## Existing opportunity email behavior (continued)

- A current category-based business opportunity is sufficient commercial justification for an introductory email; do not add a separate proof-of-current-procurement requirement.
- An observed official company or department mailbox may be used without a named buyer, after mailbox verification, current approval and address-level suppression checks.
- Automatically verify observed official business mailboxes through Hunter, persist the real result and usage history, and preserve its timestamp when public source records are refreshed.
- A failed mailbox affects that address only; other valid company addresses remain independently eligible.

## Server workflow and model execution

- Follow `docs/SERVER_WORKFLOW_EXECUTION_RULES.md` for server task execution, application review, operational visibility and economical model routing.
- Read `docs/LLM_RUNTIME_ACTUAL_STATE.md` before describing model capabilities. Distinguish planned model work from a configured and verified application API integration.
- Normal company workflow must run through persisted server tasks and application controls; development-time Codex assistance is not the production model runtime.
