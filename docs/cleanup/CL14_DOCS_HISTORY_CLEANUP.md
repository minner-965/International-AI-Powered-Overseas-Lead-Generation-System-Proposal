# CL14 — Documentation and history cleanup

Date: 2026-09-13. Scope: documentation organization and reference repair only.

## Actual changes

- Archived 121 tracked historical Markdown documents using explicit Git renames; none of these audit records was deleted.
- Distribution: Phase 1: 1; Phase 2: 2; Phase 5: 3; Phase 6: 5; Phase 7: 1; Phase 8: 3; Phase 9: 5; Phase 10: 45; Phase 11: 19; Phase 12: 19; Phase 13: 16; reference: 2.
- Preserved Phase 10–12 acceptance and Phase 13 MC03–MC07 result history under `docs/history/phaseN/`.
- Replaced the obsolete Phase 1 root README with current-document navigation. Preserved its original content in `docs/history/reference/README_PHASE1.md`.
- Moved obsolete `CURRENT_STATE.md`, `PROJECT_CONTEXT.md`, `UI_SYSTEM.md` and `PHASE8_DESIGN_SYSTEM.md` out of the current documentation root.
- Updated tracked Markdown links and exact repository paths, the historical MC03 report output path, and the Phase 7 documentation test path. Changes are path-only except the README replacement.

## Deliberate retention

Active contracts, V3 UI guidance, provider/setup instructions, reuse guidance and rule files remain at stable current paths. A Phase-prefixed filename alone is not evidence that its contents are obsolete.

Private local reports explicitly protected by `.gitignore` remain in place. Examples include Phase 1/3/4 results, Phase 5 imported-data reports and shared-folder inventories. Moving these into a tracked history directory could expose customer information; no private report was staged or copied into Git.

The restored Phase 6.1 V2/V3 plans remain historical inputs required by the documentation regression test. No duplicate plan was deleted without demonstrating zero audit and test references.

## Verification

- Maintenance guard: PASS; all execution containers stopped, PostgreSQL retained, no persisted controls modified.
- Phase 7 documentation regression: 3 tests passed, 0 failed. This includes restored historical V2/V3 plan checks.
- `git diff --check`: PASS.
- Exact requested forbidden presentation phrases found in current root Markdown only as the existing repository slug in setup/status metadata; no newly introduced claims about model capabilities.
- No service startup, external API call, email, business-data edit or migration was performed by this workstream.

Current status/runtime/version documents are consolidated by the coordinating workstream. CL15 full-suite/browser acceptance and CL16 release checks remain separate verification steps; this document does not pre-claim their outcome.
