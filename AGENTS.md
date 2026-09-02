# DPV Company-Facing Copy Rules

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

- Before changing company-facing frontend files, read `docs/UI_SYSTEM.md` and reuse its tokens, component classes, responsive breakpoints, bilingual pattern, and status mappings.
- Existing features receive the shared UI without changing their APIs, data semantics, form names or values, request payloads, endpoints, or stable DOM hooks.
- Future features must extend the same UI system. Reuse an existing component pattern before adding a new visual pattern.
- Use semantic design tokens for colors, borders, radii, shadows, and states. Do not introduce raw component colors when an existing token covers the role.
- Company-facing labels use the established `.bi` structure with Chinese above English at equal size and weight. Do not rewrite source evidence or returned business data.
- Verify frontend changes in the browser at desktop and mobile widths, including keyboard focus, loading, empty, error, long-content, and reduced-motion states.

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
