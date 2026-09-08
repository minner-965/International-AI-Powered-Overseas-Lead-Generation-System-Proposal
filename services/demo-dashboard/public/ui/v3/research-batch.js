// MC05: registry selection and parent navigation; single-scope jobs remain unchanged.
import {productTaxonomyLabel} from '../../product-match-ui.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORAGE = 'dpv.research-batch.selection.v1';
let api, options, preview, timer, sequence=0, creating=false, loaded=false, selection={}, batchOpener;
const checked = name => $$(`input[name="${name}"]:checked`).map(input=>input.value);
const unique = values => [...new Set(values.flat().filter(Boolean))];
const categoryId = item => item.category_scope_id || item.id;
const categoryLabel = item => {
  const code=item.category_code||item.normalized_category||item.label;
  const extra={HOMEWARE:['家居百货','Homeware'],HOME_AND_LIVING:['家居生活用品','Home and Living'],HOUSEHOLD_GOODS:['家居用品','Household Goods'],NON_FOOD:['非食品百货','Non-food']};
  const labels=extra[code]||productTaxonomyLabel(code);return labels[1]==='To confirm'?[item.label||code,item.label||code]:labels;
};
const status = html => { const host=$('#research-create-status'); if(host)host.innerHTML=html; };
function save() {
  selection={...selection,market_codes:checked('market_code'),category_scope_ids:checked('product_category'),
    buyer_types:checked('buyer_type'),max_results:Number($('#research-limit')?.value||5),city:$('#research-city')?.value||'',region:$('#research-region')?.value||''};
  try { sessionStorage.setItem(STORAGE,JSON.stringify(selection)); } catch {}
}
function payload() { save(); return {...selection,select_all_markets:false,select_all_categories:false}; }
function counts() {
  const markets=checked('market_code'),categories=checked('product_category');
  return {markets,categories,total:markets.length*categories.length};
}
function updateCounts() {
  const {markets,categories,total}=counts();
  for(const [id,name] of [['research-market-all','market_code'],['research-category-all','product_category']]){
    const all=$(`#${id}`), inputs=$$(`input[name="${name}"]`), number=inputs.filter(input=>input.checked).length;
    all.checked=inputs.length>0&&number===inputs.length;all.indeterminate=number>0&&number<inputs.length;
  }
  $('#research-selection-counts').innerHTML=[['已选市场','Markets selected',markets.length],['已选类目','Categories selected',categories.length],['研究范围','Market × category scopes',`${markets.length} × ${categories.length} = ${total}`]].map(([zh,en,value])=>`<div><span>${api.bi(zh,en)}</span><strong>${api.esc(value)}</strong></div>`).join('');
  $('#start-research').disabled=creating||!loaded||!total||!preview;
  for(const id of ['research-city','research-region']){const input=$(`#${id}`);input.disabled=markets.length!==1;if(input.disabled)input.value='';}
  const country=$('#research-country'); if(country)country.value=options?.markets.find(item=>item.market_code===markets[0])?.country_name||'';
}
function changed() {
  sequence++;selection.idempotency_key=null;preview=null;save();updateCounts();
  clearTimeout(timer);timer=setTimeout(()=>void loadPreview(),160);
}
async function loadPreview() {
  const requestId=++sequence;
  if(!counts().total){preview=null;$('#research-catalog-summary').innerHTML=api.bi('请选择可用市场与目标类目','Select an available market and target category');batchScopeReview();return;}
  $('#research-catalog-summary').innerHTML=api.bi('正在核对研究范围','Checking research scope');
  try {
    const result=await api.request('/api/research/batches/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});
    if(requestId!==sequence)return;
    preview=result;$('#research-catalog-summary').innerHTML=api.bi('研究范围已就绪','Research scope ready');
    batchScopeReview();updateCounts();
  }catch{
    if(requestId!==sequence)return;preview=null;updateCounts();
    $('#research-catalog-summary').innerHTML=`${api.bi('研究范围核对未完成','Research scope check incomplete')} <button type="button" class="btn btn-outline-secondary" id="research-preview-retry">${api.bi('重试','Retry')}</button>`;
    $('#research-preview-retry')?.addEventListener('click',()=>void loadPreview());
  }
}
export function batchScopeReview(){
  if(!api)return;
  const {markets,categories,total}=counts(), snapshot=preview?.research_scope_snapshot;
  const fields=[['已选市场','Markets selected',markets.length],['已选类目','Categories selected',categories.length],['研究范围','Market × category scopes',`${markets.length} × ${categories.length} = ${total}`],
    ['市场','Markets',(snapshot?.markets||options?.markets?.filter(item=>markets.includes(item.market_code))||[]).map(item=>item.country_name||item.market_code).join(' · ')],
    ['目标类目','Target categories',(snapshot?.categories||options?.categories?.filter(item=>categories.includes(categoryId(item)))||[]).map(item=>categoryLabel(item).join(' / ')).join(' · ')],
    ['客户类型','Buyer types',(preview?.buyer_types||checked('buyer_type')).join(' · ')],
    ['研究语言','Languages',(preview?.languages||[]).join(' · ')||'—'],['每个范围结果上限','Results per scope',$('#research-limit')?.value||5]];
  $('#research-scope-review').innerHTML=fields.map(([zh,en,value])=>`<div><small>${api.bi(zh,en)}</small><strong>${api.esc(value)}</strong></div>`).join('');
}
export function batchValidateScope(){
  if(!loaded||!counts().total){status(api.bi('请选择至少一个市场和一个目标类目','Select at least one market and one target category'));$('#research-market-all')?.focus();return false;}
  return true;
}
export async function refreshBatchOptions(){
  if(!api)return;
  const host=$('#research-registry-options');host?.setAttribute('aria-busy','true');
  try{
    const result=await api.request('/api/research/batches/options');
    options={...result,markets:(result.markets||[]).filter(item=>item.status==='ACTIVE'&&item.search_enabled===true),categories:(result.categories||[]).filter(item=>item.scope_status==='ACTIVE'&&item.approval_status==='APPROVED')};
    const markets=selection.market_codes||options.markets.slice(0,1).map(item=>item.market_code);
    const categories=selection.category_scope_ids||options.categories.slice(0,1).map(categoryId);
    const render=(rows,name,selected,key,label)=>rows.map(item=>`<label class="v3-registry-option"><input class="form-check-input" type="checkbox" name="${name}" value="${api.esc(key(item))}" ${selected.includes(key(item))?'checked':''}><span>${api.esc(label(item))}</span></label>`).join('');
    $('#research-market-options').innerHTML=render(options.markets,'market_code',markets,item=>item.market_code,item=>`${item.country_name} (${item.market_code})`);
    $('#research-category-options').innerHTML=options.categories.map(item=>`<label class="v3-registry-option"><input class="form-check-input" type="checkbox" name="product_category" value="${api.esc(categoryId(item))}" ${categories.includes(categoryId(item))?'checked':''}>${api.bi(...categoryLabel(item))}</label>`).join('');
    if(markets.length!==checked('market_code').length||categories.length!==checked('product_category').length)selection.idempotency_key=null;
    loaded=true;
    const buyerValues=selection.buyer_types||result.buyer_types||unique(options.markets.map(item=>item.buyer_types||[]));
    if(buyerValues.length)$$('input[name="buyer_type"]').forEach(input=>{input.checked=buyerValues.includes(input.value);});
    for(const [id,key] of [['research-limit','max_results'],['research-city','city'],['research-region','region']])if(selection[key]!==undefined)$(`#${id}`).value=selection[key];
    updateCounts();await loadPreview();
  }catch{
    loaded=false;$('#start-research').disabled=true;
    $('#research-catalog-summary').innerHTML=`${api.bi('市场与类目读取未完成','Markets and categories could not be loaded')} <button class="btn btn-outline-secondary" id="research-options-retry" type="button">${api.bi('重试','Retry')}</button>`;
    $('#research-options-retry')?.addEventListener('click',()=>void refreshBatchOptions());
  }finally{host?.setAttribute('aria-busy','false');}
}
async function create(event){
  event.preventDefault();if(creating||!batchValidateScope()||!preview)return;
  creating=true;updateCounts();$('#start-research').setAttribute('aria-busy','true');
  selection.idempotency_key ||= crypto.randomUUID();save();
  try{
    const batch=await api.request('/api/research/batches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});
    document.dispatchEvent(new CustomEvent('phase9:research-job-created',{detail:{batchId:batch.batch_id||batch.id}}));
    await openBatch(batch.batch_id||batch.id);
    void loadBatchList();
  }catch{status(api.bi('研究任务建立未完成，请重试','Research batch creation did not complete. Retry.'));}
  finally{creating=false;$('#start-research').removeAttribute('aria-busy');updateCounts();}
}
async function loadBatchList(){
  const host=$('#research-batch-list');if(!host)return;
  host.setAttribute('aria-busy','true');
  try{
    const result=await api.request('/api/research/batches');
    host.innerHTML=(result.items||[]).slice(0,10).map(batch=>`<article><div><strong>${api.esc(batch.created_at?new Date(batch.created_at).toLocaleString():'—')}</strong><span>${api.bi('研究范围','Scopes')}: ${api.esc(batch.total_scopes??batch.research_scope_snapshot?.scopes?.length??0)}</span></div><button type="button" class="btn btn-outline-primary" data-open-batch="${api.esc(batch.batch_id||batch.id)}">${api.bi('查看批次','View batch')}</button></article>`).join('')||api.bi('暂无研究批次','No research batches');
    host.querySelectorAll('[data-open-batch]').forEach(button=>button.addEventListener('click',()=>void openBatch(button.dataset.openBatch)));
  }catch{host.innerHTML=`${api.bi('批次列表读取未完成','Batch list could not be loaded')} <button type="button" class="btn btn-outline-secondary" data-batches-retry>${api.bi('重试','Retry')}</button>`;host.querySelector('[data-batches-retry]').addEventListener('click',()=>void loadBatchList());}
  finally{host.setAttribute('aria-busy','false');}
}
async function openBatch(id,{replace=false}={}){
  batchOpener=document.activeElement;
  document.dispatchEvent(new CustomEvent('phase9:research-job-open',{detail:{batchId:id}}));
  api.clearJobDetail({restoreFocus:false});
  if($('#jobs-empty'))$('#jobs-empty').hidden=true;
  const url=new URL(location.href);url.searchParams.set('batch',id);url.searchParams.delete('job');url.searchParams.set('jobs_tab','research');url.hash='jobs';
  history[replace?'replaceState':'pushState'](null,'',url);api.activateView('jobs',{updateHash:false});
  const host=$('#research-batch-detail');host.hidden=false;host.setAttribute('aria-busy','true');host.innerHTML=api.bi('正在读取研究批次','Loading research batch');
  try{
    const batch=await api.request(`/api/research/batches/${encodeURIComponent(id)}`), snapshot=batch.research_scope_snapshot||batch.scope_snapshot||{};
    host.innerHTML=`<header class="card-header crm-panel-header"><h3 class="card-title">${api.bi('研究批次','Research Batch')}</h3><button type="button" class="btn btn-outline-secondary" data-batch-back>${api.bi('返回研究','Back to Research')}</button></header><div class="card-body"><div class="p9-catalog-facts"><div><small>${api.bi('建立时间','Created')}</small><strong>${api.esc(batch.created_at?new Date(batch.created_at).toLocaleString():'—')}</strong></div><div><small>${api.bi('研究范围','Scopes')}</small><strong>${api.esc(batch.total_scopes??snapshot.scopes?.length??batch.children?.length??0)}</strong></div></div><p class="crm-helper">${api.bi('创建时的研究范围','Research scope at creation')}</p><div class="v3-batch-children">${(batch.children||[]).map(child=>`<article><div><strong>${api.esc(child.market_code)}</strong><span>${api.esc(snapshot.categories?.find(item=>categoryId(item)===child.category_scope_id)?.label||child.category_code||'')}</span></div><button type="button" class="btn btn-outline-primary" data-batch-child="${api.esc(child.job_id)}">${api.bi('查看任务','View job')}</button></article>`).join('')}</div></div>`;
    host.querySelector('[data-batch-back]').addEventListener('click',()=>{const back=new URL(location.href);back.searchParams.delete('batch');back.hash='research';history.pushState(null,'',back);host.hidden=true;api.activateView('research',{updateHash:false});requestAnimationFrame(()=>$('#research-new-job-open')?.focus({preventScroll:true}));});
    const stateLabel={QUEUED:['等待开始','Queued'],RUNNING:['进行中','Running'],COMPLETED:['已完成','Completed'],PARTIAL:['部分完成','Partially completed'],FAILED:['处理未完成','Not completed'],CANCELLED:['已取消','Cancelled']}[batch.status]||['等待更新','Awaiting update'];
    const stateBadge=document.createElement('span');stateBadge.className='data-state-badge state-unknown';stateBadge.innerHTML=api.bi(...stateLabel);host.querySelector('.card-title').after(stateBadge);
    const refresh=document.createElement('button');refresh.type='button';refresh.className='btn btn-outline-secondary';refresh.innerHTML=api.bi('刷新','Refresh');refresh.addEventListener('click',()=>void openBatch(id,{replace:true}));host.querySelector('.card-header').append(refresh);
    const frozen=document.createElement('details');frozen.className='v3-research-details';frozen.innerHTML=`<summary>${api.bi('创建范围详情','Scope at creation')}</summary><div class="p9-catalog-facts">${[['市场','Markets',snapshot.markets?.length??0],['类目','Categories',snapshot.categories?.length??0],['客户类型','Buyer types',unique((snapshot.scopes||[]).map(scope=>scope.buyer_types||[])).join(' · ')],['研究语言','Languages',unique((snapshot.scopes||[]).map(scope=>scope.languages||[])).join(' · ')]].map(([zh,en,value])=>`<div><small>${api.bi(zh,en)}</small><strong>${api.esc(value)}</strong></div>`).join('')}</div>`;host.querySelector('.v3-batch-children').before(frozen);
    host.querySelectorAll('[data-batch-child]').forEach(button=>{
      const child=batch.children.find(item=>item.job_id===button.dataset.batchChild);
      const category=snapshot.categories?.find(item=>categoryId(item)===child?.category_scope_id);if(category)button.closest('article').querySelector('div>span').innerHTML=api.bi(...categoryLabel(category));
      if(child?.reused){const note=document.createElement('small');note.className='crm-helper';note.innerHTML=api.bi('继续已有任务','Continue existing job');button.closest('article').querySelector('div').append(note);}
      if(child?.scope_snapshot?.configuration_reused){const detail=document.createElement('details');const effective=child.scope_snapshot.effective_job_scope||{};detail.innerHTML=`<summary>${api.bi('原任务执行范围','Existing execution scope')}</summary><p>${api.esc((effective.buyer_types||[]).join(' · '))}</p><p>${api.esc((effective.languages||[effective.preferred_language]).filter(Boolean).join(' · '))}</p>`;button.closest('article').querySelector('div').append(detail);}
    });
    host.querySelectorAll('[data-batch-child]').forEach(button=>button.addEventListener('click',()=>void api.openJobDetail(button.dataset.batchChild,{trigger:button})));
    host.tabIndex=-1;host.focus({preventScroll:true});
  }catch{host.innerHTML=`${api.bi('研究批次读取未完成','Research batch could not be loaded')} <button type="button" class="btn btn-outline-secondary" data-batch-retry>${api.bi('重试','Retry')}</button>`;host.querySelector('[data-batch-retry]').addEventListener('click',()=>void openBatch(id,{replace:true}));}
  finally{host.setAttribute('aria-busy','false');}
}
export function initializeResearchBatch(dependencies){
  api=dependencies;const form=$('#research-form');form.dataset.researchBatch='true';
  try{selection=JSON.parse(sessionStorage.getItem(STORAGE)||'{}');}catch{selection={};}
  const first=$('[data-research-step="1"] .p9-form-grid');
  first.id='research-registry-options';
  first.innerHTML=`<label hidden for="research-country"><select id="research-country" name="country"><option value=""></option></select></label><fieldset id="research-markets"><legend>${api.bi('市场','Markets')}</legend><label class="p9-category-all"><input id="research-market-all" type="checkbox" class="form-check-input"><span>${api.bi('全选已启用市场','Select all active markets')}</span></label><div id="research-market-options" class="v3-registry-options"></div></fieldset><fieldset id="research-category"><legend>${api.bi('目标类目','Target Categories')}</legend><label class="p9-category-all"><input id="research-category-all" type="checkbox" class="form-check-input"><span>${api.bi('全选已批准类目','Select all approved categories')}</span></label><div id="research-category-options" class="v3-registry-options"></div></fieldset>`;
  const counter=document.createElement('div');counter.id='research-selection-counts';counter.className='v3-scope-counts';counter.setAttribute('role','status');counter.setAttribute('aria-live','polite');counter.setAttribute('aria-atomic','true');$('#research-job-steps').after(counter);
  $('#research-product-profile')?.closest('label')?.setAttribute('hidden','');
  $('#research-product-profile').disabled=true;
  $('#research-step-three-title').innerHTML=api.bi('可选条件','Optional filters');
  const note=document.createElement('p');note.className='crm-helper';note.innerHTML=api.bi('城市与地区条件适用于单一市场','City and region filters apply to a single market');$('[data-research-step="3"]').append(note);
  $('#research-limit').closest('label').querySelector('.bi').innerHTML='<span lang="zh-CN">每个范围结果上限</span><span lang="en">Results per scope</span>';
  for(const [id,name] of [['research-market-all','market_code'],['research-category-all','product_category']])$(`#${id}`).addEventListener('change',event=>{$$(`input[name="${name}"]`).forEach(input=>{input.checked=event.target.checked;});if(name==='market_code')for(const field of ['research-city','research-region'])$(`#${field}`).value='';changed();});
  form.addEventListener('change',event=>{if(event.target.name==='market_code')for(const field of ['research-city','research-region'])$(`#${field}`).value='';if(!['research-market-all','research-category-all'].includes(event.target.id))changed();});
  form.addEventListener('submit',create);
  const parent=document.createElement('section');parent.id='research-batch-detail';parent.className='card crm-panel';parent.hidden=true;$('#research-job').before(parent);
  const list=document.createElement('section');list.className='card crm-panel';list.innerHTML=`<header class="card-header crm-panel-header"><h3 class="card-title">${api.bi('研究批次','Research batches')}</h3></header><div id="research-batch-list" class="card-body v3-batch-children"></div>`;$('#research-workbench-alerts').after(list);void loadBatchList();
  window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('batch');if(id&&location.hash==='#jobs')void openBatch(id,{replace:true});else{parent.hidden=true;api.activateView(location.hash.slice(1),{updateHash:false});}});
  const id=new URLSearchParams(location.search).get('batch');if(id)void openBatch(id,{replace:true});
  void refreshBatchOptions();
}
