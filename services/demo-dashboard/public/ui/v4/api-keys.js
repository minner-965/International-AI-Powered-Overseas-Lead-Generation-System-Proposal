// 接口密钥 / API keys (B9). SIM administrator: system keys for search, email check, Feishu, translation
// and the low-cost model, with each service's on/off state. Merchant (我的接口密钥 My API keys): its own
// keys for services billed per account; when set, the merchant's work uses them.
// Keys are never shown again: the server answers only "set", the last four characters and the date.
import { bi, esc, stateBlock, skeletonRows } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady, session, isReadOnly } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

const $ = (selector, root = document) => root.querySelector(selector);
const send = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const GROUPS = Object.freeze([['search', '搜索', 'Search'], ['email', '邮箱核验', 'Email check'], ['llm', '模型', 'Model'], ['translate', '翻译', 'Translation'], ['crm', '客户表格同步', 'CRM sync']]);
const LLM_PROVIDERS = Object.freeze(['deepseek', 'openai', 'anthropic', 'qwen', 'moonshot', 'openrouter', 'groq', 'mistral']);
const PROVIDER_TIPS = Object.freeze({
  tavily: ['付费搜索，免费搜索不够用时补充查找客户企业', 'Paid search used when free search is not enough'],
  exa: ['付费搜索，免费搜索不够用时补充查找客户企业', 'Paid search used when free search is not enough'],
  brave: ['付费搜索，免费搜索不够用时补充查找客户企业', 'Paid search used when free search is not enough'],
  dataforseo: ['付费搜索（按次计费），用登录名和密码连接', 'Paid search billed per request; uses a login and password'],
  hunter: ['查找并核验客户的商务邮箱', 'Finds and checks business email addresses'],
  llm: ['低成本模型，辅助整理网页信息和翻译；判断和发送仍由系统规则决定', 'Low-cost model that helps extract page details and translate; rules still decide'],
  translate: ['翻译写信框和模板里的内容', 'Translates text in the email editors'],
  feishu: ['把客户跟进记录同步到飞书多维表', 'Syncs follow-up records to a Feishu Base table']
});

export const apiBase = admin => admin ? '/api/admin/provider-credentials' : '/api/merchant/provider-credentials';
const dateText = value => value ? new Date(value).toLocaleDateString('zh-CN') : '';

/** Which source the service uses now -> pill. Merchants only see "your key" / "provided by SIM". */
export function sourcePill(item, admin) {
  const map = admin
    ? { SIM: ['已设置', 'Set', 'ok'], ENV: ['使用服务器设置', 'Server settings', 'info'], NONE: ['未设置', 'Not set', 'warn'] }
    : { MERCHANT: ['使用您的密钥', 'Your key in use', 'ok'], SIM_PROVIDED: ['由 SIM 提供', 'Provided by SIM', 'info'], NONE: ['暂未提供', 'Not available', 'warn'] };
  const [zh, en, tone] = map[item.in_use] || map.NONE || ['未设置', 'Not set', 'warn'];
  const incomplete = admin && item.in_use !== 'NONE' && !item.configured;
  return `<span class="pill ${incomplete ? 'warn' : tone}" data-key-source="${esc(item.in_use)}">${bi(...(incomplete ? ['未填完整', 'Incomplete'] : [zh, en]))}</span>`;
}

/** Admin only: whether the system uses this service at all (B8 visibility). */
export function usagePill(item) {
  const usage = item.usage;
  if (!usage) return '';
  const notes = {
    IN_SEARCH_ORDER: ['在搜索顺序里；是否花钱由“搜索花费”决定', 'In the search order; spending follows Search spending'],
    NOT_IN_SEARCH_ORDER: ['不在搜索顺序里，系统不会使用', 'Not in the search order; not used'],
    EXA_DISABLED: ['服务器设置里未开启 Exa', 'Exa is switched off in the server settings'],
    HUNTER_FREE_FIRST: ['联系人研究开启时使用', 'Used when contact research is on'], HUNTER_TEST: ['测试模式', 'Test mode'],
    HUNTER_DISABLED: ['服务器设置里已关闭', 'Switched off in the server settings'], HUNTER_MODE_UNSET: ['服务器设置里未开启', 'Not switched on in the server settings'],
    CRM_PROVIDER_FEISHU: ['已开启同步', 'Sync on'], CRM_PROVIDER_OTHER: ['服务器设置里未选飞书', 'Feishu is not selected in the server settings'],
    ON_DEMAND: ['有人点击翻译或使用模型时才调用', 'Called only when someone uses it']
  }[usage.code] || ['', ''];
  return `<span class="pill ${usage.enabled ? 'ok' : ''}" data-key-usage${tip(...notes)}>${bi(...(usage.enabled ? ['启用中', 'In use'] : ['未启用', 'Not in use']))}</span>`;
}

