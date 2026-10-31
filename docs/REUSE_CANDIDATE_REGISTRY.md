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

# Global markets, categories and search cost — reuse review (2026-10-22)

Scope: plan sections A2–A4 and D (any category, major global markets, search spend control). Decision summary: reuse public reference data at **development time** to generate the market seed (migration 065 and `config/search/market-registry-seed.v1.json`); add **no new runtime dependency**. Search cost control reuses the existing `provider_usage_events` ledger and frozen-plan executor.

## Country names, languages, time zones, working days

| Candidate | Version / license (verified) | Fit | Maintenance | Decision |
|---|---|---|---|---|
| [`i18n-iso-countries`](https://github.com/michaelwittig/node-i18n-iso-countries) | 7.14.0, MIT (package LICENSE read) | ISO 3166-1 country names in en/es/de/fr/pt/it/tr/ar used for localized search market names (`country_terms`) | Active project; 7.14.0 published 2025-02-17 | **Reuse at dev time** via `scripts/generate-market-registry-seed.mjs` |
| [`countries-and-timezones`](https://github.com/manuelmhtr/countries-and-timezones) | 3.11.0, MIT (package LICENSE read) | IANA zones per country; validates the chosen business zone (multi-zone countries use a documented business-hub zone) | Active; 3.11.0 published 2026-10-16 (recent release — output was cross-checked against PostgreSQL `pg_timezone_names` in the Postgres test) | **Reuse at dev time** |
| [Unicode CLDR `cldr-core`](https://github.com/unicode-org/cldr-json) | 48.2.0, Unicode License v3 (package LICENSE read) | `territoryInfo` official languages (≥25% share, intersected with search vocabulary, English kept as business lingua franca), `weekData` weekend days → business send days, `primaryZones` | Unicode Consortium, semi-annual releases | **Reuse at dev time** |
| Hand-written country table | — | Error-prone, no source of truth | — | Rejected |

Why not a runtime dependency: the registry is a small, curated, management-controlled table (36 markets); names/zones/languages change rarely and must be frozen per migration for audit. Generating once keeps the production image unchanged (no new packages, no extra license notices shipped, no network). Regenerate with the script when adding markets; review the diff.

Integration boundary: seed data only. Market activation stays a management decision (`PUT /api/markets/registry/:code`); every new market is inserted `INACTIVE`/not search-enabled; AE/MX/BD rows are untouched.

Search vocabulary for de/fr/pt/it/tr (buyer terms + the 13 approved category terms) was written as standard B2B trade terminology in `config/search/query-strategies.v2.json`; no machine-translation service was called. Native-speaker review is recommended before large paid runs. Languages without vocabulary fall back to English.

Round 4 (strategy version 2.1.0): category terms for de/fr/pt/it/tr now use the official localized names of the vendored Shopify Standard Product Taxonomy wherever it has an equivalent node (dresses aa-1-4, skirts aa-1-15, trousers aa-1-12 / tr aa-1-12-11, outerwear aa-1-10-2 / tr aa-1-10, pt tops aa-1-13). The remaining codes (womenswear, knitwear, general merchandise, homeware, home and living, household goods, daily-use goods, non-food, most tops) have no equivalent or a catalogue-only label and keep the reviewed trade term. Each term's provenance is recorded in `category_term_sources`; `test/search-vocabulary-locales.test.js` checks completeness, the taxonomy names and English leftovers (allowed loanwords: Non-Food, Lifestyle, Distributor in German, top in Italian). Native-speaker review is still recommended.

## Any-category source (multilingual product taxonomy)

| Candidate | License / terms (verified) | Languages | Decision |
|---|---|---|---|
| [Shopify Standard Product Taxonomy](https://github.com/Shopify/product-taxonomy) | **MIT** (upstream `LICENSE` read and copied to `rules/product-taxonomy/shopify/LICENSE`); release 2026-08; ~10,600 categories with stable IDs and mappings to Google categories | en, es, de, fr, pt-BR, it, tr, zh-CN release files (no ar) | **Adopted.** Trimmed subset (apparel, home & garden, luggage, baby, toys, office, health & beauty, furniture; depth ≤ 4; 2,954 categories) generated at dev time by `scripts/import-product-taxonomy.mjs` into `rules/product-taxonomy/shopify/categories-subset.json` (1.4 MB) |
| [Google Product Taxonomy](https://support.google.com/merchants/answer/6324436) | Merchant Center help page offers `taxonomy-with-ids.<locale>.txt/.xls` downloads but states **no license**; only general Google Terms of Service | many locales | Not vendored: redistribution terms are not stated. Shopify's taxonomy is MIT and already maps to Google category IDs, so nothing is lost |
| UNSPSC | Free code set requires registration; redistribution/derivative terms restrictive (GS1 US) | en (others paid/limited) | Rejected: licensing and B2B procurement focus, weak retail-category wording |
| HS codes (WCO Harmonized System) | Nomenclature copyright WCO; national tariff versions vary | per national customs | Rejected: customs classification, not buyer-facing category names |

Integration boundary: `GET /api/category-scopes/taxonomy?q=` searches the subset; `POST /api/category-scopes/custom` turns a chosen category plus its multilingual names into a DRAFT category-scope revision. Approval remains the existing management approve endpoint; taxonomy data never approves a category or proves a buyer's procurement. Regenerate with a newer release by downloading the release files and rerunning the script (review the diff).

## Search spend control

Reused: `leadgen.provider_usage_events` (append-only rows; reuse is recorded as a new zero-cost `SKIPPED` row), `research_query_executions` stored response snapshots (cross-run reuse), the frozen search plan (query counts). Unit prices (`SEARCH_COST_USD_PER_QUERY_<PROVIDER>`) are configurable estimates; provider-reported `costDollars` is used when present. No billing SDK or external cost service is added.

## Local web search (round 4, P1)

| Candidate | Version / license (verified) | Fit, privacy and cost | Maintenance | Decision |
|---|---|---|---|---|
| [SearXNG](https://github.com/searxng/searxng) official Docker image [`searxng/searxng`](https://hub.docker.com/r/searxng/searxng) | tag `2026.10.13-22c64b8d3` (Docker Hub, pushed 2026-10-13); **AGPL-3.0** | Self-hosted metasearch with a JSON API (`/search?format=json`); free, no API key, queries stay on SIM's machine apart from the upstream engines it asks; result quality varies and upstream engines may CAPTCHA/rate-limit | Very active (several image builds per week); [settings docs](https://docs.searxng.org/admin/settings/index.html) read | **Reuse, unmodified, as a separate container.** The workspace only sends HTTP requests to it, so AGPL obligations for modified network services do not reach the workspace code; we ship no SearXNG source. Settings live in `config/searxng/settings.yml` (json format on, engines kept: google, bing, duckduckgo, brave, startpage, qwant; limiter off because the only client is the backend on the internal network; secret from `SEARXNG_SECRET`) |
| YaCy | GPL-2.0+ | Own crawler/index; needs long crawling before useful B2B coverage; heavy Java runtime | Active | Rejected: no usable index for export buyers out of the box |
| Whoogle | MIT | Google-only proxy; single engine, frequently blocked | Moderate | Rejected: single upstream, no fallback inside the service |
| MediaCrawler (sq-system) | NC license | Social-media crawler (Xiaohongshu/Douyin), not web search | — | Not applicable |

Integration boundary: `src/search/SearxngSearchProvider.js` implements the existing `SearchProvider` interface; `CurrentCapacityRouter` reads `SEARCH_PROVIDER_ORDER` (default `searxng,exa,tavily`) and the frozen-plan executor moves a query to the next provider on any SearXNG error, 429, CAPTCHA-blocked engines or an empty page. Usage-ledger rows are written as for paid providers (provider `SEARXNG`, cost 0, `SEARCH_COST_USD_PER_QUERY_SEARXNG=0`), so SearXNG hits are visible in usage counts. Results still pass `resultFilter`/domain policy. Pin a newer image tag only after reading its release notes.

## Merchant accounts: sign-in, sessions, password hashing, secret storage (round 4, P3)

| Candidate | Version / license (verified with `npm view`) | Fit, privacy and cost | Maintenance | Decision |
|---|---|---|---|---|
| [`express-session`](https://github.com/expressjs/session) | `1.19.0` (published 2026-01-22), MIT | Official Express session middleware; cookie only carries a signed id; data stays in our PostgreSQL | expressjs organisation, active | **Reuse** (exact pin) |
| [`connect-pg-simple`](https://github.com/voxpelli/node-connect-pg-simple) | `10.0.0` (2024-09-13), MIT; depends on `pg ^8.12` (already used) | PostgreSQL session store; no Redis needed; table `leadgen.workspace_sessions` created by migration 066 using the project's documented layout (`createTableIfMissing:false`) | Stable, low churn | **Reuse** (exact pin) |
| [`@node-rs/argon2`](https://github.com/napi-rs/node-rs/tree/main/packages/argon2) | `2.2.2` (2026-10-06), MIT; prebuilt native binaries incl. `linux-x64-musl` for the `node:24-alpine` image (recorded in package-lock) | Argon2id password hashing with OWASP default parameters; no node-gyp build | napi-rs, active | **Reuse** (exact pin). Alternatives: `argon2` (needs node-gyp/prebuild), `bcrypt` (weaker, 72-byte limit), Node `scrypt` (usable but hand-rolled encoding) |
| Node `crypto` AES-256-GCM | built in | Encrypts merchant mailbox passwords; key `MERCHANT_SECRET_KEY` only in `.env` | Node core | **Reuse**, thin wrapper `src/merchant/secretBox.js` |
| Passport.js / Auth0 / Clerk | MIT / hosted SaaS | Only email + password for a handful of accounts; hosted services would move merchant data off SIM's machine and add cost | — | Not adopted (overkill; privacy/cost) |
| `express-rate-limit` | MIT | Only the sign-in endpoint needs throttling | — | Not adopted; an 20-line in-memory limiter in `src/merchant/router.js` covers one process |

`npm audit --omit=dev` after the install reports the same 7 pre-existing advisories (brace-expansion, http-cache-semantics, ip-address, nodemailer, proxy-addr, source-map-js, undici) and none from the three new packages.

Integration boundary: `src/merchant/auth.js` (session + `/api` gate with a deny-by-default merchant route list), `src/merchant/scope.js` (central data scope), `src/merchant/MerchantService.js`, `src/merchant/router.js`. Business services keep their existing role checks; `AUTH_REQUIRED=false` restores the previous `DPV_WORKSPACE_ACTOR` development identity.

## Button explanations (tooltips) and display names (round 4)

| Candidate | Version / license | Fit | Decision |
|---|---|---|---|
| Dependency-free CSS tooltip: `data-tip` attribute + `aria-describedby` (shown on hover and keyboard focus, long-press / "?" on phones) | project code (`public/ui/v4/tooltips.js` + `app.css`), no package | Every button needs a short explanation; native attributes keep it accessible to screen readers and keyboard users with no runtime dependency or remote asset | **Adopted** (frontend agent). Floating UI (MIT) was the fallback if collision handling had proved insufficient; not needed |
| Native `title` attribute | browser platform | Not shown on keyboard focus or touch, delayed, not styleable | Not used alone |
| `Intl.DisplayNames` (ICU, built into Node) | Node core | Chinese/English country names for the merchant market picker (`src/merchant/referenceNames.js`) | **Reuse**; no country-name table added |
| Shopify taxonomy zh-CN names (vendored, MIT) | `rules/product-taxonomy/shopify` | Chinese category names where SIM has no reviewed label (SIM's reviewed labels — the export wording — take precedence) | **Reuse** |

## Low-cost LLM for internal execution (plan E1, evaluation only — 2026-10-26)

No dependency added; nothing wired. Full evaluation: `docs/plan/2026-10_LLM_EVALUATION.md`; model execution standard: `docs/llm/LOW_COST_MODEL_EXECUTION_STANDARD.md`.

| Candidate | Official source (prices checked 2026-10-26) | Terms / privacy note | Decision |
|---|---|---|---|
| Claude Haiku 5.5 (Anthropic API, official SDK `@anthropic-ai/sdk`, MIT) | https://platform.claude.com/docs/en/about-claude/pricing | API data not used for training by default; strict structured outputs; Batch 50% | **Proposed primary** for pilot |
| Qwen-Flash (Alibaba Cloud Model Studio, Singapore) | https://www.alibabacloud.com/help/en/model-studio/model-pricing | Review data terms before use | Proposed fallback adapter |
| Gemini 2.5 / 3.1 Flash-Lite | https://ai.google.dev/gemini-api/docs/pricing | Paid tier only (free tier content is used to improve products) | Blind-test comparison only |
| OpenAI gpt-5-nano / gpt-5.4-nano / gpt-5-mini | https://developers.openai.com/api/docs/pricing | Data terms to be confirmed | Blind-test comparison only |
| DeepSeek `deepseek-flash` | https://api-docs.deepseek.com/zh-cn/quick_start/pricing | CNY pricing, off-peak half price; review data terms | Not first choice |
| Self-hosted open-weight model | — | Needs GPU host; quality on PT/AR extraction unproven | Not adopted (cost of a ~$2–11/month API workload does not justify hosting) |

## Translation in the email editors (plan B7, 2026-10-26)

| Candidate | Source / version / license | Fit, privacy and cost | Maintenance | Decision |
|---|---|---|---|---|
| [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) official image [`libretranslate/libretranslate`](https://hub.docker.com/r/libretranslate/libretranslate) | tag `v1.9.6` (Docker Hub, 2026-05-26); **AGPL-3.0** | Self-hosted HTTP API (`POST /translate`, `GET /languages`) built on Argos Translate; text never leaves SIM's machine; free. Loaded with `LT_LOAD_ONLY=en,zh-Hans,es,pt,ar,fr,de,it,tr`: ~1.2 GB RAM measured, first start downloads the models into a volume. Verified locally: zh→es, en→pt, en→ar, es→zh in 0.6–2.3 s on CPU; quality is serviceable for drafts, so every translation stays editable before use | Active (v1.9.x releases through 2026) | **Adopted** as compose service `translate` (merged into `compose.yaml`), internal network only, pinned tag |
| Argos Translate (library used inside LibreTranslate) | MIT | Python library; would need our own HTTP wrapper and model management | Active | Not used directly: LibreTranslate is that wrapper |
| Bergamot / Firefox Translations | MPL-2.0 | Browser/WASM engine; no maintained self-host HTTP server; per-browser model downloads | Active (Mozilla) | Not adopted |
| Low-cost LLM via the B9 key (OpenAI-compatible or Anthropic API) | provider terms (see E1 section) | Better fluency for Arabic/Portuguese business tone; paid per token; text goes to the provider | — | **Fallback only**: used when LibreTranslate is not set up or not reachable and a model key exists (merchant's own key first) |
| DeepL / Google Cloud Translation | commercial | Good quality, but paid and sends email text to a third party | — | Not adopted |

AGPL-3.0 implications: LibreTranslate runs **unmodified** in its own container (same model as SearXNG). SIM talks to it only over HTTP, does not link or ship its code, and the service is not exposed to merchants or the internet (no published port), so SIM's own source is not a derivative work and no source-offer obligation is triggered. If the container is ever modified or exposed publicly, its modified source must be offered to those users.

Integration boundary: `src/translate/translateClient.js` (LibreTranslate → model → `TRANSLATE_UNAVAILABLE`), `src/translate/router.js` (`POST /api/translate`, sign-in required, 20 per minute per user, 5000 characters), `public/ui/v4/translate-widget.js` (editable result, "使用译文 Use translation"; nothing is saved or sent by the widget).

## Provider API keys page (plan B9, 2026-10-26)

| Candidate | License | Fit | Decision |
|---|---|---|---|
| Node `crypto` AES-256-GCM via existing `src/merchant/secretBox.js` | Node core | Same key (`MERCHANT_SECRET_KEY`) and format as mailbox passwords; per-row AAD binds ciphertext to owner/provider/field | **Reuse** |
| HashiCorp Vault / Infisical / Doppler | BUSL-1.1 / MIT (core) / SaaS | Separate secret service for ~20 values; extra container or third-party custody of keys | Not adopted (overkill for one host) |
| PostgreSQL `pgcrypto` | PostgreSQL licence | Would put the key into SQL statements and logs | Not adopted |

## Manual companies and test first emails (plan B1/B2, 2026-10-26)

| Candidate | License | Fit | Decision |
|---|---|---|---|
| `tldts` 7.4.11 (already a dependency; github.com/remusao/tldts) | MIT, actively maintained, public suffix list bundled | Registrable domain of the website and of the mailbox (`mail.example.co.uk` → `example.co.uk`) for the "company-domain mailbox" rule | Adopted (no new dependency) |
| Existing first-touch templates, SMTP adapter, `outbound_messages` / `outreach_threads` / reply correlation, CRM outbox + Feishu adapter | in-repo | Manual first touch and test sends reuse the approved template renderer and the same provider and CRM paths; only the draft/approval step and the test-send log are new | Adopted |
| CRM-style "add lead manually" and "send test email to myself" (HubSpot, Pipedrive, lemlist, Instantly, Smartlead) | commercial SaaS | Product pattern reference only; hosted CRMs would split data from the merchant workspace | Not adopted (pattern only) |
| Generic email validation libraries (`validator` already present, deep-email-validator) | MIT | SMTP probing of addresses would be an external call and is not needed: a person enters the mailbox and server rules check domain / source page / allowlist | Not adopted |

## Low-cost model assist: provider clients and local model (plan E1 / Simon 2026-10-27, batch 3)

| Candidate | Source / version / license | Fit, privacy and cost | Maintenance | Decision |
|---|---|---|---|---|
| [Ollama](https://github.com/ollama/ollama) official image [`ollama/ollama`](https://hub.docker.com/r/ollama/ollama) | tag `0.40.11` (2026-10-24); **MIT** | Self-hosted model server with an OpenAI-compatible `/v1/chat/completions` and `/v1/models` ([docs](https://docs.ollama.com/api/openai-compatibility)); data stays on SIM's machine; no per-token cost; needs ~8 GB RAM for a 7B Q4 model (CPU is slow) | Very active (several releases a week) | **Adopted as optional** compose service under profile `local-llm`, not started by default, internal network only, SIM-level only (merchants cannot choose it) |
| Qwen2.5 7B Instruct via `ollama pull qwen2.5:7b` | Apache-2.0; 4.7 GB Q4_K_M ([library](https://ollama.com/library/qwen2.5:7b)) | Multilingual (incl. Arabic, Portuguese, Chinese); 128K context | Qwen team | Default local model suggestion; `deepseek-r1:7b` distill as alternative (its `<think>` prefix is stripped) |
| Anthropic TypeScript SDK `@anthropic-ai/sdk` | MIT | Typed client with retries and structured-output helpers | Official, active | **Not used**: the integration needs one non-streaming request per task across three providers behind one contract; plain `fetch` (Node core) to `POST /v1/messages` with `output_config.format` json_schema keeps one code path, adds no dependency and is fully mockable. Revisit if batches or streaming are needed |
| OpenAI Node SDK `openai` | Apache-2.0 | Works against OpenAI, DeepSeek, DashScope compatible mode and Ollama via `baseURL` | Official, active | **Not used** for the same reason; plain `fetch` to `/chat/completions` (JSON mode, json_schema on OpenAI itself) |
| LiteLLM proxy / LangChain | MIT | Multi-provider gateway / framework | Active | Not adopted: an extra service or a large dependency for five fixed extraction tasks |
| Ajv JSON Schema validator | MIT | Full JSON Schema validation | Active | **Not used**: task schemas are fixed and small; `src/llm/jsonSchema.js` implements the needed subset (types, enum, required, additionalProperties:false, items, lengths, ranges) without a new dependency (package.json is outside this batch's scope). Switch to Ajv if schemas grow |
| `cheerio` (already a dependency) | MIT | Visible page text for the model (scripts, styles, hidden elements removed) | Active | **Reused** |

Integration boundary: `src/llm/` (adapters, switches, tasks T1-T5, validation, ledger, hooks, router), migration `075_llm_assist.sql` (append-only), keys via `src/credentials/` (provider `llm`), UI in `public/ui/v4/api-keys.js`, setup in `docs/llm/LOCAL_MODEL_SETUP.md`.

## Rules-only lead accuracy (plan batch 3 C1/C3–C8, 2026-10-29)

| Candidate | Source / license | Fit | Maintenance | Decision |
|---|---|---|---|---|
| Shopify Standard Product Taxonomy localizations (already imported, `rules/product-taxonomy/shopify/categories-subset.json`) | [Shopify/product-taxonomy](https://github.com/Shopify/product-taxonomy), MIT | Official es / pt names of the clothing, bags and home nodes become category evidence terms (C8); no new download | Official, monthly releases | **Reused** (`src/market/productProfiles.js`). The import has no Arabic locale; a short reviewed Arabic list is kept next to it until an `ar` file is imported with `scripts/import-product-taxonomy.mjs` |
| Hunter accept-all guidance ([email verification FAQ](https://help.hunter.io/en/articles/15899247-email-verification-faqs), [accept-all guide](https://hunter.io/email-verification-guide/accept-all-catch-all)) | Vendor documentation | Thresholds for catch-all addresses: verifier score ≥ 85 send, 80–84 human review, below 80 / unknown not sent (C7) | Vendor | **Adopted as policy** in `src/verification/contactVerificationPolicy.js`; only the Email Verifier score counts (Domain Search / Finder confidence is kept as `finder_confidence`) |
| `tldts` registrable-domain parsing (already used through `domainService.getRegistrableDomain`) | MIT | Company root domain vs. mailbox domain (C3) | Active | **Reused** via `extractRootDomain` |
| Free-mail provider lists (e.g. `free-email-domains`, `disposable-email-domains`) | MIT / CC0 | Full lists of thousands of providers | Active | **Not adopted**: only the main providers seen in MX, BR, Gulf and Asian SME mail matter; a 40-domain set avoids a new dependency. Revisit if webmail misclassification shows up |
| `libphonenumber-js` (already a dependency) | MIT | National number lengths for the new BR / AU / CA / SG market profiles | Active | **Reused** through `PhoneService` |
