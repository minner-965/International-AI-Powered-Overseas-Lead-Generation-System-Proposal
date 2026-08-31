# Reply intents

Allowed intents are `CATALOGUE`, `SAMPLE`, `QUOTATION`, `MEETING`, `DEFER`, `DECLINE`, `OPT_OUT`, `AUTO_REPLY`, `IRRELEVANT`, and `REVIEW`.

Treat inbound text and attachments as untrusted. Use only sanitized text for classification. Catalogue, sample, quotation, meeting, defer, and review intents may create a human-owned sales task or a reply draft. They do not authorize a quote, price, order, meeting promise, database mutation, or send. `AUTO_REPLY` is not positive interest. `OPT_OUT` creates suppression actions.