export function testText(test) {
  if (!test) return ['尚未测试', 'Not tested yet'];
  const code = String(test.code || '').toUpperCase();
  if (test.ok) return [`测试通过 ${dateText(test.tested_at)}`, `Test passed ${dateText(test.tested_at)}`];
  if (code === 'NOT_CONFIGURED') return ['请先保存密钥', 'Save the key first'];
  if (code === 'KEY_REJECTED' || /^FEISHU_/.test(code)) return ['密钥未被接受，请检查后重新填写', 'The key was not accepted; check it and enter it again'];
  if (code === 'NO_CREDIT') return ['账户余额或额度不足', 'The account has no credit left'];
  if (code === 'RATE_LIMITED' || code === 'CREDENTIAL_TEST_RATE_LIMITED') return ['测试太频繁，请稍后再试', 'Too many tests; try again later'];
  if (/TIMEOUT|UNREACHABLE/.test(code)) return ['连接不上该服务，请检查地址或稍后再试', 'The service did not answer; check the address or retry'];
  return ['测试未通过', 'Test failed'];
}

function fieldMarkup(item, field, disabled) {
  const id = `key-${item.provider}-${field.field}`;
  const placeholder = field.configured ? '已设置，输入新值可替换 · Type to replace' : field.env_fallback ? '使用服务器设置，填写后改用此值 · Type to override' : field.optional ? '可选 Optional' : '';
  const list = item.provider === 'llm' && field.field === 'provider' ? ` list="key-llm-providers"` : '';
  return `<div class="field"><label for="${id}">${bi(field.label.zh, field.label.en)}</label><input id="${id}" name="${esc(field.field)}" type="${field.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" maxlength="4096"${list} placeholder="${esc(placeholder)}"${disabled ? ' disabled' : ''}>
    ${field.configured ? `<small class="meta" data-key-saved="${esc(field.field)}">${bi(`已设置${field.last4 ? ` · 末四位 ${field.last4}` : ''}${field.set_at ? ` · ${dateText(field.set_at)}` : ''}`, `Set${field.last4 ? ` · ends ${field.last4}` : ''}`)}</small>` : ''}</div>`;
}

function cardMarkup(item, { admin, readOnly }) {
  const anySaved = item.fields.some(field => field.configured);
  const [tzh, ten] = PROVIDER_TIPS[item.provider] || ['', ''];
  const result = testText(item.last_test);
  return `<section class="card v4-key-card" data-key-provider="${esc(item.provider)}" aria-labelledby="key-title-${esc(item.provider)}">
    <div class="ph"><div><h3 id="key-title-${esc(item.provider)}">${bi(item.label.zh, item.label.en)}</h3><p>${bi(tzh, ten)}</p></div><div class="v4-key-pills">${sourcePill(item, admin)}${admin ? usagePill(item) : ''}</div></div>
    <form class="pb" novalidate data-key-form="${esc(item.provider)}"><div class="form-grid">${item.fields.map(field => fieldMarkup(item, field, readOnly)).join('')}</div>
      <p class="meta v4-key-test" data-key-test-result>${item.last_test ? `<i class="ti ti-${item.last_test.ok ? 'circle-check' : 'circle-x'}" aria-hidden="true"></i>` : ''}${bi(...result)}</p>
      <p class="v4-form-status" role="status" aria-live="polite"></p>
      <div class="btns"><button class="btn btn-primary" type="submit" data-key-save${readOnly ? ' disabled' : ''}${tip('加密保存；保存后不再显示，只显示末四位', 'Saved encrypted; afterwards only the last four characters are shown')}><i class="ti ti-device-floppy" aria-hidden="true"></i>${bi('保存', 'Save')}</button>
      <button class="btn btn-outline-primary" type="button" data-key-test${readOnly ? ' disabled' : ''}${tip(['exa', 'brave'].includes(item.provider) ? '用一次最小的查询检查密钥是否可用（计 1 次查询）' : '检查密钥是否可用，不产生费用', ['exa', 'brave'].includes(item.provider) ? 'Checks the key with one minimal search (counts as one search)' : 'Checks the key without any charge')}><i class="ti ti-plug-connected" aria-hidden="true"></i>${bi('测试', 'Test')}</button>
      ${anySaved ? `<button class="btn btn-danger" type="button" data-key-revoke${readOnly ? ' disabled' : ''}${tip(admin ? '停用这里保存的密钥（保留记录）；之后改用服务器设置' : '停用您的密钥（保留记录）；之后由 SIM 提供并计入您的额度', admin ? 'Stop using the key saved here (history kept); server settings apply again' : 'Stop using your key (history kept); SIM provides the service again')}><i class="ti ti-key-off" aria-hidden="true"></i>${bi('停用', 'Remove')}</button>` : ''}</div>
    </form></section>`;
}

