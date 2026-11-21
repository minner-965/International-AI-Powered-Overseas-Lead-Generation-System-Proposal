// 商机与分级 / Deal and grade card in Company Detail (migration 079): amount, currency, expected
// close date, win probability (empty = the stage default), customer grade A-D, plus the health
// score and key-customer flags. API: GET/PUT /api/crm/companies/:id/deal.
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';
import { FLAG_NAMES } from './sales-reports.js';

export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'AED', 'SAR', 'MXN', 'BRL', 'AUD', 'CAD', 'SGD', 'CNY']);
const GRADES = Object.freeze({ A: ['重点', 'Key'], B: ['良好', 'Good'], C: ['一般', 'Normal'], D: ['较低', 'Low'] });
const HEALTH = Object.freeze({ GOOD: ['健康', 'Healthy', 'ok'], FAIR: ['一般', 'Fair', 'warn'], POOR: ['需关注', 'Needs attention', 'bad'] });
const PARTS = Object.freeze([['profile', '资料完整', 'Profile', 25], ['timely', '跟进及时', 'On time', 35], ['moving', '商机推进', 'Deal moving', 25], ['answered', '客户互动', 'Customer answers', 15]]);

/** Card markup (exported for tests). */
export function dealCardMarkup(deal, { busy = false } = {}) {
  const health = deal.health ? HEALTH[deal.health.level] : null;
  const parts = deal.health ? PARTS.map(([key, zh, en, max]) => `<li><span class="k">${bi(zh, en)}</span><span class="v4-bar" aria-hidden="true"><span style="width:${Math.round(deal.health.parts[key] / max * 100)}%"></span></span><span class="v">${deal.health.parts[key]} / ${max}</span></li>`).join('') : '';
  const flags = (deal.flags || []).map(flag => `<span class="pill${flag === 'HIGH_INTENT' ? ' ok' : ' warn'}">${bi(...FLAG_NAMES[flag])}</span>`).join('');
  const currencies = [...new Set([...(deal.deal_currency ? [deal.deal_currency] : []), ...CURRENCIES])];
  const grade = Object.entries(GRADES).map(([key, [zh, en]]) => `<label class="v4-grade${deal.customer_grade === key ? ' is-on' : ''}"${tip(`客户分级 ${key}：${zh}。分级由您判断，和健康度分开`, `Grade ${key}: ${en}. Your own judgement, separate from health`)}><input type="radio" name="customer_grade" value="${key}"${deal.customer_grade === key ? ' checked' : ''}${busy ? ' disabled' : ''}><b>${key}</b><small>${bi(zh, en)}</small></label>`).join('');
  return `<section class="card v4-deal-card" aria-labelledby="deal-title" data-deal-card data-company-id="${esc(deal.company_id)}"><div class="ph"><div><h3 id="deal-title">${bi('商机与分级', 'Deal and grade')}</h3><p>${flags || bi('暂无提醒', 'No alerts')}</p></div>${health ? `<span class="pill ${health[2]}"${tip('健康度 0-100：资料完整、跟进及时、商机推进、客户互动四项相加', 'Health 0-100: profile, timely follow-up, deal movement and customer answers')}>${bi(`${health[0]} ${deal.health.score}`, `${health[1]} ${deal.health.score}`)}</span>` : ''}</div>
    <form class="pb" data-deal-form novalidate>
      <fieldset class="field"><legend class="lbl">${bi('客户分级', 'Customer grade')}</legend><div class="v4-grades" role="radiogroup">${grade}</div></fieldset>
      <div class="form-grid">
        <div class="field"><label for="deal-amount">${bi('预计金额', 'Deal amount')}</label><input id="deal-amount" name="deal_amount" type="number" inputmode="decimal" min="0" step="0.01" value="${deal.deal_amount ?? ''}"${busy ? ' disabled' : ''}${tip('这单预计能成交的金额，用于报表的在谈金额', 'Expected value of this deal; used for the pipeline value in reports')}></div>
        <div class="field"><label for="deal-currency">${bi('币种', 'Currency')}</label><select id="deal-currency" name="deal_currency"${busy ? ' disabled' : ''}><option value="">—</option>${currencies.map(code => `<option value="${code}"${deal.deal_currency === code ? ' selected' : ''}>${code}</option>`).join('')}</select></div>
        <div class="field"><label for="deal-close">${bi('预计成交日', 'Expected close')}</label><input id="deal-close" name="expected_close_date" type="date" value="${esc(deal.expected_close_date || '')}"${busy ? ' disabled' : ''}></div>
        <div class="field"><label for="deal-probability">${bi('赢率 %', 'Win probability %')}</label><input id="deal-probability" name="win_probability" type="number" inputmode="numeric" min="0" max="100" step="1" value="${deal.win_probability ?? ''}" placeholder="${deal.default_win_probability}"${busy ? ' disabled' : ''}${tip(`留空时按当前阶段默认 ${deal.default_win_probability}%`, `Empty uses the stage default, ${deal.default_win_probability}%`)}></div>
      </div>
      ${parts ? `<details class="v4-health-parts"><summary>${bi('健康度怎么算', 'How health is counted')}</summary><ul class="review-list">${parts}</ul></details>` : ''}
      <p class="v4-form-status" role="status" aria-live="polite" data-deal-status></p>
      <div class="btns"><button class="btn btn-primary" type="submit"${busy ? ' disabled' : ''}${tip('保存金额、成交日、赢率和分级；每次修改都会留下记录', 'Save the amount, close date, probability and grade; every change is recorded')}>${bi('保存', 'Save')}</button></div>
    </form></section>`;
}

