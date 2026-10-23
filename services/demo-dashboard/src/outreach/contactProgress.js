// Presentation facts only. Never transfers approval between immutable snapshots.
export function projectContactProgress(row, history = [], companySuppressed = false) {
  const profile = row.product_profile;
  const same = history.filter(item => item.product_profile === profile);
  const candidates = same.length ? same : history;
  const latest = [...candidates].sort((a,b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at))[0];
  const latestSent = [...candidates].filter(item=>item.sent_at).sort((a,b)=>new Date(b.sent_at)-new Date(a.sent_at))[0];
  const meaningfulReply = [...candidates].filter(item=>['OPT_OUT','HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE'].includes(item.reply_category))
    .sort((a,b)=>new Date(b.reply_received_at || b.sent_at)-new Date(a.reply_received_at || a.sent_at))[0];
  const accepted = history.some(item => item.sent_at || item.transport_status === 'SMTP_ACCEPTED');
  let status = 'NOT_CONTACTED';
  if (latest) {
    if (latest.reply_category === 'OPT_OUT' || latest.business_contact_status === 'OPTED_OUT') status = 'OPTED_OUT';
    else if (latest.send_status === 'HARD_BOUNCED' || latest.business_contact_status === 'BOUNCED') status = 'BOUNCED';
    else if (['HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE'].includes(latest.reply_category) || latest.business_contact_status === 'REPLIED') status = 'REPLIED';
    else if (latest.sent_at || latest.transport_status === 'SMTP_ACCEPTED') status = 'SENT_NO_REPLY';
    else if (latest.send_status === 'AMBIGUOUS') status = 'SEND_AMBIGUOUS';
  }
  if (meaningfulReply) status=meaningfulReply.reply_category==='OPT_OUT'?'OPTED_OUT':'REPLIED';
  if (companySuppressed) status = companySuppressed === 'OPT_OUT' ? 'OPTED_OUT' : 'DO_NOT_CONTACT';
  return {...row,contact_progress_status:status,has_prior_company_contact:accepted,
    first_contact_pending:!companySuppressed && !accepted && status === 'NOT_CONTACTED',
    last_contact_at:latestSent?.sent_at || null,
    contact_progress_transport_status:latestSent?.transport_status || latest?.transport_status || 'NOT_ATTEMPTED',
    contact_progress_receipt_evidence_status:latestSent?.receipt_evidence_status || 'UNCONFIRMED',
    contact_progress_reply_status:meaningfulReply?.reply_category || latest?.reply_category || (latestSent?'NO_REPLY_YET':'NOT_SENT')};
}

export async function attachContactProgress(pool, rows) {
  const ids = [...new Set(rows.map(row => row.company_id || row.id).filter(Boolean))];
  if (!ids.length) return rows;
  const history = await pool.query(`SELECT m.company_id,m.send_status,m.transport_status,
    CASE WHEN crm.funnel_status IN('OPTED_OUT','BOUNCED','REPLIED') THEN crm.funnel_status ELSE m.business_contact_status END business_contact_status,
    m.sent_at,m.queued_at created_at,m.receipt_evidence_status,
    s.product_profile,reply.reply_category,reply.received_at reply_received_at
    FROM leadgen.outbound_messages m
    JOIN leadgen.outreach_approvals a ON a.id=m.approval_id
    JOIN leadgen.business_opportunity_decision_snapshots s ON s.id=a.opportunity_snapshot_id
    LEFT JOIN leadgen.opportunity_crm_states crm ON crm.opportunity_snapshot_id=a.opportunity_snapshot_id AND crm.merchant_id IS NULL
    LEFT JOIN LATERAL(SELECT rc.reply_category,i.received_at FROM leadgen.inbound_messages i
      JOIN LATERAL(SELECT classification.reply_category FROM leadgen.reply_classifications classification
        WHERE classification.inbound_message_id=i.id ORDER BY classification.created_at DESC,classification.id DESC LIMIT 1)rc ON true
      WHERE i.correlation_outbound_message_id=m.id AND i.correlation_status='MATCHED'
      ORDER BY CASE WHEN rc.reply_category='OPT_OUT' THEN 0
        WHEN rc.reply_category IN('HUMAN_POSITIVE','HUMAN_NEUTRAL','HUMAN_NEGATIVE') THEN 1 ELSE 2 END,
        i.received_at DESC,i.id DESC LIMIT 1)reply ON true
    WHERE m.company_id=ANY($1::uuid[]) AND (m.sent_at IS NOT NULL OR m.transport_status='SMTP_ACCEPTED' OR m.send_status='AMBIGUOUS')`,[ids]);
  const suppressed = await pool.query("SELECT company_id,CASE WHEN bool_or(suppression_type='OPT_OUT') THEN 'OPT_OUT' ELSE 'DO_NOT_CONTACT' END suppression_type FROM leadgen.company_suppressions WHERE company_id=ANY($1::uuid[]) AND lifted_at IS NULL GROUP BY company_id",[ids]);
  const blocked = new Map(suppressed.rows.map(row => [row.company_id,row.suppression_type]));
  return rows.map(row => {const id=row.company_id || row.id;return projectContactProgress(row,history.rows.filter(item=>item.company_id===id),blocked.get(id));});
}

export const firstContactPendingSql = alias => `NOT EXISTS(SELECT 1 FROM leadgen.outbound_messages prior_mail WHERE prior_mail.company_id=${alias}.company_id AND (prior_mail.sent_at IS NOT NULL OR prior_mail.transport_status='SMTP_ACCEPTED' OR prior_mail.send_status='AMBIGUOUS')) AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions prior_suppression WHERE prior_suppression.company_id=${alias}.company_id AND prior_suppression.lifted_at IS NULL)`;
