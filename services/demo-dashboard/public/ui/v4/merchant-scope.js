// 我的业务范围 / Business scope: the merchant picks categories (from SIM-approved categories) and
// markets (active markets) for their searches. GET/PUT /api/merchant/scope.
import { bi, esc, stateBlock, skeletonRows } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

const $ = (selector, root = document) => root.querySelector(selector);
const PROFILES = { WOMENSWEAR: ['女装', 'Womenswear'], GENERAL_MERCHANDISE: ['日用百货', 'General merchandise'] };
const humanCode = code => String(code || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
let regionNames = null;
try { regionNames = { zh: new Intl.DisplayNames(['zh-CN'], { type: 'region' }), en: new Intl.DisplayNames(['en'], { type: 'region' }) }; } catch { regionNames = null; }
export const countryName = (code, fallback = '') => {
  try { return [regionNames?.zh.of(code) || fallback || code, regionNames?.en.of(code) || fallback || code]; } catch { return [fallback || code, fallback || code]; }
};

/** Options + current choice from the scope payload, with the approved lists as fallback sources. */
export function scopeModel(scope, categories, markets) {
  const categoryItems = (scope?.available_categories || categories?.items || []).filter(item => !item.scope_status || item.scope_status === 'ACTIVE')
    .map(item => ({ id: String(item.id ?? item.category_scope_id), profile: item.product_profile || '', zh: item.name_zh || item.names?.zh || item.display_name_zh || '', en: item.name_en || item.names?.en || humanCode(item.normalized_category || item.name || item.id) }));
  const marketItems = (scope?.available_markets || markets?.items || []).filter(item => (item.status ?? 'ACTIVE') === 'ACTIVE' && item.search_enabled !== false)
    .map(item => { const code = String(item.market_code || item.code).toUpperCase(); const [zh, en] = countryName(code, item.country_name); return { code, zh, en }; });
  return { categories: categoryItems, markets: marketItems, chosenCategories: new Set((scope?.category_scope_ids || []).map(String)), chosenMarkets: new Set((scope?.market_codes || []).map(code => String(code).toUpperCase())) };
}

const state = { model: null, error: false, saving: false };

function categoriesMarkup(model) {
  if (!model.categories.length) return stateBlock('empty', 'SIM 还没有开放可选类目，请联系 SIM', 'No categories are open yet; contact SIM');
  const groups = new Map();
  for (const item of model.categories) { if (!groups.has(item.profile)) groups.set(item.profile, []); groups.get(item.profile).push(item); }
  return [...groups].map(([profile, items]) => `<fieldset class="v4-scope-group"><legend>${bi(...(PROFILES[profile] || [profile || '其他', profile || 'Other']))}</legend><div class="v4-choice-grid">${items.map(item => `<label class="v4-choice"${tip(`勾选后会按「${item.zh || item.en}」为您找客户`, `Searches will include ${item.en}`)}><input type="checkbox" name="category" value="${esc(item.id)}"${model.chosenCategories.has(item.id) ? ' checked' : ''}><span>${item.zh ? `${esc(item.zh)}<small>${esc(item.en)}</small>` : esc(item.en)}</span></label>`).join('')}</div></fieldset>`).join('');
}
function marketsMarkup(model) {
  if (!model.markets.length) return stateBlock('empty', 'SIM 还没有开放可选市场，请联系 SIM', 'No markets are open yet; contact SIM');
  return `<div class="v4-choice-grid">${model.markets.map(item => `<label class="v4-choice"${tip(`勾选后会在${item.zh}寻找客户`, `Searches will include ${item.en}`)}><input type="checkbox" name="market" value="${esc(item.code)}"${model.chosenMarkets.has(item.code) ? ' checked' : ''}><span>${esc(item.zh)}<small>${esc(item.en)} · ${esc(item.code)}</small></span></label>`).join('')}</div>`;
}

function summary(form) {
  const c = form ? form.querySelectorAll('input[name="category"]:checked').length : state.model.chosenCategories.size;
  const m = form ? form.querySelectorAll('input[name="market"]:checked').length : state.model.chosenMarkets.size;
  return bi(`已选 ${c} 个类目 · ${m} 个市场`, `${c} categories · ${m} markets selected`);
}

function render() {
  const root = $('#scope-root');
  if (!root) return;
  if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '业务范围暂未读取', 'Business scope unavailable', { retry: true })}</section>`; return; }
  if (!state.model) { root.innerHTML = `<section class="card">${skeletonRows(4)}</section>`; return; }
  root.innerHTML = `<form class="v4-scope-form" novalidate>
    <section class="card" id="scope-categories" aria-labelledby="scope-categories-title" tabindex="-1"><div class="ph"><div><h3 id="scope-categories-title">${bi('① 我能供货的类目', '① Categories you supply')}</h3><p>${bi('从 SIM 已开放的类目中选择，可多选', 'Pick from the categories SIM has opened; choose several')}</p></div></div><div class="pb">${categoriesMarkup(state.model)}</div></section>
    <section class="card" id="scope-markets" aria-labelledby="scope-markets-title" tabindex="-1"><div class="ph"><div><h3 id="scope-markets-title">${bi('② 想开发的市场', '② Markets to sell to')}</h3><p>${bi('选择要寻找客户的国家和地区，可多选', 'Pick the countries to find buyers in; choose several')}</p></div></div><div class="pb">${marketsMarkup(state.model)}</div></section>
    <div class="v4-savebar"><span class="v4-scope-summary" aria-live="polite">${summary()}</span><span class="v4-form-status" role="status" aria-live="polite"></span><button class="btn btn-primary" type="submit" data-scope-save${tip('保存后，新的找客户任务会按这里的类目和市场进行', 'New searches will use these categories and markets')}><i class="ti ti-device-floppy" aria-hidden="true"></i>${bi('保存业务范围', 'Save scope')}</button></div>
  </form>`;
}

export async function loadScope() {
  state.error = false;
  const settle = promise => promise.catch(error => ({ __error: error }));
  const [scope, categories, registry] = await Promise.all([settle(managementRequest('/api/merchant/scope')), settle(managementRequest('/api/category-scopes/current')), settle(managementRequest('/api/markets/registry'))]);
  // Merchants may not read the registry; the public market list is the next source.
  const markets = !registry?.__error ? registry : await managementRequest('/api/markets').then(payload => ({ items: (payload?.markets || []).map(item => ({ market_code: item.country_code, country_name: item.country_name, status: 'ACTIVE' })) })).catch(() => ({ __error: true }));
  const scopeData = scope?.__error ? (scope.__error.status === 404 ? {} : null) : scope;
  if (!scopeData) { state.error = true; render(); return; }
  state.model = scopeModel(scopeData, categories?.__error ? null : categories, markets?.__error ? null : markets);
  render();
}

if (typeof document !== 'undefined') {
  const root = $('#scope-root');
  if (root) {
    root.addEventListener('change', event => { const form = event.target.form; if (form) form.querySelector('.v4-scope-summary').innerHTML = summary(form); });
    root.addEventListener('click', event => { if (event.target.closest('[data-state-retry]')) void loadScope(); });
    root.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.target; const status = form.querySelector('.v4-form-status');
      const body = { category_scope_ids: [...form.querySelectorAll('input[name="category"]:checked')].map(input => input.value), market_codes: [...form.querySelectorAll('input[name="market"]:checked')].map(input => input.value) };
      if (!body.category_scope_ids.length || !body.market_codes.length) { status.innerHTML = bi('请至少选择 1 个类目和 1 个市场', 'Choose at least one category and one market'); return; }
      const button = form.querySelector('[data-scope-save]'); button.disabled = true; status.innerHTML = bi('正在保存', 'Saving');
      try {
        await managementRequest('/api/merchant/scope', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        state.model.chosenCategories = new Set(body.category_scope_ids); state.model.chosenMarkets = new Set(body.market_codes);
        status.textContent = ''; toast('业务范围已保存', 'Business scope saved', { action: { zh: '开始找客户', en: 'Find customers', href: '#research' } });
        document.dispatchEvent(new CustomEvent('crm:onboarding'));
      } catch (error) { status.innerHTML = bi(...([400, 422].includes(error.status) ? ['所选类目或市场已不可用，请刷新后重选', 'A choice is no longer available; refresh and choose again'] : error.status === 404 ? ['业务范围服务暂未开放，请联系 SIM', 'Scope settings are not available yet; contact SIM'] : ['保存未完成，请重试', 'Could not save; please retry'])); }
      finally { button.disabled = false; }
    });
    document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'scope') void loadScope(); });
    document.addEventListener('crm:scopesection', event => {
      const go = () => { const target = document.getElementById(`scope-${event.detail?.section}`); if (target) { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); } };
      if (state.model) requestAnimationFrame(go); else setTimeout(go, 600);
    });
    sessionReady.then(() => { if (!document.querySelector('#view-scope')?.hidden) void loadScope(); });
  }
}
