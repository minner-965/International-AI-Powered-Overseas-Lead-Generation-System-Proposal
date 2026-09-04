import { managementRequest } from '../phase7-ui.js';
import { phase8StatusMarkup } from './status.js';

const host = document.querySelector('#contact-queue-list');
const status = document.querySelector('#contact-queue-status');
const routeHost = document.querySelector('#manual-official-route-list');
const routeStatus = document.querySelector('#manual-official-route-status');
let loaded = false;
const text = value => String(value ?? '').trim();
const esc = value => text(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const rows = payload => Array.isArray(payload) ? payload : payload?.items || [];
const date = value => value ? new Date(value).toLocaleString() : '-';
const safeUrl = value => { try { const url=new URL(text(value));return ['http:','https:'].includes(url.protocol)?url.href:''; } catch { return ''; } };
async function workspaceRequest(url){
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error||response.statusText||'Request failed');
  return payload;
}
const routeLabels=Object.freeze({
  SUPPLIER_PORTAL:['供应商入口','Supplier portal'],VENDOR_REGISTRATION:['供应商注册','Vendor registration'],
  CONTACT_FORM:['企业联系表单','Contact form'],PROCUREMENT_DEPARTMENT_EMAIL:['采购部门邮箱','Procurement department email'],
  PROCUREMENT_DEPARTMENT_PHONE:['采购部门电话','Procurement department phone']
});
const manualStatus=value=>{
  const state={READY:['待处理','Ready'],IN_PROGRESS:['处理中','In progress'],COMPLETED:['已完成','Completed'],DISMISSED:['不采用','Dismissed']}[text(value).toUpperCase()]||['待确认','To confirm'];
  return `<span class="p8-status ${value==='IN_PROGRESS'?'is-evidence':'is-approved'}">${bi(state[0],state[1])}</span>`;
};

function emptyState() {
  return `<div class="p8-empty-state"><i class="ti ti-address-book-off" aria-hidden="true"></i><h3>${bi('当前没有待联系记录', 'No approved contacts are queued')}</h3><button class="btn btn-outline-primary" type="button" data-open-view="opportunities">${bi('查看业务机会', 'Open Opportunities')}</button></div>`;
}

function render(items) {
  if (!host) return;
  const readiness=item=>[
    item.named_buyer_ready&&bi('具名买手','Named buyer'),item.official_email_route&&bi('官方邮箱','Official email'),
    item.official_phone_route&&bi('人工电话','Manual phone'),item.official_whatsapp_route&&bi('人工 WhatsApp','Manual WhatsApp'),
    item.official_form_route&&bi('人工表单','Manual form'),item.supplier_vendor_route&&bi('供应商入口','Supplier route')
  ].filter(Boolean).join(' · ')||bi('路径待补充','Route required');
  host.innerHTML = items.length ? items.map(item => `<article class="crm-contact-queue-row">
    <div><strong>${esc(item.company_name || '-')}</strong><span class="crm-row-secondary">${esc(item.country_code || '-')} / ${esc(item.product_profile || '-')}</span></div>
    <div><small>${bi('队列状态', 'Queue status')}</small>${phase8StatusMarkup(item.queue_status || 'ACTIVE')}</div>
    <div><small>${bi('负责人', 'Owner')}</small><span>${esc(item.owner_identity || '-')}</span></div>
    <div><small>${bi('可用联系路径', 'Available route')}</small><span>${readiness(item)}</span><span class="crm-row-secondary">${bi('各种路径分别显示，不等同于已核验买手','Routes are separate; only a named buyer is labelled as such')}</span></div>
    <div><small>${bi('下一步', 'Next action')}</small><button class="btn btn-outline-primary" type="button" data-open-view="companies">${bi('查看客户主档', 'View company')}</button></div>
  </article>`).join('') : emptyState();
  host.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => document.querySelector(`[data-app-nav="${button.dataset.openView}"]`)?.click()));
}

function manualRouteEmpty(){
  return `<div class="p8-empty-state"><i class="ti ti-route-off" aria-hidden="true"></i><h3>${bi('当前没有待处理的官方采购路径','No official procurement routes need action')}</h3><p>${bi('新发现并核验的供应商入口、采购表单或采购部门联系方式会显示在这里。','Newly confirmed supplier portals, contact forms, and procurement department routes will appear here.')}</p></div>`;
}

function routeActionForm(item){
  if(item.manual_action_status==='READY')return `<button class="btn btn-outline-primary" type="button" data-route-action="IN_PROGRESS" data-route-id="${esc(item.id)}">${bi('开始处理','Start review')}</button>`;
  return `<form class="p10-manual-route-action" data-route-form="${esc(item.id)}"><label>${bi('处理结果','Outcome')}<textarea class="form-control" name="outcome" rows="2" maxlength="2000" required></textarea></label><div class="p10-manual-route-buttons"><button class="btn btn-primary" type="submit" name="status" value="COMPLETED">${bi('完成','Complete')}</button><button class="btn btn-outline-secondary" type="submit" name="status" value="DISMISSED">${bi('不采用','Dismiss')}</button></div><div class="crm-operation-status" data-route-feedback role="status" aria-live="polite"></div></form>`;
}

