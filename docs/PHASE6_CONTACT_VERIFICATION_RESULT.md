# Phase 6 Contact Verification Result

## Status

**PASS — public business contact routes are retained with conservative, explicit verification meanings.**

This report uses the final acceptance job `d86975c4-5815-4a43-a375-9ebd1adb178b` only. Earlier validation runs remain in job history but do not contribute to these counts.

## Actual contact-route distribution

| Contact type | Verification state | Count |
| --- | --- | ---: |
| BUSINESS_EMAIL | NOT_VERIFIED | 4 |
| GENERIC_BUSINESS_EMAIL | NOT_VERIFIED | 5 |
| BUSINESS_PHONE | FORMAT_VALID | 5 |
| BUSINESS_WHATSAPP | BUSINESS_WHATSAPP_OBSERVED | 5 |
| CONTACT_FORM | PUBLICLY_OBSERVED | 14 |
| DEPARTMENT_EMAIL | — | 0 |
| SUPPLIER_PORTAL | — | 0 |
| VENDOR_REGISTRATION | — | 0 |
| Total |  | 33 |

```text
VALID email: 0
ACCEPT_ALL email: 0
UNKNOWN email: 0
NOT_VERIFIED email: 9
```

`NOT_VERIFIED` is a stored verification state, not part of an email address. The management UI presents it as a separate equal-size bilingual badge. An observed address is not described as deliverable unless an independent verifier returns the corresponding result.

## Meaning of each state

- `NOT_VERIFIED`: publicly observed email; mailbox deliverability was not tested.
- `FORMAT_VALID`: the public phone number can be normalized for its market; reachability is not claimed.
- `BUSINESS_WHATSAPP_OBSERVED`: an explicit public WhatsApp business route was observed; message delivery is not claimed.
- `PUBLICLY_OBSERVED`: the company published the contact form; no form was submitted.
- `VALID`: reserved for a stronger provider verification result; none occurred in the final run.
- `ACCEPT_ALL`: intentionally distinct from `VALID`; none occurred in the final run.

## Route-quality controls

```text
maximum routes for one company: 9
companies above 12-route cap: 0
maximum distinct phone/WhatsApp numbers for one company: 3
companies above 3-number cap: 0
guessed personal emails marked verified: 0
private personal phone numbers collected: 0
```

The extractor prioritizes explicit `mailto:`, `tel:`, WhatsApp links, labelled public numbers, structured Organization data and public company contact forms. It rejects image filenames, examples, dates, CSS fragments and unlabelled high-volume phone directories.

## Hunter

Hunter remained disabled because the final accepted set had no independently supported named person and no configured acceptance need justified spending credits.

```text
calls: 0
usage events: 0
reserved credits: 0
used credits: 0
```

The adapter supports Domain Search, Email Finder and Email Verifier behind backend-only configuration, transactional credit reservation and idempotent request fingerprints. The system continues with public sources when Hunter is disabled. Hunter documents that Domain Search, Email Finder and Email Verifier have different credit rules; the Phase 6 adapter keeps those results separate and never promotes `ACCEPT_ALL` to `VALID`: [Hunter API](https://help.hunter.io/en/articles/1970956-hunter-api).

## LinkedIn

```text
mode: SEARCH_DISCOVERY_ONLY
public references: 33
references in REVIEW: 33
DISCOVERY_HINT: 33
content_fetched: 0
```

No login, session reuse, member-page request, search-result-page request or LinkedIn HTML parsing exists in the adapter. This matches LinkedIn's published requirement for express permission before automated crawling: [LinkedIn Crawling Terms](https://www.linkedin.com/legal/crawling-terms). The separate `OFFICIAL_API` gate remains disabled unless the required access and credentials are configured under LinkedIn's [API Terms](https://www.linkedin.com/legal/l/api-terms-of-use).

## Privacy and output

Public APIs return normalized public-business fields and clickable evidence URLs. They do not expose source hashes, provider request fingerprints, original shared-folder paths, raw OKKI contact rows, API keys or private activity bodies. No raw business dataset is committed to Git.
