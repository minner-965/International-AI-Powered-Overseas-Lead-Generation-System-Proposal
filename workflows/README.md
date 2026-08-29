# n8n workflow exports

Store reviewed n8n workflow JSON exports in this directory. Never include n8n
credential exports or secret values.

The workflow remains no-send and now performs the Phase 4 management pipeline:

1. accept country code/name plus optional city/region and preferred language;
2. generate five market-aware balanced queries;
3. execute bounded Tavily Basic discovery and public contact checks;
4. resolve company identity and official websites;
5. persist structured business, size and accessibility evidence;
6. retain SME/regional opportunities and strategic accounts;
7. promote only verified, traceable, non-duplicate businesses.

`01-two-week-demo.json` is the credential-free workflow export. Secrets remain
in n8n environment variables. It contains no email, WhatsApp or other outreach
node.

Research candidates remain job-scoped. Promotion uses `data_origin =
live_discovered` with a valid `research_job_id`; source URLs, capture times and
existing historical records are retained.
