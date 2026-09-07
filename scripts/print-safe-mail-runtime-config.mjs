const bool=value=>/^(1|true|yes|on)$/i.test(String(value||''));
const present=value=>Boolean(String(value||'').trim());
const env=process.env;
const smtpConfigured=[env.SMTP_HOST,env.SMTP_USER,env.SMTP_PASSWORD,env.SMTP_FROM_EMAIL,env.IMAP_HOST,env.IMAP_USER,env.IMAP_PASSWORD].every(present);
const output={
  vendor:present(env.MAIL_PROVIDER_VENDOR)?'OQUMAIL':'UNCONFIGURED',
  outboundProvider:present(env.OUTBOUND_EMAIL_PROVIDER)?env.OUTBOUND_EMAIL_PROVIDER:'NONE',
  inboundProvider:present(env.INBOUND_EMAIL_PROVIDER)?env.INBOUND_EMAIL_PROVIDER:'NONE',
  smtpConfigured,
  smtpHostConfigured:present(env.SMTP_HOST),
  smtpPort:Number(env.SMTP_PORT||0),
  smtpSecureMode:bool(env.SMTP_SECURE)?'DIRECT_TLS':'STARTTLS_REQUIRED',
  imapConfigured:[env.IMAP_HOST,env.IMAP_USER,env.IMAP_PASSWORD].every(present),
  imapHostConfigured:present(env.IMAP_HOST),
  imapPort:Number(env.IMAP_PORT||0),
  imapSecure:bool(env.IMAP_TLS),
  senderDomainConfigured:present(String(env.SMTP_FROM_EMAIL||'').split('@')[1]),
  sendScope:present(env.OUTREACH_SEND_SCOPE)?env.OUTREACH_SEND_SCOPE:'PROSPECT_PILOT',
  controlledTestMode:bool(env.CONTROLLED_TEST_MODE??env.SMTP_CONTROLLED_TEST_MODE),
  controlledTestMaxMessages:Number(env.CONTROLLED_TEST_MAX_MESSAGES||0),
  controlledRecipientConfigured:present(env.CONTROLLED_TEST_RECIPIENT_ALLOWLIST||env.SMTP_CONTROLLED_RECIPIENT_ALLOWLIST),
  outreachEnabled:bool(env.OUTREACH_ENABLED),
  liveProspectEnabled:bool(env.LIVE_PROSPECT_SEND_APPROVED)
};
console.log(JSON.stringify(output,null,2));