const state = { data: null, error: false, admin: false };

export function pageMarkup(data, { admin, readOnly }) {
  const intro = admin
    ? bi('系统使用的各项服务密钥。保存后加密存放，页面只显示末四位；商家填了自己的密钥时，商家的工作改用商家的密钥。', 'Keys for the services SIM uses. They are stored encrypted and only the last four characters are shown; when a merchant adds its own key, that merchant\'s work uses it.')
    : bi('可以填写您自己的服务账户密钥：填了就用您自己的账户和费用，不再占用 SIM 的资源，但仍计入您账号的每月额度；不填则由 SIM 提供。', 'You may add keys for your own service accounts: your work then uses your account and billing instead of SIM\'s, still within your monthly allowance. Without a key SIM provides the service.');
  const spend = admin && data.search_spend_mode ? `<p class="meta" data-key-spend>${bi(`搜索花费：${data.search_spend_mode === 'ALLOW_PAID' ? '允许付费兜底' : '只用免费搜索'}（在“系统设置”里切换）`, `Search spending: ${data.search_spend_mode === 'ALLOW_PAID' ? 'paid fallback allowed' : 'free search only'} (change it in Settings)`)}</p>` : '';
  const notReady = data.encryption_ready === false ? `<p class="v4-help" role="alert"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>${bi('服务器还没有设置加密密钥，暂时不能保存。', 'The server has no encryption key yet, so keys cannot be saved.')}</span></p>` : '';
  const simOnly = admin ? `<p class="meta" data-key-crm-note>${bi('飞书多维表只由 SIM 统一设置；商家账号里的“同步到飞书表”开关目前不起作用。', 'Feishu Base is set up by SIM only; the merchant “CRM sync” feature does not do anything yet.')}</p>`
    : `<p class="meta" data-key-sim-only>${bi('翻译服务和飞书多维表由 SIM 统一设置。', 'Translation and Feishu Base are set up by SIM.')}</p>`;
  const groups = GROUPS.map(([group, zh, en]) => {
    const items = data.items.filter(item => item.group === group);
    if (!items.length) return '';
    return `<h3 class="sub-title v4-key-group">${bi(zh, en)}</h3><div class="v4-key-grid">${items.map(item => cardMarkup(item, { admin, readOnly })).join('')}</div>`;
  }).join('');
  return `<section class="card v4-key-intro"><div class="pb"><p>${intro}</p>${spend}${simOnly}${notReady}</div></section>${groups}
    <datalist id="key-llm-providers">${LLM_PROVIDERS.map(name => `<option value="${name}"></option>`).join('')}</datalist>`;
}

