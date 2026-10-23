// System settings: 品类范围 (approved supply categories, drafts, custom proposals) and
// 目标市场 (which registry markets research may search). Management approval stays explicit.
import { managementRequest } from '../../phase7-ui.js';
import { bi, esc, stateBlock, skeletonRows, errorText, shortDate } from './crm.js';

const $ = (selector, root = document) => root.querySelector(selector);
const PROFILES = { WOMENSWEAR: ['女装', 'Womenswear'], GENERAL_MERCHANDISE: ['日用百货', 'General merchandise'] };
const CANDIDATE_SOURCES = { MANAGEMENT_PROFILE: ['客户画像', 'Customer profile'], HISTORICAL_DEALS: ['历史成交', 'Past orders'], CUSTOMER_DEALS: ['历史成交', 'Past orders'], PRODUCT_MASTER: ['公司商品', 'Product catalogue'] };
const profileLabel = code => PROFILES[code] || [code, code];
const humanCode = code => String(code || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const json = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const settle = async promise => { try { return await promise; } catch (error) { return { error }; } };

/* ---------------- 品类范围 / Category scope ---------------- */
const cat = { current: null, revisions: null, candidates: null, taxonomy: [], picked: null };

function currentMarkup() {
  if (cat.current?.error) return stateBlock('error', '已批准品类暂未读取', 'Approved categories unavailable', { retry: true });
  if (!cat.current) return skeletonRows(3);
  const items = cat.current.items || [];
  if (!items.length) return stateBlock('empty', '尚无已批准品类', 'No approved categories yet');
  const groups = new Map();
  for (const item of items) { if (!groups.has(item.product_profile)) groups.set(item.product_profile, []); groups.get(item.product_profile).push(item); }
  const revision = items[0]?.revision;
  return `<p class="meta v4-scope-meta">${bi(`当前生效版本 ${revision ?? '—'} · ${items.length} 个品类`, `Revision ${revision ?? '—'} in effect · ${items.length} categories`)}</p>${[...groups].map(([profile, rows]) => `<div class="v4-scope-group"><h4>${bi(...profileLabel(profile))}</h4><ul class="v4-chip-list">${rows.map(row => `<li class="tag" title="${esc(row.normalized_category)}">${esc(humanCode(row.normalized_category))}${row.scope_status !== 'ACTIVE' ? ` · ${esc(row.scope_status)}` : ''}</li>`).join('')}</ul></div>`).join('')}`;
}

function draftsMarkup() {
  if (cat.revisions?.error) return stateBlock('error', '修订记录暂未读取', 'Revisions unavailable', { retry: true });
  if (!cat.revisions) return skeletonRows(2);
  // Only drafts newer than the revision in effect can be approved; older drafts were superseded.
  const effective = Math.max(0, ...(cat.revisions.items || []).filter(item => item.approval_status === 'APPROVED').map(item => Number(item.revision) || 0));
  const drafts = (cat.revisions.items || []).filter(item => item.approval_status === 'DRAFT' && Number(item.revision) > effective);
  if (!drafts.length) return stateBlock('empty', '没有待批准的品类修订', 'No category revision awaiting approval');
  return `<ul class="rows">${drafts.map(item => `<li><div class="row"><span class="main-t"><span class="co">${bi(`修订 ${item.revision}`, `Revision ${item.revision}`)}</span><span class="meta">${esc(item.source_reference || '')} · ${esc(item.created_by || '—')} · ${esc(shortDate(item.created_at))} · ${bi(`${item.scope_count ?? '—'} 个品类`, `${item.scope_count ?? '—'} categories`)}</span></span><button class="btn btn-primary btn-sm" type="button" data-approve-revision="${esc(item.id)}">${bi('批准', 'Approve')}</button></div><p class="v4-form-status" role="status" aria-live="polite" data-revision-status="${esc(item.id)}"></p></li>`).join('')}</ul>`;
}

function candidatesMarkup() {
  if (cat.candidates?.error) return stateBlock('error', '候选品类暂未读取', 'Candidates unavailable', { retry: true });
  if (!cat.candidates) return skeletonRows(2);
  const approved = new Set((cat.current?.items || []).map(row => `${row.product_profile}:${row.normalized_category}`));
  const items = (cat.candidates.items || []).filter(item => !approved.has(`${item.product_profile}:${item.normalized_category}`));
  if (!items.length) return stateBlock('empty', '没有新的候选品类', 'No new candidate categories');
  return `<ul class="rows">${items.map(item => `<li><div class="row"><span class="main-t"><span class="co">${esc(humanCode(item.normalized_category))}</span><span class="meta">${bi(...profileLabel(item.product_profile))} · ${bi(...(CANDIDATE_SOURCES[item.candidate_source] || [item.candidate_source || '—', item.candidate_source || '—']))}</span></span><button class="btn btn-sm" type="button" data-propose-candidate="${esc(item.product_profile)}|${esc(item.normalized_category)}">${bi('提议加入', 'Propose')}</button></div></li>`).join('')}</ul>`;
}

function categoriesPage() {
  return `<div class="grid2b v4-scope-grid">
    <section class="card" aria-labelledby="scope-current-title"><div class="ph"><div><h3 id="scope-current-title">${bi('已批准品类', 'Approved categories')}</h3><p>${bi('研究与机会评估使用的供货品类', 'Supply categories used by research and opportunity assessment')}</p></div></div><div class="pb" id="scope-current"></div></section>
    <section class="card" aria-labelledby="scope-drafts-title"><div class="ph"><div><h3 id="scope-drafts-title">${bi('待批准修订', 'Revisions awaiting approval')}</h3><p>${bi('批准后成为新的生效版本', 'Approval makes it the revision in effect')}</p></div></div><div id="scope-drafts"></div></section>
  </div>
  <div class="grid2b v4-scope-grid">
    <section class="card" aria-labelledby="scope-custom-title"><div class="ph"><div><h3 id="scope-custom-title">${bi('新增品类', 'Add a category')}</h3><p>${bi('先建立待批准修订，由管理层批准', 'Creates a draft revision for management approval')}</p></div></div>
      <form class="pb" id="scope-custom-form" novalidate>
        <div class="form-grid">
          <div class="field"><label for="scope-profile">${bi('产品画像', 'Product profile')}</label><select id="scope-profile" name="product_profile">${Object.entries(PROFILES).map(([code, [zh, en]]) => `<option value="${code}">${zh} ${en}</option>`).join('')}</select></div>
          <div class="field"><label for="scope-taxonomy">${bi('从标准品类查找', 'Find in standard taxonomy')}</label><input id="scope-taxonomy" type="search" autocomplete="off" placeholder="dress / 连衣裙"></div>
        </div>
        <ul class="v4-taxonomy-results" id="scope-taxonomy-results" aria-live="polite"></ul>
        <div class="form-grid">
          <div class="field"><label for="scope-code">${bi('品类代码', 'Category code')}</label><input id="scope-code" name="normalized_category" maxlength="100" placeholder="DRESSES" autocapitalize="characters"></div>
          <div class="field"><label for="scope-parent">${bi('上级品类（可选）', 'Parent category (optional)')}</label><select id="scope-parent" name="parent_category"><option value="">—</option></select></div>
          <div class="field"><label for="scope-name-zh">${bi('中文名称', 'Chinese name')}</label><input id="scope-name-zh" name="name_zh" maxlength="200"></div>
          <div class="field"><label for="scope-name-en">${bi('英文名称', 'English name')}</label><input id="scope-name-en" name="name_en" maxlength="200"></div>
          <div class="field wide"><label for="scope-name-es">${bi('西班牙语名称（可选）', 'Spanish name (optional)')}</label><input id="scope-name-es" name="name_es" maxlength="200"></div>
        </div>
        <div class="btns v4-followup-save"><span class="v4-form-status" role="status" aria-live="polite"></span><button class="btn btn-primary" type="submit">${bi('建立待批准修订', 'Create draft revision')}</button></div>
      </form></section>
    <section class="card" aria-labelledby="scope-candidates-title"><div class="ph"><div><h3 id="scope-candidates-title">${bi('候选品类', 'Candidate categories')}</h3><p>${bi('来自客户画像与历史成交', 'From customer profiles and past orders')}</p></div></div><div id="scope-candidates"></div></section>
  </div>`;
}

function renderCategories() {
  const set = (id, html) => { const node = $(id); if (node) node.innerHTML = html; };
  set('#scope-current', currentMarkup()); set('#scope-drafts', draftsMarkup()); set('#scope-candidates', candidatesMarkup());
  const parent = $('#scope-parent'); const profile = $('#scope-profile')?.value;
  if (parent) parent.innerHTML = `<option value="">—</option>${(cat.current?.items || []).filter(row => row.product_profile === profile).map(row => `<option value="${esc(row.normalized_category)}">${esc(humanCode(row.normalized_category))}</option>`).join('')}`;
}

async function loadCategories() {
  [cat.current, cat.revisions, cat.candidates] = [null, null, null]; renderCategories();
  const [current, revisions, candidates] = await Promise.all([settle(managementRequest('/api/category-scopes/current')), settle(managementRequest('/api/category-scopes/revisions')), settle(managementRequest('/api/category-scopes/candidates'))]);
  Object.assign(cat, { current, revisions, candidates }); renderCategories();
}

function wireCategories(root) {
  let searchTimer = null; let searchSeq = 0;
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-state-retry]')) { void loadCategories(); return; }
    const approve = event.target.closest('[data-approve-revision]');
    if (approve) {
      const draft = (cat.revisions?.items || []).find(item => item.id === approve.dataset.approveRevision);
      const status = root.querySelector(`[data-revision-status="${CSS.escape(approve.dataset.approveRevision)}"]`);
      const next = Math.max(0, ...(cat.revisions?.items || []).map(item => Number(item.revision) || 0)) + 1;
      approve.disabled = true; status.innerHTML = bi('正在批准', 'Approving');
      try { await json(`/api/category-scopes/revisions/${encodeURIComponent(draft.id)}/approve`, { revision: next, source_reference: draft.source_reference || `approve:${draft.id}`, source_digest: draft.source_digest }); await loadCategories(); }
      catch (error) { approve.disabled = false; status.innerHTML = bi(...errorText(error)); }
      return;
    }
    const pick = event.target.closest('[data-taxonomy-pick]');
    if (pick) {
      const item = cat.taxonomy[Number(pick.dataset.taxonomyPick)];
      const form = $('#scope-custom-form');
      cat.picked = item;
      form.normalized_category.value = item.suggested_category_code || '';
      form.name_zh.value = item.names?.zh || ''; form.name_en.value = item.names?.en || ''; form.name_es.value = item.names?.es || '';
      if (item.suggested_product_profile && PROFILES[item.suggested_product_profile]) { form.product_profile.value = item.suggested_product_profile; renderCategories(); }
      $('#scope-taxonomy-results').innerHTML = `<li class="meta">${bi(`已选：${item.path}`, `Selected: ${item.path}`)}</li>`;
      form.name_zh.focus();
      return;
    }
    const propose = event.target.closest('[data-propose-candidate]');
    if (propose) {
      const [profile, code] = propose.dataset.proposeCandidate.split('|');
      const form = $('#scope-custom-form'); form.product_profile.value = profile; form.normalized_category.value = code; cat.picked = null;
      renderCategories(); form.name_zh.focus();
    }
  });
  root.addEventListener('change', event => { if (event.target.id === 'scope-profile') renderCategories(); });
  root.addEventListener('input', event => {
    if (event.target.id !== 'scope-taxonomy') return;
    clearTimeout(searchTimer);
    const q = event.target.value.trim(); const host = $('#scope-taxonomy-results');
    if (q.length < 2) { host.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq; host.innerHTML = `<li class="meta">${bi('正在查找', 'Searching')}</li>`;
      try {
        const payload = await managementRequest(`/api/category-scopes/taxonomy?q=${encodeURIComponent(q)}&limit=8`);
        if (seq !== searchSeq) return;
        cat.taxonomy = payload?.items || [];
        host.innerHTML = cat.taxonomy.length ? cat.taxonomy.map((item, index) => `<li><button type="button" class="v4-taxonomy-item" data-taxonomy-pick="${index}"><b>${esc(item.names?.zh || item.names?.en || item.path)}</b> <span class="meta">${esc(item.names?.en || '')} · ${esc(item.path)}</span></button></li>`).join('') + `<li class="meta v4-taxonomy-source">${esc(payload.source || '')} ${esc(payload.version || '')}</li>` : `<li class="meta">${bi('没有匹配的标准品类', 'No matching taxonomy category')}</li>`;
      } catch { if (seq === searchSeq) host.innerHTML = `<li class="meta">${bi('标准品类暂未读取', 'Taxonomy unavailable')}</li>`; }
    }, 250);
  });
  root.addEventListener('submit', async event => {
    if (event.target.id !== 'scope-custom-form') return;
    event.preventDefault();
    const form = event.target; const status = form.querySelector('.v4-form-status'); const submit = form.querySelector('[type="submit"]');
    const code = form.normalized_category.value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const names = Object.fromEntries([['zh', form.name_zh.value], ['en', form.name_en.value], ['es', form.name_es.value]].map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
    if (!code) { status.innerHTML = bi('请填写品类代码', 'Enter a category code'); form.normalized_category.focus(); return; }
    if (!names.zh && !names.en) { status.innerHTML = bi('请至少填写中文或英文名称', 'Enter a Chinese or English name'); form.name_zh.focus(); return; }
    submit.disabled = true; status.innerHTML = bi('正在建立', 'Creating');
    try {
      await json('/api/category-scopes/custom', { product_profile: form.product_profile.value, normalized_category: code, names, parent_category: form.parent_category.value || undefined, taxonomy_id: cat.picked?.taxonomy_id || undefined });
      form.reset(); cat.picked = null; $('#scope-taxonomy-results').innerHTML = '';
      status.innerHTML = bi('已建立待批准修订', 'Draft revision created');
      await loadCategories();
    } catch (error) {
      status.innerHTML = error?.code === 'CATEGORY_SCOPE_ALREADY_APPROVED' ? bi('该品类已在批准范围内', 'This category is already approved') : bi(...errorText(error));
    } finally { submit.disabled = false; }
  });
}

