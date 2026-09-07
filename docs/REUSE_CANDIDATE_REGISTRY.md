# UI reuse candidate registry — Phase 12

WP-UI16 final decision: no new production dependency; retain installed local Tabler/Core Icons and native interaction/chart capabilities. Remaining legacy-named modules are reachable functional code, not orphan assets. See PHASE12_UI15_CLEANUP_RESULT.md for the final reachability inventory.

Reviewed 2026-09-07. Current installed versions come from local package files, not guesses about the latest release. Official project pages were read for identity/capabilities; latest release age was not separately verified. Any future upgrade requires a fresh license/release/security review. No production package was installed for WP-UI01.

| Candidate | Verified version / license | Fit, privacy and cost | Maintenance evidence / integration boundary | Decision |
|---|---|---|---|---|
| Tabler core | installed `1.4.0`; local package MIT | Existing vanilla HTML/CSS/JS; locally served, no user-data upload needed; no new license fee identified | [Official project](https://github.com/tabler/tabler) and local package inspected; latest release date not checked. Keep vendor interaction support, replace old presentation with reference-led V3 | Reuse capabilities, not default/old skin; no upgrade now |
| Tabler Icons webfont | installed `3.46.0`; official MIT icon collection | Already self-hosted via `/vendor/tabler-icons`; no remote icon requests required; no new dependency | [Official project](https://github.com/tabler/tabler-icons); keep icon role/accessibility, restyle size/color through V3 | Reuse; avoid another icon family |
| Bundled ApexCharts | local Tabler `dist/libs/apexcharts` package and JS banner `3.54.1`; local LICENSE/banner MIT | Already on disk, compatible local script delivery; charts need only aggregate API data; no hosted chart service | Bundled artifact verified, not presently loaded by application. Preserve this version's license; do not assume newer versions share terms. Needs lifecycle/destroy, resize, accessible data fallback and V3 adapter tests before adoption | First chart-library candidate, pending bounded implementation evaluation |
| Existing semantic HTML/CSS charts | project code, no separate package | Current opportunity status bars and counts work with native DOM; minimal payload and no data egress | `public/ui/opportunity-workspace.js:115`; business counts/events reusable, current visual styling discarded | Preferred for funnel/simple bars |
| Chart.js | not installed; candidate only, version not selected | Canvas/local npm serving fits runtime; new dependency cost and accessible fallback required | [Official documentation](https://www.chartjs.org/docs/latest/) checked. License/version/security must be pinned and checked at adoption | Defer; only if bundled/native capability is insufficient; no CDN |
| Native table + existing filters/pagination | platform + existing project code | Current business lists; no grid migration or service cost | `app.js` renderCompanyTable/renderOpportunityTable and UI filters; business assertions already exist | Reuse mechanics, fully replace visual treatment |
| Native dialog | browser platform, no added package | Existing review/detail interactions; no data egress | [Platform documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog); existing detail/review close/focus behavior must remain | Reuse semantics, rebuild reference-family presentation |
| Existing Node test contracts + browser tool | package `node --test`; no Playwright/Puppeteer dependency declared | Keeps offline unit/API contracts; browser tool can verify rendered UI without changing production runtime | `services/demo-dashboard/test/*ui*.test.js`; live screenshots alone do not replace assertions | Reuse and extend, distinguish source-contract from browser PASS |
| ECharts / new grid / React rewrite | not found in application dependency/public search | Additional runtime and migration burden not justified for current scoped preparation | No adoption evaluation conducted, no installed version claimed | Do not add in WP-UI00–02 |

## Complete candidate records

### WP-UI09–11 reuse decision (2026-09-07)

Reused native dialog, details, original form controls, current Tabler controls/icons, existing read projections and the existing native SVG/HTML chart implementation. No new production package or external service. Thin adapters live in `public/ui/v3/{records,replies,charts}.js`; original form listeners and approval handlers remain. SVG geometry is visibility-deferred with immediate text fallback. This intentionally adapts the plan's library-specific chart wording: bundled ApexCharts remains unshipped, avoiding its 539,664-byte minified artifact for one existing ring. No new library maintenance or license claim is made. Native semantics still require runtime focus/mobile checks; they are not accepted solely by dependency choice.

### Tabler core

- **Capability:** form/control primitives and mature interaction support.
- **Existing implementation:** `public/index.html` local vendor CSS/JS; `src/server.js:516` static route.
- **Candidate:** retain installed Tabler capability.
- **Official source:** https://github.com/tabler/tabler (read).
- **Version:** installed 1.4.0.
- **License:** MIT, local package checked.
- **Maintenance:** official repository available; latest release date, security advisory review and support horizon not verified.
- **Bundle/runtime cost:** already shipped; no package addition. Exact transferred bytes/CPU not measured.
- **Accessibility:** preserve semantics, focus and disabled states; new V3 contrast/keyboard behavior requires browser validation, not inferred from framework use.
- **Privacy:** local static assets; no user-data upload needed for this reuse.
- **Integration boundary:** HTML/CSS/JS component behavior only; no API or data-model migration.
- **Decision:** reuse existing version, no upgrade now.
- **Reason:** capability fits existing runtime; default appearance is replaceable and not the visual authority.
- **Date:** 2026-09-07.

### Tabler Icons

- **Capability:** consistent local interface icons.
- **Existing implementation:** `/vendor/tabler-icons` webfont and `.ti` classes.
- **Candidate:** installed `@tabler/icons-webfont`.
- **Official source:** https://github.com/tabler/tabler-icons (read).
- **Version:** installed 3.46.0.
- **License:** official MIT icon collection.
- **Maintenance:** project page checked; latest release age/security status not verified.
- **Bundle/runtime cost:** already loaded; exact font bytes not measured; avoid a second icon bundle.
- **Accessibility:** decorative icons hidden from accessibility tree; icon-only actions require labels and visible focus.
- **Privacy:** self-hosted; no external icon fetch required.
- **Integration boundary:** icon markup/tokens, not business labels or handlers.
- **Decision:** reuse.
- **Reason:** existing consistent icon capability meets scope without another dependency.
- **Date:** 2026-09-07.

### Bundled ApexCharts

- **Capability:** richer aggregate charts if semantic HTML/CSS is insufficient.
- **Existing implementation:** Tabler bundles `node_modules/@tabler/core/dist/libs/apexcharts`; current public page does not load it.
- **Candidate:** bundled ApexCharts artifact, not an automatic upgrade.
- **Official source:** https://github.com/apexcharts/apexcharts.js (URL verified in local package metadata; upstream page not separately read in this audit).
- **Version:** 3.54.1, verified in package and JS banner.
- **License:** local LICENSE and JS banner MIT for this exact artifact; newer release terms not verified.
- **Maintenance:** bundled historical version; latest release/security/advisory status not verified, must review before activating.
- **Bundle/runtime cost:** actual local `dist/apexcharts.js` **1,256,663 bytes**; `dist/apexcharts.min.js` **539,664 bytes**. Filesystem lengths, not gzip/network transfer sizes. Current application load cost is zero because not referenced; future chart render/CPU cost unmeasured.
- **Accessibility:** provide equivalent textual/table counts and keyboard-supported filters; SVG output alone is not acceptance. Reduced motion and resize/destroy handling need validation.
- **Privacy:** intended local render of aggregate API values; no hosted service required. Verify no new external requests in browser at adoption.
- **Integration boundary:** V3 chart adapter receiving API counts; preserve score/status semantics and lifecycle cleanup.
- **Decision:** first library candidate, pending capability/security/license/accessibility evaluation; not activated.
- **Reason:** already present; installing Chart.js before evaluating it would duplicate available capability.
- **Date:** 2026-09-07.

### Semantic HTML/CSS chart

- **Capability:** funnel, simple status bars and interactive count summaries.
- **Existing implementation:** `public/ui/opportunity-workspace.js:115` renderChart.
- **Candidate:** native semantic markup with new V3 presentation.
- **Official source:** project source above; no third-party module adopted.
- **Version:** repository baseline, no independent package version.
- **License:** project-local code; separate external license not applicable to this reuse; repository license review not performed.
- **Maintenance:** maintained within DPV; no upstream release dependency.
- **Bundle/runtime cost:** no additional package; exact function byte/CPU cost not measured.
- **Accessibility:** actual labeled buttons expose count and percentage; preserve keyboard activation and add V3 contrast checks.
- **Privacy:** local DOM from existing API aggregates.
- **Integration boundary:** render-only markup/styles, retaining data-opw-status events and count calculations.
- **Decision:** preferred for simple bars/funnel.
- **Reason:** smallest existing capability; old appearance still replaced.
- **Date:** 2026-09-07.

### Chart.js

- **Capability:** canvas-based aggregate chart candidate.
- **Existing implementation:** none; no installed Chart.js found in application package/lock/public search.
- **Candidate:** locally installed/pinned Chart.js only if later justified.
- **Official source:** https://www.chartjs.org/docs/latest/ (read).
- **Version:** not selected or installed.
- **License:** exact selected artifact not yet verified; must verify before adoption.
- **Maintenance:** documentation available; release age/security review not performed.
- **Bundle/runtime cost:** new JS package and canvas lifecycle; exact bytes/CPU unknown until version/build chosen.
- **Accessibility:** canvas must have accessible name and equivalent data fallback; keyboard interaction separately required.
- **Privacy:** planned self-hosting, no CDN; verify requests before use.
- **Integration boundary:** chart adapter only, no business/data changes.
- **Decision:** defer.
- **Reason:** native bars and bundled ApexCharts need evaluation first.
- **Date:** 2026-09-07.

### Native tables and existing filters

- **Capability:** company/opportunity lists, sorting/filtering/pagination and long-content scrolling.
- **Existing implementation:** `app.js` renderCompanyTable/renderOpportunityTable; `ui/filters.js` and semantic tables in index.
- **Candidate:** retain native mechanics and replace styling/layout.
- **Official source:** project implementation; no third-party grid source selected.
- **Version:** repository baseline/native platform, no independent package.
- **License:** no new external package; project license not reviewed here.
- **Maintenance:** DPV-owned renderers and tests.
- **Bundle/runtime cost:** no grid dependency added; large-list performance not benchmarked in this audit.
- **Accessibility:** retain caption, column headers, keyboard actions and readable scroll region; responsive overflow requires browser checks.
- **Privacy:** same API data stays in current application.
- **Integration boundary:** DOM layout and V3 CSS; preserve query/filter/page state and IDs.
- **Decision:** reuse mechanics.
- **Reason:** no demonstrated need for grid framework migration.
- **Date:** 2026-09-07.

### Native dialog

- **Capability:** company details, review and confirmation surfaces.
- **Existing implementation:** `#detail`, `#verification-detail`, outreach dialog and their current handlers.
- **Candidate:** native dialog with V3 size/layout/style.
- **Official source:** https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog (read platform reference).
- **Version:** browser platform; browser version not recorded by this source audit.
- **License:** no additional library package.
- **Maintenance:** browser platform plus DPV handlers; compatibility review for deployment browsers pending.
- **Bundle/runtime cost:** no new package; actual layout cost unmeasured.
- **Accessibility:** preserve close/back, Escape, focus return, labels, error feedback; validate nested/long content and mobile behavior.
- **Privacy:** existing local application surface, no service upload.
- **Integration boundary:** presentation and accessibility mechanics; approval/send remain distinct existing actions.
- **Decision:** reuse semantics.
- **Reason:** current interaction capability fits scope without modal library replacement.
- **Date:** 2026-09-07.

### Existing test contracts and browser verification

- **Capability:** API/hook regression and rendered UI checks.
- **Existing implementation:** `node --test test/*.test.js`; UI contract files; session browser tooling.
- **Candidate:** extend existing tests plus browser evidence.
- **Official source:** local package/test code; no new test-package upstream source inspected.
- **Version:** package test command verified; Node/browser tool runtime versions not captured in this audit.
- **License:** no newly adopted dependency; tooling license audit not performed.
- **Maintenance:** project-owned tests; runtime release status not reviewed.
- **Bundle/runtime cost:** development/acceptance only, no production JS addition.
- **Accessibility:** browser acceptance must cover keyboard/focus/contrast/overflow; source string checks are insufficient.
- **Privacy:** screenshots can contain customer details; keep baseline artifacts local and review before publishing.
- **Integration boundary:** tests/evidence only, no production behavior changes.
- **Decision:** reuse and extend.
- **Reason:** preserve business assertions while replacing assertions tied solely to obsolete visuals.
- **Date:** 2026-09-07.

### ECharts / new grid / React rewrite

- **Capability:** speculative replacement chart/grid/framework stack.
- **Existing implementation:** these replacements not found in current app dependency/public searches.
- **Candidate:** none selected.
- **Official source:** not researched; no adoption proposed.
- **Version:** not selected; no installed version claimed.
- **License:** unverified.
- **Maintenance:** unverified.
- **Bundle/runtime cost:** unmeasured, introduces additional runtime/migration burden.
- **Accessibility:** unverified; framework adoption would not itself prove compliance.
- **Privacy:** unverified for any proposed configuration.
- **Integration boundary:** potential broad migration conflicts with preservation scope.
- **Decision:** do not add in WP-UI00–02.
- **Reason:** existing native/Tabler capability has not been shown insufficient; user requests runtime preservation.
- **Date:** 2026-09-07.

## Adoption and retirement protocol

### Accessibility completion QA tooling (2026-09-07)

- **Candidate/version/license:** `axe-core` **4.10.3**, **MPL-2.0**, verified from the installed package and [official pinned source](https://github.com/dequelabs/axe-core/tree/v4.10.3).
- **Decision:** QA-only reuse. Existing native/Tabler components are not accessibility testing engines; this adds rendered contrast and ARIA checks rather than a production widget.
- **Location/boundary:** ignored `artifacts/phase12-ui-baseline/qa-tools/`; injected into a fresh independent Chrome test context. Production package files, runtime assets and lockfiles are unchanged.
- **Privacy/cost:** local execution; browser permits only loopback GET/HEAD and blocks remote origins, writes and WebSockets. No hosted audit upload or service fee. Screenshots/results remain private. Zero production bundle bytes added.
- **Maintenance/security:** official pinned repository reviewed; local reproducibility version, not a claim of latest release or comprehensive advisory clearance. Installation uses `--ignore-scripts`. A future version change requires renewed review.
- **Limit:** automated findings and Chromium accessibility-tree inspection do not replace human screen-reader testing or establish complete WCAG conformance. Incomplete checks require additional review.
- **Rollback:** remove the QA-only local package and stop invoking its script; no application rollback is needed.

Before adding a dependency document exact version, license text, official release/security status, self-hosted deployment, data sent outside DPV, ongoing fee/resource cost, reason existing native/Tabler capability falls short, rollback path and test plan. No third-party CDN is part of the new production UI.

The reference HTML provides visual direction, not trusted business data, APIs, external-script approval or authority to overwrite current workflow gates. Existing UI artifacts remain in place only until their surface is migrated and verified; unused replaced CSS/JS must then be removed after reference checks. APIs, stable hooks, scores, real records, mail eligibility, approval and suppression gates stay unchanged.
# Phase 13 search reuse review — 2026-09-07

Reuse the existing JavaScript adapters, native Node fetch/AbortSignal, PostgreSQL provider_usage_events, and existing company/category/contact processing. No new production package is required.

- Brave official Web Search API: commercial API terms, not an open-source dataset license. Backend-only token; only public research queries sent. Metered request costs depend on the subscribed account; no billed amount is invented. Official API documentation is available and was checked for pagination/country limits. Result storage remains gated by the account's storage entitlement. Boundary: discovery hints, never direct Opportunity qualification.
- Tavily official Search API: retain current backend integration and account state; explicit Basic/Advanced, no automatic parameters or answer/raw-content expansion. Existing account pricing applies; record actual usage when returned and mark estimates. Boundary: evidence and contact search; original verification still required.
- Native runtime and existing ledger: no new vendor, data residency, package license or maintenance burden. Database result cache stays on the existing local deployment and is excluded from Git exports. Frozen migration 057 remains unchanged.

Sources: [Brave API](https://api-dashboard.search.brave.com/api-reference/web/search/get), [Tavily API](https://docs.tavily.com/documentation/api-reference/endpoint/search).
