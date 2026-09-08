import { managementRequest } from '../phase7-ui.js';
import { opportunityDimensionsMarkup } from './v3/opportunity-dimensions.js';
import { publishCommunicationChange, subscribeCommunicationChanges } from './communication-sync.js';
import { contactProgressStatus, contactNextAction } from './contact-progress.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bi=(zh,en)=>`<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const labels={DRAFT:['草稿','Draft'],PENDING_REVIEW:['待审核','Pending review'],APPROVED:['已批准','Approved'],REJECTED:['已拒绝','Rejected'],INVALID_DRAFT:['需要修改','Changes required'],NEEDS_CHANGES:['需要修改','Changes required'],SUPERSEDED:['已替换','Superseded'],QUEUED:['等待发送','Waiting to send'],SENDING:['发送中','Sending'],PROVIDER_ACCEPTED:['已提交邮件服务','Accepted by mail service'],SENT:['已发送','Sent'],FAILED:['发送失败','Send failed'],BLOCKED:['待处理','Action required'],SEND_AMBIGUOUS:['发送结果待核对','Send result needs review'],DELIVERED:['已送达','Delivered'],BOUNCED:['已退信','Bounced']};
Object.assign(labels,{AMBIGUOUS:['发送结果待核对','Send result needs review'],HARD_BOUNCED:['永久退信','Permanent bounce'],SOFT_BOUNCED:['临时退信','Temporary bounce'],CANCELLED:['已取消','Cancelled']});
Object.assign(labels,{VALID:['已核验','Verified'],ELIGIBLE:['条件通过','Eligible'],VERIFICATION_REQUIRED:['待核验','Verification required']});
Object.assign(labels,{NO_VERIFIED_EMAIL:['未找到可发送邮箱','No verified email found']});
Object.assign(labels,{SENT_NO_REPLY:['已发送，未回复','Sent, no reply yet'],REPLIED:['已回复','Replied'],OPTED_OUT:['已退订','Opted out'],NEEDS_RECIPIENT_REVIEW:['待核验收件人','Recipient review required'],NEEDS_MANAGEMENT_APPROVAL:['待授权邮件联系','Email contact authorization pending'],NEEDS_DRAFT:['待准备草稿','Draft required'],NEEDS_DRAFT_APPROVAL:['待审核草稿','Draft review required'],READY_TO_SEND:['待发送','Ready to send'],MANUAL_CHANNEL:['其他联系渠道','Other contact channel']});
const status=value=>{const tone=['APPROVED','VALID','ELIGIBLE','REPLIED','DELIVERED'].includes(value)?'current':['FAILED','REJECTED','OPTED_OUT','BOUNCED','HARD_BOUNCED'].includes(value)?'rejected':['SENT','SENT_NO_REPLY','PROVIDER_ACCEPTED','READY_TO_SEND'].includes(value)?'active':'review';return `<span class="data-state-badge state-${tone}">${bi(...(labels[value]||['待准备','Not prepared']))}</span>`;};
const category=value=>bi(...(value==='GENERAL_MERCHANDISE'?['日用百货','General merchandise']:['女装','Womenswear']));
const businessStatus=row=>contactProgressStatus(row)?status(contactProgressStatus(row)):row.business_contact_status&&row.business_contact_status!=='NOT_SENT'?status(row.business_contact_status):row.opportunity_status!=='MANAGEMENT_APPROVED'?status('NEEDS_MANAGEMENT_APPROVAL'):row.eligibility_status!=='ELIGIBLE'?status('NEEDS_RECIPIENT_REVIEW'):status(row.send_status||row.draft_status||'NEEDS_DRAFT');
const autoMode=()=>document.documentElement.dataset.acquisitionMode==='auto';
const independentStates=row=>{
  const opportunity=String(row.business_opportunity_status||row.opportunity_pool_status||row.opportunity_status||'').toUpperCase();
  const readiness=String(row.contact_readiness_status||row.contact_status||'').toUpperCase();
  const eligibility=String(row.email_eligibility_status||row.eligibility_status||'').toUpperCase();
  const active=['ACTIVE','ACTIVE_BUSINESS_OPPORTUNITY','RECOMMENDED','MANAGEMENT_APPROVED'].includes(opportunity);
  const ready=['READY','CONTACT_READY','ELIGIBLE'].includes(readiness);
  const eligible=eligibility==='ELIGIBLE';
  const badge=(zh,en,value,tone)=>`<span class="v3-email-dimension"><small>${bi(zh,en)}</small><strong class="${tone}">${bi(...value)}</strong></span>`;
  return `<div class="v3-email-dimensions" aria-label="业务机会、联系方式和邮件资格 Business opportunity, contact readiness and email eligibility">${badge('业务机会','Business Opportunity',active?['有效','Active']:['待确认','Pending'],active?'is-ready':'is-pending')}${badge('联系方式','Contact Readiness',ready?['就绪','Ready']:['待完善','Pending'],ready?'is-ready':'is-pending')}${badge('邮件资格','Email Eligibility',eligible?['通过','Eligible']:['未通过','Not eligible'],eligible?'is-ready':'is-blocked')}</div>`;
};
const automaticEmailState=row=>{
  const progress=String(contactProgressStatus(row)||row.business_contact_status||row.send_status||'').toUpperCase();
  if(['OPTED_OUT','DO_NOT_CONTACT'].includes(progress)||row.suppressed)return status('OPTED_OUT');
  if(['HARD_BOUNCED','BOUNCED'].includes(progress))return status('HARD_BOUNCED');
  if(['SENT_NO_REPLY','SMTP_ACCEPTED','SENT','PROVIDER_ACCEPTED'].includes(progress))return status('SENT_NO_REPLY');
  if(progress==='REPLIED')return status('REPLIED');
  if(row.verification_status!=='VALID')return status(row.recipient_email?'VERIFICATION_REQUIRED':'NO_VERIFIED_EMAIL');
  if(row.eligibility_status!=='ELIGIBLE')return status('NEEDS_RECIPIENT_REVIEW');
  if(['QUEUED','SENDING'].includes(progress))return status(progress);
  return status('READY_TO_SEND');
};
labels.DO_NOT_CONTACT=['停止联系','Do Not Contact'];
const nextAction=value=>{
  const progressAction=contactNextAction(state.row);
  if(progressAction)return bi(...progressAction);
  if(value==='REVIEW_DRAFT'&&state.row?.draft_status==='APPROVED'&&!state.row.message_id){
    if(state.row.send_allowed&&state.data?.sending_enabled)return bi('待发送','Ready to send');
    if(state.row.send_blocked_reasons?.includes('SEND_RATE_CAP_BLOCKED'))return bi('发送额度待恢复','Send allowance pending');
    if(!state.data?.sending_enabled)return bi('发信权限待确认','Sending permission pending');
    return bi('联系条件待复核','Contact review required');
  }
  return bi(...({STOP_CONTACT:['停止联系','Stop contact'],WAIT_FOR_REPLY:['等待回复','Wait for reply'],REVIEW_DRAFT:['审核草稿','Review draft'],FOLLOW_UP_REQUIRED:['安排跟进','Arrange follow-up']}[value]||['待安排','To be arranged']));
};
const activityLabels={DRAFT_CREATED:['草稿已建立','Draft created'],APPROVED:['草稿已批准','Draft approved'],SMTP_ACCEPTED:['已发送','Sent'],CONTACTED:['已发送','Sent'],HUMAN_REPLY:['收到回复','Reply received'],OPT_OUT:['收到退订','Opt-out received'],AUTO_REPLY:['收到自动回复','Automatic reply received'],OUT_OF_OFFICE:['收到休假回复','Out-of-office reply received'],CRM_SYNCED:['跟进记录已同步','Follow-up record synced']};
const date=value=>value?esc(new Date(value).toLocaleString()):'—';
const state={data:null,row:null,busy:false,opener:null,dirty:false};
const post=(url,body={})=>managementRequest(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const dialog=document.createElement('dialog');
dialog.id='outreach-review-dialog';dialog.className='p11-outreach-dialog';dialog.setAttribute('aria-labelledby','outreach-review-title');
dialog.innerHTML=`<header class="p11-outreach-header"><h3 id="outreach-review-title" tabindex="-1">${bi('开发信审核','Email review')}</h3><button type="button" id="outreach-review-close" class="btn btn-outline-secondary">${bi('返回','Back')}</button></header><div class="p11-outreach-body"><div id="outreach-review-summary"></div><form id="outreach-review-form"><label for="outreach-subject">${bi('主题','Subject')}</label><input id="outreach-subject" class="form-control" required maxlength="240"><label for="outreach-body">${bi('正文','Message')}</label><textarea id="outreach-body" class="form-control" rows="10" required maxlength="12000"></textarea><button id="outreach-save" class="btn btn-outline-primary" type="submit">${bi('保存草稿','Save draft')}</button></form><div id="outreach-review-feedback" role="status" aria-live="polite"></div><div id="outreach-send-readiness" class="crm-helper"></div></div><footer class="p11-outreach-footer"><button id="outreach-submit" class="btn btn-outline-primary" type="button">${bi('提交审核','Submit for review')}</button><button id="outreach-reject" class="btn btn-outline-secondary" type="button">${bi('退回修改','Return for changes')}</button><button id="outreach-approve" class="btn btn-outline-primary" type="button">${bi('批准当前版本','Approve this version')}</button><button id="outreach-send" class="btn btn-primary" type="button">${bi('发送此邮件','Send this email')}</button></footer>`;
document.body.append(dialog);
const q=id=>document.getElementById(id);
// Recompose the existing controls; their IDs and business handlers remain unchanged.
dialog.classList.add('v3-email-review');
const reviewBody=dialog.querySelector('.p11-outreach-body');
const companyColumn=document.createElement('aside');companyColumn.className='v3-email-company';
companyColumn.setAttribute('aria-label','邮件客户资料 Email company details');
const composerColumn=document.createElement('section');composerColumn.className='v3-email-composer';
const gateColumn=document.createElement('aside');gateColumn.className='v3-email-gates';
gateColumn.setAttribute('aria-label','邮件审核条件 Email review conditions');
companyColumn.append(q('outreach-review-summary'));
composerColumn.innerHTML=`<h4>${bi('邮件内容','Email content')}</h4><div id="outreach-recipient-display" class="v3-email-recipient"></div>`;
composerColumn.append(q('outreach-review-form'),q('outreach-review-feedback'));
gateColumn.innerHTML=`<h4>${bi('审核与联系条件','Review & contact conditions')}</h4><div id="outreach-gate-status"></div>`;
gateColumn.append(q('outreach-send-readiness'),dialog.querySelector('.p11-outreach-footer'));
reviewBody.append(companyColumn,composerColumn,gateColumn);
const approveContact=document.createElement('button');approveContact.id='outreach-contact-approve';approveContact.type='button';approveContact.className='btn btn-outline-primary';approveContact.innerHTML=bi('批准邮件联系','Authorize email contact');q('outreach-review-summary').after(approveContact);
const refreshReview=document.createElement('button');refreshReview.id='outreach-review-refresh';refreshReview.type='button';refreshReview.className='btn btn-outline-primary';refreshReview.innerHTML=bi('刷新','Refresh');q('outreach-review-close').before(refreshReview);
function feedback(zh,en){q('outreach-review-feedback').innerHTML=bi(zh,en);}
const sendBlockLabels={
  OUTREACH_DISABLED:['客户邮件发送尚未启用，请联系管理员。','Customer sending is not enabled. Contact your administrator.'],
  PROSPECT_PILOT_SCOPE_REQUIRED:['客户单封发送范围尚未启用。','Single-customer sending scope is not enabled.'],
  OUTREACH_SEND_SCOPE_DISABLED:['客户单封发送范围尚未启用。','Single-customer sending scope is not enabled.'],
  LIVE_PROSPECT_SEND_NOT_APPROVED:['客户发信权限待管理员确认。','Customer sending permission requires administrator confirmation.'],
  SMTP_DISABLED:['发信服务尚未启用。','The sending service is not enabled.'],
  OUTBOUND_PROVIDER_NOT_CONFIGURED:['发信账户待配置。','A sending account is required.'],
  SEND_RATE_CAP_NOT_CONFIGURED:['发信频次上限待管理员设置。','Sending frequency limits require administrator setup.'],
  SEND_RATE_CAP_BLOCKED:['已达到发信频次上限，请稍后再检查。','The sending frequency limit has been reached. Check again later.'],
  CONTACT_VERIFICATION_EXPIRED:['邮箱核验已到期，请重新核验。','Mailbox verification has expired. Verify it again.'],
  ELIGIBILITY_EXPIRED_OR_BLOCKED:['联系资格已到期或未通过，请重新核验。','Contact eligibility has expired or needs review.'],
  RECIPIENT_NOT_SEND_READY:['收件邮箱未通过当前核验。','The recipient mailbox has not passed current verification.'],
  APPROVAL_EXPIRED:['草稿批准已到期，请重新提交审核。','Draft approval has expired. Submit it for review again.'],
  APPROVAL_CONTEXT_STALE:['客户资料已更新，请重新审核。','Company information has changed. Review it again.'],
  ELIGIBILITY_FACTS_STALE:['联系资料已更新，请重新核验。','Contact information has changed. Verify it again.'],
  EXACT_VERSION_APPROVAL_REQUIRED:['当前草稿待批准。','The current draft requires approval.'],
  COMPANY_SUPPRESSED:['此公司已停止联系。','Contact with this company has been stopped.'],
  CONTACT_SUPPRESSED:['此地址已停止联系。','Contact with this address has been stopped.'],
  CURRENT_MANAGEMENT_APPROVAL_REQUIRED:['公司联系待批准。','Company contact requires approval.'],
  CURRENT_CONTACT_QUEUE_REQUIRED:['此公司已移出当前联系队列。','This company is no longer in the current contact queue.'],
};
function sendBlockExplanation(row){
  const reasons=[...new Set([...(state.data?.sending_blocked_reasons||[]),...(row.send_blocked_reasons||[])])];
  const reason=reasons.find(value=>sendBlockLabels[value]);
  return reason?bi(...sendBlockLabels[reason]):bi('发送条件待复核','Sending conditions require review');
}
function readiness(row){
  if(state.data?.read_failed)return bi('状态更新未完成，请刷新后再发送。','Status refresh is incomplete. Refresh before sending.');
  if(state.dirty)return bi('正文有未保存修改，请先保存并重新审核。','The message has unsaved changes. Save and review the new version.');
  if(!state.data?.sending_enabled&&row.draft_status==='APPROVED')return sendBlockExplanation(row);
  if(row.retry_allowed)return bi('上次提交在邮件服务调用前停止，可重新提交同一封邮件。','The last submission stopped before contacting the mail service. This same email can be resubmitted.');
  if(['AMBIGUOUS','SEND_AMBIGUOUS'].includes(row.send_status))return bi('发送结果待核对，请先检查发件箱。','The send result needs review. Check the Sent folder first.');
  if(row.send_status==='FAILED')return bi('本次发送失败，请联系管理员核对发送记录。','This send failed. Ask your administrator to review the send record.');
  if(row.message_id)return bi('此邮件已有发送记录，请查看当前状态。','This email has a send record. Check its current status.');
  if(row.opportunity_status!=='MANAGEMENT_APPROVED')return bi('邮件联系授权待批准。','Email contact authorization is pending.');
  if(row.eligibility_status!=='ELIGIBLE')return bi('请先补齐当前联系条件并核验邮箱。','Complete contact requirements and verify the mailbox first.');
  if(row.draft_status!=='APPROVED')return bi('发送前请完成当前草稿审核。','Approve the current draft before sending.');
  if(!state.data?.sending_enabled||!row.send_allowed)return sendBlockExplanation(row);
  return bi('当前版本可单封发送。','This version is ready for a single-email send.');
}
function controls(){
  const row=state.row;
  if(!row){
    for(const id of ['outreach-save','outreach-submit','outreach-approve','outreach-reject','outreach-send','outreach-contact-approve'])q(id).disabled=true;
    approveContact.hidden=true;
    refreshReview.disabled=state.busy||state.dirty;
    q('outreach-subject').readOnly=true;q('outreach-body').readOnly=true;
    q('outreach-subject').disabled=state.busy;q('outreach-body').disabled=state.busy;
    q('outreach-gate-status').innerHTML=bi('此公司已移出当前联系队列','This company is no longer in the current contact queue');
    q('outreach-send-readiness').innerHTML=bi('请返回公司列表，重新选择当前记录。','Return to the company list and select a current record.');
    dialog.setAttribute('aria-busy',String(state.busy));
    return;
  }
  const frozen=Boolean(row.message_id),eligible=row.eligibility_status==='ELIGIBLE'&&row.opportunity_status==='MANAGEMENT_APPROVED';
  approveContact.hidden=row.opportunity_status==='MANAGEMENT_APPROVED'||frozen;
  approveContact.disabled=state.busy||state.dirty||row.opportunity_status!=='RECOMMENDED';
  refreshReview.disabled=state.busy||state.dirty;
  q('outreach-save').disabled=state.busy||frozen||!eligible;
  q('outreach-subject').disabled=state.busy;q('outreach-body').disabled=state.busy;
  q('outreach-subject').readOnly=frozen;q('outreach-body').readOnly=frozen;
  q('outreach-submit').disabled=state.busy||state.dirty||frozen||!['DRAFT','PENDING_REVIEW'].includes(row.draft_status)||Boolean(row.submitted_at);
  q('outreach-approve').disabled=state.busy||state.dirty||frozen||row.draft_status!=='PENDING_REVIEW'||!row.submitted_at;
  q('outreach-reject').disabled=state.busy||state.dirty||frozen||!['PENDING_REVIEW','APPROVED'].includes(row.draft_status);
  q('outreach-send').disabled=state.busy||state.dirty||!state.data?.sending_enabled||(!row.send_allowed&&!row.retry_allowed);
  if(state.data?.read_failed)for(const id of ['outreach-save','outreach-submit','outreach-approve','outreach-reject','outreach-send','outreach-contact-approve'])q(id).disabled=true;
  q('outreach-send').innerHTML=row.retry_allowed?bi('重新提交此邮件','Resubmit this email'):bi('发送此邮件','Send this email');
  q('outreach-send').setAttribute('aria-describedby','outreach-send-readiness');
  q('outreach-send-readiness').innerHTML=readiness(row);
  q('outreach-gate-status').innerHTML=`<dl class="v3-email-checks"><dt>${bi('邮件联系授权','Email contact authorization')}</dt><dd>${row.opportunity_status==='MANAGEMENT_APPROVED'?status('APPROVED'):status('NEEDS_MANAGEMENT_APPROVAL')}</dd><dt>${bi('收件人','Recipient')}</dt><dd>${row.eligibility_status==='ELIGIBLE'?status('ELIGIBLE'):status('NEEDS_RECIPIENT_REVIEW')}</dd><dt>${bi('当前草稿','Current draft')}</dt><dd>${status(row.draft_status||'NEEDS_DRAFT')}</dd></dl>`;
  dialog.setAttribute('aria-busy',String(state.busy));
}
function renderDialog(){
  const row=state.row;if(!row){controls();return;}
  q('outreach-review-summary').innerHTML=`<strong>${esc(row.company_name)}</strong><dl><dt>${bi('商品类目','Product category')}</dt><dd>${category(row.product_profile)}</dd><dt>${bi('收件人','Recipient')}</dt><dd>${esc(row.recipient_email||'—')}</dd><dt>${bi('邮箱核验','Email verification')}</dt><dd>${row.verification_status==='VALID'?status('VALID'):status('VERIFICATION_REQUIRED')} · ${date(row.verified_at)}</dd><dt>${bi('当前状态','Current status')}</dt><dd>${businessStatus(row)}</dd><dt>${bi('收件证据','Receipt evidence')}</dt><dd>${row.receipt_evidence_status==='UNCONFIRMED'||!row.receipt_evidence_status?bi('尚无收件确认','No receipt confirmation'):bi('已有收件证据','Receipt evidence recorded')}</dd><dt>${bi('负责人','Owner')}</dt><dd>${esc(row.owner||'—')}</dd><dt>${bi('下一步','Next action')}</dt><dd>${nextAction(row.next_action)}</dd><dt>${bi('最近回复','Latest reply')}</dt><dd>${date(row.last_reply_at)}</dd></dl><details><summary>${bi('活动记录','Activity history')}</summary><ol class="p11-activity-list">${(row.activity||[]).map(event=>`<li>${bi(...(activityLabels[event.event_type]||['联系状态已更新','Contact status updated']))}<time>${date(event.occurred_at)}</time></li>`).join('')||`<li>${bi('暂无活动','No activity yet')}</li>`}</ol></details>`;
  q('outreach-subject').value=row.subject||state.data?.template?.subject||'';
  q('outreach-review-summary').insertAdjacentHTML('beforeend',opportunityDimensionsMarkup(row));
  if(window.matchMedia('(max-width:600px)').matches){
    const facts=q('outreach-review-summary').querySelector('dl');
    const disclosure=document.createElement('details');disclosure.innerHTML=`<summary>${bi('公司与联系资料','Company & contact details')}</summary>`;
    facts.before(disclosure);disclosure.append(facts);
  }
  q('outreach-recipient-display').innerHTML=`${bi('收件人','To')}<strong>${esc(row.recipient_email||'—')}</strong>`;
  q('outreach-body').value=row.body_text||state.data?.template?.body_text||'';
  state.dirty=false;controls();
}
function renderList(){
  const host=q('outreach-workbench-list');if(!host)return;
  const items=state.data?.items||[];
  const companies=new Map();items.forEach((row,index)=>{if(!companies.has(row.company_id))companies.set(row.company_id,[]);companies.get(row.company_id).push({row,index});});
  const autoAction=(row,index)=>{
    if(row.message_id||contactProgressStatus(row))return `<button class="btn btn-outline-primary" type="button" data-outreach-index="${index}">${bi('查看邮件记录','View mail record')}</button>`;
    if(!row.recipient_email)return `<a class="btn btn-outline-primary" href="#contact-ready">${bi('继续查找联系方式','Continue contact research')}</a>`;
    if(row.verification_status!=='VALID')return `<a class="btn btn-outline-primary" href="#contact-ready">${bi('查看邮箱核验','Review email verification')}</a>`;
    if(row.eligibility_status!=='ELIGIBLE')return `<a class="btn btn-outline-primary" href="#contact-ready">${bi('查看联系条件','Review contact requirements')}</a>`;
    return `<button class="btn btn-outline-primary" type="button" data-outreach-index="${index}">${bi('查看联系状态','View contact status')}</button>`;
  };
  host.innerHTML=items.length?[...companies.values()].map(group=>`<article class="p11-outreach-row"><div class="v3-email-identity"><span class="v3-email-avatar" aria-hidden="true">${esc(group[0].row.company_name?.slice(0,1)||'—')}</span><div><strong>${esc(group[0].row.company_name)}</strong><p>${esc(group[0].row.recipient_email||'—')}</p></div></div><div class="p11-category-actions">${group.map(({row,index})=>`<div><span class="v3-email-category">${category(row.product_profile)}</span><span class="v3-email-state">${autoMode()?automaticEmailState(row):businessStatus(row)}</span>${autoMode()?autoAction(row,index):`<button class="btn btn-outline-primary" type="button" data-outreach-index="${index}">${contactProgressStatus(row)?bi('查看邮件记录','View mail record'):bi('审核与发送','Review & send')}</button>`}</div>${independentStates(row)}`).join('')}</div></article>`).join(''):`<div class="p8-empty-state">${bi('暂无可准备开发信的公司，请先检查业务机会与邮箱。','No companies are ready for draft preparation. Review opportunities and mailboxes first.')}</div>`;
  host.querySelectorAll('[data-outreach-index]').forEach(button=>button.addEventListener('click',()=>{state.opener=button;state.row=items[Number(button.dataset.outreachIndex)];q('outreach-review-feedback').textContent='';renderDialog();dialog.showModal();q('outreach-review-title').focus();}));
}
async function load(){
  const generation=(state.loadGeneration||0)+1;state.loadGeneration=generation;
  const host=q('outreach-workbench-list');if(!host)return;host.setAttribute('aria-busy','true');
  try{const data=await managementRequest('/api/outreach/workbench');if(state.loadGeneration!==generation)return;state.data=data;if(state.row)state.row=state.data.items.find(row=>row.company_id===state.row.company_id&&row.product_profile===state.row.product_profile)||null;renderList();controls();}
  catch{if(state.loadGeneration!==generation)return;if(state.data){state.data.sending_enabled=false;state.data.read_failed=true;}controls();host.innerHTML=`<div class="p8-empty-state">${bi('邮件工作台读取未完成，请点击刷新状态重试。','Email workspace did not load. Use Refresh status to retry.')}</div>`;throw new Error('WORKBENCH_READ_FAILED');}
  finally{if(state.loadGeneration===generation)host.setAttribute('aria-busy','false');}
}
let pendingSync=false;
async function refreshAfterChange(){
  if(state.busy){pendingSync=true;return;}
  if(document.hidden)return;
  if(!dialog.open&&location.hash!=='#contact-queue')return;
  // Refresh gates without replacing unsaved subject/body input.
  try{await load();if(dialog.open&&!state.dirty)renderDialog();else controls();}catch{}
}
subscribeCommunicationChanges(refreshAfterChange);
window.addEventListener('focus',refreshAfterChange);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshAfterChange();});
setInterval(refreshAfterChange,30000);
async function operate(action,{sending=false}={}){
  if(state.busy||!state.row||state.data?.read_failed)return;state.loadGeneration=(state.loadGeneration||0)+1;state.busy=true;controls();feedback('正在处理，请稍候。','Processing. Please wait.');
  try{await action();publishCommunicationChange({companyId:state.row?.company_id,productProfile:state.row?.product_profile,reason:sending?'SEND_COMPLETED':'UPDATED'});await load();renderDialog();feedback('操作已保存。','The action was saved.');await loadOperations();}
  catch{if(sending){publishCommunicationChange({companyId:state.row?.company_id,reason:'SEND_RECONCILE'});try{await load();renderDialog();}catch{if(state.data)state.data.sending_enabled=false;}}feedback('此步骤未完成，请检查当前状态后重试；发送结果待核对时请勿重复发送。','This step did not complete. Check the current status before retrying; do not resend while a send result is under review.');}
  finally{state.busy=false;controls();if(pendingSync){pendingSync=false;void refreshAfterChange();}}
}
function close(){
  if(state.busy)return;
  if(state.dirty&&!window.confirm('放弃未保存修改并返回？\nDiscard unsaved changes and go back?'))return;
  dialog.close();const row=state.row;
  const visible=node=>node?.isConnected&&node.getClientRects().length&&!node.closest('[hidden],[inert]');
  const replacement=[...document.querySelectorAll('[data-outreach-index]')].find(button=>visible(button)&&state.data?.items[Number(button.dataset.outreachIndex)]?.company_id===row?.company_id);
  (visible(state.opener)?state.opener:replacement)?.focus({preventScroll:true});
}
q('outreach-review-close').addEventListener('click',close);
refreshReview.addEventListener('click',async()=>{if(state.busy||state.dirty)return;state.busy=true;controls();try{await load();renderDialog();feedback('状态已更新。','Status updated.');}catch{feedback('状态读取未完成，请重试。','Status could not be loaded. Please retry.');}finally{state.busy=false;controls();}});
dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[hidden]'));
  if(!controls.length){event.preventDefault();q('outreach-review-title').focus();return;}
  const first=controls[0],last=controls.at(-1),active=document.activeElement;
  if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
});
dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}});
q('outreach-review-form').addEventListener('input',()=>{state.dirty=true;controls();});
q('outreach-review-form').addEventListener('submit',event=>{event.preventDefault();operate(()=>post(`/api/outreach/workbench/${state.row.company_id}/prepare`,{product_profile:state.row.product_profile,subject:q('outreach-subject').value,body_text:q('outreach-body').value}));});
q('outreach-submit').addEventListener('click',()=>operate(()=>post(`/api/outreach/drafts/${state.row.draft_id}/submit`)));
approveContact.addEventListener('click',()=>{if(approveContact.disabled)return;operate(()=>post(`/api/opportunities/${encodeURIComponent(state.row.opportunity_id||`${state.row.company_id}:${state.row.product_profile}`)}/management-approve`,{reason:'Company contact reviewed in email workspace',request_id:crypto.randomUUID()}));});
q('outreach-approve').addEventListener('click',()=>operate(()=>post(`/api/outreach/drafts/${state.row.draft_id}/approve`,{provider_purpose:'COLD_OUTREACH',reason:'Reviewed current message in application'})));
q('outreach-reject').addEventListener('click',()=>operate(()=>post(`/api/outreach/drafts/${state.row.draft_id}/reject`,{reason:'Revision requested in application'})));
q('outreach-send').addEventListener('click',()=>{if(state.dirty||!state.data?.sending_enabled||(!state.row?.send_allowed&&!state.row?.retry_allowed))return;operate(()=>state.row.retry_allowed?post(`/api/outreach/messages/${state.row.message_id}/retry-before-provider`):post(`/api/outreach/messages/${state.row.approval_id}/enqueue`,{provider_purpose:'COLD_OUTREACH'}),{sending:true});});
q('outreach-workbench-refresh')?.addEventListener('click',()=>load().catch(()=>{}));
document.addEventListener('crm:openoutreach',async event=>{
  document.querySelector('[data-app-nav="contact-queue"]')?.click();
  try{
    await load();
    const row=state.data?.items?.find(item=>item.company_id===event.detail?.companyId);
    if(row){state.row=row;state.opener=[...document.querySelectorAll('[data-outreach-index]')].find(button=>state.data.items[Number(button.dataset.outreachIndex)]===row)||q('outreach-workbench-refresh');q('outreach-review-feedback').textContent='';renderDialog();if(!dialog.open)dialog.showModal();q('outreach-review-title').focus();}
    else{q('outreach-workbench-list')?.scrollIntoView({block:'start'});}
  }catch{/* The workspace already presents its retry action. */}
});
document.addEventListener('dpv:automationchange',()=>{renderList();controls();});
async function loadOperations(){
  const host=q('outreach-operations');if(!host || host.dataset.v3Overview==='true')return;host.setAttribute('aria-busy','true');
  try{const [data,research]=await Promise.all([managementRequest('/api/outreach/operations-summary'),managementRequest('/api/research/workbench-summary').catch(()=>null)]);const p=data.prospect||{};
    const stages=[['eligible','联系条件通过','Eligibility passed'],['pending_drafts','待审核草稿','Drafts to review'],['approved','已批准草稿','Approved drafts'],['queued','等待发送','Waiting to send'],['smtp_accepted','邮件服务已接收','Mail service accepted'],['replies','关联回复','Linked replies']];
    host.innerHTML=`<ol class="p11-operations-flow">${stages.map(([key,zh,en])=>`<li><button type="button" data-outreach-open><strong>${esc(p[key]??0)}</strong>${bi(zh,en)}</button></li>`).join('')}</ol><div class="p11-operations-notes"><span>${bi('停止联系地址','Suppressed addresses')} <strong>${esc(p.suppressed??0)}</strong></span><span>${bi('发送异常','Send issues')} <strong>${esc(p.failed??0)}</strong></span></div><p class="crm-helper">${bi('各阶段按当前记录统计，数量不相加；验证邮件单独统计。','Stages count current records and are not additive; verification emails are tracked separately.')}</p><details><summary>${bi('邮件流程验证记录','Email workflow verification records')}</summary><p>${bi('已发邮件','Sent emails')} ${esc(data.controlled?.sent??0)} · ${bi('收到回复','Received replies')} ${esc(data.controlled?.inbound??0)} · ${bi('退订地址','Suppressed addresses')} ${esc(data.controlled?.suppressed??0)}</p></details>`;
    const researchPanel=document.createElement('div');researchPanel.className='p11-operations-notes';researchPanel.innerHTML=research?`<button type="button" class="btn btn-outline-primary" data-operation-view="jobs">${bi('进行中的研究任务','Active research tasks')} <strong>${esc(research.active_jobs)}</strong></button><button type="button" class="btn btn-outline-primary" data-operation-view="research">${bi('待处理资料任务','Evidence tasks')} <strong>${esc(research.evidence_tasks)}</strong></button>`:bi('研究状态暂未读取，请刷新。','Research status is unavailable. Refresh to retry.');host.prepend(researchPanel);
    const monitor=data.monitoring||{};
    const alertLabels={IMAP_CHECKPOINT_STALE:['收信更新延迟','Inbox update delayed'],IMAP_SYNC_FAILURE:['收信需要检查','Inbox sync needs attention'],UIDVALIDITY_CHANGED:['邮箱记录编号已更新','Mailbox numbering changed'],SEND_AMBIGUOUS:['发送结果待核对','Send result needs review'],OUTBOUND_STUCK:['发送处理超时','Send processing overdue'],CRM_OUTBOX_LAG:['跟进同步延迟','Follow-up sync delayed'],INBOUND_CORRELATION_CONFLICT:['回复关联待核对','Reply matching needs review'],SUPPRESSION_BYPASS:['停止联系规则待检查','Stop-contact rule needs review'],SMTP_AUTH_FAILURE:['发信连接待检查','Sending connection needs review']};
    const monitoring=document.createElement('section');monitoring.className='p11-monitor';monitoring.setAttribute('aria-label','运营监控 Operations monitoring');
    Object.assign(alertLabels,{INBOUND_CORRELATION_REVIEW:['来信关联待核对','Incoming mail needs matching'],SUPPRESSION_BLOCKED_ATTEMPT:['已阻止向退订地址发送','Suppressed-address attempts blocked'],CRM_RECONCILIATION_REQUIRED:['跟进同步结果待核对','Follow-up sync result needs review']});
    monitoring.innerHTML=`<h4>${bi('运营监控','Operations monitoring')}</h4><div class="p11-operations-notes"><span>${bi('发信配置','Sending setup')} ${monitor.smtp_configured?bi('已配置','Configured'):bi('待配置','Setup required')}</span><span>${bi('收信配置','Inbox setup')} ${monitor.imap_configured?bi('已配置','Configured'):bi('待配置','Setup required')}</span><span>${bi('最近收信更新','Last inbox update')} ${date(monitor.last_successful_sync)}</span><span>${bi('客户邮件发送','Customer sending')} ${monitor.prospect_pilot_open?bi('已启用','Enabled'):bi('已关闭','Closed')}</span></div>${monitor.alerts?.length?`<ul>${monitor.alerts.map(alert=>`<li>${bi(...(alertLabels[alert.code]||['运行状态待检查','Operations review required']))} · ${esc(alert.count)}</li>`).join('')}</ul>`:bi('当前无待处理运行提醒','No current operational alerts')}`;
    host.append(monitoring);
    host.querySelectorAll('[data-operation-view]').forEach(button=>button.addEventListener('click',()=>document.querySelector(`[data-app-nav="${button.dataset.operationView}"]`)?.click()));
    host.querySelectorAll('[data-outreach-open]').forEach(button=>button.addEventListener('click',()=>document.querySelector('[data-app-nav="contact-queue"]')?.click()));
  }catch{host.innerHTML=bi('运营状态读取未完成，请刷新重试。','Operations could not be loaded. Refresh to retry.');}
  finally{host.setAttribute('aria-busy','false');}
}
q('outreach-operations-refresh')?.addEventListener('click',loadOperations);
document.addEventListener('crm:viewchange',event=>{if(event.detail?.view==='contact-queue')load().catch(()=>{});if(event.detail?.view==='overview')loadOperations();});
if(location.hash==='#contact-queue')load().catch(()=>{});
if(location.hash==='#overview')loadOperations();
