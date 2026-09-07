# Phase 12 WP-UI15 — Cleanup evidence

Date: 2026-09-07. Static cleanup implemented; final deployed browser/business regression is recorded by the release handoff, not claimed by this static audit.

## Removed

Removed 259 obsolete selector arms from 10 served stylesheets. A selector arm means one member of a comma-separated selector group; shared declarations are retained when any live member remains. Empty media blocks and surplus blank lines left by these removals were also removed.

| File under `services/demo-dashboard/public/` | Removed selector arms |
| --- | ---: |
| `bilingual.css` | 36 |
| `phase5.css` | 88 |
| `phase7.css` | 7 |
| `styles.css` | 50 |
| `ui/phase10-workbench.css` | 1 |
| `ui/phase8-components.css` | 1 |
| `ui/phase8-pages.css` | 46 |
| `ui/phase8-responsive.css` | 28 |
| `ui/v3/foundation.css` | 1 |
| `ui/v3/shell.css` | 1 |

Removed families cover the old hero/header, old Sidebar/Topbar, old command/KPI/overview layouts, replaced research progress/candidate tables, old exact-product-candidate presentation and superseded evidence/manual-route layout classes. These class names have no current HTML/JS literal callers. Dynamic class generation was checked separately; tier, verification, business-state and product-profile state classes were retained, even where individual enum values do not occur literally in source.

## Retained and why

The module reachability audit finds **23 public JavaScript files, all reachable** from `index.html` via script entries and relative imports. All **20 public stylesheets are linked** from the application. There are **zero other public image/font/asset files** in this source directory. Vendor dependencies are separately served local packages, not orphan public assets.

No entire JavaScript/CSS/asset file was deleted just because its name contains an earlier phase:

- `crm-shell.js`: active navigation, theme, density and dialog interaction.
- `ui/shell.js`: active bilingual preference persistence and settings; it is not a duplicate of `ui/v3/shell.js`.
- `phase7-ui.js`, `ui/outreach-workbench.js`, `ui/controlled-email-verification.js`: live management, draft, mail and controlled-verification interfaces.
- `ui/phase9-research-workbench.js`: live persisted research/jobs workflows.
- `verification-ui.js`, `opportunity-ui.js`, `product-match-ui.js`, `market-visibility.js`: imported business presentation/validation helpers.
- Earlier-named CSS files still own live tables, filters, dialogs, controlled-mail and shared business components. Only their unreachable replaced selectors were removed. V3 tokens and components remain the current visual authority.

The archived reference, historical plans, migrations and evidence documents are outside the served frontend and remain historical records. Business/source evidence text and database contents were not rewritten by this cleanup.

## Verification performed by cleanup workstream

- Updated the two Phase 8 navigation assertions to test the actual V3 48px navigation targets and scrollable/openable mobile navigation. Retained native zoom, focus and viewport contracts.
- `node --test test/phase8-ui-contract.test.js`: **17 passed, 0 failed**.
- `node --test test/phase12-legacy-cleanup.test.js`: **3 passed, 0 failed**. Guards obsolete selector families, JS import reachability and stylesheet linkage.
- `node --test test/phase7-ui-contract.test.js`: **9 passed, 0 failed**. Replaced a dead readiness-stack CSS assertion with current readiness summary/grid markup, status rendering and minimum-width contracts; action and mobile assertions remain.
- `git diff --check`: exit 0; Windows newline warnings only.
- No browser or business mutation was performed by the cleanup workstream. Final release verification must cover the deployed pages, error states and business invariants before WP-UI16 release completion.

## Recovery

Removed declarations remain recoverable from Git history. No company, contact, evidence, email, shared-folder file or database record was removed.
