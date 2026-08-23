# Security and Data Handling

## Repository policy

This repository may contain company planning materials but must not contain operational secrets or unapproved personal/customer data.

Do not commit:

- Completed `.env` files
- API keys, access tokens or private keys
- n8n credential exports or encryption keys
- Email, CRM or database passwords
- Real customer lists, CRM exports or order-level personal data
- Unapproved contact lists or scraped personal profiles
- Database backups and runtime volumes

## Before every push

1. Review `git status` and `git diff --cached`.
2. Search staged text files for secrets.
3. Confirm that new data files are de-identified and approved.
4. Confirm that document metadata does not expose personal author information when external distribution requires anonymization.

## Incident response

If a secret is committed, immediately rotate the secret, stop affected workflows, remove the value from repository history and document the incident through the company's security process.

