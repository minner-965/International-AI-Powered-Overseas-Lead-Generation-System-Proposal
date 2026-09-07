---
name: dpv-workspace-ui
description: Implement and review DPV workspace frontend pages, CSS, labels, charts, responsive layouts and interactions against the approved Phase 12 reference while preserving existing business behavior. Use for user-visible frontend changes in this repository.
---

# DPV workspace UI

## Authority and scope

Read repository `AGENTS.md`, `docs/UI_SYSTEM_V3.md`, and the accepted reference `docs/ui/reference/dpv-workspace-reference-dashboard.html` before frontend work. Read `docs/UI_COMPONENT_CATALOG_V3.md` for components, `docs/UI_PAGE_CONTRACTS_V3.md` for the affected page, and `docs/UI_VISUAL_QA_PROTOCOL.md` before verification. Resolve these paths from the repository root, not this skill folder.

The reference is the sole visual direction: dark sidebar, white topbar, light-gray canvas, white rounded cards, compact operational hierarchy. User corrections take priority over sample decoration. Phase 8/post-Phase 9 visuals are obsolete, including shell, palette, KPI, tables, detail, opportunities, contact queue and settings. Retain functionality, not appearance. Other design skills may inform accessibility or mechanics, never replace this direction.

## Implementation boundary

- Preserve native HTML/CSS/JS, Express static frontend, stable hooks, API payloads, database and mature Tabler/native interactions. No framework migration or business-rule rewrite.
- Reuse existing capabilities before adding dependencies. Inspect lockfiles, vendor and Tabler distribution, record official license/version/cost/privacy/accessibility evidence in `docs/REUSE_CANDIDATE_REGISTRY.md`, then choose the smallest pinned local solution.
- Never copy sample data, AI promotional labels, CDN code, Google Fonts, Font Awesome, remote avatars, glowing gradients, shimmer or fake rates/ETA into production. Archive reference HTML outside served `public/`.
- Use semantic V3 tokens, local Tabler icons and equal-size/equal-weight Chinese-above-English `.bi` labels. Keep original company names, contact details and evidence unchanged.
- Preserve research, category opportunity, approval, SMTP/IMAP, reply, CRM, suppression and export semantics. UI work itself does not authorize sending mail, granting approval, starting searches, database migrations or source-file changes.

## Work and stopping conditions

Complete only the authorized work packages. WP-UI00–02 are baseline, inventory and rules only; no production frontend edits. Later, migrate components/pages directly and remove their replaced styles only when all callers and tests are accounted for. Never use a giant override layer or accept a mixed V3/legacy product.

Before handoff, use actual browser evidence and the QA protocol. Record unavailable tests as unverified, not PASS. Keep screenshots/business snapshots private and outside public Git artifacts. Do not substitute screenshot-only checks for functional regression. Report package-level outcomes separately from full Phase 12 acceptance, then stop at the authorized boundary.
