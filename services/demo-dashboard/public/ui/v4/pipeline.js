// Sales opportunities by follow-up stage (/api/crm/pipeline). The category-assessment workspace
// (existing opportunity table, filters and hooks) stays available in the second pane.
import { STAGES, bi, esc, stageLabel, when, stateBlock, skeletonRows, loadPipeline } from './crm.js';
import { managementRequest } from '../../phase7-ui.js';
import { poolLabels } from '../v3/opportunity-dimensions.js';

const $ = selector => document.querySelector(selector);
const PAGE = 20;
const MARKETS = { AE: ['阿联酋', 'UAE'], MX: ['墨西哥', 'Mexico'], SA: ['沙特阿拉伯', 'Saudi Arabia'], US: ['美国', 'United States'] };
const state = { items: null, counts: null, stage: '', owner: '', market: '', q: '', shown: PAGE, bands: new Map(), error: false };
const storage = { get: key => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key, value) => { try { localStorage.setItem(key, value); } catch {} } };

function selectPane(name, { focus = false } = {}) {
  const pane = name === 'assessment' ? 'assessment' : 'pipeline';
  document.querySelectorAll('[data-opp-pane]').forEach(node => { node.hidden = node.dataset.oppPane !== pane; });
  document.querySelectorAll('[data-opp-pane-tab]').forEach(tab => {
    const active = tab.dataset.oppPaneTab === pane;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  storage.set('sim-opportunity-pane', pane);
}

const bandPill = band => {
  if (!poolLabels[band] || !['PRECISION', 'RELEVANT', 'GENERAL_RELEVANT'].includes(band)) return '<span class="meta">—</span>';
  const [zh, en] = { PRECISION: ['精准', 'Precision'], RELEVANT: ['相关', 'Relevant'], GENERAL_RELEVANT: ['一般相关', 'General relevant'] }[band];
  return `<span class="pill ${band === 'PRECISION' ? 'band-p' : band === 'RELEVANT' ? 'band-r' : 'band-g'}">${bi(zh, en)}</span>`;
};
const marketText = code => MARKETS[code] ? `${MARKETS[code][0]} ${code}` : (code || '—');
const stageTag = code => { const [, zh, en, cls] = stageLabel(code); return `<span class="stage ${cls}">${bi(zh, en)}</span>`; };

function filtered() {
  const q = state.q.trim().toLocaleLowerCase();
  return (state.items || []).filter(item => (!state.stage || item.pipeline_stage === state.stage)
    && (!state.owner || item.owner_identity === state.owner) && (!state.market || item.country_code === state.market)
    && (!q || String(item.company_name || '').toLocaleLowerCase().includes(q) || String(item.city || '').toLocaleLowerCase().includes(q)))
    .sort((a, b) => (a.next_action_due_at ? new Date(a.next_action_due_at) : Infinity) - (b.next_action_due_at ? new Date(b.next_action_due_at) : Infinity));
}

function renderTabs() {
  const host = $('#pipeline-stage-tabs');
  if (!host) return;
  const counts = state.counts || {};
  const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const tabs = [['', '全部', 'All', total], ...STAGES.map(([key, zh, en]) => [key, zh, en, counts[key] ?? 0])];
  host.innerHTML = tabs.map(([key, zh, en, count]) => `<button type="button" data-tip="只看「${zh}」阶段的客户|Show prospects at ${en}" role="tab" data-pipeline-stage="${key}" aria-selected="${state.stage === key}" tabindex="${state.stage === key ? 0 : -1}">${bi(zh, en)}<span class="n">${state.counts ? Number(count).toLocaleString() : '—'}</span></button>`).join('');
}

function renderFilters() {
  const owners = [...new Set((state.items || []).map(item => item.owner_identity).filter(Boolean))].sort();
  const markets = [...new Set((state.items || []).map(item => item.country_code).filter(Boolean))].sort();
  const owner = $('#pipeline-owner'); const market = $('#pipeline-market');
  if (owner) owner.innerHTML = `<option value="">全部负责人 All owners</option>${owners.map(value => `<option value="${esc(value)}"${value === state.owner ? ' selected' : ''}>${esc(value)}</option>`).join('')}`;
  if (market) market.innerHTML = `<option value="">全部市场 All markets</option>${markets.map(value => `<option value="${esc(value)}"${value === state.market ? ' selected' : ''}>${esc(MARKETS[value] ? `${MARKETS[value][0]} ${MARKETS[value][1]}` : value)}</option>`).join('')}`;
}

function renderList() {
  const host = $('#pipeline-list');
  if (!host) return;
  const more = $('#pipeline-more'); const count = $('#pipeline-count');
  if (state.error) { host.innerHTML = stateBlock('error', '销售机会暂未读取', 'Opportunities unavailable', { retry: true }); if (more) more.hidden = true; if (count) count.textContent = ''; return; }
  if (!state.items) { host.innerHTML = skeletonRows(5); return; }
  const rows = filtered();
  if (!rows.length) {
    host.innerHTML = stateBlock('empty', state.items.length ? '没有符合条件的机会' : '暂无销售机会', state.items.length ? 'No opportunities match the filters' : 'No opportunities yet');
    if (more) more.hidden = true; if (count) count.textContent = '';
    return;
  }
  const visible = rows.slice(0, state.shown);
  host.innerHTML = `<table class="rtable v4-pipeline-table"><caption class="sr-only">销售机会 Opportunities</caption><thead><tr><th scope="col">${bi('企业', 'Company')}</th><th scope="col">${bi('机会等级', 'Band')}</th><th scope="col">${bi('阶段', 'Stage')}</th><th scope="col">${bi('负责人', 'Owner')}</th><th scope="col">${bi('下次跟进', 'Next follow-up')}</th></tr></thead><tbody>${visible.map(item => {
    const due = when(item.next_action_due_at);
    const band = state.bands.get(`${item.company_id}:${item.product_profile}`) || state.bands.get(String(item.company_id));
    const dueText = due ? `${due.zh}${item.overdue ? ' · 已逾期' : ''}` : '未设置';
    return `<tr class="has-chev${item.overdue ? ' is-overdue' : ''}"><td class="m-main"><button type="button" data-tip="打开这家企业的详情和跟进记录|Open company details and activity" class="co v4-link-btn" data-pipeline-company="${esc(item.company_id)}" data-pipeline-profile="${esc(item.product_profile || '')}">${esc(item.company_name || '—')}</button><span class="meta">${esc([item.city, marketText(item.country_code)].filter(Boolean).join(' · '))}<span class="v4-phone-inline"> · ${esc(item.owner_identity || '未指派')}</span></span></td><td class="m-hide">${bandPill(band)}</td><td class="m-side">${stageTag(item.pipeline_stage)}</td><td class="m-hide">${esc(item.owner_identity || '—')}</td><td class="m-sub${item.overdue ? ' overdue' : ''}"><span class="v4-due">${esc(dueText)}</span><span class="meta">${esc(item.next_action || '')}</span><i class="ti ti-chevron-right chev" aria-hidden="true"></i></td></tr>`;
  }).join('')}</tbody></table>`;
  if (count) count.innerHTML = bi(`显示 ${visible.length} / ${rows.length}`, `Showing ${visible.length} of ${rows.length}`);
  if (more) more.hidden = rows.length <= visible.length;
}

function renderMeta() {
  const meta = $('#pipeline-meta');
  if (!meta || !state.items) return;
  const active = state.items.filter(item => !['WON', 'LOST'].includes(item.pipeline_stage)).length;
  meta.innerHTML = bi(`有效机会 ${active} 家 · 按下次跟进时间排序`, `${active} active, sorted by next follow-up`);
}

async function load({ force = false } = {}) {
  state.error = false;
  if (!state.items) renderList();
  const [pipeline, opportunities] = await Promise.all([
    loadPipeline({ force }).catch(() => null),
    managementRequest('/api/opportunities?status=ALL&limit=500').catch(() => null)
  ]);
  if (!pipeline) { state.error = true; state.items = null; state.counts = null; renderTabs(); renderList(); return; }
  state.items = pipeline.items || []; state.counts = pipeline.stage_counts || null;
  const list = Array.isArray(opportunities) ? opportunities : opportunities?.items || [];
  state.bands = new Map();
  for (const row of list) if (row.opportunity_pool_band) {
    state.bands.set(`${row.company_id}:${row.product_profile}`, row.opportunity_pool_band);
    if (!state.bands.has(String(row.company_id))) state.bands.set(String(row.company_id), row.opportunity_pool_band);
  }
  renderTabs(); renderFilters(); renderList(); renderMeta();
}

function mount() {
  const root = $('#opportunity-pipeline');
  if (!root) return;
  selectPane(storage.get('sim-opportunity-pane') || 'pipeline');
  document.querySelectorAll('[data-opp-pane-tab]').forEach((tab, index, tabs) => {
    tab.addEventListener('click', () => selectPane(tab.dataset.oppPaneTab));
    tab.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step) { event.preventDefault(); selectPane(tabs[(index + step + tabs.length) % tabs.length].dataset.oppPaneTab, { focus: true }); }
    });
  });
  $('#pipeline-stage-tabs')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-pipeline-stage]');
    if (!tab) return;
    state.stage = tab.dataset.pipelineStage; state.shown = PAGE; renderTabs(); renderList();
  });
  $('#pipeline-stage-tabs')?.addEventListener('keydown', event => {
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]; const index = tabs.indexOf(document.activeElement);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || index < 0) return;
    event.preventDefault(); const next = tabs[(index + step + tabs.length) % tabs.length];
    state.stage = next.dataset.pipelineStage; state.shown = PAGE; renderTabs(); renderList();
    $(`#pipeline-stage-tabs [data-pipeline-stage="${state.stage}"]`)?.focus();
  });
  $('#pipeline-owner')?.addEventListener('change', event => { state.owner = event.target.value; state.shown = PAGE; renderList(); });
  $('#pipeline-market')?.addEventListener('change', event => { state.market = event.target.value; state.shown = PAGE; renderList(); });
  $('#pipeline-search')?.addEventListener('input', event => { state.q = event.target.value; state.shown = PAGE; renderList(); });
  $('#pipeline-more')?.addEventListener('click', () => { state.shown += PAGE; renderList(); });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-state-retry]')) { void load({ force: true }); return; }
    const row = event.target.closest('tr');
    const button = event.target.closest('[data-pipeline-company]') || row?.querySelector('[data-pipeline-company]');
    if (button) document.dispatchEvent(new CustomEvent('crm:opencompany', { detail: { companyId: button.dataset.pipelineCompany, productProfile: button.dataset.pipelineProfile } }));
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'opportunities') void load(); });
  document.addEventListener('crm:changed', () => { if (!document.querySelector('#view-opportunities')?.hidden) void load({ force: true }); });
  document.addEventListener('crm:showassessment', () => selectPane('assessment'));
  if (!document.querySelector('#view-opportunities')?.hidden) void load();
}
mount();
