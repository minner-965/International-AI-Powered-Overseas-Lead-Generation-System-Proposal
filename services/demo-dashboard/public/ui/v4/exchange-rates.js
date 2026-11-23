// 汇率 / Exchange rates entered by hand (plan item 7, migration 081): 1 unit of a currency = ? base currency.
// The card sits in Settings (administrator) and, folded, at the bottom of 销售报表 for every account; the line
// above the report shows the converted total once every currency has a rate. No outside rate service is used.
// API: GET /api/crm/exchange-rates[?include=totals], PUT /api/crm/exchange-rates.
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';
import { moneyText } from './sales-reports.js';

export const BASE_CURRENCIES = Object.freeze(['USD', 'EUR', 'CNY', 'GBP', 'AED']);
const CODE = /^[A-Z]{3}$/;

/** Rates card markup (exported for tests). `rows` are {currency, rate} as typed. */
export function ratesMarkup(data, { busy = false, folded = false } = {}) {
  const base = data.base_currency || 'USD';
  const bases = [...new Set([base, ...BASE_CURRENCIES])];
  const rows = (data.rates || []).map((row, index) => `<li class="v4-rate-row" data-rate-row>
      <label class="sr-only" for="rate-currency-${index}">币种 Currency</label><input id="rate-currency-${index}" name="currency" maxlength="3" autocapitalize="characters" value="${esc(row.currency || '')}" placeholder="EUR"${busy ? ' disabled' : ''}>
      <span class="v4-rate-eq">${bi(`1 单位 =`, '1 unit =')}</span>
      <label class="sr-only" for="rate-value-${index}">汇率 Rate</label><input id="rate-value-${index}" name="rate" type="number" inputmode="decimal" min="0" step="any" value="${esc(row.rate ?? '')}"${busy ? ' disabled' : ''}>
      <span class="v4-rate-base">${esc(base)}</span>
      <button class="btn btn-sm" type="button" data-rate-remove="${index}"${busy ? ' disabled' : ''}${tip('删掉这一行汇率', 'Remove this rate')}>${bi('删除', 'Remove')}</button></li>`).join('');
  const updated = data.updated_at ? `<p class="meta">${bi(`最近修改 ${new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false })}`, `Last changed ${new Date(data.updated_at).toLocaleString('en-GB', { hour12: false })}`)}</p>` : '';
  const body = `<form class="pb" data-rates-form novalidate>
      <div class="field"><label for="rates-base">${bi('基准币种', 'Base currency')}</label><select id="rates-base" name="base_currency"${busy ? ' disabled' : ''}${tip('报表的折合合计用这个币种显示', 'The report shows the converted total in this currency')}>${bases.map(code => `<option value="${code}"${code === base ? ' selected' : ''}>${code}</option>`).join('')}</select></div>
      ${rows ? `<ul class="v4-rate-list">${rows}</ul>` : `<p class="meta">${bi('还没有汇率。有不同币种的商机时，添加对应币种的汇率', 'No rates yet. Add one for each other currency your deals use')}</p>`}
      ${updated}<p class="v4-form-status" role="status" aria-live="polite" data-rates-status></p>
      <div class="btns"><button class="btn" type="button" data-rate-add${busy ? ' disabled' : ''}${tip('再加一种币种的汇率', 'Add a rate for another currency')}>${bi('添加币种', 'Add currency')}</button>
        <button class="btn btn-primary" type="submit"${busy ? ' disabled' : ''}${tip('保存汇率，只用于您自己的报表合计，每次修改都会留下记录', 'Save the rates for your own report totals; every change is recorded')}>${bi('保存汇率', 'Save rates')}</button></div></form>`;
  const head = `<h3 id="${folded ? 'report-rates-title' : 'rates-title'}">${bi('汇率', 'Exchange rates')}</h3><p>${bi('自己填写的汇率，用来把不同币种的金额折合成一个合计；不会自动更新', 'Rates you enter to add up amounts in different currencies; they are not updated automatically')}</p>`;
  return folded
    ? `<section class="card v4-rates-card" aria-labelledby="report-rates-title"><details data-rates-details><summary class="ph"><div>${head}</div></summary>${body}</details></section>`
    : `<section class="card v4-rates-card" aria-labelledby="rates-title"><div class="ph"><div>${head}</div></div>${body}</section>`;
}

/** Form → request body, or a problem [zh, en]. */
export function ratesBody(base, rows) {
  const rates = [];
  for (const row of rows) {
    const currency = String(row.currency || '').trim().toUpperCase(); const raw = String(row.rate ?? '').trim();
    if (!currency && !raw) continue;
    if (!CODE.test(currency)) return { problem: ['币种请填三个字母，例如 EUR', 'Use a 3-letter code such as EUR'] };
    if (currency === base) return { problem: [`不用填基准币种 ${base} 的汇率`, `No rate is needed for the base currency ${base}`] };
    if (rates.some(item => item.currency === currency)) return { problem: [`${currency} 填了两次`, `${currency} is listed twice`] };
    const rate = Number(raw);
    if (!(rate > 0 && rate <= 1e6)) return { problem: [`${currency} 的汇率请填大于 0 的数字`, `Enter a positive rate for ${currency}`] };
    rates.push({ currency, rate });
  }
  return { body: { base_currency: base, rates } };
}

