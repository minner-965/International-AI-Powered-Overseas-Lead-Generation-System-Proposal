import {activateView} from '../../crm-shell.js';
import {managementRequest} from '../../phase7-ui.js';
import {isMarketVisible} from '../../market-visibility.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bi=(zh,en)=>`<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const search=document.querySelector('#workspace-search-dialog');
const input=document.querySelector('#workspace-search-input');
const results=document.querySelector('#workspace-search-results');
let companies=[];
let requestId=0;
let opener;
function renderSearch(){
  const query=input.value.trim().toLocaleLowerCase();
  const matched=companies.filter(c=>[c.company_name,c.website,c.country_code,c.city].some(v=>String(v??'').toLocaleLowerCase().includes(query)));
  results.innerHTML=matched.slice(0,20).map(c=>`<button type="button" data-search-company="${esc(c.company_id||c.id)}"><strong>${esc(c.company_name)}</strong><small>${esc([c.country_code,c.city].filter(Boolean).join(' / '))}</small></button>`).join('')||bi('未找到符合条件的公司','No matching companies');
  document.querySelector('#workspace-search-count').textContent=`${matched.length} 家 / companies`;
  results.querySelectorAll('[data-search-company]').forEach(button=>button.addEventListener('click',()=>{
    search.close();
    activateView('companies');
    document.dispatchEvent(new CustomEvent('crm:opencompany',{detail:{companyId:button.dataset.searchCompany}}));
  }));
}
async function openSearch(trigger){
  if(document.querySelector('dialog[open]'))return;
  opener=trigger||document.activeElement;
  search.showModal(); input.focus();
  results.innerHTML=bi('正在读取公司','Loading companies');
  results.setAttribute('aria-busy','true');
  const current=++requestId;
  try{
    const data=await managementRequest('/api/leads');
    if(current!==requestId||!search.open)return;
    companies=(Array.isArray(data)?data:[]).filter(company=>isMarketVisible(company.country_code));
    renderSearch();
  }catch{
    if(current!==requestId||!search.open)return;
    results.innerHTML=bi('公司读取失败，请关闭后重试','Company loading failed. Close and retry.');
  }finally{if(current===requestId)results.setAttribute('aria-busy','false');}
}
document.querySelector('#workspace-search-open')?.addEventListener('click',event=>openSearch(event.currentTarget));
document.querySelector('#workspace-search-open')?.setAttribute('aria-label','搜索公司 / Search companies');
input?.addEventListener('input',renderSearch);
document.querySelector('#workspace-search-close')?.addEventListener('click',()=>search.close());
search?.addEventListener('close',()=>{requestId++;opener?.focus({preventScroll:true});});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){event.preventDefault();void openSearch(document.activeElement);}
});
document.querySelector('#workspace-new-research')?.addEventListener('click',event=>{
  activateView('research',{focus:false});
  document.dispatchEvent(new CustomEvent('crm:newresearch',{detail:{trigger:event.currentTarget}}));
});
document.querySelector('#workspace-attention-open')?.addEventListener('click',()=>{
  activateView('overview',{focus:false});
  requestAnimationFrame(()=>{const target=document.querySelector('#overview-attention');target?.setAttribute('tabindex','-1');target?.scrollIntoView({block:'center',behavior:'auto'});target?.focus({preventScroll:true});});
});
document.documentElement.dataset.workspaceUi='v3';