/** Form values → request body; empty fields clear the value. */
export function dealBody(form) {
  const value = name => form[name]?.value?.trim?.() ?? '';
  const grade = form.querySelector('input[name="customer_grade"]:checked')?.value || null;
  return { deal_amount: value('deal_amount') === '' ? null : Number(value('deal_amount')), deal_currency: value('deal_currency') || null,
    expected_close_date: value('expected_close_date') || null, win_probability: value('win_probability') === '' ? null : Number(value('win_probability')), customer_grade: grade };
}
export function dealProblem(body) {
  if (body.deal_amount !== null && !(body.deal_amount >= 0)) return ['金额请填写正数', 'Enter a positive amount'];
  if (body.deal_amount !== null && !body.deal_currency) return ['请选择币种', 'Choose a currency'];
  if (body.win_probability !== null && !(Number.isInteger(body.win_probability) && body.win_probability >= 0 && body.win_probability <= 100)) return ['赢率请填 0 到 100 的整数', 'Use a whole number from 0 to 100'];
  return null;
}

export async function mountDealCard(host, companyId) {
  if (!host || !companyId) return;
  host.querySelector('[data-deal-card]')?.remove();
  const slot = document.createElement('div');
  slot.innerHTML = `<section class="card" data-deal-card>${stateBlock('loading', '正在读取商机', 'Loading deal')}</section>`;
  host.append(slot);
  let deal;
  try { deal = await managementRequest(`/api/crm/companies/${encodeURIComponent(companyId)}/deal`); }
  catch { slot.innerHTML = ''; return; }
  const render = (busy = false) => { slot.innerHTML = dealCardMarkup(deal, { busy }); };
  render();
  slot.addEventListener('click', event => {
    const label = event.target.closest('.v4-grade');
    if (label) slot.querySelectorAll('.v4-grade').forEach(item => item.classList.toggle('is-on', item === label));
  });
  slot.addEventListener('submit', async event => {
    if (!event.target.matches('[data-deal-form]')) return;
    event.preventDefault();
    const body = dealBody(event.target);
    const problem = dealProblem(body);
    if (problem) { event.target.querySelector('[data-deal-status]').innerHTML = bi(...problem); return; }
    render(true);
    try {
      deal = await managementRequest(`/api/crm/companies/${encodeURIComponent(companyId)}/deal`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expected_version: deal.version }) });
      render(); toast('商机信息已保存', 'Deal saved');
    } catch (error) {
      render();
      const status = slot.querySelector('[data-deal-status]');
      if (status) status.innerHTML = bi(...(error?.status === 409 ? ['已被他人修改，请刷新后重试', 'Changed by someone else; refresh and retry'] : error?.code === 'CRM_CURRENCY_REQUIRED' ? ['请选择币种', 'Choose a currency'] : ['未能保存，请重试', 'Could not save; please retry']));
    }
  });
}
