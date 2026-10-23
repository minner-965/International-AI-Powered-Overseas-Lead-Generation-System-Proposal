import {managementRequest} from '../../phase7-ui.js';
import {subscribeCommunicationChanges} from '../communication-sync.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bi=(zh,en)=>`<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const labels={SENT_NO_REPLY:['已发送，未回复','Sent, no reply yet'],REPLIED:['已回复','Replied'],REPLIED_NEEDS_REVIEW:['回复待审核','Reply needs review'],OPTED_OUT:['已退订','Opted out'],BOUNCED:['已退信','Bounced'],SEND_AMBIGUOUS:['发送结果待核对','Send result needs review']};
const actions={STOP_CONTACT:['停止联系','Stop contact'],WAIT_FOR_REPLY:['等待回复','Wait for reply'],FOLLOW_UP_REQUIRED:['安排跟进','Arrange follow-up'],REVIEW_DRAFT:['审核草稿','Review draft']};
const events={DRAFT_CREATED:['草稿已建立','Draft created'],APPROVED:['草稿已批准','Draft approved'],SMTP_ACCEPTED:['邮件已发送','Email sent'],HUMAN_REPLY:['收到回复','Reply received'],OPT_OUT:['收到退订','Opt-out received'],AUTO_REPLY:['收到自动回复','Automatic reply received'],OUT_OF_OFFICE:['收到休假回复','Out-of-office reply received'],CRM_SYNCED:['跟进记录已同步','Follow-up record synced']};
const sync={SYNCED:['已同步','Synced'],SUCCEEDED:['已同步','Synced'],PENDING:['待同步','Pending sync'],QUEUED:['待同步','Pending sync'],FAILED:['同步待处理','Sync needs attention'],NOT_REQUIRED:['无需同步','Not required']};
const date=value=>value&&Number.isFinite(new Date(value).getTime())?esc(new Date(value).toLocaleString()):'—';
// This projection contains prospect opportunities only. Never join uncontrolled inbox rows.
export function replyRows(payload){return(payload?.items||[]).filter(row=>row.message_id||row.last_reply_at||row.has_prior_company_contact===true||row.last_contact_at);}
export function communicationRow(row){
  const status=row.contact_progress_status||row.business_contact_status;
  const next=['OPTED_OUT','DO_NOT_CONTACT','BOUNCED'].includes(status)?'STOP_CONTACT'
    :status==='SENT_NO_REPLY'?'WAIT_FOR_REPLY':['REPLIED','REPLIED_NEEDS_REVIEW'].includes(status)?'FOLLOW_UP_REQUIRED'
      :status==='SEND_AMBIGUOUS'?'REVIEW_SEND_RESULT':row.next_action;
  return{...row,business_contact_status:status,sent_at:row.last_contact_at||row.sent_at,next_action:next};
}
labels.DO_NOT_CONTACT=['停止联系','Do not contact'];
actions.REVIEW_SEND_RESULT=['核对发送结果','Review send result'];
// Repository listInbox joins outreach_threads and filters t.company_id; controlled
// application mail is held in a separate controlled_application_inbound_messages table.
export function scopedInboxRows(payload,companyId){return(Array.isArray(payload)?payload:payload?.items||[]).filter(row=>row.company_id===companyId&&row.thread_id&&row.correlation_status==='MATCHED');}
export function renderInboxRows(rows){
  const intents={REVIEW:['待分类','Needs classification'],AUTO_REPLY:['自动回复','Automatic reply'],OPT_OUT:['退订','Opt-out'],DECLINE:['暂无合作意向','Declined'],DEFER:['稍后联系','Contact later'],QUOTATION:['询价','Quotation enquiry'],SAMPLE:['样品需求','Sample request'],MEETING:['会议邀约','Meeting request'],CATALOGUE:['产品资料需求','Catalogue request'],IRRELEVANT:['其他来信','Other message']};
  const review={PENDING:['待复核','Pending review'],REVIEW:['待复核','Pending review'],APPROVED:['已复核','Reviewed'],CONFIRMED:['已确认','Confirmed'],AUTO_CLASSIFIED:['已分类','Classified']};
  return rows.length?rows.map(row=>`<article class="v3-inbox-message"${row.classification_id?` data-classification-id="${esc(row.classification_id)}" data-intent="${esc(row.intent||'')}" data-review-status="${esc(row.review_status||'')}"`:''}><header><strong>${esc(row.subject_sanitized||'—')}</strong><time>${date(row.received_at)}</time></header><div class="v3-inbox-classification">${bi(...(intents[row.intent]||['待分类','Needs classification']))}${bi(...(review[row.review_status]||['复核状态待确认','Review status not confirmed']))}</div><p class="v3-inbox-body" tabindex="0" aria-label="来信正文 Incoming message body">${esc(row.body_text_sanitized||'—')}</p></article>`).join(''):`<p>${bi('暂无已关联来信','No matched incoming messages')}</p>`;
}
export function renderReplyRows(items){return items.map(row=>`<article class="v3-reply-row"><div class="v3-reply-summary"><div><strong>${esc(row.company_name)}</strong><small>${esc(row.recipient_email||'—')}</small></div><div>${bi(...(labels[row.business_contact_status]||['联系状态待核对','Contact status needs review']))}<small>${date(row.last_reply_at||row.sent_at)}</small></div><div>${bi('负责人','Owner')}<small>${esc(row.owner||'—')}</small></div><button class="btn btn-outline-primary" data-tip="打开这家企业的详情和跟进记录|Open company details and activity" data-reply-company="${esc(row.company_id)}" type="button">${bi('查看往来','View correspondence')}</button></div><details><summary>${bi('跟进与活动','Follow-up & activity')}</summary><dl class="v3-reply-facts"><div><dt>${bi('下一步','Next action')}</dt><dd>${bi(...(row.suppression?actions.STOP_CONTACT:actions[row.next_action]||['待安排','To be arranged']))}</dd></div><div><dt>${bi('跟进同步','Follow-up sync')}</dt><dd>${bi(...(sync[row.crm_sync]||['同步状态待核对','Sync status needs review']))}</dd></div><div><dt>${bi('最近回复','Latest reply')}</dt><dd>${date(row.last_reply_at)}</dd></div></dl><ol class="v3-reply-timeline">${(row.activity||[]).map(event=>`<li>${bi(...(events[event.event_type]||['联系状态已更新','Contact status updated']))}<time>${date(event.occurred_at)}</time></li>`).join('')||`<li>${bi('暂无活动记录','No activity recorded')}</li>`}</ol></details></article>`).join('');}