function render() {
  const root = $('#api-keys-root');
  if (!root) return;
  if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '接口密钥暂未读取', 'API keys unavailable', { retry: true })}</section>`; return; }
  if (!state.data) { root.innerHTML = `<section class="card">${skeletonRows(4)}</section>`; return; }
  root.innerHTML = pageMarkup(state.data, { admin: state.admin, readOnly: !state.admin && isReadOnly(session.user) });
}

function errorWords(error) {
  const code = String(error?.code || '');
  if (code === 'MERCHANT_SECRET_KEY_MISSING') return ['服务器还没有设置加密密钥，暂时不能保存', 'The server has no encryption key yet'];
  if (code === 'CREDENTIAL_URL_NOT_ALLOWED') return ['请填写以 https:// 开头的公开地址', 'Use a public address starting with https://'];
  if (code === 'CREDENTIAL_URL_INVALID') return ['请填写完整地址，以 http:// 或 https:// 开头', 'Enter a full address starting with http:// or https://'];
  if (code === 'CREDENTIAL_VALUE_REQUIRED') return ['请至少填写一项', 'Enter at least one value'];
  if (code === 'CREDENTIAL_SIM_ONLY') return ['这项服务由 SIM 统一设置', 'This service is set up by SIM'];
  if (code === 'MERCHANT_READ_ONLY') return ['试用已结束，续期后可以修改', 'The trial has ended; renew to change this'];
  if (error?.status === 429) return ['操作太频繁，请稍后再试', 'Too many attempts; try again later'];
  if ([400, 422].includes(error?.status)) return ['填写的内容有误，请检查', 'Some values are invalid; please check'];
  return ['保存未完成，请重试', 'Could not save; please retry'];
}

async function onSubmit(form) {
  const provider = form.dataset.keyForm; const status = form.querySelector('.v4-form-status');
  const values = Object.fromEntries([...form.querySelectorAll('input[name]')].map(input => [input.name, input.value.trim()]).filter(([, value]) => value));
  if (!Object.keys(values).length) { status.innerHTML = bi('请至少填写一项', 'Enter at least one value'); return; }
  status.innerHTML = bi('正在保存', 'Saving');
  try {
    state.data = { ...state.data, ...await send(`${apiBase(state.admin)}/${encodeURIComponent(provider)}`, { values }, 'PUT') };
    render(); toast('已加密保存', 'Saved encrypted');
    $(`[data-key-form="${CSS.escape(provider)}"] [data-key-test]`)?.focus();
  } catch (error) { status.innerHTML = bi(...errorWords(error)); }
}

async function onClick(event) {
  if (event.target.closest('[data-state-retry]')) { void loadApiKeys(); return; }
  const button = event.target.closest('[data-key-test], [data-key-revoke]');
  if (!button) return;
  const form = button.closest('form'); const provider = form.dataset.keyForm; const status = form.querySelector('.v4-form-status');
  if (button.matches('[data-key-revoke]') && button.dataset.confirm !== 'yes') {
    button.dataset.confirm = 'yes'; button.innerHTML = `<i class="ti ti-key-off" aria-hidden="true"></i>${bi('确认停用', 'Confirm remove')}`; return;
  }
  button.disabled = true;
  try {
    if (button.matches('[data-key-test]')) {
      status.innerHTML = bi('正在测试', 'Testing');
      const result = await send(`${apiBase(state.admin)}/${encodeURIComponent(provider)}/test`, {});
      const item = state.data.items.find(entry => entry.provider === provider);
      if (item) item.last_test = { ok: result.ok, code: result.code, tested_at: new Date().toISOString(), source: result.source };
      render(); toast(...testText({ ok: result.ok, code: result.code, tested_at: new Date() }), { tone: result.ok ? 'ok' : 'warn' });
    } else {
      state.data = { ...state.data, ...await send(`${apiBase(state.admin)}/${encodeURIComponent(provider)}/revoke`, {}) };
      render(); toast('已停用', 'Removed');
    }
    $(`[data-key-form="${CSS.escape(provider)}"] [data-key-test]`)?.focus();
  } catch (error) {
    status.innerHTML = bi(...(button.matches('[data-key-test]') ? testText({ ok: false, code: error.code || (error.status === 429 ? 'RATE_LIMITED' : '') }) : errorWords(error)));
    button.disabled = false;
  }
}

export async function loadApiKeys() {
  state.error = false; state.admin = !session.user || session.user.role === 'ADMIN';
  render();
  try { state.data = await managementRequest(apiBase(state.admin)); }
  catch { state.error = true; state.data = null; }
  render();
}

if (typeof document !== 'undefined') {
  const root = $('#api-keys-root');
  if (root) {
    root.addEventListener('submit', event => { const form = event.target.closest('[data-key-form]'); if (form) { event.preventDefault(); void onSubmit(form); } });
    root.addEventListener('click', event => { void onClick(event); });
    document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'api-keys') void loadApiKeys(); });
    sessionReady.then(() => { if (!root.closest('[hidden]')) void loadApiKeys(); });
  }
}
