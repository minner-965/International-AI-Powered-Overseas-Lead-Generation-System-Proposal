# CL01 Text and Frontend Reachability Scan

Date: 2026-09-08
Scope: CL01 inventory only. No file, selector, renderer, route, asset, or business record was deleted or rewritten.

## Method and privacy boundary

The repeatable scanner is `scripts/cleanup-ui-inventory.mjs`. It reads only Git-tracked files, skips binary files, and writes the machine-readable result to ignored local evidence:

```text
test-artifacts/cleanup-cl01/ui-inventory.json
```

The JSON contains relative repository paths, line numbers, matched terms, frontend imports, asset references, view-to-renderer candidates, and API path literals. It does not include environment values, credentials, email addresses, or database/customer rows.

Command:

```text
node scripts/cleanup-ui-inventory.mjs
```

Observed scan boundary:

| Item | Count |
| --- | ---: |
| Git-tracked files | 818 |
| Tracked text files scanned | 788 |
| Frontend `public/` files | 51 |
| Frontend CSS/JS/HTML/font-image assets inventoried | 51 |
| Matched lines | 1,640 |
| Matched occurrences | 1,882 |

Counts are an inventory baseline, not a deletion decision. Vendored skill/reference material accounts for most `Resend` occurrences and is not served by the application.

## Classification result

| Classification | Occurrences | Meaning in CL01 |
| --- | ---: | --- |
| `CURRENT_VALID` | 898 | Required policy/allowlist or vendored reference text; not ordinary product copy |
| `HISTORICAL_ONLY` | 676 | Applied migrations, prior plans/results, or archived visual reference |
| `REMOVE_ACTIVE` | 57 | Hit is in an active/current surface and must be inspected in CL02/CL03/CL10; this is not deletion approval |
| `REVIEW` | 251 | Runtime, tests, scripts, config, or documentation where reachability/compatibility is not yet proven |
| `REMOVE_FILE` | 0 | No file met the CL01 proof threshold for removal |

All uncertain hits default to `REVIEW`. No candidate is classified for physical deletion solely from lexical matching.

## Term totals

| Term | Lines | Occurrences |
| --- | ---: | ---: |
| `Resend` | 781 | 950 |
| `procurement` | 412 | 442 |
| `AI` | 120 | 142 |
| `Gmail` | 108 | 119 |
| `buying evidence` | 56 | 56 |
| `supplier portal` | 46 | 48 |
| `vendor registration` | 37 | 40 |
| `PROSPECT_PILOT` | 21 | 22 |
| `phase13_search` | 15 | 16 |
| `smart` | 8 | 9 |
| `智能` | 7 | 9 |
| `PRODUCT_SCOPE_REQUIRED` | 9 | 9 |
| `manual-only` | 9 | 9 |
| `Start review` | 5 | 5 |
| `wand` | 3 | 3 |
| `sparkle` | 2 | 2 |
| `robot` | 1 | 1 |
| `intelligent` | 0 | 0 |

`Resend` is dominated by `.agents/vendor/resend-skills/`; those files are development references, not browser runtime assets. `AI` is concentrated in historical plans/builders and the archived Phase12 reference. Active ordinary UI still has legacy business-semantic strings, primarily procurement/supplier-route compatibility labels.

## Active/current hits requiring later work

The 57 `REMOVE_ACTIVE` occurrences are pre-classified for inspection, not automatic replacement. File concentration:

| File | Matched lines | Principal reason |
| --- | ---: | --- |
| `services/demo-dashboard/public/app.js` | 12 | Shared legacy procurement/supplier compatibility renderers and endpoint names |
| `services/demo-dashboard/public/opportunity-ui.js` | 10 | Legacy opportunity reason and route labels |
| `docs/CURRENT_PROJECT_STATUS.md` | 9 | Mixed current/historical state, including `phase13_search`, manual-only and older provider wording |
| `services/demo-dashboard/public/index.html` | 3 | Legacy procurement filter/section labels |
| `services/demo-dashboard/public/product-match-ui.js` | 3 | Buying/procurement compatibility labels |
| `docs/OPERATIONS_EXPAND_VERIFIED_COMPANY_POOL.md` | 2 | Current operations wording review |
| `services/demo-dashboard/public/ui/v3/companies.js` | 2 | Supplier portal/vendor registration compatibility labels |
| `services/demo-dashboard/public/ui/v3/overview.js` | 2 | Legacy procurement compatibility field reads |

Active/current occurrence composition:

| Term | Occurrences |
| --- | ---: |
| `procurement` | 31 |
| `supplier portal` | 8 |
| `vendor registration` | 6 |
| `buying evidence` | 5 |
| `manual-only` | 2 |
| `phase13_search` | 2 |
| `AI` | 1 |
| `Gmail` | 1 |
| `PROSPECT_PILOT` | 1 |