export function mountReplies(host,{request=managementRequest}={}){
  if(!host)return null;
  host.innerHTML=`<header class="v3-replies-header"><h2 id="replies-title">${bi('回复与跟进','Replies & Follow-up')}</h2><button class="btn btn-outline-primary" data-tip="重新读取客户回复|Reload customer replies" type="button" data-replies-refresh>${bi('刷新','Refresh')}</button></header><p data-replies-status role="status" aria-live="polite"></p><div class="v3-replies-list" data-replies-list></div>`;
  const list=host.querySelector('[data-replies-list]'),status=host.querySelector('[data-replies-status]'),button=host.querySelector('[data-replies-refresh]');
  let busy=false,generation=0,queued=false;
  function bindInbox(){
    list.querySelectorAll('[data-reply-company]').forEach(control=>{
      const companyId=control.dataset.replyCompany,article=control.closest('.v3-reply-row');
      const disclosure=document.createElement('details');disclosure.className='v3-inbox-disclosure';
      disclosure.innerHTML=`<summary>${bi('查看来信','View incoming messages')}</summary><div data-inbox-content role="status" aria-live="polite"></div>`;article.append(disclosure);
      let loading=false,loaded=false;
      const load=async()=>{if(loading||loaded)return;loading=true;const content=disclosure.querySelector('[data-inbox-content]');content.setAttribute('aria-busy','true');content.innerHTML=bi('正在读取来信','Loading incoming messages');try{const payload=await request(`/api/outreach/inbox?company_id=${encodeURIComponent(companyId)}`);content.innerHTML=renderInboxRows(scopedInboxRows(payload,companyId));loaded=true;}catch{content.innerHTML=`<p>${bi('来信读取未完成','Incoming messages did not load')}</p><button type="button" data-tip="重新读取收件箱|Reload the inbox" class="btn btn-outline-primary" data-inbox-retry>${bi('重试','Retry')}</button>`;content.querySelector('[data-inbox-retry]').addEventListener('click',load);}finally{loading=false;content.setAttribute('aria-busy','false');}};
      disclosure.addEventListener('toggle',()=>{if(disclosure.open)load();});
    });
  }
  const visible=()=>!host.closest('[hidden]')&&document.visibilityState!=='hidden';
  async function refresh(){
    if(busy){generation++;queued=true;return;}const ticket=++generation;
    busy=true;button.disabled=true;list.setAttribute('aria-busy','true');status.innerHTML=bi('正在读取客户往来','Loading customer correspondence');
    try{
      const rows=replyRows(await request('/api/outreach/workbench')).map(communicationRow);if(ticket!==generation)return;
      const fingerprint=JSON.stringify(rows);if(fingerprint===lastFingerprint){status.innerHTML=bi(`当前 ${rows.length} 条客户往来记录`,`${rows.length} customer correspondence records`);return;}
      const opened=new Set([...list.querySelectorAll('.v3-reply-row')].flatMap(article=>[...article.querySelectorAll('details')].map((detail,index)=>detail.open?`${article.querySelector('[data-reply-company]')?.dataset.replyCompany}:${index}`:null).filter(Boolean)));
      list.innerHTML=rows.length?renderReplyRows(rows):`<div class="p8-empty-state">${bi('暂无客户往来记录','No customer correspondence yet')}</div>`;
      status.innerHTML=bi(`当前 ${rows.length} 条客户往来记录`,`${rows.length} customer correspondence records`);
      list.querySelectorAll('[data-reply-company]').forEach(control=>control.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('crm:openoutreach',{detail:{companyId:control.dataset.replyCompany}}))));bindInbox();
      list.querySelectorAll('.v3-reply-row').forEach(article=>article.querySelectorAll('details').forEach((detail,index)=>{if(opened.has(`${article.querySelector('[data-reply-company]')?.dataset.replyCompany}:${index}`))detail.open=true;}));
      lastFingerprint=fingerprint;
    }catch{if(ticket===generation){lastFingerprint=null;status.innerHTML=bi('客户往来读取未完成，请刷新重试','Correspondence did not load. Refresh to retry');list.innerHTML=`<div class="p8-empty-state">${bi('请检查访问权限或稍后重试','Check access or try again shortly')}</div>`;}}
    finally{busy=false;button.disabled=false;list.setAttribute('aria-busy','false');if(queued){queued=false;if(visible())refresh();}}
  }
  let scheduled=false;
  let lastFingerprint=null;
  const invalidate=()=>{generation++;if(visible()&&!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;if(visible())refresh();});}};
  subscribeCommunicationChanges(invalidate);window.addEventListener('focus',invalidate);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')invalidate();});
  const poll=setInterval(()=>{if(visible()&&!busy)refresh();},30000);poll.unref?.();
  button.addEventListener('click',refresh);document.addEventListener('crm:viewchange',event=>{if(event.detail?.view==='replies')invalidate();});if(location.hash==='#replies')refresh();return{refresh};
}
if(typeof document!=='undefined')mountReplies(document.querySelector('#view-replies'));