/* ---------------- 目标市场 / Target markets ---------------- */
const mk = { payload: null };
const marketStatus = { ACTIVE: ['启用', 'Active', 'ok'], INACTIVE: ['未启用', 'Inactive', ''], HIDDEN: ['已隐藏', 'Hidden', ''], AVAILABLE: ['可启用', 'Available', ''], PAUSED: ['已暂停', 'Paused', 'warn'], PLANNED: ['规划中', 'Planned', ''] };
function marketsMarkup() {
  if (mk.payload?.error) return stateBlock('error', '目标市场暂未读取', 'Markets unavailable', { retry: true });
  if (!mk.payload) return skeletonRows(4);
  const items = mk.payload.items || [];
  if (!items.length) return stateBlock('empty', '暂无可选市场', 'No markets available');
  const enabled = items.filter(item => item.search_enabled).length;
  return `<p class="meta v4-scope-meta">${bi(`已启用研究 ${enabled} / ${items.length} 个市场`, `${enabled} of ${items.length} markets enabled for research`)}</p><table class="rtable v4-market-table"><caption class="sr-only">目标市场 Target markets</caption><thead><tr><th scope="col">${bi('市场', 'Market')}</th><th scope="col">${bi('状态', 'Status')}</th><th scope="col">${bi('语言', 'Languages')}</th><th scope="col">${bi('时区', 'Time zone')}</th><th scope="col">${bi('研究搜索', 'Research search')}</th></tr></thead><tbody>${items.map(item => {
    const [zh, en, tone] = marketStatus[item.status] || [item.status, item.status, ''];
    const langs = Array.isArray(item.languages) ? item.languages.join(' · ') : (item.languages || '—');
    return `<tr><td class="m-main"><span class="co">${esc(item.country_name || item.market_code)}</span><span class="meta">${esc(item.market_code)}${item.market_profile ? ` · ${esc(item.market_profile)}` : ''}</span></td><td class="m-hide"><span class="pill ${tone}">${bi(zh, en)}</span></td><td class="m-sub">${esc(langs)}</td><td class="m-hide">${esc(item.timezone || '—')}</td><td class="m-side"><label class="v4-switch"><input type="checkbox" role="switch" data-market-toggle="${esc(item.market_code)}"${item.search_enabled ? ' checked' : ''} aria-label="${esc(item.country_name || item.market_code)} 研究搜索 Research search"><span aria-hidden="true"></span></label><span class="v4-form-status" role="status" aria-live="polite" data-market-status="${esc(item.market_code)}"></span></td></tr>`;
  }).join('')}</tbody></table>`;
}
async function loadMarkets() { mk.payload = null; render('#markets-list', marketsMarkup()); mk.payload = await settle(managementRequest('/api/markets/registry')); render('#markets-list', marketsMarkup()); }
const render = (id, html) => { const node = $(id); if (node) node.innerHTML = html; };
function wireMarkets(root) {
  root.addEventListener('click', event => { if (event.target.closest('[data-state-retry]')) void loadMarkets(); });
  root.addEventListener('change', async event => {
    const toggle = event.target.closest('[data-market-toggle]');
    if (!toggle) return;
    const code = toggle.dataset.marketToggle; const status = root.querySelector(`[data-market-status="${CSS.escape(code)}"]`);
    toggle.disabled = true; status.innerHTML = bi('正在保存', 'Saving');
    try {
      const result = await json(`/api/markets/registry/${encodeURIComponent(code)}`, { search_enabled: toggle.checked, reason: toggle.checked ? 'Enabled in system settings' : 'Disabled in system settings' }, 'PUT');
      const item = (mk.payload?.items || []).find(row => row.market_code === code); if (item) Object.assign(item, result);
      render('#markets-list', marketsMarkup());
      root.querySelector(`[data-market-status="${CSS.escape(code)}"]`).innerHTML = bi('已保存', 'Saved');
      document.dispatchEvent(new CustomEvent('research:optionschange'));
    } catch (error) { toggle.checked = !toggle.checked; toggle.disabled = false; status.innerHTML = bi(...errorText(error)); }
  });
}

function mount() {
  const categories = $('#categories-root'); const markets = $('#markets-root');
  if (categories) { categories.innerHTML = categoriesPage(); wireCategories(categories); }
  if (markets) {
    markets.innerHTML = `<section class="card" aria-labelledby="markets-card-title"><div class="ph"><div><h3 id="markets-card-title">${bi('研究市场', 'Research markets')}</h3><p>${bi('停用只停止新的研究，已有客户的跟进不受影响', 'Disabling stops new research only; existing follow-up continues')}</p></div></div><div class="pb" id="markets-list"></div></section>`;
    wireMarkets(markets);
  }
  document.addEventListener('crm:viewchange', event => {
    if (event.detail?.view === 'categories') void loadCategories();
    if (event.detail?.view === 'markets') void loadMarkets();
  });
  if (!document.querySelector('#view-categories')?.hidden) void loadCategories();
  if (!document.querySelector('#view-markets')?.hidden) void loadMarkets();
}
mount();