function renderManualRoutes(items){
  if(!routeHost)return;
  routeHost.innerHTML=items.length?items.map(item=>{
    const label=routeLabels[item.route_type]||['官方采购路径','Official procurement route'];
    const href=safeUrl(item.official_url);
    const routeValue=item.official_contact||item.official_url;
    return `<article class="crm-contact-queue-row p10-manual-route-row"><div><strong>${esc(item.company_name||'-')}</strong><span class="crm-row-secondary">${esc(item.country_code||'-')} / ${esc(item.product_profile||'-')}</span></div><div><small>${bi('路径类型','Route type')}</small><span>${bi(label[0],label[1])}</span></div><div class="p10-manual-route-value"><small>${bi('官方路径','Official route')}</small>${href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(routeValue)}</a>`:`<span>${esc(routeValue)}</span>`}<span class="crm-row-secondary">${esc(date(item.verified_at))}</span></div><div><small>${bi('处理状态','Action status')}</small>${manualStatus(item.manual_action_status)}</div><div>${routeActionForm(item)}</div></article>`;
  }).join(''):manualRouteEmpty();
  routeHost.querySelectorAll('[data-route-action]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;button.setAttribute('aria-busy','true');
    try{await managementRequest(`/api/manual-official-routes/${button.dataset.routeId}/actions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:button.dataset.routeAction,request_id:crypto.randomUUID()})});await loadManualOfficialRoutes({force:true});}
    catch{if(routeStatus)routeStatus.innerHTML=bi('操作未完成，请重试。','The action was not completed. Try again.');button.disabled=false;button.removeAttribute('aria-busy');}
  }));
  routeHost.querySelectorAll('[data-route-form]').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();const submitter=event.submitter;const feedback=form.querySelector('[data-route-feedback]');
    form.setAttribute('aria-busy','true');form.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{await managementRequest(`/api/manual-official-routes/${form.dataset.routeForm}/actions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:submitter?.value,outcome:form.outcome.value,request_id:crypto.randomUUID()})});await loadManualOfficialRoutes({force:true});}
    catch{if(feedback)feedback.innerHTML=bi('请填写处理结果后重试。','Enter the outcome and try again.');form.removeAttribute('aria-busy');form.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }));
}

async function loadManualOfficialRoutes({force=false}={}){
  if(!routeHost||(loaded&&!force&&routeHost.dataset.loaded==='true'))return;
  routeHost.setAttribute('aria-busy','true');if(routeStatus)routeStatus.innerHTML=bi('正在读取官方采购路径','Loading official procurement routes');
  try{const payload=await workspaceRequest('/api/workspace/manual-official-routes?status=ACTIVE');const items=rows(payload);renderManualRoutes(items);routeHost.dataset.loaded='true';if(routeStatus)routeStatus.innerHTML=bi(`当前 ${items.length} 条待处理路径`,`${items.length} routes need action`);}
  catch{routeHost.innerHTML=`<div class="p8-empty-state"><i class="ti ti-alert-triangle" aria-hidden="true"></i><h3>${bi('官方采购路径读取未完成','Official procurement routes could not be loaded')}</h3><button id="manual-route-retry" class="btn btn-outline-primary" type="button">${bi('重试','Try again')}</button></div>`;routeHost.querySelector('#manual-route-retry')?.addEventListener('click',()=>loadManualOfficialRoutes({force:true}));if(routeStatus)routeStatus.textContent='';}
  finally{routeHost.removeAttribute('aria-busy');}
}

export async function loadContactQueue({ force = false } = {}) {
  if (!host || (loaded && !force)) return;
  host.setAttribute('aria-busy', 'true');
  if (status) status.innerHTML = bi('正在读取待联系记录', 'Loading Contact Queue');
  try {
    const payload = await workspaceRequest('/api/workspace/contact-queue');
    render(rows(payload));
    loaded = true;
    if (status) status.innerHTML = bi(`当前 ${rows(payload).length} 条待联系记录`, `${rows(payload).length} active queue items`);
  } catch (error) {
    host.innerHTML = `<div class="p8-empty-state"><i class="ti ti-alert-triangle" aria-hidden="true"></i><h3>${bi('待联系记录读取未完成', 'Contact Queue could not be loaded')}</h3><p>${bi('请确认管理访问后重试。', 'Confirm management access and try again.')}</p><button id="contact-queue-retry" class="btn btn-outline-primary" type="button">${bi('重试', 'Try again')}</button></div>`;
    host.querySelector('#contact-queue-retry')?.addEventListener('click', () => loadContactQueue({ force: true }));
    if (status) status.textContent = '';
  } finally {
    host.removeAttribute('aria-busy');
  }
}

document.addEventListener('crm:viewchange', event => {
  if (event.detail?.view === 'contact-queue'){loadContactQueue();loadManualOfficialRoutes();}
});

if (location.hash === '#contact-queue'){loadContactQueue();loadManualOfficialRoutes();}
