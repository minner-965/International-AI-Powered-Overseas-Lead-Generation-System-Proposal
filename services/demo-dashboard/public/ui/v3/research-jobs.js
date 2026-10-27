/* Read-only presentation helpers. No workflow state or provider calls. */
export const profileLabel = value => ({
  WOMENSWEAR: "全品类女装 / Women's apparel",
  GENERAL_MERCHANDISE: '日用百货 / General merchandise',
}[String(value ?? '').toUpperCase()] || (/^[A-Z][A-Z0-9_:-]+$/.test(String(value ?? '')) ? '其他类目 / Other category' : String(value || '—')));

export function persistedProgress(job) {
  const value = job?.progress_percent ?? job?.progress;
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

export function outreachTaskRows(payload) {
  return (Array.isArray(payload?.items) ? payload.items : []).filter(row =>
    (row.scope === undefined || row.scope === 'PROSPECT') && (row.message_id || row.draft_id));
}

export function outreachTaskLabel(row) {
  const value = row.business_contact_status && row.business_contact_status !== 'NOT_SENT'
    ? row.business_contact_status : row.send_status || row.draft_status;
  return ({
    DRAFT: ['草稿', 'Draft'], PENDING_REVIEW: ['待审核', 'Pending review'], APPROVED: ['已批准', 'Approved'],
    REJECTED: ['已退回', 'Returned'], QUEUED: ['等待发送', 'Queued'], SENDING: ['发送中', 'Sending'],
    SMTP_ACCEPTED: ['已发送，未回复', 'Sent, no reply yet'], SENT_NO_REPLY: ['已发送，未回复', 'Sent, no reply yet'],
    REPLIED: ['已回复', 'Replied'], OPTED_OUT: ['已退订', 'Opted out'], HARD_BOUNCED: ['永久退信', 'Permanent bounce'],
    SOFT_BOUNCED: ['临时退信', 'Temporary bounce'], SEND_AMBIGUOUS: ['发送结果待核对', 'Send result needs review'],
    AMBIGUOUS: ['发送结果待核对', 'Send result needs review'], FAILED: ['处理未完成', 'Not completed'],
    CANCELLED: ['已取消', 'Cancelled'], BLOCKED: ['待处理', 'Action required'],
  })[value] || ['待确认', 'To confirm'];
}

/** Category display name returned by the server (category_label_zh/en); null when the server has none. */
export function jobCategoryLabel(job) {
  const zh = String(job?.category_label_zh ?? '').trim(), en = String(job?.category_label_en ?? '').trim();
  if (!zh && !en) return null;
  return [zh || en, en || zh];
}
