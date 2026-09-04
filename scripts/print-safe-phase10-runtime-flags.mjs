const enabled = value => String(value ?? '').trim().toLowerCase() === 'true';

const safeFlags = {
  AUTO_EVIDENCE_ENABLED: enabled(process.env.AUTO_EVIDENCE_ENABLED),
  AUTO_EVIDENCE_RECONCILE_MINUTES: Number(process.env.AUTO_EVIDENCE_RECONCILE_MINUTES || 30),
  RESEARCH_DIRECT_QUEUE_DISPATCH: enabled(process.env.RESEARCH_DIRECT_QUEUE_DISPATCH),
  OUTBOUND_EMAIL_PROVIDER: String(process.env.OUTBOUND_EMAIL_PROVIDER || 'NONE').toUpperCase(),
  GMAIL_API_ENABLED: enabled(process.env.GMAIL_API_ENABLED),
  GMAIL_INBOUND_SYNC_ENABLED: enabled(process.env.GMAIL_INBOUND_SYNC_ENABLED),
  OUTREACH_ENABLED: enabled(process.env.OUTREACH_ENABLED),
  LIVE_PROSPECT_SEND_APPROVED: enabled(process.env.LIVE_PROSPECT_SEND_APPROVED),
  RESEND_USE_CASE: String(process.env.RESEND_USE_CASE || 'DISABLED').toUpperCase()
};

process.stdout.write(`${JSON.stringify(safeFlags, null, 2)}\n`);
