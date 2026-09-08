# Phase13 Reuse Decision Register

## MC06 — 2026-09-08

Candidate: [B2B Buyer Discovery](https://github.com/Tommy-old/b2b-buyer-discovery). [MIT license](https://github.com/Tommy-old/b2b-buyer-discovery/blob/main/LICENSE). GitHub metadata checked on 2026-09-08: non-archived, latest push 2026-06-24. No upstream runtime dependency or copied provider client is introduced.

| Design | Decision | DPV adaptation |
| --- | --- | --- |
| Multi-keyword × multi-market | ADAPT | Frozen registry scope, multiple languages, explicit strategy identity and deterministic fingerprints |
| Domain exclusion | ADAPT | Three actions; social/directory hints retained, not automatically official evidence |
| Seen-count/corroboration | ADAPT | Replay-safe PostgreSQL provenance and distinct projections; never affects MC04 bands |
| Second-pass contact search | DEFER_TO_MC10 | No contact/provider invocation in MC06 |

Verified sources: [search implementation](https://github.com/Tommy-old/b2b-buyer-discovery/blob/main/src/skills/search/google.ts) and [lead persistence](https://github.com/Tommy-old/b2b-buyer-discovery/blob/main/src/skills/db/leads-db.ts). Upstream search combines keyword and market; persistence records repeated observations. DPV adapts those concepts, not its fixed market list, blanket social exclusions, scoring formula or Google/SerpAPI client.

Deployment: existing Node/Express/PostgreSQL/native V3 controls suffice. Privacy: local config/plans and existing candidate references stay within DPV; this adaptation sends no data upstream. Cost: no added service/package fee or search call. Maintenance: small versioned adapters and regression tests remain owned by DPV. Future changes require a new strategy/config version; no silent overwrite of an experiment's frozen plan.
