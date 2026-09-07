// Display only: persisted server history owns contact progress and approval gates.
const labels=Object.freeze({
 SENT_NO_REPLY:['已发未回复','Sent · Awaiting Reply'],REPLIED:['已回复','Replied'],
 OPTED_OUT:['停止联系','Do Not Contact'],DO_NOT_CONTACT:['停止联系','Do Not Contact'],BOUNCED:['退信待处理','Bounce Review'],
 SEND_AMBIGUOUS:['发送结果待核对','Send Result Under Review']
});
export function contactProgressStatus(row){return Object.hasOwn(labels,row?.contact_progress_status)?row.contact_progress_status:null;}
export function contactProgressLabel(row){return labels[contactProgressStatus(row)] || null;}
export function initialContactPending(row){return row?.first_contact_pending!==false&&!row?.has_prior_company_contact&&!contactProgressStatus(row);}
export function contactNextAction(row){return ({SENT_NO_REPLY:['等待回复','Await Reply'],REPLIED:['处理回复与跟进','Review Reply & Follow-up'],OPTED_OUT:['停止联系','Do Not Contact'],DO_NOT_CONTACT:['停止联系','Do Not Contact'],BOUNCED:['核对收件地址','Review Recipient'],SEND_AMBIGUOUS:['核对发送结果','Review Send Result']})[contactProgressStatus(row)] || null;}
