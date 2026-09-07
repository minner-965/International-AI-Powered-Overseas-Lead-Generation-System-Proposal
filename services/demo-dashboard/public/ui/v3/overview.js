const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import { finiteCount, marketSeries, lazyChart } from './charts.js';
const bi = (zh,en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString();
const empty = (zh,en) => `<p class="v3-overview-empty">${bi(zh,en)}</p>`;
const panel = (id,zh,en,body) => `<section class="v3-overview-panel" aria-labelledby="${id}-title"><header><h3 id="${id}-title">${bi(zh,en)}</h3></header>${body}</section>`;
const link = (view,zh,en) => `<a class="v3-overview-link" href="#${view}" data-open-view="${view}">${bi(zh,en)}<i class="ti ti-arrow-right" aria-hidden="true"></i></a>`;
export function marketDonut(markets,total) {
  const series=marketSeries(markets,total);
  if(series.state==='error')return empty('市场分布暂未读取，请刷新重试。','Market distribution unavailable. Refresh to retry.');
  if(series.state==='empty')return empty('暂无市场分布','No market distribution available');
  const colors=['var(--dpv-primary)','var(--dpv-violet-data)','var(--dpv-info)','var(--dpv-muted)'];
  const labels={AE:['阿联酋','UAE'],MX:['墨西哥','Mexico']};
  let offset=0;
  const rings=markets.map(([market,count],i)=>{
    const fraction=count/total*100;
    const circle=`<circle cx="60" cy="60" r="48" fill="none" stroke="${colors[i%colors.length]}" stroke-width="12" pathLength="100" stroke-dasharray="${fraction} ${100-fraction}" stroke-dashoffset="${-offset}"/>`;
    offset+=fraction;return circle;
  }).join('');
  return `<div class="v3-overview-market-chart"><svg viewBox="0 0 120 120" aria-hidden="true">${rings}</svg><div class="v3-overview-market-total"><strong>${number(total)}</strong>${bi('企业','Companies')}</div></div><ul class="v3-overview-market-list" aria-label="市场分布 Market distribution">${markets.map(([market,count],i)=>`<li><span class="v3-overview-market-dot" style="background:${colors[i%colors.length]}" aria-hidden="true"></span>${bi(...(labels[market]||[market,market]))}<strong>${number(count)} · ${(count/total*100).toLocaleString(undefined,{maximumFractionDigits:1})}%</strong></li>`).join('')}</ul>`;
}
function jobCategory(job) {
  const labels={WOMENSWEAR:['女装','Womenswear'],GENERAL_MERCHANDISE:['百货','General Merchandise'],
    'BUYER PROCUREMENT ENRICHMENT':['采购联系资料','Buyer & Procurement Evidence'],BUYER_PROCUREMENT_ENRICHMENT:['采购联系资料','Buyer & Procurement Evidence']};
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
    ? [['pending_management','待批准机会','Opportunity Approvals'],['pending_drafts','待审核草稿','Draft Reviews'],['pending_followups','回复与跟进','Replies & Follow-up'],['pending_contacts','待完善联系','Contact Evidence']].map(([key,zh,en])=>({key,zh,en,count:Number(p[key])})) : null;
  if(pendingParts)pendingParts.push({key:'alerts',zh:'运营提醒类别',en:'Operational Alert Types',count:(operations.monitoring?.alerts || []).length});
  const markets = new Map();
  const companies = new Set();
  for (const row of opportunities || []) {
    const id = row.company_id || row.companyId || row.id;
    if (!id || companies.has(id)) continue;
    companies.add(id);
    const market = row.country_code || row.market || '—';
    markets.set(market,(markets.get(market) || 0)+1);
  }
  return {recommended:opportunities ? opportunities.filter(row=>getStatus(row)==='RECOMMENDED').length : null,
    verified:metrics?.verified_active ?? null,sent,pending:pendingParts?pendingParts.reduce((sum,item)=>sum+item.count,0):null,pendingParts,
    markets:[...markets].sort((a,b)=>b[1]-a[1]),marketTotal:Array.isArray(opportunities)?companies.size:null,
    operations:operations?.prospect || null};
}

export function mountOverview() {
  const root = document.getElementById('view-overview');
  if (!root || root.dataset.v3Mounted) return;
  const reset = document.getElementById('reset');
  const runStatus = document.getElementById('run-status');
  root.dataset.v3Mounted='true';root.classList.add('v3-overview');
  root.innerHTML=`<header class="v3-overview-heading"><div><h2 id="overview-title">${bi('客户开发总览','Prospect Overview')}</h2><p id="overview-last-refresh"></p></div><div class="v3-overview-actions">${link('data-export','导出报表','Export Reports')}<button type="button" id="outreach-operations-refresh" class="btn btn-outline-primary">${bi('刷新总览','Refresh Overview')}</button><details class="v3-overview-more"><summary>${bi('名录管理','Directory Actions')}</summary><div id="overview-directory-actions"></div></details></div></header><div id="overview-run-slot"></div><section id="metrics" class="v3-overview-metrics" aria-label="业务概览 Business overview" aria-busy="true">${empty('正在读取概览','Loading overview')}</section><div class="v3-overview-analysis">${panel('outreach-operations','客户开发进展','Prospect Development',`<div id="outreach-operations" data-v3-overview="true" aria-live="polite"></div>`)}${panel('overview-markets','客户市场分布','Market Distribution',`<p class="v3-overview-caption">${bi('当前机会覆盖的企业','Companies represented in current opportunities')}</p><div id="overview-markets"></div>`)}</div><div class="v3-overview-lower">${panel('overview-tasks','工作任务','Work in Progress',`<div id="overview-tasks"></div>${link('jobs','查看任务','View Jobs')}`)}${panel('overview-attention','待处理事项','Attention Required',`<div id="overview-attention"></div>${link('contact-queue','审核邮件与联系','Email Review & Contact')}`)}</div>`;
  if (reset) document.getElementById('overview-directory-actions').append(reset);
  if (runStatus) document.getElementById('overview-run-slot').append(runStatus);
}

export function markOverviewLoading() {
  for(const id of ['metrics','outreach-operations','overview-markets','overview-tasks','overview-attention']) {
    const element=document.getElementById(id);
    if(element) { element.setAttribute('aria-busy','true'); element.dataset.refreshing='true'; }
  }
  const stamp=document.getElementById('overview-last-refresh');
  if(stamp)stamp.innerHTML=bi('正在更新概览','Updating overview');
}

export function renderOverview({metrics,opportunities,operations,research,jobs,getStatus,onCompany}) {
  const model=overviewModel({metrics,opportunities,operations,research,getStatus});
  const set=(id,html)=>{const el=document.getElementById(id);if(el){el.innerHTML=html;el.setAttribute('aria-busy','false');delete el.dataset.refreshing;}};
  set('metrics',[
    [model.recommended,'建议联系','Recommended','当前业务机会','Current business opportunities','target-arrow','primary'],
    [model.verified,'当前有效企业','Verified Active Companies','','','building','success'],
    [model.sent,'已发未回复','Sent · Awaiting Reply','全部客户邮件','All prospect mail','mail','primary'],
    [model.pending,'待处理','Pending Actions','审批、跟进、联系与运营事项','Approvals, follow-up, contacts & operations','clipboard-list','warning']
  ].map(([value,zh,en,scopeZh,scopeEn,icon,tone])=>`<article class="v3-overview-metric" data-tone="${tone}"><div class="v3-overview-metric-top">${bi(zh,en)}<i class="ti ti-${icon}" aria-hidden="true"></i></div><strong>${number(value)}</strong>${scopeZh ? `<p>${bi(scopeZh,scopeEn)}</p>` : ''}</article>`).join(''));
  const stageValues={verified:model.verified,category:opportunities?opportunities.filter(row=>['CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'].includes(row.category_procurement_match_status)).length:null,
    contact:research?.contact_ready_opportunities ?? null,management:opportunities?opportunities.filter(row=>getStatus(row)==='MANAGEMENT_APPROVED').length:null,
    sent:operations?.prospect?.smtp_accepted ?? null,replied:operations?.prospect?.replies ?? null};
  const stages=[['verified','已验证企业','Verified Companies'],['category','类目匹配机会','Category-Matched Opportunities'],['contact','联系方式就绪','Contact-Ready Opportunities'],['management','管理批准机会','Management Approved'],['sent','已发邮件','Sent Emails'],['replied','客户回复','Customer Replies']];
  const max=Math.max(1,...Object.values(stageValues).map(value=>Number(value || 0)));
  set('outreach-operations',`<ol class="v3-overview-stages">${stages.map(([key,zh,en],i)=>`<li><span class="v3-overview-stage-index" aria-hidden="true">${i+1}</span><div><div class="v3-overview-stage-label">${bi(zh,en)}<strong>${number(stageValues[key])}</strong></div><div class="v3-overview-track" aria-hidden="true"><span style="width:${Math.max(0,Number(stageValues[key] || 0))/max*100}%"></span></div></div></li>`).join('')}</ol><p class="v3-overview-caption">${bi('当前企业与机会 · 累计客户邮件与回复','Current companies & opportunities · Cumulative prospect mail & replies')}</p>${link('contact-queue','查看邮件审核','View Email Review')}`);
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
  const chart=document.querySelector('#overview-markets .v3-overview-market-chart');
  const svg=chart?.querySelector('svg');
  if(svg){svg.style.visibility='hidden';lazyChart(chart,()=>{if(svg.isConnected)svg.style.visibility='visible';});}
  const stageLabels={QUEUED:['等待处理','Queued'],RUNNING:['处理中','In Progress'],DISCOVERING:['查找企业','Company Search'],CRAWLING:['查阅资料','Evidence Review'],QUALIFYING:['企业核验','Company Verification'],SCORING:['客户评估','Prospect Assessment'],COMPLETED:['已完成','Completed'],WAITING_EVIDENCE:['待完善资料','Evidence Pending'],FAILED_RETRYABLE:['待重试','Retry Required'],FAILED_FINAL:['待检查','Review Required']};
  const recentJobs=jobs?.items || [];
  const date=value=>value && Number.isFinite(new Date(value).getTime())?esc(new Date(value).toLocaleString()):'—';
  const jobsHtml=jobs?recentJobs.length?`<ul class="v3-overview-job-list">${recentJobs.map(job=>`<li><div class="v3-overview-job-heading"><strong>${esc((job.market_codes || []).join(' / ') || '—')}</strong>${bi(...(stageLabels[job.progress_stage] || stageLabels[job.status] || ['状态待确认','Status Pending']))}</div><p>${jobCategory(job)}</p><dl><div><dt>${bi('建立时间','Created')}</dt><dd>${date(job.created_at)}</dd></div><div><dt>${bi('最近活动','Last Activity')}</dt><dd>${date(job.last_provider_event_at || job.updated_at)}</dd></div><div><dt>${bi('已核验企业','Verified Companies')}</dt><dd>${number(job.verified_companies)}</dd></div></dl></li>`).join('')}</ul>`:empty('暂无研究任务','No research jobs'):empty('任务明细暂未读取，请刷新。','Job details unavailable. Refresh to retry.');
  set('overview-tasks',`${research?`<dl class="v3-overview-task-counts"><div><dt>${bi('进行中的研究任务','Active Research Jobs')}</dt><dd>${number(research.active_jobs)}</dd></div></dl>`:''}${jobsHtml}`);
  const tasks=(research?.priority_tasks || []).slice(0,3);
  const pendingDrafts=operations?.prospect?.pending_drafts;
  const alerts=operations?.monitoring?.alerts || [];
  const alertLabels={IMAP_CHECKPOINT_STALE:['收信更新延迟','Inbox Update Delayed'],IMAP_SYNC_FAILURE:['收信需要检查','Inbox Needs Review'],SEND_AMBIGUOUS:['发送结果待核对','Send Result Needs Review'],OUTBOUND_STUCK:['发送处理超时','Sending Overdue'],CRM_OUTBOX_LAG:['跟进同步延迟','Follow-up Sync Delayed'],INBOUND_CORRELATION_CONFLICT:['回复关联待核对','Reply Matching Needs Review'],INBOUND_CORRELATION_REVIEW:['来信关联待核对','Incoming Mail Needs Matching'],CRM_RECONCILIATION_REQUIRED:['跟进记录待核对','Follow-up Records Need Review'],SUPPRESSION_BLOCKED_ATTEMPT:['已阻止退订地址联系','Suppressed Contact Blocked']};
  set('overview-attention',`${pendingDrafts!==undefined?`<div class="v3-overview-attention-summary">${bi('待审核草稿','Drafts Awaiting Review')}<strong>${number(pendingDrafts)}</strong></div>`:''}${alerts.length?`<ul class="v3-overview-attention-list">${alerts.map(alert=>`<li>${bi(...(alertLabels[alert.code] || ['运营事项待检查','Operations Review Required']))}<strong>${number(alert.count)}</strong></li>`).join('')}</ul>`:''}${tasks.length?`<ul class="v3-overview-attention-list">${tasks.map(task=>`<li>${task.company_id?`<button class="v3-overview-company" data-overview-id="${esc(task.company_id)}" type="button">${esc(task.company_name || '—')}</button>`:`<strong>${esc(task.company_name || '—')}</strong>`}<span>${bi(task.human_review_required?'待复核资料':'待完善资料',task.human_review_required?'Evidence Review':'Evidence Pending')}</span></li>`).join('')}</ul>`:empty(research?'暂无优先处理资料':'待处理事项暂未读取',research?'No priority evidence items':'Attention items unavailable')}`);
  if(model.pendingParts)document.getElementById('overview-attention')?.insertAdjacentHTML('afterbegin',`<details class="v3-overview-pending-breakdown"><summary>${bi('待处理构成','Pending Action Breakdown')}</summary><dl>${model.pendingParts.map(item=>`<div><dt>${bi(item.zh,item.en)}</dt><dd>${number(item.count)}</dd></div>`).join('')}</dl><p class="v3-overview-caption">${bi('按事项统计，同一企业可能有多个不同事项。','Counts actions; one company may have multiple distinct actions.')}</p></details>`);
  document.getElementById('overview-attention')?.querySelectorAll('[data-overview-id]').forEach(button=>button.addEventListener('click',()=>onCompany(button.dataset.overviewId)));
}
