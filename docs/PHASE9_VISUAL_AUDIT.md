# Phase 9 Visual Audit

Date: 2026-08-31

Target: deployed management workspace at `http://localhost:3000/`

Coverage: Research Workbench, New Research Job dialog, Jobs Inbox, job detail and deployed export.

## Outcome

```text
PHASE 9 VISUAL AUDIT: PASS
page-level horizontal overflow: 0 tested viewports
fake KPI/company/task/gauge: 0
gradient/external font/new icon family: 0
```

The inspection used the deployed application with authenticated management access and real PostgreSQL projections. Screenshots are retained only under the Git-ignored `runtime/phase9-visual-audit/` directory.

## Viewport matrix

| Viewport | Research | Jobs | Page horizontal overflow | Result |
| --- | --- | --- | --- | --- |
| 1440 × 900 | compact command header, 4 metrics, two-column work area | seven-column operational table | none | PASS |
| 1280 × 720 | full workflow visible without a marketing hero | stable | none | PASS |
| 1024 × 768 | panels reflow without label collision | stable | none | PASS |
| 768 × 900 | single-column work area | usable | none | PASS |
| 390 × 844 | two-by-two metrics, full-width actions | decision cards | none | PASS |
| 375 × 667 | compact overview | internal 467px scroll region for 19,211px content | none | PASS |
| 844 × 390 | landscape actions and content remain readable | usable | none | PASS |

The mobile Jobs list uses a bounded internal scrolling region (`overflow-y:auto`) instead of extending a page through every full record. Desktop column headers remain sticky inside the same region. The browser viewport remains normally zoomable; no `maximum-scale` or `user-scalable=no` is present.

## Theme and density

- Light + comfortable: passed.
- Dark + compact at 1280 × 720: passed.
- Returned to light + comfortable after the audit.
- Existing warm-neutral / indigo design tokens remain authoritative.
- Chinese and English remain equal-size, equal-weight, stacked bilingual labels.
- No deep-green brand surface, gradients, glow, glass, remote font or second icon family was introduced.

## Research Workbench

Verified in the deployed UI:

- four real metrics only: active jobs, Evidence Required opportunities, verified profile buyers and contact-ready opportunities;
- at most three deterministically ranked priority tasks;
- the six most recent jobs with real status and progress;
- completed Phase 9 jobs render `100%`, not `0%`;
- no historical score is presented as a recommendation;
- no provider name, secret, raw payload or internal path appears in the company UI;
- current true zeroes remain visible instead of being replaced with sample data.

## New Research Job dialog

- Native modal dialog with a visible close control and Escape handling.
- Three steps: market/profile, buyer scope and final review.
- Dialog at 375 × 667 remains within the viewport (`top 8`, `bottom 659`) and scrolls its body internally.
- Sticky footer actions remain visible without covering the focused control.
- Cancel/close restores focus to the exact “New Research Job” trigger.
- Validation is inline and does not dispatch until the third-step confirmation.

## Jobs Inbox and detail

- Three tabs: Research, Data and Outreach.
- Research list exposes seven decision columns: Job, Market, Status, Progress, Results, Blocker and Action.
- Filters, bounded cursor pagination, status labels and empty/error/loading states were checked.
- Job detail shows seven stages: Identity, Buyer Model, Category Procurement, Supplier Access, Buyer/Role, Email verification and Decision refresh.
- Evidence links accept only safe HTTP(S) URLs and open with `rel="noreferrer"`.
- Browser Back closes detail, restores the list and returns focus to the exact “Open details” button.
- Opportunity blocker actions deep-link to the existing opportunity workspace without duplicating business rules.

## Deployed Excel regression

An authenticated browser action generated and downloaded export job `7e513435-d7f7-4b23-8ee6-c279ddd494ef`.

```text
status: READY
rows: 14
columns: 31
worksheet: Export
used range: A1:AE15
tables: 1
blank headers: 0
formula errors: 0
SHA-256: f132b093b8ae7e2333cd20b22ac0b87cee0e387b733f25dad6e70451d7b7bb71
download audit recorded: yes
```

The file was independently opened and rendered with the local spreadsheet runtime. It contains the 14 current opportunity records and no synthetic filler row. The inspection copy and PNG preview remain Git-ignored under `runtime/phase9-export-audit/`.

## Accessibility and recovery checks

- Logical page, section and dialog headings.
- Visible labels and focus indicators.
- 44px project touch-target policy preserved.
- Statuses include text; meaning is not color-only.
- One contextual live region per async surface.
- Retry controls appear for recoverable read errors.
- `prefers-reduced-motion` contract remains inherited from Phase 8.
- No hover-only primary action.

## Screenshot manifest

```text
research-1440x900.png
research-1280x720.png
research-1024x768.png
research-768x900.png
research-390x844.png
research-375x667.png
research-844x390-corrected.png
research-1280x720-dark-compact.png
research-new-job-dialog-step1.png
research-dialog-375x667.png
jobs-wave-b-detail.png
jobs-375x667-final.png
phase9-final-research-1280x720.png
```

This manifest records visual coverage only; the screenshots are not release artifacts and are excluded from Git.
