import { escapeText as esc } from './components.js';
import { isMarketVisible } from '../../market-visibility.js';
// Presentation only: move original nodes so listeners, values and approval gates survive.
export const recordViews = ['evidence','customer-match','data-import','data-export','settings'];
const label = (zh,en) => `<span class="bi"><span lang="zh-CN">${zh}</span><span lang="en">${en}</span></span>`;

export function evidenceUrl(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}

export function evidenceRecords(company) {
  const records = Array.isArray(company?.sources) ? company.sources : Array.isArray(company?.source_references) ? company.source_references : [];
  return records.map(item=>({
    url:evidenceUrl(item.url || item.source_url),
    title:item.page_title || item.source_page_title || '',
    finding:item.evidence_text || '',
    captured:item.captured_at || '',
    kind:item.evidence_kind || item.evidence_type || ''
  }));
}

export function renderEvidenceRecords(company) {
  const records = evidenceRecords(company);
  if (!records.length) return `<div class="crm-empty-state">${label('暂无资料来源','No source references available')}</div>`;
  return `<ul class="v3-evidence-list">${records.map(item=>`<li><div class="v3-evidence-heading"><strong>${item.title ? esc(item.title) : label('企业资料','Company source')}</strong>${item.captured ? `<time datetime="${esc(item.captured)}">${esc(Number.isNaN(Date.parse(item.captured)) ? '—' : new Date(item.captured).toLocaleString())}</time>` : `<span>${label('时间未记录','Time not recorded')}</span>`}</div>${item.finding ? `<blockquote>${esc(item.finding)}</blockquote>` : ''}<div class="v3-evidence-link">${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a>` : label('暂无来源链接','No source link available')}</div></li>`).join('')}</ul>`;
}

export function mountEvidence(page, request) {
  if (!page || page.dataset.v3Evidence) return;
  page.dataset.v3Evidence = 'true';
  const original = page.querySelector('.crm-panel');
  const directory = original?.querySelector('[data-open-view="companies"]');
  const panel = page.ownerDocument.createElement('section');
  panel.className = 'card crm-panel v3-evidence-workspace';
  panel.innerHTML = `<div class="v3-evidence-toolbar"><label for="v3-evidence-company">${label('选择企业','Select company')}<select id="v3-evidence-company" class="form-select" disabled><option value="">正在读取 / Loading</option></select></label><button type="button" data-tip="重新读取评估依据|Reload the evidence" class="btn btn-outline-primary" id="v3-evidence-refresh">${label('刷新资料','Refresh sources')}</button></div><div id="v3-evidence-status" role="status" aria-live="polite"></div><div id="v3-evidence-results" aria-busy="false"></div>`;
  original?.replaceWith(panel);
  if (!original) page.append(panel);
  if (directory) page.querySelector('.crm-section-head')?.append(directory);
  const select = panel.querySelector('select');
  const results = panel.querySelector('#v3-evidence-results');
  const status = panel.querySelector('#v3-evidence-status');
  let sequence = 0;
  async function loadSources() {
    const current = ++sequence;
    if (!select.value) return;
    results.setAttribute('aria-busy','true');
    status.innerHTML = label('正在读取资料','Loading sources');
    results.innerHTML = '';
    try {
      const company = await request(`/api/leads/${encodeURIComponent(select.value)}`);
      if (current !== sequence) return;
      results.innerHTML = renderEvidenceRecords(company);
      status.innerHTML = '';
    } catch {
      if (current !== sequence) return;
      status.innerHTML = label('资料暂时未返回，请刷新重试','Sources are unavailable. Refresh to retry');
    } finally { if(current === sequence) results.setAttribute('aria-busy','false'); }
  }
  async function loadCompanies() {
    status.innerHTML = label('正在读取企业','Loading companies');
    try {
      const response = await request('/api/leads');
      const companies = (Array.isArray(response) ? response : response.items || []).filter(item=>isMarketVisible(item.country_code || item.market));
      select.innerHTML = companies.length ? companies.map(item=>`<option value="${esc(item.company_id || item.id)}">${esc(item.company_name || item.name || '—')}</option>`).join('') : '<option value="">暂无企业 / No companies</option>';
      select.disabled = !companies.length;
      status.innerHTML = companies.length ? '' : label('当前没有可查看的企业','No companies available');
      if (companies.length) await loadSources();
    } catch { status.innerHTML = label('企业列表暂时未返回，请刷新重试','Company list is unavailable. Refresh to retry'); }
  }
  select.addEventListener('change',loadSources);
  panel.querySelector('#v3-evidence-refresh').addEventListener('click',()=>select.disabled ? loadCompanies() : loadSources());
  let loaded = false;
  const onView = event=>{ if(event.detail?.view === 'evidence' && !loaded) { loaded = true; loadCompanies(); } };
  page.ownerDocument.addEventListener('crm:viewchange',onView);
  if (page.ownerDocument.defaultView?.location.hash === '#evidence') { loaded = true; loadCompanies(); }
}

export function discloseOriginal(node, zh, en, className = '') {
  if (!node || node.parentElement?.classList.contains('v3-record-disclosure')) return null;
  const disclosure = node.ownerDocument.createElement('details');
  disclosure.className = `v3-record-disclosure ${className}`.trim();
  const summary = node.ownerDocument.createElement('summary');
  summary.innerHTML = label(zh,en);
  node.before(disclosure);
  disclosure.append(summary,node);
  return disclosure;
}

export function upgradeProfiles(host) {
  if (!host) return;
  for (const card of host.querySelectorAll('.crm-icp-profile-card')) {
    if (card.dataset.v3Profile === 'true') continue;
    card.dataset.v3Profile = 'true';
    const groups = card.querySelector('.crm-profile-groups');
    discloseOriginal(groups,'画像范围与条件','Profile scope and criteria','v3-profile-disclosure');
    for(const value of card.querySelectorAll('.crm-detail-facts dd')) {
      const percent = coveragePercent(value.textContent);
      if(percent === null) continue;
      const bar = host.ownerDocument.createElement('span');
      bar.className = 'v3-profile-coverage';
      bar.setAttribute('aria-hidden','true');
      bar.innerHTML = `<span style="width:${percent}%"></span>`;
      value.append(bar);
    }
    const facts = card.querySelector('.crm-detail-facts');
    if(facts && facts.children.length > 4) {
      const remainder = host.ownerDocument.createElement('dl');
      remainder.className = 'crm-detail-facts';
      // The first four facts are scope/type/basis/sample summary in each existing renderer.
      // Move every remaining original row, including its original coverage bar.
      for(const row of Array.from(facts.children).slice(4)) remainder.append(row);
      facts.after(remainder);
      const disclosure = discloseOriginal(remainder,'更多画像信息','More profile information','v3-profile-facts-disclosure');
      if(disclosure) disclosure.open = !(host.ownerDocument.defaultView?.matchMedia('(max-width:600px)').matches ?? false);
    }
  }
}

export function coveragePercent(text) {
  const match = String(text || '').trim().match(/^(\d+(?:\.\d+)?)%$/);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function mountRecordViews(documentRoot = document, options = {}) {
  for (const name of recordViews) {
    const page = documentRoot.getElementById(`view-${name}`);
    if (!page || page.dataset.v3Records === 'true') continue;
    page.dataset.v3Records = 'true';
    page.classList.add('v3-record-page');
    // The stable p8-stepper class remains for the existing state renderer.
    page.querySelector('.p8-stepper')?.classList.add('v3-record-steps');
  }

  const request = options.request || (async url=>{const response = await fetch(url); if(!response.ok) throw new Error('Read failed'); return response.json();});
  mountEvidence(documentRoot.getElementById('view-evidence'), request);
  const matchTitle = documentRoot.getElementById('customer-match-title');
  if(matchTitle) matchTitle.innerHTML = label('客户匹配与画像','Customer Match & Profiles');

  const settings = documentRoot.getElementById('view-settings');
  if (settings && !settings.dataset.v3Sections) {
    settings.dataset.v3Sections = 'true';
    discloseOriginal(settings.querySelector('.p11-controlled-mail'),'受控邮箱验证','Controlled email verification','v3-settings-disclosure');
    discloseOriginal(settings.querySelector('.p10-settings-automation'),'服务状态','Service status','v3-settings-disclosure');
    const defaultView = settings.querySelector('#default-opportunity-view');
    if (defaultView) {
      const note = documentRoot.createElement('small');
      note.id = 'v3-default-view-note';
      note.innerHTML = label('当前固定为业务机会','Currently set to Active opportunities');
      defaultView.setAttribute('aria-describedby',note.id);
      defaultView.after(note);
    }
  }

  const profiles = documentRoot.getElementById('icp-profile-content');
  upgradeProfiles(profiles);
  const Observer = documentRoot.defaultView?.MutationObserver;
  const observer = profiles && Observer ? new Observer(()=>upgradeProfiles(profiles)) : null;
  observer?.observe(profiles,{childList:true});
  const mobile = documentRoot.defaultView?.matchMedia('(max-width:600px)');
  const syncFacts = ()=>profiles?.querySelectorAll('.v3-profile-facts-disclosure').forEach(disclosure=>{disclosure.open=!mobile.matches;});
  mobile?.addEventListener('change',syncFacts);
  return { destroy:()=>{observer?.disconnect(); mobile?.removeEventListener('change',syncFacts);} };
}
