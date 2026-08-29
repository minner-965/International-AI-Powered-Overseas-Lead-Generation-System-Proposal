# Acceptance tests

Initial acceptance checks should cover source traceability, normalized-domain
deduplication, explicit qualification reasons, contact-verification status,
pending human approval, and disabled outbound sending.

Run `node tests/live_acceptance.mjs` to perform a new network collection and
validate that records come from multiple real public providers, contain live
source URLs and capture timestamps, preserve accumulated real records, and never
enable outbound sending.