Several active JavaScript hits are internal field names or compatibility API paths rather than visible prose. CL03/CL09/CL10 must distinguish those cases before changing them. The scan intentionally does not infer that a source-code token is user-visible.

## Review hotspots

The largest non-historical, non-vendor review areas are:

- `services/demo-dashboard/src/server.js`: 32 matched lines, mainly current/compatibility route and service wiring.
- `docs/VERSION_CHANGELOG.md`: 32 matched lines; mixed operational and historical narrative requires CL14 classification.
- `services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js`: 11 matched lines.
- `services/demo-dashboard/src/enrichment/procurementExtractor.js`: 10 matched lines.
- `services/demo-dashboard/src/enrichment/EnrichmentService.js`: 9 matched lines.
- `services/demo-dashboard/src/categoryProcurement/CategoryProcurementService.js`: 9 matched lines.
- `services/demo-dashboard/src/research/ResearchWorkbenchService.js`: 8 matched lines.
- `services/demo-dashboard/src/outreach/providers.js`: 7 matched lines.
- `services/demo-dashboard/src/autoEvidence/AutoEvidenceOrchestrator.js`: 7 matched lines.

These remain `REVIEW` because CL01 does not prove producer/consumer removal, route retirement, database compatibility, or historical-audit independence.

## Frontend view → renderer → API inventory

The machine inventory records every observed API literal in each renderer source. Because `public/app.js` is a shared entrypoint, its API list is deliberately marked as a renderer-file candidate set rather than an assertion that every call runs on every view.

| View | Primary renderer(s) | Principal API families |
| --- | --- | --- |
| Overview | `app.js`, `ui/v3/overview.js`, `ui/outreach-workbench.js`, `ui/v3/automation-control.js` | metrics, opportunities, outreach summary/workbench, research summary/jobs, automation control/status |
| Opportunities | `app.js`, `ui/opportunity-workspace.js`, `ui/v3/opportunity-dimensions.js` | opportunities, company fit/detail, outreach status |
| Research | `ui/phase9-research-workbench.js`, `ui/v3/research-batch.js`, automation control | research summary/tasks/jobs, batch options/preview/create, provider status |
| Jobs | `ui/phase9-research-workbench.js`, `ui/v3/research-jobs.js`, `ui/v3/research-batch.js` | research jobs/results/batches, outreach job records, automation status |
| Companies | `app.js`, `ui/v3/companies.js` | leads, company detail, opportunities, contact state |
| Company Detail | `app.js`, `phase7-ui.js`, `ui/v3/companies.js` | company/category/contact/evidence/history/outreach detail |
| Contact-ready | `ui/v3/companies.js`, `ui/contact-queue.js` | workspace contact queue, leads, current opportunities |
| Email Queue | `ui/outreach-workbench.js`, `ui/contact-queue.js`, automation control | workbench, drafts, approvals, enqueue/retry, operations summary |
| Replies | `ui/v3/replies.js` | outreach inbox and workbench |
| Evidence | `ui/v3/records.js` | leads and source-detail payload |
| Customer Match | `app.js`, `ui/v3/records.js` | ICP profiles, company fit/history |
| Import | `app.js`, `phase7-ui.js`, `ui/v3/records.js` | import templates/dry-run/approval/commit |
| Export | `app.js`, `phase7-ui.js`, `ui/v3/records.js` | export create/status/download |
| Settings / Search Operations | research workbench, controlled-email verification, records, automation control | automation control/status, provider refresh, controlled-test compatibility endpoints |

## CSS/JS/assets reference graph

- `index.html` contains 35 direct resource URIs: 1 inline data favicon, 23 stylesheets, and 11 module/classic scripts. This is a reachability count, not a network-request measurement.
- The scanner identified 51 tracked frontend CSS/JS/HTML/font-image assets.
- All 51 have at least one direct entrypoint or tracked source/test reference under the conservative literal/import scan.
- No asset is classified `REMOVE_FILE` in CL01.
- Directly loaded legacy-named styles (`phase5.css`, `phase7.css`, `ui/phase8-*.css`, `ui/phase9-research-workbench.css`, `ui/phase10-workbench.css`) are `REVIEW`, not deletion candidates, because the current HTML still loads them and runtime-generated selectors may depend on them.
- The archived visual reference remains `HISTORICAL_ONLY`; its removal requires neutral-reference replacement and zero visual-test dependency proof in CL11.

The complete import edges, direct resource list, per-asset reference counts, renderer candidates, and API literals are in the ignored machine inventory.

## CL01 conclusion

CL01 found active copy/current-state cleanup work, but did not prove any file safe to delete. Result:

```text
files deleted: 0
business behavior changed: 0
API calls made: 0
provider calls: 0
Hunter calls: 0
SMTP sends: 0
```

Proceed by classification in later authorized work packages. Do not treat the `REMOVE_ACTIVE` label as permission to rename internal compatibility fields, remove endpoints, or rewrite historical values without the relevant reachability and regression proof.