/** Line above the report: converted total, or which currencies still need a rate; empty with one currency. */
export function convertedMarkup(data) {
  const c = data?.converted;
  if (!c || (c.currencies || []).length < 2) return '';
  const link = `<a class="btn btn-sm" href="#sales-reports" data-rates-open${tip('打开汇率设置', 'Open the exchange rates')}>${bi('设置汇率', 'Set rates')}</a>`;
  if (!c.total) return `<p class="meta v4-converted">${bi(`${c.missing.join('、')} 未设汇率，未计入合计`, `No rate for ${c.missing.join(', ')}; not in a combined total`)} ${link}</p>`;
  const t = c.total;
  return `<p class="meta v4-converted">${bi(`折合 ${c.base} 约：在谈 ${moneyText(t.pipeline_amount, c.base)}（按赢率 ${moneyText(t.weighted_amount, c.base)}），已成交 ${moneyText(t.won_amount, c.base)}（按您填的汇率）`, `In ${c.base}, at your rates: pipeline ${moneyText(t.pipeline_amount, c.base)} (weighted ${moneyText(t.weighted_amount, c.base)}), won ${moneyText(t.won_amount, c.base)}`)} ${link}</p>`;
}

function mount(root, { folded }) {
  const state = { data: null, rows: [], busy: false, error: false };
  const render = () => {
    if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '汇率暂未读取', 'Rates unavailable', { retry: true })}</section>`; return; }
    if (!state.data) { root.innerHTML = ''; return; }
    const open = root.querySelector('[data-rates-details]')?.open;
    root.innerHTML = ratesMarkup({ ...state.data, rates: state.rows }, { busy: state.busy, folded });
    if (open) root.querySelector('[data-rates-details]').open = true;
  };
  const readRows = () => [...root.querySelectorAll('[data-rate-row]')].map(row => ({ currency: row.querySelector('[name="currency"]').value, rate: row.querySelector('[name="rate"]').value }));
  const load = async () => {
    state.error = false;
    try { state.data = await managementRequest('/api/crm/exchange-rates'); state.rows = state.data.rates.map(row => ({ ...row })); }
    catch { state.error = true; }
    render();
  };
  root.addEventListener('click', event => {
    if (event.target.closest('[data-state-retry]')) { void load(); return; }
    if (event.target.closest('[data-rate-add]')) { state.rows = [...readRows(), { currency: '', rate: '' }]; render(); root.querySelector('[data-rate-row]:last-child [name="currency"]')?.focus(); return; }
    const remove = event.target.closest('[data-rate-remove]');
    if (remove) { const rows = readRows(); rows.splice(Number(remove.dataset.rateRemove), 1); state.rows = rows; render(); }
  });
  root.addEventListener('change', event => { if (event.target.name === 'base_currency') { state.data = { ...state.data, base_currency: event.target.value }; state.rows = readRows(); render(); } });
  root.addEventListener('submit', async event => {
    if (!event.target.matches('[data-rates-form]')) return;
    event.preventDefault();
    const rows = readRows(); const { body, problem } = ratesBody(event.target.base_currency.value, rows);
    if (problem) { event.target.querySelector('[data-rates-status]').innerHTML = bi(...problem); return; }
    state.rows = rows; state.busy = true; render();
    try {
      state.data = await managementRequest('/api/crm/exchange-rates', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      state.rows = state.data.rates.map(row => ({ ...row })); state.busy = false; render(); toast('汇率已保存', 'Rates saved');
      document.dispatchEvent(new CustomEvent('crm:rateschange'));
    } catch { state.busy = false; render(); const status = root.querySelector('[data-rates-status]'); if (status) status.innerHTML = bi('未能保存，请检查后重试', 'Could not save; check and retry'); }
  });
  return load;
}

async function loadConverted() {
  const host = document.getElementById('report-converted-root');
  if (!host) return;
  try { host.innerHTML = convertedMarkup(await managementRequest('/api/crm/exchange-rates?include=totals')); }
  catch { host.innerHTML = ''; }
}

if (typeof document !== 'undefined') {
  const settingsRoot = document.getElementById('exchange-rates-root');
  const reportRoot = document.getElementById('report-rates-root');
  const loadSettings = settingsRoot ? mount(settingsRoot, { folded: false }) : null;
  const loadReportRates = reportRoot ? mount(reportRoot, { folded: true }) : null;
  document.getElementById('report-converted-root')?.addEventListener('click', event => {
    if (!event.target.closest('[data-rates-open]')) return;
    event.preventDefault();
    const details = reportRoot?.querySelector('[data-rates-details]');
    if (details) { details.open = true; details.scrollIntoView({ block: 'start' }); details.querySelector('select,input')?.focus(); }
  });
  document.addEventListener('crm:viewchange', event => {
    if (event.detail?.view === 'settings') void loadSettings?.();
    if (event.detail?.view === 'sales-reports') { void loadReportRates?.(); void loadConverted(); }
  });
  document.addEventListener('crm:rateschange', () => void loadConverted());
  sessionReady.then(() => {
    if (!document.getElementById('view-settings')?.hidden) void loadSettings?.();
    if (!document.getElementById('view-sales-reports')?.hidden) { void loadReportRates?.(); void loadConverted(); }
  });
}
