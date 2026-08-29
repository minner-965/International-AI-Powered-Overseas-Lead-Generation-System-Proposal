# Phase 5 Reuse-First Utility Retrofit

Date: 2026-08-28
Scope: Phase 1–4 domain, phone, email and HTML utility retrofit only

## Result

The search, contact and company-verification paths now call DPV-owned adapters around pinned, maintained libraries. Existing public function signatures remain in place, so callers and persisted status meanings do not change.

| Component | Previous implementation | Reused module | Version | License | Adapter |
| --- | --- | --- | --- | --- | --- |
| URL and registrable domain | `URL` plus manual suffix-label rules | `tldts` | 7.4.11 | MIT | `src/platform/DomainService.js` |
| Phone parsing and validation | digit, calling-code and length rules | `libphonenumber-js` | 1.13.12 | MIT | `src/platform/PhoneService.js` |
| Email syntax | project regular expression | `validator` | 13.15.35 | MIT | `src/platform/EmailService.js` |
| HTML parsing | direct Cheerio imports in several domain modules | `cheerio` | 1.2.0 | MIT | `src/platform/HtmlService.js` |

Versions above were read from the installed package metadata and match the exact versions pinned by `services/demo-dashboard/package.json`.

## Integration boundaries

### DomainService

Provides:

- `normalizeUrl(value)`
- `getHostname(value)`
- `getRegistrableDomain(value)`

`search/resultNormalizer.js` remains the compatibility facade for existing imports. URL normalization still:

- accepts HTTP and HTTPS only;
- canonicalizes the scheme to HTTPS;
- lowercases the hostname and removes the leading `www.`;
- removes the fragment;
- removes `utm_*`, `fbclid`, `gclid`, `dclid`, `msclkid`, `mc_cid` and `mc_eid`;
- sorts retained query parameters;
- removes duplicate/trailing path separators.

The registrable domain now comes from the Public Suffix List maintained by `tldts`. Tests cover `.com.bd`, `.co.uk` and `.ae`.

### PhoneService

The adapter accepts the observed phone text plus the active market context. Its native result contains:

- `raw_value`;
- `normalized_e164`, nullable;
- `country`, nullable;
- `is_possible`;
- `is_valid`;
- `normalization_status` and `normalization_certainty`.

`contact/phoneUtils.js` retains the Phase 4 compatibility fields used by persistence code:

- `normalized_value`;
- `normalization_status`;
- `normalization_certainty`;
- `country_code`.

AE and BD local numbers are converted only when the corresponding market profile supplies the country, calling code, national prefix and expected national length. A GENERIC/unknown-market local number remains `AMBIGUOUS_LOCAL`; `normalized_e164` is `null`, and the observed text is retained in `contact_value`.

### EmailService

`validator.isEmail` now performs syntax validation. The existing DNS MX lookup and status meanings are unchanged:

- syntax invalid: `INVALID`;
- syntax valid and MX present: `DOMAIN_MX_VERIFIED`;
- syntax valid without an MX result: `PUBLICLY_OBSERVED`.

An MX result is domain-level evidence only. The implementation does not label an address deliverable and does not send a test message.

The exact observed email text is retained in `contact_value`; the lowercase comparison form is stored in `normalized_value`. The prior code lowercased both values.

### HtmlService

Contact, page-discovery and verification modules now obtain the Cheerio document through `HtmlService`. Existing bounded fetching, robots policy, timeouts, page limits and source audit fields are untouched.

Cheerio remains responsible for structured extraction of:

- `mailto:` and `tel:` anchors;
- contact forms;
- same-site navigation links;
- business social anchors;
- JSON-LD `sameAs` accounts;
- title, meta and evidence-page content.

## Behavior comparison

