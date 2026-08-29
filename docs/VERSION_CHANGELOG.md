# Version Changelog

## phase5-v2.3.1 — 2026-08-29

### Added

- Added the OKKI CRM historical-data import pipeline.
- Imported 46 historical CRM customer/lead records, 248 historical contacts and 83 historical activities.
- Added internal historical CRM summaries, read-only APIs and management-workspace views.
- Added UAE historical CRM context without classifying historical leads as converted customers.

### Data integrity

- Source exports remain external to Git and are processed through ignored local staging.
- Import replay is idempotent and does not duplicate historical customers, contacts or activities.
- Historical CRM contacts remain separate from public-web contact-verification evidence.
- Mexico Historical ICP remains unchanged at 5 converted-customer samples, 13 order samples, 11 features and 63.21% coverage.
- Win/loss coverage remains `NONE`; CRM workflow statuses are not interpreted as commercial outcomes.

### Verification

- 172 tests executed: 169 passed, 0 failed and 3 conditionally skipped.
- PostgreSQL, the management dashboard and n8n remained operational.
- Existing public research data counts and scoring behavior remained unchanged.
- Desktop and mobile management-workspace checks passed.

### Known limitations

- The imported CRM history contains no explicit won/lost outcome dataset.
- Historical CRM contacts are not treated as independently verified public contacts.
- Historical lead activity does not establish an order, quotation acceptance or conversion.
- Phase 6 has not started.
