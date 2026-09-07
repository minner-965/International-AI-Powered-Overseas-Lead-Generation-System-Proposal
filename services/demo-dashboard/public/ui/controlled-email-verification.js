import { managementRequest } from '../phase7-ui.js';

const text = value => String(value ?? '').trim();
const esc = value => text(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const bi = (zh,en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const items = payload => Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];

const STATUS = Object.freeze({
  PENDING_REVIEW:['待审核','Pending review','review'],
  APPROVED:['已批准','Approved','active'],
  REJECTED:['已拒绝','Rejected','rejected'],
  SUPERSEDED:['已替换','Superseded','rejected'],
  PENDING_MANAGEMENT_APPROVAL:['待管理确认','Management approval pending','review'],
  MANAGEMENT_APPROVED:['已完成管理确认','Management approved','active'],
  DRAFT_PENDING:['草稿待审核','Draft approval pending','review'],
  DRAFT_APPROVED:['草稿已批准','Draft approved','active'],
  SEND_QUEUED:['已提交','Submitted','active'],
  SENDING:['正在提交','Submitting','review'],
  AWAITING_REPLY:['等待回复','Awaiting reply','active'],
  REPLIED:['已收到回复','Reply received','active'],
  OPTED_OUT:['已退订','Opted out','rejected'],
  FAILED:['提交失败','Submission failed','rejected'],
  SEND_AMBIGUOUS:['需要人工核对','Manual check required','review'],
  CLOSED:['已关闭','Closed','rejected']
});

const PURPOSE = Object.freeze({
  COLD_OUTREACH:['业务联系','Business contact'],
  OPT_IN:['已同意联系','Opt-in contact'],
  TRANSACTIONAL:['业务往来','Transactional message']
});

const state = { contexts:[], runtime:null, selectedId:null, detail:null, busy:false };

function statusInfo(value){ return STATUS[text(value).toUpperCase()] || ['待确认','To confirm','unknown']; }
function statusBadge(value){ const [zh,en,tone]=statusInfo(value);return `<span class="data-state-badge state-${tone}">${bi(zh,en)}</span>`; }
function dateLabel(value){ if(!value)return '-';const parsed=new Date(value);return Number.isNaN(parsed.valueOf())?'-':parsed.toLocaleString(); }
function latestDraft(){ const drafts=Array.isArray(state.detail?.drafts)?state.detail.drafts:[];return drafts.at(-1)||null; }

function setFeedback(zh,en,tone='info'){
  const host=document.querySelector('#controlled-mail-feedback');if(!host)return;
  host.dataset.tone=tone;host.innerHTML=bi(zh,en);
}

function clearFeedback(){ const host=document.querySelector('#controlled-mail-feedback');if(host){host.textContent='';delete host.dataset.tone;} }

function setBusy(button,busy){
  if(!button)return;
  button.toggleAttribute('aria-busy',busy);button.disabled=busy;
}

function errorFeedback(error){
  const code=text(error?.code).toUpperCase();
  if(code==='MANAGEMENT_ROLE_FORBIDDEN')return setFeedback('当前账号没有完成此步骤的权限。','The current account is not permitted to complete this step.','error');
  if(code==='CONTROLLED_SEND_GATE_BLOCKED')return setFeedback('发送准备条件尚未满足，请刷新状态后再检查。','Send readiness requirements are not yet met. Refresh and check again.','error');
  if(code.includes('APPROVAL'))return setFeedback('审批状态已变化，请刷新后重新核对。','The approval state changed. Refresh and review it again.','error');
  if(code.includes('DRAFT'))return setFeedback('草稿状态不符合当前操作，请刷新后重新核对。','The draft is not ready for this action. Refresh and review it again.','error');
  setFeedback('当前操作未完成，请刷新状态后重试。','The operation was not completed. Refresh and try again.','error');
}

function renderRuntime(){
  const host=document.querySelector('#controlled-mail-runtime');if(!host)return;
  const runtime=state.runtime||{};
  const configured=runtime.recipient_configured===true;
  const ready=runtime.ready===true;
  host.innerHTML=`<div><span class="p11-runtime-label">${bi('受控地址','Controlled address')}</span><strong>${configured?bi('已配置','Configured'):bi('尚未配置','Not configured')}</strong></div><div><span class="p11-runtime-label">${bi('提交状态','Submission readiness')}</span><strong class="p11-runtime-${ready?'ready':'hold'}">${ready?bi('可以提交','Ready'):bi('等待管理员启用','Administrator action required')}</strong></div>`;
}

function renderContexts(){
  const host=document.querySelector('#controlled-context-list');const count=document.querySelector('#controlled-context-count');if(!host)return;
  if(count)count.textContent=String(state.contexts.length);
  if(!state.contexts.length){
    host.innerHTML=`<div class="p8-empty-state"><i class="ti ti-mail-off" aria-hidden="true"></i><p>${bi('尚无受控验证记录，请先由管理员完成受控地址配置。','No controlled verification context is available. Ask an administrator to complete the controlled-address setup.')}</p></div>`;
    return;
  }
  host.innerHTML=state.contexts.map((context,index)=>`<button class="p11-controlled-context${context.id===state.selectedId?' is-selected':''}" type="button" data-controlled-context-id="${esc(context.id)}" aria-pressed="${context.id===state.selectedId?'true':'false'}"><span><strong>${bi(`验证记录 ${index+1}`,`Verification context ${index+1}`)}</strong><small>${esc(dateLabel(context.created_at))}</small></span>${statusBadge(context.context_status)}</button>`).join('');
  host.querySelectorAll('[data-controlled-context-id]').forEach(button=>button.addEventListener('click',()=>selectContext(button.dataset.controlledContextId,button)));
}

function stepForStatus(status){
  return ({PENDING_MANAGEMENT_APPROVAL:'management',MANAGEMENT_APPROVED:'draft',DRAFT_PENDING:'approval',DRAFT_APPROVED:'enqueue',SEND_QUEUED:'enqueue',SENDING:'enqueue',AWAITING_REPLY:'enqueue',REPLIED:'enqueue',OPTED_OUT:'enqueue',FAILED:'enqueue',SEND_AMBIGUOUS:'enqueue',CLOSED:'enqueue'})[text(status).toUpperCase()]||'context';
}

function renderSteps(){
  const current=state.detail?stepForStatus(state.detail.context_status):'context';
  document.querySelectorAll('[data-controlled-step]').forEach(step=>{
    if(step.dataset.controlledStep===current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
  });
}

function renderWorkflow(){
  const createContext=document.querySelector('#controlled-context-create');
  if(createContext)createContext.disabled=state.busy||!state.runtime?.recipient_configured;
  const empty=document.querySelector('#controlled-workflow-empty');const content=document.querySelector('#controlled-workflow-content');
  if(!empty||!content)return;
  if(!state.detail){empty.hidden=false;content.hidden=true;renderSteps();return;}
  empty.hidden=true;content.hidden=false;renderSteps();
  const detail=state.detail;const draft=latestDraft();const contextStatus=text(detail.context_status).toUpperCase();
  let crmHost=document.querySelector('#controlled-crm-summary');
  if(!crmHost){crmHost=document.createElement('section');crmHost.id='controlled-crm-summary';crmHost.className='p11-monitor';document.querySelector('#controlled-context-summary')?.after(crmHost);}
  const crm=detail.crm||{};
  const activities=Array.isArray(crm.activities)?crm.activities:[];
  const tasks=Array.isArray(crm.tasks)?crm.tasks:[];
  const completed=Array.isArray(crm.outbox)?crm.outbox.filter(row=>row.sync_status==='SYNCED').length:0;
  const activityLabels={FOLLOW_UP_REQUIRED:['回复待复核','Reply review required'],REPLIED:['收到回复','Reply received'],OPTED_OUT:['已停止联系','Contact stopped'],AUTO_REPLY:['自动回复','Automatic reply'],BOUNCED:['退信','Bounce']};
  crmHost.innerHTML=`<h4>${bi('回复与跟进记录','Reply & follow-up records')}</h4><div class="p11-operations-notes"><span>${bi('同步状态','Sync status')} ${crm.status==='SYNCED'?bi('已同步','Synced'):bi('待同步','Pending sync')}</span><span>${bi('已处理记录','Processed records')} ${esc(completed)}</span><span>${bi('负责人','Owner')} ${esc(crm.owner||'—')}</span><span>${bi('下一步','Next action')} ${crm.next_action==='STOP_CONTACT'?bi('停止联系','Stop contact'):crm.next_action==='REVIEW_REPLY'?bi('复核回复','Review reply'):bi('暂无待办','No pending action')}</span><span>${bi('跟进时间','Follow-up due')} ${esc(dateLabel(crm.due_at))}</span></div><details><summary>${bi('查看活动和任务','View activities and tasks')}</summary><ol class="p11-activity-list">${activities.map(row=>`<li>${bi(...(activityLabels[row.activity_type]||['跟进记录已更新','Follow-up updated']))}<time>${esc(dateLabel(row.created_at))}</time></li>`).join('')||`<li>${bi('暂无活动','No activities')}</li>`}</ol><ul class="p11-activity-list">${tasks.map(row=>`<li>${bi('回复复核任务','Reply review task')} · ${row.closed_at?bi('已关闭','Closed'):bi('待处理','Pending')}<p>${bi('负责人','Owner')} ${esc(row.owner||'—')} · ${bi('计划时间','Due')} ${esc(dateLabel(row.due_at))}</p></li>`).join('')||`<li>${bi('暂无跟进任务','No follow-up tasks')}</li>`}</ul></details>`;
  const purpose=PURPOSE[text(detail.provider_purpose).toUpperCase()]||['待确认','To confirm'];
  const summary=document.querySelector('#controlled-context-summary');
  if(summary)summary.innerHTML=`<div><span>${bi('当前状态','Current status')}</span>${statusBadge(contextStatus)}</div><div><span>${bi('验证用途','Verification purpose')}</span><strong>${bi(...purpose)}</strong></div><div><span>${bi('受控地址','Controlled address')}</span><strong>${state.runtime?.recipient_configured?bi('已配置','Configured'):bi('尚未配置','Not configured')}</strong></div><div><span>${bi('单次上限','Message limit')}</span><strong>${esc(detail.max_messages??'-')}</strong></div>`;

  const management=document.querySelector('#controlled-management-approve');
  if(management)management.disabled=state.busy||contextStatus!=='PENDING_MANAGEMENT_APPROVAL';
  const draftAllowed=['MANAGEMENT_APPROVED','DRAFT_PENDING'].includes(contextStatus);
  const subject=document.querySelector('#controlled-draft-subject');const body=document.querySelector('#controlled-draft-body');const create=document.querySelector('#controlled-draft-create');
  if(subject){subject.disabled=!draftAllowed||state.busy;if(draft&&document.activeElement!==subject)subject.value=text(draft.subject);}
  if(body){body.disabled=!draftAllowed||state.busy;if(draft&&document.activeElement!==body)body.value=text(draft.body_text);}
  if(create)create.disabled=!draftAllowed||state.busy;
  const draftState=document.querySelector('#controlled-draft-state');
  if(draftState)draftState.innerHTML=draft?statusBadge(draft.draft_status):bi('保存草稿后可审核。','Save a draft before approval.');
  const approve=document.querySelector('#controlled-draft-approve');
  if(approve)approve.disabled=state.busy||!draft||text(draft.draft_status).toUpperCase()!=='PENDING_REVIEW';
  const confirm=document.querySelector('#controlled-send-confirm');const enqueue=document.querySelector('#controlled-send-enqueue');
  const approved=contextStatus==='DRAFT_APPROVED'&&draft&&text(draft.draft_status).toUpperCase()==='APPROVED';
  if(confirm){confirm.disabled=!approved||state.busy;if(!approved)confirm.checked=false;}
  if(enqueue)enqueue.disabled=state.busy||!approved||!state.runtime?.ready||!confirm?.checked;
}

async function refresh({keepSelection=true}={}){
  const panel=document.querySelector('#controlled-mail-panel');const refreshButton=document.querySelector('#controlled-mail-refresh');
  state.busy=true;if(panel)panel.setAttribute('aria-busy','true');setBusy(refreshButton,true);renderWorkflow();
  try{
    const [runtime,contexts]=await Promise.all([
      managementRequest('/api/outreach/controlled-tests/runtime'),
      managementRequest('/api/outreach/controlled-tests?limit=20')
    ]);
    state.runtime=runtime;state.contexts=items(contexts);
    if(!keepSelection||!state.contexts.some(item=>item.id===state.selectedId)){state.selectedId=null;state.detail=null;}
    if(state.selectedId)state.detail=await managementRequest(`/api/outreach/controlled-tests/${encodeURIComponent(state.selectedId)}`);
    renderRuntime();renderContexts();renderWorkflow();
  }catch(error){errorFeedback(error);}
  finally{state.busy=false;if(panel)panel.setAttribute('aria-busy','false');setBusy(refreshButton,false);renderWorkflow();}
}

async function selectContext(id,button){
  if(state.busy||!id)return;clearFeedback();document.querySelector('#controlled-draft-form')?.reset();state.busy=true;state.selectedId=id;renderContexts();renderWorkflow();button?.setAttribute('aria-busy','true');
  try{state.detail=await managementRequest(`/api/outreach/controlled-tests/${encodeURIComponent(id)}`);renderWorkflow();document.querySelector('#controlled-workflow-title')?.focus?.();}
  catch(error){state.selectedId=null;state.detail=null;errorFeedback(error);}
  finally{state.busy=false;button?.removeAttribute('aria-busy');renderContexts();renderWorkflow();}
}

async function runAction(button,operation,success){
  if(state.busy)return;clearFeedback();state.busy=true;setBusy(button,true);renderWorkflow();
  try{await operation();await refresh();setFeedback(...success,'success');}
  catch(error){errorFeedback(error);}
  finally{state.busy=false;button?.removeAttribute('aria-busy');renderWorkflow();}
}

function wireActions(){
  const createContext=document.querySelector('#controlled-context-create');
  createContext?.addEventListener('click',()=>runAction(createContext,()=>managementRequest('/api/outreach/controlled-tests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context_label:'OQ10 controlled application E2E',provider_purpose:'COLD_OUTREACH',max_messages:state.runtime?.max_messages||1})}),['受控验证记录已创建，请选择记录继续。','Controlled verification context created. Select it to continue.']));
  document.querySelector('#controlled-mail-refresh')?.addEventListener('click',()=>{clearFeedback();refresh();});
  const management=document.querySelector('#controlled-management-approve');
  management?.addEventListener('click',()=>runAction(management,()=>managementRequest(`/api/outreach/controlled-tests/${encodeURIComponent(state.selectedId)}/management-approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'APPROVED'})}),['管理确认已保存。','Management approval was saved.']));
  const form=document.querySelector('#controlled-draft-form');
  form?.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);const subject=text(data.get('subject'));const bodyText=text(data.get('body_text'));if(!subject||!bodyText){setFeedback('请填写主题和正文。','Enter both a subject and message.','error');return;}const button=document.querySelector('#controlled-draft-create');runAction(button,()=>managementRequest(`/api/outreach/controlled-tests/${encodeURIComponent(state.selectedId)}/drafts`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject,body_text:bodyText})}),['草稿已保存，请继续审核。','Draft saved. Continue to draft approval.']);});
  const approve=document.querySelector('#controlled-draft-approve');
  approve?.addEventListener('click',()=>{const draft=latestDraft();if(!draft)return;runAction(approve,()=>managementRequest(`/api/outreach/controlled-tests/${encodeURIComponent(state.selectedId)}/drafts/${encodeURIComponent(draft.id)}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'APPROVED'})}),['草稿已批准，请完成最终确认。','Draft approved. Complete the final confirmation.']);});
  const confirm=document.querySelector('#controlled-send-confirm');confirm?.addEventListener('change',renderWorkflow);
  const enqueue=document.querySelector('#controlled-send-enqueue');
  enqueue?.addEventListener('click',()=>{const draft=latestDraft();if(!draft||!confirm?.checked||!state.runtime?.ready)return;runAction(enqueue,()=>managementRequest(`/api/outreach/controlled-tests/${encodeURIComponent(state.selectedId)}/drafts/${encodeURIComponent(draft.id)}/enqueue`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),['单封验证已提交，可刷新查看状态。','The one-message verification was submitted. Refresh to view its status.']);});
}

export function initControlledEmailVerification(){
  if(!document.querySelector('#controlled-mail-panel'))return;
  wireActions();refresh({keepSelection:false});
}

initControlledEmailVerification();