| Case | Previous result | New result | Compatibility decision |
| --- | --- | --- | --- |
| URL tracking parameters | removed and remaining parameters sorted | same | exact comparison test |
| `.com.bd`, `.co.uk`, `.ae` roots | correct for the existing hand-written cases | same, now Public-Suffix-List based | existing outputs preserved |
| AE `050 123 4567` | `+971501234567` | same, with possible/valid metadata | preserved |
| BD `01712 345678` | `+8801712345678` | same, with possible/valid metadata | preserved |
| GENERIC `01712 345678` | ambiguous digit form | same compatibility value; E.164 remains null | preserved without inferring a country |
| ordinary business email | regex-valid | validator-valid | exact comparison test |
| consecutive-dot local part | accepted by the old regex | rejected by validator | intentional correctness fix |
| MX present/absent/unavailable | Phase 4 statuses | same | preserved |
| observed email casing | lowercased in both fields | raw in `contact_value`, lowercase in `normalized_value` | intentional audit improvement |
| contact/social HTML | Cheerio extraction | same Cheerio extraction through adapter | extraction fixture test |

## Phase 4 evidence-density repair

### Read-only baseline

The latest completed five-candidate acceptance job was inspected without changing its rows:

```text
job_id: 3159d58d-1fae-4f29-86d5-b3d339fb9f46
verified: 3
review: 2
```

Evidence distribution at inspection time:

| Candidate | Reachable | Status | Evidence rows |
| --- | --- | --- | ---: |
| Rizqé Dubai | yes | VERIFIED_BUSINESS | 134 |
| ELK Fashion Dubai | yes | VERIFIED_BUSINESS | 104 |
| Apparel Group | yes | VERIFIED_BUSINESS | 83 |
| Fashion houses Distributors in Dubaï - Kompass | no | REVIEW | 0 |
| Merchant Listing | no | REVIEW | 0 |

The two zero-evidence candidates were unreachable. This repair does not create evidence from their search-result titles and does not change them automatically. They remain `REVIEW` unless a future bounded rerun reaches an explicit company source.

### Safe acquisition improvements

The following evidence acquisition was added without changing confidence thresholds or qualification rules:

- parse JSON-LD `Organization`, `Corporation`, `LocalBusiness`, `Store` and `ProfessionalService` nodes;
- capture structured business email, telephone and `ContactPoint` values while excluding `Person` nodes;
- capture target-market-matching `PostalAddress` and `areaServed` values as location evidence;
- capture explicit `description`, `slogan`, `knowsAbout` and `numberOfEmployees` fields;
- use explicit JSON-LD business URLs from directory profiles as outbound company-site candidates;
- decode explicit directory outbound redirect parameters when they contain an external HTTP(S) company URL;
- recognize generic directory/listing result titles before treating page contacts as company contacts;
- prioritize same-site Contact, About, Distribution, Brands, Products and Locations links from anchors and JSON-LD;
- follow the first bounded HTTP redirect as the effective official-site URL/root while continuing to enforce same-site page traversal.

Structured business-activity evidence receives the same confidence assigned to the equivalent explicit page phrase. A wholesaler/importer/distributor does not become VERIFIED from a generic organization description. Structured location evidence is emitted only when the address/served area matches the active job country, city, region or MarketProfile terms. Employee-size evidence is emitted only when `numberOfEmployees` contains a numeric value or range.

No threshold, scoring dimension, promotion rule, page limit, robots rule, timeout or search budget changed.

### Repair tests

`test/reuseEvidenceRepair.test.js` covers:

- Organization versus Person structured-contact isolation;
- raw and normalized structured contacts;
- JSON-LD address, explicit wholesale activity and employee range;
- exact external business URL resolution from a directory profile;
- rejection of a Person-only external profile URL;
- explicit outbound redirect decoding;
- bounded semantic same-site page selection.

The repair improves evidence availability when the source publishes suitable information. It does not guarantee the Phase 4 density gate for sources that remain unreachable or do not identify an underlying business.

### Final Phase 4 repair rerun

The same five-candidate job was reverified after the safe acquisition changes. No acceptance threshold or verification rule was weakened.

```text
job_id: 3159d58d-1fae-4f29-86d5-b3d339fb9f46
status: COMPLETED
candidates: 5
verified: 3
review: 2
rejected: 0
companies promoted new: 2
companies enriched existing: 1
```

Final evidence distribution:

