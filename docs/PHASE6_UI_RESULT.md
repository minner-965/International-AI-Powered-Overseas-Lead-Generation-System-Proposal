# Phase 6 Management UI Result

## Status

**PASS — Phase 6 is integrated into the existing bilingual CRM workspace on desktop and mobile.**

## Implemented management workflow

The existing Opportunities view now includes:

- Cooperation Feasibility, Opportunity Matrix, supplier-access, barrier and readiness fields.
- Market, product, readiness, feasibility, matrix, role, contact, verification, history, match and tier filters.
- Default access-first sorting without replacing Management Match, Mexico Historical Match or DPV Score.
- A management-triggered `Update Buying Contacts` action that creates an Express ResearchJob and shows persisted progress.
- A reusable company-detail window with Buying Contacts and Cooperation Feasibility tabs.
- Clickable public evidence and separate verification labels.

The job button remains disabled throughout `QUEUED`, discovery, resolution, verification and persistence, then returns to its normal state only after `COMPLETE`, `PARTIAL` or `FAILED`. A transient status-reading error keeps the button disabled and retries with a bounded exponential delay, preventing an accidental duplicate job while the persisted state is uncertain.

## Bilingual and company-facing copy

- Chinese appears above English using the shared `.bi` component.
- Both language lines use the same font size and weight.
- System-only role/reason codes are translated into management wording.
- Raw rule versions, hashes, internal eligibility enums and shared-folder details are not shown in ordinary company detail.
- `Corporate Contact Route` is shown once as `企业联系路径 / Corporate contact route`, not as a fabricated buyer name.
- Bangladesh remains absent from the visible market controls.

The company-facing wording audit found no prohibited prototype claims, collection jargon or internal system prose in the rendered Opportunities view.

## Desktop browser checks

Tested at 1440 × 900:

```text
opportunity rows: 7
AE/MX data: PASS
MX filter: 1 row
clear filters: returns 7 rows
company-detail tabs: PASS
evidence links: PASS
Escape dismissal: PASS
focus restoration: PASS
body horizontal overflow: none
light theme: PASS
dark theme: PASS
```

The company-detail window is content-sized, has both Back and Close actions, stays within the viewport, scrolls internally when needed and restores focus to the original row action.

## Mobile and responsive checks

The Opportunities table becomes a four-field 2 × 2 card grid at 560px and below:

```text
Company
Market / Product
Cooperation Feasibility
Readiness
```

Each card keeps a visible bilingual `View prospect` action. Cooperation Feasibility and Readiness retain explicit bilingual field labels rather than relying on position alone. Empty and error states span the complete card width.

Long buyer, route, barrier and scoring detail remains in the detail window. Tested viewports:

| Viewport | Result |
| --- | --- |
| 375 × 667 | PASS; four-field card, no page overflow |
| 390 × 844 | PASS; four-field card, internal detail scrolling |
| 768 × 900 | PASS; no page overflow |
| 844 × 390 | PASS; wide table scrolls inside its container |
| 1024 × 768 | PASS; no page overflow |
| 1440 × 900 | PASS; full desktop table |

The viewport keeps native browser zoom enabled. Compact tables use component-level scrolling; the document body does not force horizontal scrolling.

## Visual system

Phase 6 reuses the existing womenswear/export CRM palette, Tabler shell, semantic status tokens, equal bilingual typography, compact density and accessible focus states. It adds no separate visual language. Future functions can extend the same semantic components and responsive rules.

## Data and API boundary

The browser calls Express only. The rendered Opportunities view contains 7 current Phase 6 results, while long evidence, contacts and feasibility dimensions are loaded into the detail window. API response checks found no evidence hashes or provider request fingerprints in the enrichment result contract.
