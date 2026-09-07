# V3 Visual QA Protocol

## Baseline versus acceptance

WP-UI00 screenshots record the existing system at 1440×900, 1280×720, 390×844. They are not V3 visual PASS. Store real business screenshots and count snapshots under ignored `artifacts/phase12-ui-baseline/`; public docs may link local evidence without embedding sensitive exports. The reference is archived outside production static roots.

## Later implementation acceptance

1. Compare the archived reference with the actual rendered application, not only source code: dark sidebar, white topbar, gray canvas, white panels, proportions, gaps, typography, hierarchy and density. Every page must belong to the same V3 family.
2. Capture 1440×900, 1280×720, 1024×768, 768×900, 390×844, 375×667 and 844×390; test 200% browser zoom. Record actual viewport dimensions, route, time and filename. Test long content and no page-level overflow.
3. Test keyboard navigation, active sidebar, browser Back, deep links, drawer, filter controls, dialog focus trap/restore, visible return controls and reduced motion. Targets 44px; text contrast 4.5:1; interactive non-text contrast 3:1. Keep zoom enabled, no document-scale hacks.
4. Record console errors, failed requests/404 and remote UI asset requests. Zero UI CDN/Google Fonts/Font Awesome/remote avatars in production. Do not count preserved offline reference dependencies as production dependencies.
5. Exercise loading, empty, error, success, warning, disabled, stale, permission denied and degraded states using isolated test fixtures where necessary, never synthetic production records.
6. Verify actual metric sources/windows/scopes; exclude controlled records from prospect totals, show SMTP accepted as sent-no-reply until real reply; no fake rate/ETA.
7. Run applicable Phase 10/11 regression, verify original API payloads/hooks, approval/draft/send-state, IMAP/reply/CRM/suppression and import/export. Do not send new emails during UI verification. Record executed/pass/fail/skipped honestly.
8. Compare read-only business snapshots and SMTP attempt evidence before/after. Existing workers may progress independently: investigate/document any delta rather than asserting every background count is frozen. No task-originated business writes.
9. Measure HTML/CSS/JS bytes, requests and rendering with a reproducible method. User-approved revision (2026-09-07): resource-entry growth allowance is 40%, fixed against freeze commit `f3706d7765745fde02d7d77fe2d52eef60f87ba7` (50 entries → at most 70 in the same comparison harness); loading-time median growth allowance is 20%. Do not roll these baselines forward each release. Timing increases above 20% require review; record absolute milliseconds as context rather than applying an additional unapproved 100ms exemption. API counts remain separately reviewed; byte growth retains the original 15% review line. No blanket exemption for errors, missing assets, business regressions or inaccessible UI. Use repeated comparable runs and report local-only limitations. Do not confuse viewport captures with full-scroll-page coverage; inspect lower content and dialogs too.
10. Delete superseded styles/scripts/assets only after source/tests/runtime caller analysis and regression. Keep migrations, stable hooks, APIs and history. Restore temporary viewport/browser test settings at handoff.

## Result records

### Accepted measured performance exception — 2026-09-07

The user explicitly accepted the recorded combined cold-load increase of **37.48%** (165.7 → 227.8 ms) against the fixed frozen baseline. This specific measured result is accepted, not an outstanding release blocker. Preserve the original measurements and the general 20% review line above; this approval does not create an unlimited exception or silently change the baseline. Resource growth remains subject to the approved 40% allowance. Other functional, visual and accessibility checks still require evidence.

Each check records actual evidence, status PASS/FAIL/NOT RUN and cause. Current WP-UI00–02 may pass their limited scope while full Phase12 remains NOT STARTED. Commit/push/tag belongs to WP-UI16 unless separately requested; freeze branch does not imply final acceptance tag.