| Candidate | Status | Size | Evidence rows | Public business social accounts |
| --- | --- | --- | ---: | ---: |
| APPAREL GROUP | VERIFIED_BUSINESS | MICRO | 91 | 11 |
| ELK Fashion Dubai | VERIFIED_BUSINESS | LARGE | 168 | 1 |
| Rizqé | VERIFIED_BUSINESS | UNKNOWN | 37 | 3 |
| Fashion houses Distributors in Dubaï - Kompass | REVIEW | UNKNOWN | 0 | 0 |
| Merchant Listing | REVIEW | UNKNOWN | 0 | 0 |

The final gate result is:

```text
useful verification evidence: 3/5 (target 4/5)
target-business VERIFIED/SUPPORTED: 3/5 (target 3/5)
evidence-backed non-UNKNOWN size: 2/5 (target 2/5 when supported)
```

The target-business and size targets are closed. The useful-evidence target remains open because the Kompass aggregate result and Merchant Listing page did not expose a reachable explicit company source. Both remain `REVIEW` with zero evidence rather than being promoted from search-result wording.

A related company-name repair rejects stylesheet selector fragments such as `-wrapper a,` and prefers an explicit brand segment from the page title. The final five verification rows contain no such invalid resolved company name.

## Files changed

New adapters:

- `services/demo-dashboard/src/platform/DomainService.js`
- `services/demo-dashboard/src/platform/PhoneService.js`
- `services/demo-dashboard/src/platform/EmailService.js`
- `services/demo-dashboard/src/platform/HtmlService.js`

Compatibility cutover:

- `services/demo-dashboard/src/search/resultNormalizer.js`
- `services/demo-dashboard/src/contact/phoneUtils.js`
- `services/demo-dashboard/src/contact/emailVerifier.js`
- `services/demo-dashboard/src/contact/ContactExtractor.js`
- `services/demo-dashboard/src/contact/pageDiscovery.js`
- `services/demo-dashboard/src/contact/researchContactService.js`
- `services/demo-dashboard/src/verification/verificationRules.js`
- `services/demo-dashboard/src/verification/companyVerificationService.js`

Tests:

- `services/demo-dashboard/test/reuseAdapters.test.js`
- `services/demo-dashboard/test/reuseEvidenceRepair.test.js`

No server route, database migration, workflow, scoring, matching or frontend file is part of this retrofit.

## Tests

Focused adapter and integration command:

```text
node --test test/reuseAdapters.test.js test/contact.test.js test/search.test.js test/multiMarket.test.js test/verification.test.js
```

The reusable-adapter suite contains old/new comparison fixtures and covers:

- tracking-parameter URL normalization;
- `.com.bd`, `.co.uk` and `.ae` registrable domains;
- AE, BD and ambiguous-market phones;
- raw versus normalized contact values;
- validator syntax behavior and existing MX semantics;
- Cheerio anchor, form and JSON-LD social extraction.

## Rollback

The cutover is isolated behind the existing compatibility facades. A rollback does not require database or API changes:

1. restore the previous implementations of `search/resultNormalizer.js`, `contact/phoneUtils.js` and `contact/emailVerifier.js`;
2. restore direct Cheerio imports in the four HTML-consuming modules;
3. remove the four `src/platform` adapters;
4. run the focused command above and then `npm test`;
5. leave stored contact rows unchanged—the retrofit introduces no schema migration or bulk rewrite.

The old comparison functions retained in `reuseAdapters.test.js` provide executable reference behavior for URL and email rollback checks. Git history should be used as the source for the complete previous phone implementation.

For an evidence-repair-only rollback, restore the previous versions of `HtmlService.js`, `ContactExtractor.js`, `pageDiscovery.js`, `researchContactService.js`, `verificationRules.js` and `companyVerificationService.js`, then remove `reuseEvidenceRepair.test.js`. No stored evidence should be deleted as part of code rollback; a later explicitly requested verification rerun can replace a candidate's evidence through the existing transaction.

Final full dashboard test result:

```text
tests 102
pass 100
fail 0
skipped 2
```
