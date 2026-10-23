const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import { finiteCount, marketSeries, lazyChart } from './charts.js';
import { initialContactPending } from '../contact-progress.js';
import { hasOpportunityPool, isActiveBusinessOpportunity } from './opportunity-dimensions.js';
import { overdueText, crm, STAGES, taskTypePill, taskDot, when, stateBlock, skeletonRows } from '../v4/crm.js';
import { viewTip, tip } from '../v4/tooltips.js';
const bi = (zh,en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString();
const empty = (zh,en) => `<p class="v3-overview-empty">${bi(zh,en)}</p>`;
// V4 card: title with inline English, optional caption and header link.
const card = (id,zh,en,body,{caption=null,link:headerLink='',cls=''}={}) => `<section class="card v4-card ${cls}" aria-labelledby="${id}-title"><div class="ph"><div><h3 id="${id}-title">${bi(zh,en)}</h3>${caption?`<p>${bi(...caption)}</p>`:''}</div>${headerLink}</div>${body}</section>`;
const link = (view,zh,en) => `<a class="lnk v3-overview-link" href="#${view}" data-open-view="${view}"${viewTip(view)}>${bi(zh,en)}<i class="ti ti-chevron-right" aria-hidden="true"></i></a>`;
const marketLabels={AE:['阿联酋','UAE'],MX:['墨西哥','Mexico'],SA:['沙特阿拉伯','Saudi Arabia'],US:['美国','United States'],BD:['孟加拉国','Bangladesh']};
const donutColors=['var(--c1)','var(--c2)','var(--c3)','var(--c4)'];

export function marketDonut(markets,total) {
  const series=marketSeries(markets,total);
  if(series.state==='error')return empty('市场分布暂未读取，请刷新重试。','Market distribution unavailable. Refresh to retry.');
  if(series.state==='empty')return empty('暂无市场分布','No market distribution available');
  let offset=0;
  const rings=markets.map(([,count],i)=>{
    const fraction=count/total*100;
    const circle=`<circle cx="21" cy="21" r="15.915" fill="none" stroke="${donutColors[Math.min(i,donutColors.length-1)]}" stroke-width="5" pathLength="100" stroke-dasharray="${fraction} ${100-fraction}" stroke-dashoffset="${-offset}"/>`;
    offset+=fraction;return circle;
  }).join('');
  const label=market=>marketLabels[market] || [market,market];
  return `<div class="donut-wrap v3-overview-market-chart"><div class="donut"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--line-soft)" stroke-width="5"/>${rings}</svg><div class="mid v3-overview-market-total"><b>${number(total)}</b><span>${bi('家企业','companies')}</span></div></div><ul class="legend v3-overview-market-list" aria-label="市场分布 Market distribution">${markets.map(([market,count],i)=>`<li><i style="background:${donutColors[Math.min(i,donutColors.length-1)]}"></i><span class="bi"><span lang="zh-CN">${esc(label(market)[0])}</span><span lang="en">${esc(market)}</span></span><b>${number(count)} · ${Number((count/total*100).toFixed(1))}%</b></li>`).join('')}</ul></div>`;
}
function jobCategory(job) {
  const labels={WOMENSWEAR:['女装','Womenswear'],GENERAL_MERCHANDISE:['百货','General Merchandise'],
    'BUYER PROCUREMENT ENRICHMENT':['联系人资料','Contact Evidence'],BUYER_PROCUREMENT_ENRICHMENT:['联系人资料','Contact Evidence']};
  const category=String(job.product_category || '').trim();
  if(labels[category.toUpperCase()])return bi(...labels[category.toUpperCase()]);
  const profiles=(job.product_profiles || []).map(profile=>labels[profile]).filter(Boolean);
  if(profiles.length)return profiles.map(label=>bi(...label)).join('');
  return category?esc(category):bi('企业资料','Company Evidence');
}

export function overviewModel({metrics,opportunities,operations,research,getStatus}) {
  const sent = operations?.prospect?.sent_no_reply ?? null;
  const p=operations?.prospect;
  const pendingParts=p && ['pending_management','pending_drafts','pending_followups','pending_contacts'].every(key=>finiteCount(p[key])!==null) && Array.isArray(operations?.monitoring?.alerts)
    ? [['pending_management','待授权邮件联系','Email Contact Authorizations'],['pending_drafts','待审核草稿','Draft Reviews'],['pending_followups','回复与跟进','Replies & Follow-up'],['pending_contacts','待完善联系','Contact Evidence']].map(([key,zh,en])=>({key,zh,en,count:Number(p[key])})) : null;
  if(pendingParts)pendingParts.push({key:'alerts',zh:'运营提醒类别',en:'Operational Alert Types',count:(operations.monitoring?.alerts || []).length});
  const markets = new Map();
  const companies = new Set();
  for (const row of opportunities || []) {
    if (hasOpportunityPool(row) && !isActiveBusinessOpportunity(row)) continue;
    const id = row.company_id || row.companyId || row.id;
    if (!id || companies.has(id)) continue;
    companies.add(id);
    const market = row.country_code || row.market || '—';
    markets.set(market,(markets.get(market) || 0)+1);
  }
  return {recommended:opportunities ? new Set(opportunities.filter(row=>hasOpportunityPool(row)?isActiveBusinessOpportunity(row):getStatus(row)==='RECOMMENDED'&&initialContactPending(row)).map(row=>row.company_id||row.companyId||row.id)).size : null,
    verified:metrics?.verified_active ?? null,sent,pending:pendingParts?pendingParts.reduce((sum,item)=>sum+item.count,0):null,pendingParts,
    markets:[...markets].sort((a,b)=>b[1]-a[1]),marketTotal:Array.isArray(opportunities)?companies.size:null,
    operations:operations?.prospect || null};
}

// Phone workbench grid: every function stays reachable with a text label (no "more" menu).
const functions=[
  ['log-note','写跟进','Log note','pencil','b'],['log-call','记电话','Log call','phone','g'],['new-task','新建任务','New task','calendar-plus','a'],
  ['followups','跟进审批','Approvals','mail','b'],['companies','客户名录','Directory','building','b'],['research','研究任务','Research','list-search','g'],
  ['data-import','导入导出','Import/Export','arrows-down-up','a'],['settings','系统设置','Settings','adjustments-horizontal','n']
];
const QUICK_TIPS={'log-note':['写一条跟进备注','Write a follow-up note'],'log-call':['记录一次电话沟通','Log a phone call'],'new-task':['新建一项跟进任务','Create a follow-up task']};
const functionGrid=()=>`<section class="m-card v4-phone-only v4-function-grid" aria-label="常用功能 Functions"><div class="m-grid">${functions.map(([key,zh,en,icon,tone])=>{const view=['log-note','log-call','new-task'].includes(key)?null:key;return `<a href="#${view||(key==='new-task'?'tasks':'opportunities')}" ${view?`data-open-view="${view}"${viewTip(view)}`:`data-quick-action="${key}"${tip(...QUICK_TIPS[key])}`}><span class="m-ico ${tone}"><i class="ti ti-${icon}" aria-hidden="true"></i>${key==='followups'?'<b class="m-badge" data-nav-count="followups" hidden></b>':''}</span><span class="lab">${esc(zh)}<small>${esc(en)}</small></span></a>`;}).join('')}</div></section>`;

export function mountOverview() {
  const root = document.getElementById('view-overview');
  if (!root || root.dataset.v3Mounted) return;
  const reset = document.getElementById('reset');
  const runStatus = document.getElementById('run-status');
  root.dataset.v3Mounted='true';root.classList.add('v3-overview','v4-overview');
  root.innerHTML=`<header class="head v3-overview-heading"><div><h2 id="overview-title" class="bi"><span lang="zh-CN">总览</span><span lang="en">Overview</span></h2><p id="overview-last-refresh" class="meta"></p></div><div class="btns v3-overview-actions"><button type="button" data-tip="打开销售机会，按阶段跟进客户|Open opportunities by stage" class="btn" data-open-view="opportunities">${bi('销售机会','Opportunities')}</button><button type="button" data-tip="打开今天要处理的跟进任务|Open today's follow-up tasks" class="btn btn-primary" data-open-view="tasks">${bi('处理今日待办',"Today's tasks")}</button><button type="button" data-tip="重新读取总览数据|Reload the overview" id="outreach-operations-refresh" class="btn btn-icon" aria-label="刷新总览 Refresh Overview"><i class="ti ti-refresh" aria-hidden="true"></i></button></div></header>
  <div id="overview-run-slot"></div>
  <section id="metrics" class="grid4 v3-overview-metrics" aria-label="关键指标 Key figures" aria-busy="true">${['有效机会','已发开发信','收到回复','今日待办'].map(()=>'<div class="card kpi"><span class="skel" style="width:60%"></span><span class="skel" style="width:30%;height:24px;margin:12px 0"></span></div>').join('')}</section>
  ${functionGrid()}
  <div class="grid2">
    ${card('overview-pipeline','销售漏斗','Pipeline funnel',`<div class="pb" id="overview-pipeline" aria-live="polite">${skeletonRows(4)}</div>`,{caption:['按当前阶段累计 · 全部有效机会','Cumulative by current stage · all opportunities'],link:link('opportunities','销售机会','Opportunities')})}
    ${card('overview-markets','市场分布','Markets',`<div class="pb" id="overview-markets"></div>`,{caption:['当前机会覆盖的企业','Companies represented in current opportunities']})}
  </div>
  <div class="grid2b v4-overview-actions">
    ${card('overview-todo','今日待办','Due today',`<div id="overview-todo" aria-live="polite">${skeletonRows(3)}</div>`,{caption:['按截止时间排序','By due time'],link:link('tasks','全部任务','All tasks')})}
    ${card('overview-approvals','待审批','Approvals',`<div id="overview-approvals" aria-live="polite">${skeletonRows(2)}</div>`,{caption:['跟进邮件 · 批准后按计划发出','Follow-up email · sent as scheduled after approval'],link:link('followups','跟进邮件审批','Follow-up approval')})}
  </div>
  <div class="grid3 v4-overview-ops">
    ${card('outreach-operations','客户开发进展','Prospect development',`<div class="pb" id="outreach-operations" data-v3-overview="true" aria-live="polite"></div>`)}
    ${card('overview-tasks','研究任务','Research jobs',`<div class="pb" id="overview-tasks"></div>`,{link:link('jobs','查看任务','View jobs')})}
    ${card('overview-attention','待处理事项','Attention required',`<div class="pb" id="overview-attention"></div>`,{link:link('contact-queue','开发信审核','First-touch review')})}
  </div>
  <details class="v3-overview-more v4-directory-actions"><summary>${bi('名录管理','Directory actions')}</summary><div id="overview-directory-actions"></div>${link('data-export','导出报表','Export reports')}</details>`;
  if (reset) document.getElementById('overview-directory-actions').append(reset);
  if (runStatus) document.getElementById('overview-run-slot').append(runStatus);
  document.addEventListener('crm:viewchange',event=>{if(event.detail?.view==='overview')void loadOverviewCrm();});
  document.addEventListener('crm:changed',()=>{if(!root.hidden)void loadOverviewCrm();});
  root.addEventListener('click',event=>{if(event.target.closest('[data-state-retry]'))void loadOverviewCrm();});
  if(!root.hidden)void loadOverviewCrm();
}

export function markOverviewLoading() {
  for(const id of ['metrics','outreach-operations','overview-markets','overview-tasks','overview-attention']) {
    const element=document.getElementById(id);
    if(element) { element.setAttribute('aria-busy','true'); element.dataset.refreshing='true'; }
  }
  const stamp=document.getElementById('overview-last-refresh');
  if(stamp)stamp.innerHTML=bi('正在更新','Updating');
}

const crmState={tasks:undefined,drafts:undefined,pipeline:undefined,generation:0};
function kpi({zh,en,value,unit,sub='',attn=false,view}) {
  return `<a class="card kpi${attn?' attn':''}" href="#${view}" data-open-view="${view}"${viewTip(view)}><div class="lab">${bi(zh,en)}</div><div class="val">${number(value)}${value===null||value===undefined?'':`<small>${esc(unit)}</small>`}</div><div class="kpi-sub">${sub}</div></a>`;
}
let lastMetrics=null;
/** "本周 x 封 · 上周 y 封" from the overview first_touch metric; null until the backend provides it. */
export function firstTouchWeeks(metrics,operations) {
  const weeks=metrics?.first_touch ?? operations?.first_touch ?? operations?.prospect?.first_touch;
  const thisWeek=finiteCount(weeks?.this_week); const lastWeek=finiteCount(weeks?.last_week);
  if(thisWeek===null||lastWeek===null)return null;
  const trend=thisWeek>lastWeek?' up':thisWeek<lastWeek?' down':'';
  return `<span class="v4-week${trend}">${bi(`本周 ${number(thisWeek)} 封 · 上周 ${number(lastWeek)} 封`,`This week ${number(thisWeek)} · last week ${number(lastWeek)}`)}</span>`;
}
function renderKpis() {
  const host=document.getElementById('metrics');
  if(!host||!lastMetrics)return;
  const {metrics,model,operations}=lastMetrics;
  const bands=metrics?.opportunity_pool_bands;
  const active=metrics?.active_business_opportunities ?? model.recommended;
  const summary=crmState.tasks?.summary;
  const overdue=summary?.overdue ?? null;
  host.innerHTML=[
    kpi({zh:'有效机会',en:'Active opportunities',value:active,unit:'家',view:'opportunities',sub:bands?[['PRECISION','精准'],['RELEVANT','相关'],['GENERAL_RELEVANT','一般相关']].map(([key,zh])=>`<span class="tag">${zh} ${number(bands[key])}</span>`).join(''):''}),
    kpi({zh:'已发开发信',en:'First-touch sent',value:operations?.prospect?.smtp_accepted ?? null,unit:'封',view:'contact-queue',sub:firstTouchWeeks(metrics,operations)||(model.sent===null?'':bi(`已发未回复 ${number(model.sent)}`,`Awaiting reply ${number(model.sent)}`))}),
    kpi({zh:'收到回复',en:'Replies',value:operations?.prospect?.replies ?? null,unit:'封',view:'replies',sub:operations?.prospect?.pending_followups==null?'':bi(`待处理 ${number(operations.prospect.pending_followups)}`,`To review ${number(operations.prospect.pending_followups)}`)}),
    kpi({zh:'今日待办',en:'Due today',value:summary?.due_today ?? null,unit:'项',view:'tasks',attn:overdue>0,sub:crmState.tasks===null?bi('待办暂未读取','Tasks unavailable'):overdue>0?`<span class="down">${bi(`逾期 ${number(overdue)} 项`,`${number(overdue)} overdue`)}</span>`:summary?bi(`未完成 ${number(summary.open)} 项`,`${number(summary.open)} open`):''})
  ].join('');
  host.setAttribute('aria-busy','false');delete host.dataset.refreshing;
}

export function renderOverview({metrics,opportunities,operations,research,jobs,getStatus,onCompany}) {
  const model=overviewModel({metrics,opportunities,operations,research,getStatus});
  const set=(id,html)=>{const el=document.getElementById(id);if(el){el.innerHTML=html;el.setAttribute('aria-busy','false');delete el.dataset.refreshing;}};
  lastMetrics={metrics,model,operations};renderKpis();
  const stageValues={verified:model.verified,category:opportunities?opportunities.filter(row=>['CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'].includes(row.category_procurement_match_status)).length:null,
    contact:research?.contact_ready_opportunities ?? null,management:opportunities?opportunities.filter(row=>(hasOpportunityPool(row) ? row.management_contact_status==='MANAGEMENT_APPROVED'||row.display_opportunity_status==='MANAGEMENT_APPROVED' : getStatus(row)==='MANAGEMENT_APPROVED')&&initialContactPending(row)).length:null,
    sent:operations?.prospect?.smtp_accepted ?? null,replied:operations?.prospect?.replies ?? null};
  if (research?.opportunity_pool) {
    stageValues.category = research.opportunity_pool.active ?? null;
    stageValues.contact = research.opportunity_pool.contact_ready ?? null;
    stageValues.management = research.opportunity_pool.email_eligible ?? null;
  }
  const stages=[['verified','已验证企业','Verified companies'],['category','类目匹配机会','Category-matched'],['contact','联系方式就绪','Contact-ready'],['management','邮件资格通过','Email eligible'],['sent','已发邮件','Sent emails'],['replied','客户回复','Customer replies']];
  const max=Math.max(1,...Object.values(stageValues).map(value=>Number(value || 0)));
  set('outreach-operations',`<ol class="v3-overview-stages">${stages.map(([key,zh,en])=>`<li><span class="n">${bi(zh,en)}</span><span class="track v3-overview-track" aria-hidden="true"><span style="width:${Math.max(0,Number(stageValues[key] || 0))/max*100}%"></span></span><b>${number(stageValues[key])}</b></li>`).join('')}</ol><p class="v3-overview-caption">${bi('当前企业与机会 · 累计客户邮件与回复','Current companies & opportunities · Cumulative prospect mail & replies')}</p>`);
  set('overview-markets',marketDonut(model.markets,model.marketTotal));
  document.querySelectorAll('#outreach-operations .v3-overview-stages li').forEach((row,index)=>{
    if(finiteCount(stageValues[stages[index][0]])===null){
      row.dataset.state='unavailable';
      row.querySelector('.v3-overview-track')?.remove();
    }
  });
  if([metrics,opportunities,operations,research,jobs].some(source=>source===null || source===undefined)) {
    const note=document.getElementById('overview-last-refresh');
    if(note)note.dataset.partial='true';
  } else document.getElementById('overview-last-refresh')?.removeAttribute('data-partial');
  const chart=document.querySelector('#overview-markets .donut');
  const svg=chart?.querySelector('svg');
  if(svg){svg.style.visibility='hidden';lazyChart(chart,()=>{if(svg.isConnected)svg.style.visibility='visible';});}
  const stageLabels={QUEUED:['等待处理','Queued'],RUNNING:['处理中','In Progress'],DISCOVERING:['查找企业','Company Search'],CRAWLING:['查阅资料','Evidence Review'],QUALIFYING:['企业核验','Company Verification'],SCORING:['客户评估','Prospect Assessment'],COMPLETED:['已完成','Completed'],WAITING_EVIDENCE:['待完善资料','Evidence Pending'],FAILED_RETRYABLE:['待重试','Retry Required'],FAILED_FINAL:['待检查','Review Required']};
  const recentJobs=jobs?.items || [];
  const date=value=>value && Number.isFinite(new Date(value).getTime())?esc(new Date(value).toLocaleString()):'—';
  const jobsHtml=jobs?recentJobs.length?`<ul class="v3-overview-job-list">${recentJobs.map(job=>`<li><div class="v3-overview-job-heading"><strong>${esc((job.market_codes || []).join(' / ') || '—')}</strong>${bi(...(stageLabels[job.progress_stage] || stageLabels[job.status] || ['状态待确认','Status Pending']))}</div><p>${jobCategory(job)}</p><dl><div><dt>${bi('建立时间','Created')}</dt><dd>${date(job.created_at)}</dd></div><div><dt>${bi('最近活动','Last Activity')}</dt><dd>${date(job.last_provider_event_at || job.updated_at)}</dd></div><div><dt>${bi('已核验企业','Verified Companies')}</dt><dd>${number(job.verified_companies)}</dd></div></dl></li>`).join('')}</ul>`:empty('暂无研究任务','No research jobs'):empty('任务明细暂未读取，请刷新。','Job details unavailable. Refresh to retry.');
  set('overview-tasks',`${research?`<dl class="v3-overview-task-counts"><div><dt>${bi('进行中的研究任务','Active Research Jobs')}</dt><dd>${number(research.active_jobs)}</dd></div></dl>`:''}${jobsHtml}`);
  const jobList=document.querySelector('#overview-tasks .v3-overview-job-list');
  if(jobList){jobList.tabIndex=0;jobList.setAttribute('aria-label','最近研究任务 Recent research jobs');}
  const tasks=(research?.priority_tasks || []).slice(0,3);
  const pendingDrafts=operations?.prospect?.pending_drafts;
  const alerts=operations?.monitoring?.alerts || [];
  const alertLabels={IMAP_CHECKPOINT_STALE:['收信更新延迟','Inbox Update Delayed'],IMAP_SYNC_FAILURE:['收信需要检查','Inbox Needs Review'],SEND_AMBIGUOUS:['发送结果待核对','Send Result Needs Review'],OUTBOUND_STUCK:['发送处理超时','Sending Overdue'],CRM_OUTBOX_LAG:['跟进同步延迟','Follow-up Sync Delayed'],INBOUND_CORRELATION_CONFLICT:['回复关联待核对','Reply Matching Needs Review'],INBOUND_CORRELATION_REVIEW:['来信关联待核对','Incoming Mail Needs Matching'],CRM_RECONCILIATION_REQUIRED:['跟进记录待核对','Follow-up Records Need Review'],SUPPRESSION_BLOCKED_ATTEMPT:['已阻止退订地址联系','Suppressed Contact Blocked']};
  set('overview-attention',`${pendingDrafts!==undefined?`<div class="v3-overview-attention-summary">${bi('待审核草稿','Drafts Awaiting Review')}<strong>${number(pendingDrafts)}</strong></div>`:''}${alerts.length?`<ul class="v3-overview-attention-list">${alerts.map(alert=>`<li>${bi(...(alertLabels[alert.code] || ['运营事项待检查','Operations Review Required']))}<strong>${number(alert.count)}</strong></li>`).join('')}</ul>`:''}${tasks.length?`<ul class="v3-overview-attention-list">${tasks.map(task=>`<li>${task.company_id?`<button class="v3-overview-company" data-tip="打开这家企业的详情|Open this company's details" data-overview-id="${esc(task.company_id)}" type="button">${esc(task.company_name || '—')}</button>`:`<strong>${esc(task.company_name || '—')}</strong>`}<span>${bi(task.human_review_required?'待复核资料':'待完善资料',task.human_review_required?'Evidence Review':'Evidence Pending')}</span></li>`).join('')}</ul>`:empty(research?'暂无优先处理资料':'待处理事项暂未读取',research?'No priority evidence items':'Attention items unavailable')}`);
  if(model.pendingParts)document.getElementById('overview-attention')?.insertAdjacentHTML('afterbegin',`<details class="v3-overview-pending-breakdown"><summary>${bi('待处理构成','Pending Action Breakdown')}</summary><dl>${model.pendingParts.map(item=>`<div><dt>${bi(item.zh,item.en)}</dt><dd>${number(item.count)}</dd></div>`).join('')}</dl><p class="v3-overview-caption">${bi('按事项统计，同一企业可能有多个不同事项。','Counts actions; one company may have multiple distinct actions.')}</p></details>`);
  document.getElementById('overview-attention')?.querySelectorAll('[data-overview-id]').forEach(button=>button.addEventListener('click',()=>onCompany(button.dataset.overviewId)));
}

/** Cumulative funnel from current stage counts: a stage counts every opportunity at it or beyond (lost excluded). */
export function pipelineFunnel(stageCounts) {
  if(!stageCounts||typeof stageCounts!=='object')return null;
  const order=STAGES.filter(([key])=>key!=='LOST');
  const counts=order.map(([key])=>finiteCount(stageCounts[key]));
  if(counts.some(value=>value===null))return null;
  const reached=counts.map((_,index)=>counts.slice(index).reduce((sum,value)=>sum+value,0));
  return {rows:order.map(([key,zh,en],index)=>({key,zh,en,count:reached[index],conversion:index&&reached[index-1]?Math.round(reached[index]/reached[index-1]*100):null})),
    active:counts.slice(0,-1).reduce((sum,value)=>sum+value,0),won:counts.at(-1),lost:finiteCount(stageCounts.LOST)};
}
function renderPipeline(payload) {
  const host=document.getElementById('overview-pipeline');
  if(!host)return;
  host.setAttribute('aria-busy','false');
  if(payload===null){host.innerHTML=stateBlock('error','销售漏斗暂未读取','Pipeline unavailable',{retry:true});return;}
  const funnel=pipelineFunnel(payload?.stage_counts);
  if(!funnel){host.innerHTML=stateBlock('error','销售漏斗暂未读取','Pipeline unavailable',{retry:true});return;}
  if(!funnel.rows[0].count&&!funnel.lost){host.innerHTML=stateBlock('empty','暂无销售机会','No opportunities yet');return;}
  const max=Math.max(1,funnel.rows[0].count);
  host.innerHTML=`<div class="fun-head" aria-hidden="true"><span>${bi('阶段','Stage')}</span><span></span><span>${bi('数量','Count')}</span><span>${bi('环比','Step conv.')}</span></div><div class="fun">${funnel.rows.map(row=>`<div class="fun-row"><span class="n">${bi(row.zh,row.en)}</span><span class="track" role="img" aria-label="${esc(row.zh)} ${row.count}"><span style="width:${row.count/max*100}%"></span></span><span class="v">${number(row.count)}</span><span class="r">${row.conversion===null?'—':`${row.conversion}%`}</span></div>`).join('')}</div><div class="fun-foot"><span>${bi('当前有效','Active')}<b>${number(funnel.active)}</b></span><span>${bi('成交','Won')}<b>${number(funnel.won)}</b></span><span>${bi('流失','Lost')}<b>${number(funnel.lost)}</b></span></div>`;
}
function renderTodo(payload) {
  const host=document.getElementById('overview-todo');
  if(!host)return;
  if(payload===null){host.innerHTML=stateBlock('error','待办暂未读取','Tasks unavailable',{retry:true});return;}
  const items=(payload?.items||[]).slice(0,5);
  if(!items.length){host.innerHTML=stateBlock('empty','今日没有待办','Nothing due today');return;}
  host.innerHTML=`<ul class="rows">${items.map(task=>{const due=when(task.due_at);return `<li class="${task.overdue?'is-overdue':''}"><button class="row" data-tip="打开这家企业的详情和跟进记录|Open company details and activity" type="button" data-overview-company="${esc(task.company_id)}"><i class="m-dot ${taskDot(task.task_type)} v4-phone-only" aria-hidden="true"></i><span class="v4-desktop-pill">${taskTypePill(task.task_type)}</span><span class="main-t"><span class="co">${esc(task.company_name||'—')}</span><span class="meta">${esc(task.title||task.next_action||'')}</span></span><span class="when${task.overdue?' overdue':''}">${due?esc(due.zh):'—'}${task.overdue&&due?`<small>${bi(...overdueText(due))}</small>`:''}</span></button></li>`;}).join('')}</ul>`;
}
function renderApprovals(payload) {
  const host=document.getElementById('overview-approvals');
  if(!host)return;
  if(payload===null){host.innerHTML=stateBlock('error','待审批暂未读取','Approvals unavailable',{retry:true});return;}
  const items=(payload?.items||[]).slice(0,4);
  if(!items.length){host.innerHTML=stateBlock('empty','没有待审批的跟进邮件','No follow-up email awaiting approval');return;}
  host.innerHTML=`<ul class="rows">${items.map(draft=>{const due=when(draft.due_at);return `<li><div class="row"><span class="main-t"><span class="co">${esc(draft.company_name||'—')}</span><span class="meta">${bi(`第 ${draft.sequence_no} 封跟进邮件 · 计划 ${due?due.zh:'—'}`,`Follow-up ${draft.sequence_no} · ${due?due.en:'—'}`)}</span><span class="meta subj">${esc(draft.subject||'')}</span></span><a class="btn btn-outline-primary btn-sm" data-tip="去审批这封跟进邮件|Review this follow-up email" href="#followups" data-open-view="followups" data-draft-id="${esc(draft.id)}">${bi('去审批','Review')}</a></div></li>`;}).join('')}</ul>`;
}
async function settle(promise){try{return await promise;}catch{return null;}}
export async function loadOverviewCrm() {
  const generation=++crmState.generation;
  const [tasks,drafts,pipeline]=await Promise.all([settle(crm.tasks({due:'today'})),settle(crm.drafts({status:'PENDING_APPROVAL'})),settle(crm.pipeline({limit:1}))]);
  if(generation!==crmState.generation)return;
  Object.assign(crmState,{tasks,drafts,pipeline});
  renderTodo(tasks);renderApprovals(drafts);renderPipeline(pipeline);renderKpis();
  document.querySelectorAll('#overview-todo [data-overview-company]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.overviewCompany)document.dispatchEvent(new CustomEvent('crm:opencompany',{detail:{companyId:button.dataset.overviewCompany}}));}));
}
