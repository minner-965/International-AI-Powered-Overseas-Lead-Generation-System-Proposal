import {phase8StatusMarkup} from './status.js';
import {subscribeCommunicationChanges} from './communication-sync.js';

const host=document.querySelector('#contact-queue-list');
const status=document.querySelector('#contact-queue-status');
let loaded=false;
let generation=0;

const text=value=>String(value??'').trim();
const esc=value=>text(value).replace(/[&<>'"]/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const bi=(zh,en)=>`<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const rows=payload=>Array.isArray(payload)?payload:payload?.items||[];
const safeUrl=value=>{try{const url=new URL(text(value));return['http:','https:'].includes(url.protocol)?url.href:'';}catch{return'';}};
const categoryLabel=value=>({WOMENSWEAR:['女装','Womenswear'],GENERAL_MERCHANDISE:['日用百货','General Merchandise']}[text(value).toUpperCase()]||[text(value),text(value)]);
const routeLabel=value=>({BUSINESS_EMAIL:['官方邮箱','Official email'],GENERIC_BUSINESS_EMAIL:['官方邮箱','Official email'],DEPARTMENT_EMAIL:['部门邮箱','Department email'],
  BUSINESS_PHONE:['电话','Phone'],BUSINESS_WHATSAPP:['WhatsApp','WhatsApp'],CONTACT_FORM:['联系页面','Contact page']}[text(value).toUpperCase()]||['官方联系方式','Official contact']);

async function workspaceRequest(url){
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error||response.statusText||'Request failed');
  return payload;
}

function emptyState(){
  return `<div class="p8-empty-state"><i class="ti ti-address-book-off" aria-hidden="true"></i><h3>${bi('当前没有待联系公司','No contact-ready companies')}</h3><p>${bi('请查看业务机会及联系方式。','Review business opportunities and contact details.')}</p><button class="btn btn-outline-primary" data-tip="打开销售机会|Open opportunities" type="button" data-open-view="opportunities">${bi('查看业务机会','Open Opportunities')}</button></div>`;
}

function routeMarkup(route){
  const label=routeLabel(route.route_type);const value=text(route.value);const href=safeUrl(value);
  const rendered=href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>`:`<span>${esc(value)}</span>`;
  return `<li><small>${bi(label[0],label[1])}</small>${rendered}</li>`;
}

function render(items){
  if(!host)return;
  host.innerHTML=items.length?items.map(item=>{
    const categories=(item.matched_categories||[]).map(value=>{const label=categoryLabel(value);return bi(label[0],label[1]);}).join(' · ')||'-';
    const buyers=(item.named_buyers||[]).map(esc).join(' · ')||bi('未找到实名联系人','No named contact found');
    const routes=(item.contact_routes||[]).map(routeMarkup).join('');
    return `<article class="crm-contact-queue-row p10-contact-ready-row">
      <div><strong>${esc(item.company_name||'-')}</strong><span class="crm-row-secondary">${esc(item.country_code||'-')}</span></div>
      <div><small>${bi('匹配类目','Matched categories')}</small><span>${categories}</span></div>
      <details><summary>${bi('联系人资料','Contact details')}</summary><span>${buyers}</span></details>
      <div><small>${bi('官方联系方式','Official contacts')}</small><ul class="p10-contact-route-list">${routes}</ul></div>
      <div><small>${bi('机会状态','Opportunity status')}</small>${phase8StatusMarkup(item.opportunity_status||'RECOMMENDED')}</div>
      <div><button class="btn btn-outline-primary" data-tip="打开这家企业的详情|Open this company's details" type="button" data-company-id="${esc(item.company_id)}">${bi('查看公司','View company')}</button></div>
    </article>`;
  }).join(''):emptyState();
  host.querySelectorAll('[data-open-view]').forEach(button=>button.addEventListener('click',()=>document.querySelector(`[data-app-nav="${button.dataset.openView}"]`)?.click()));
  host.querySelectorAll('[data-company-id]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelector('[data-app-nav="companies"]')?.click();
    document.dispatchEvent(new CustomEvent('crm:opencompany',{detail:{companyId:button.dataset.companyId}}));
  }));
}

export async function loadContactQueue({force=false}={}){
  if(!host||(loaded&&!force))return;
  const ticket=++generation;
  host.setAttribute('aria-busy','true');
  if(status)status.innerHTML=bi('正在读取待联系公司','Loading contact-ready companies');
  try{
    const payload=await workspaceRequest('/api/workspace/contact-queue');const items=rows(payload);
    if(ticket!==generation)return;
    render(items);loaded=true;
    if(status)status.innerHTML=bi(`当前 ${items.length} 家待联系公司`,`${items.length} contact-ready companies`);
  }catch{
    if(ticket!==generation)return;
    host.innerHTML=`<div class="p8-empty-state"><i class="ti ti-alert-triangle" aria-hidden="true"></i><h3>${bi('待联系公司读取未完成','Contact-ready companies could not be loaded')}</h3><button id="contact-queue-retry" data-tip="重新读取待联系记录|Reload the contact queue" class="btn btn-outline-primary" type="button">${bi('重试','Try again')}</button></div>`;
    host.querySelector('#contact-queue-retry')?.addEventListener('click',()=>loadContactQueue({force:true}));
    if(status)status.textContent='';
  }finally{if(ticket===generation)host.removeAttribute('aria-busy');}
}

const visible=()=>!!host&&!host.closest('[hidden]')&&document.visibilityState!=='hidden';
let refreshScheduled=false;
function invalidate(){loaded=false;generation++;if(visible()&&!refreshScheduled){refreshScheduled=true;queueMicrotask(()=>{refreshScheduled=false;if(visible())loadContactQueue({force:true});});}}
subscribeCommunicationChanges(invalidate);
document.addEventListener('crm:viewchange',event=>{if(event.detail?.view === 'contact-queue'||event.detail?.view === 'contact-ready')invalidate();});
window.addEventListener('focus',invalidate);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')invalidate();});
if(location.hash==='#contact-queue')loadContactQueue();
