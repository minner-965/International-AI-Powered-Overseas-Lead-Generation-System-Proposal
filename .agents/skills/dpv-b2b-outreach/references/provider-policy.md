# Provider policy

The default outbound provider is `NONE`. This skill never calls a Provider.

Resend is restricted to the configured `OPT_IN`, `TRANSACTIONAL`, or `TRANSACTIONAL_RELATIONSHIP` use case. `TRANSACTIONAL_RELATIONSHIP` may be used only for `TRANSACTIONAL` mail. `COLD_OUTREACH` or any recipient without `EXPLICIT_OPT_IN` must produce `PROVIDER_PURPOSE_NOT_ALLOWED` before a network call. SMTP or another provider requires its own approved purpose-policy adapter.

An approved exact message still requires the application to recheck kill switches, suppression, readiness, mailbox freshness, exact approval digest, purpose, and rate caps immediately before sending.

Inbound webhook handling must verify the raw request body plus `svix-id`, `svix-timestamp`, and `svix-signature` before any business event is created. Invalid signatures create no business event.
