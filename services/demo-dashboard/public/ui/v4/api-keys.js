// 接口密钥 / API keys (B9). SIM administrator: system keys for search, email check, Feishu, translation
// and the low-cost model, with each service's on/off state, plus 辅助模型 Model assist (switches, mode,
// usage this month and the 待人工确认 review list; see src/llm/router.js). Merchant (我的接口密钥 My API keys): its own
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
// Model choices (Simon 2026-10-27): a cloud model is the default (Claude Haiku preselected); a local
// Ollama model is an optional choice for SIM's own machine only (never offered to merchants).
export const LLM_CHOICES = Object.freeze([
  { value: 'anthropic', zh: 'Claude Haiku（默认）', en: 'Claude Haiku (default)', model: 'claude-haiku-5-5', base: 'https://api.anthropic.com/v1' },
  { value: 'deepseek', zh: 'DeepSeek', en: 'DeepSeek', model: 'deepseek-chat', base: 'https://api.deepseek.com' },
  { value: 'qwen', zh: '通义千问 Qwen', en: 'Qwen', model: 'qwen-flash', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  { value: 'openai', zh: 'OpenAI 兼容接口', en: 'OpenAI-compatible', model: 'gpt-5-nano', base: 'https://api.openai.com/v1' },
  { value: 'ollama', zh: '本地 Ollama（可选）', en: 'Local Ollama (optional)', model: 'qwen2.5:7b', base: 'http://ollama:11434/v1', simOnly: true }
]);
export const ASSIST_TASKS = Object.freeze([
  ['T1_CATEGORY_EVIDENCE', '官网商品类目', 'Categories on websites', '从企业官网页面摘出它自己在卖的商品类目，带原文出处', 'Picks out the product categories a company sells on its own website, with the original sentence'],
  ['T2_BUYER_TYPE', '买家类型', 'Buyer type', '判断企业自己是进口商、批发商、连锁零售等，以及写明的门店数量', 'Reads whether the company is an importer, wholesaler, retail chain and so on, and any stated store count'],
  ['T3_ATTRIBUTION', '第三方内容识别', 'Third-party text check', '识别一段证据是企业自述，还是文章、名录、访客提问或导航文字', 'Tells whether a piece of evidence is the company speaking about itself or an article, listing or menu text'],
  ['T4_RULE_CHECKLIST', '规则对照清单', 'Rule checklist', '按评估规则逐条标出“满足 / 不满足 / 无证据”，只给人复核时参考', 'Marks each review rule as met, not met or no evidence, for people reviewing only'],
  ['T5_REPLY_INTENT', '回信意图', 'Reply intent', '识别客户回信要报价、样品、目录、会议，或要求不再联系', 'Reads whether a reply asks for a quote, samples, a catalogue, a meeting, or to stop contact']
]);
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

/** Provider choice for the model card; the saved choice comes from the model assist view. */
export function llmProviderMarkup(field, disabled, { admin, current } = {}) {
  const choices = LLM_CHOICES.filter(choice => admin || !choice.simOnly);
  const selected = choices.some(choice => choice.value === current) ? current : 'anthropic';
  return `<div class="field v4-llm-providers"><span class="lbl">${bi(field.label.zh, field.label.en)}</span>
    <div class="v4-presets" role="radiogroup" aria-label="模型服务商 Model provider">${choices.map(choice => `<label class="v4-preset${choice.value === selected ? ' is-on' : ''}"${tip(choice.simOnly ? '可选：模型装在自己的服务器上，数据不离开本机；需先启动本地模型服务' : `使用 ${choice.en} 的云端接口`, choice.simOnly ? 'Optional: the model runs on your own server and data stays there; start the local model service first' : `Use the ${choice.en} cloud service`)}><input type="radio" name="provider" value="${esc(choice.value)}" data-llm-model="${esc(choice.model)}" data-llm-base="${esc(choice.base)}"${choice.value === selected ? ' checked' : ''}${disabled ? ' disabled' : ''}><b>${bi(choice.zh, choice.en)}</b><small>${esc(choice.model)}</small></label>`).join('')}</div>
    ${field.configured ? `<small class="meta" data-key-saved="provider">${bi(`已设置${field.set_at ? ` · ${dateText(field.set_at)}` : ''}`, 'Set')}</small>` : ''}</div>`;
}

const llmChoice = value => LLM_CHOICES.find(choice => choice.value === value) || LLM_CHOICES[0];

function fieldMarkup(item, field, disabled, context = {}) {
  if (item.provider === 'llm' && field.field === 'provider') return llmProviderMarkup(field, disabled, context);
  const id = `key-${item.provider}-${field.field}`;
  const choice = item.provider === 'llm' ? llmChoice(context.current) : null;
  const hint = choice && field.field === 'model' ? `例 e.g. ${choice.model}` : choice && field.field === 'base_url' ? `可不填，默认 ${choice.base} · Optional` : choice && field.field === 'api_key' && choice.value === 'ollama' ? '本地模型不需要密钥 · Not needed for a local model' : '';
  const placeholder = field.configured ? '已设置，输入新值可替换 · Type to replace' : hint || (field.env_fallback ? '使用服务器设置，填写后改用此值 · Type to override' : field.optional ? '可选 Optional' : '');
  const list = '';
  return `<div class="field"><label for="${id}">${bi(field.label.zh, field.label.en)}</label><input id="${id}" name="${esc(field.field)}"${choice ? ` data-llm-field="${esc(field.field)}"` : ''} type="${field.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" maxlength="4096"${list} placeholder="${esc(placeholder)}"${disabled ? ' disabled' : ''}>
    ${field.configured ? `<small class="meta" data-key-saved="${esc(field.field)}">${bi(`已设置${field.last4 ? ` · 末四位 ${field.last4}` : ''}${field.set_at ? ` · ${dateText(field.set_at)}` : ''}`, `Set${field.last4 ? ` · ends ${field.last4}` : ''}`)}</small>` : ''}</div>`;
}

function cardMarkup(item, { admin, readOnly, llmCurrent = null }) {
  const anySaved = item.fields.some(field => field.configured);
  const [tzh, ten] = PROVIDER_TIPS[item.provider] || ['', ''];
  const result = testText(item.last_test);
  return `<section class="card v4-key-card" data-key-provider="${esc(item.provider)}" aria-labelledby="key-title-${esc(item.provider)}">
    <div class="ph"><div><h3 id="key-title-${esc(item.provider)}">${bi(item.label.zh, item.label.en)}</h3><p>${bi(tzh, ten)}</p></div><div class="v4-key-pills">${sourcePill(item, admin)}${admin ? usagePill(item) : ''}</div></div>
    <form class="pb" novalidate data-key-form="${esc(item.provider)}"><div class="form-grid">${item.fields.map(field => fieldMarkup(item, field, readOnly, { admin, current: llmCurrent })).join('')}</div>
      <p class="meta v4-key-test" data-key-test-result>${item.last_test ? `<i class="ti ti-${item.last_test.ok ? 'circle-check' : 'circle-x'}" aria-hidden="true"></i>` : ''}${bi(...result)}</p>
      <p class="v4-form-status" role="status" aria-live="polite"></p>
      <div class="btns"><button class="btn btn-primary" type="submit" data-key-save${readOnly ? ' disabled' : ''}${tip('加密保存；保存后不再显示，只显示末四位', 'Saved encrypted; afterwards only the last four characters are shown')}><i class="ti ti-device-floppy" aria-hidden="true"></i>${bi('保存', 'Save')}</button>
      <button class="btn btn-outline-primary" type="button" data-key-test${readOnly ? ' disabled' : ''}${tip(['exa', 'brave'].includes(item.provider) ? '用一次最小的查询检查密钥是否可用（计 1 次查询）' : '检查密钥是否可用，不产生费用', ['exa', 'brave'].includes(item.provider) ? 'Checks the key with one minimal search (counts as one search)' : 'Checks the key without any charge')}><i class="ti ti-plug-connected" aria-hidden="true"></i>${bi('测试', 'Test')}</button>
      ${anySaved ? `<button class="btn btn-danger" type="button" data-key-revoke${readOnly ? ' disabled' : ''}${tip(admin ? '停用这里保存的密钥（保留记录）；之后改用服务器设置' : '停用您的密钥（保留记录）；之后由 SIM 提供并计入您的额度', admin ? 'Stop using the key saved here (history kept); server settings apply again' : 'Stop using your key (history kept); SIM provides the service again')}><i class="ti ti-key-off" aria-hidden="true"></i>${bi('停用', 'Remove')}</button>` : ''}</div>
    </form></section>`;
}

const money = cost => Object.entries(cost || {}).map(([currency, amount]) => `${currency === 'CNY' ? '¥' : '$'}${Number(amount).toFixed(4)}`).join(' · ') || '$0';
const modelReadyText = (model, admin) => {
  if (model?.ready) return [`使用 ${llmChoice(model.provider).zh} · ${model.model}${model.local ? ' · 数据留在本机' : ''}`, `Uses ${llmChoice(model.provider).en} · ${model.model}${model.local ? ' · data stays on this server' : ''}`];
  if (model?.code === 'LLM_MERCHANT_KEY_REQUIRED') return ['请先在上方填写您自己的模型密钥，或联系 SIM 开通', 'Add your own model key above first, or ask SIM to enable its model for you'];
  return admin ? ['还没有可用的模型：请先在上方选择服务商并保存密钥', 'No model ready yet: choose a provider above and save its key'] : ['还没有可用的模型：请先在上方填写您自己的模型密钥', 'No model ready yet: add your own model key above'];
};

/** 辅助模型 Model assist: master switch, mode, per-task switches, usage and the review list. */
export function assistMarkup(assist, { admin, readOnly, review = null, merchants = null } = {}) {
  const settings = assist.settings || { enabled: false, mode: 'SHADOW', tasks: {} };
  const usage = assist.usage || {};
  const blocked = !admin && !assist.own_key && !assist.sim_key_allowed;
  const disabled = readOnly || blocked ? ' disabled' : '';
  const [mzh, men] = modelReadyText(assist.model, admin);
  const modes = [['SHADOW', '只记录', 'Shadow', '模型的结果只记录下来供对比，不影响任何判断（建议先用两周）', 'Results are only recorded for comparison and change nothing (try this for two weeks first)'],
    ['ASSIST', '辅助判定', 'Assist', '把握较高（80% 以上）的结果可补充证据，或把企业改为“待复核”；不会让企业通过核验，也不会放行发信', 'Confident results (80% or more) can add evidence or move a company to review; they never pass a check or allow sending']];
  const taskRows = ASSIST_TASKS.map(([code, zh, en, tzh, ten]) => `<li><span class="k">${bi(zh, en)}<small class="v3-automation-note">${bi(tzh, ten)}</small></span><span class="v"><label class="v4-switch"${tip(tzh, ten)}><input type="checkbox" role="switch" data-assist-task="${code}"${settings.tasks?.[code] ? ' checked' : ''}${disabled} aria-label="${esc(`${zh} ${en}`)}"><span aria-hidden="true"></span></label></span></li>`).join('');
  const budget = admin ? `<div class="field"><label for="assist-budget">${bi('每月费用上限（美元）', 'Monthly spending cap (USD)')}</label><input id="assist-budget" type="number" min="0" max="100000" step="1" inputmode="decimal" data-assist-budget value="${esc(settings.monthly_budget_usd ?? '')}"${readOnly ? ' disabled' : ''}${tip('本月使用 SIM 密钥的花费达到上限后自动停止调用；本地模型不计费', 'Calls on SIM\'s key stop for the month once this is reached; a local model costs nothing')}></div>` : '';
  const used = `<p class="meta" data-assist-usage>${bi(`本月：${usage.calls || 0} 次 · 输入 ${usage.input_tokens || 0} / 输出 ${usage.output_tokens || 0} tokens · 费用约 ${money(usage.cost)}${usage.unknown_cost_calls ? ` · ${usage.unknown_cost_calls} 次费用未知` : ''}`, `This month: ${usage.calls || 0} calls · ${usage.input_tokens || 0} in / ${usage.output_tokens || 0} out tokens · about ${money(usage.cost)}${usage.unknown_cost_calls ? ` · ${usage.unknown_cost_calls} with unknown cost` : ''}`)}</p>`;
  const blockedNote = blocked ? `<p class="v4-help" role="note"><i class="ti ti-info-circle" aria-hidden="true"></i><span>${bi('要开启辅助模型，请先在上方保存您自己的模型密钥（费用由您的账户承担），或联系 SIM 为您开通。', 'To switch model assist on, save your own model key above first (billed to your account), or ask SIM to enable it for you.')}</span></p>` : '';
  const allowances = admin && Array.isArray(merchants) && merchants.length ? `<details class="v4-servers" data-assist-merchants><summary>${bi('允许商家使用 SIM 的模型', 'Let merchants use SIM\'s model')}</summary><ul class="review-list v3-automation-switches">${merchants.map(merchant => {
    const allowed = (assist.merchant_allowances || []).some(row => row.merchant_id === merchant.id && row.sim_key_allowed);
    return `<li><span class="k">${esc(merchant.company_name || merchant.login_email || merchant.id)}<small class="v3-automation-note">${bi('开启后该商家没有自己的密钥时也能用 SIM 的模型，费用计入 SIM', 'When on, this merchant may use SIM\'s model without its own key; SIM pays')}</small></span><span class="v"><label class="v4-switch"><input type="checkbox" role="switch" data-assist-allow="${esc(merchant.id)}"${allowed ? ' checked' : ''}${readOnly ? ' disabled' : ''} aria-label="${esc(merchant.company_name || merchant.id)} 使用 SIM 的模型 Use SIM's model"><span aria-hidden="true"></span></label></span></li>`;
  }).join('')}</ul></details>` : '';
  return `<section class="card v4-key-card v4-assist" data-assist aria-labelledby="assist-title">
    <div class="ph"><div><h3 id="assist-title">${bi('辅助模型', 'Model assist')}</h3><p>${bi('开启后，模型只帮忙从企业官网和客户回信里摘出带原文出处的信息；企业是否合适、能否发信，仍由系统规则决定。默认关闭。', 'When on, the model only picks out facts with their original sentence from company websites and replies; rules still decide fit and sending. Off by default.')}</p></div>
      <div class="v4-key-pills"><span class="pill ${settings.enabled ? 'ok' : ''}" data-assist-state>${bi(...(settings.enabled ? ['已开启', 'On'] : ['已关闭', 'Off']))}</span></div></div>
    <form class="pb" novalidate data-assist-form>
      <p class="meta" data-assist-model>${bi(mzh, men)}</p>${blockedNote}
      <ul class="review-list v3-automation-switches"><li><span class="k">${bi('辅助模型', 'Model assist')}<small class="v3-automation-note">${bi(admin ? '总开关：管 SIM 自己的客户搜索和回信；商家各自开关自己的' : '只管您账号自己的客户搜索和回信', admin ? 'Master switch for SIM\'s own work; merchants switch their own' : 'Applies to your own account\'s work only')}</small></span><span class="v"><label class="v4-switch"${tip('关闭时不调用模型，也不产生费用', 'When off, no model is called and nothing is charged')}><input type="checkbox" role="switch" data-assist-enabled${settings.enabled ? ' checked' : ''}${disabled} aria-label="辅助模型 Model assist"><span aria-hidden="true"></span></label></span></li></ul>
      <div class="field"><span class="lbl">${bi('使用方式', 'Mode')}</span><div class="v4-presets" role="radiogroup" aria-label="使用方式 Mode">${modes.map(([value, zh, en, tzh, ten]) => `<label class="v4-preset${settings.mode === value ? ' is-on' : ''}"${tip(tzh, ten)}><input type="radio" name="assist-mode" value="${value}"${settings.mode === value ? ' checked' : ''}${disabled}><b>${bi(zh, en)}</b><small>${esc(tzh)}</small></label>`).join('')}</div></div>
      <span class="lbl">${bi('分项开关', 'Tasks')}</span><ul class="review-list v3-automation-switches">${taskRows}</ul>
      ${budget}${used}
      <p class="v4-form-status" role="status" aria-live="polite" data-assist-status></p>
      <div class="btns"><button class="btn btn-primary" type="submit" data-assist-save${disabled}${tip('保存开关和使用方式；每次修改都会留下记录', 'Saves the switches and mode; every change is kept on record')}><i class="ti ti-device-floppy" aria-hidden="true"></i>${bi('保存设置', 'Save settings')}</button></div>
      ${allowances}
    </form>${reviewMarkup(review, { readOnly })}</section>`;
}

const TASK_NAMES = Object.fromEntries(ASSIST_TASKS.map(([code, zh, en]) => [code, [zh, en]]));
function itemSummary(item = {}) {
  if (!item) return '';
  if (item.code) return `${item.code}${item.raw_category ? ` · ${item.raw_category}` : ''}`;
  if (item.rule) return `${item.rule} · ${item.result}`;
  return item.buyer_type || item.attribution || item.intent || item.fact || item.kind || '';
}
/** 待人工确认 Needs review: 0.50-0.79 items; confirm or reject (both are kept on record). */
export function reviewMarkup(review, { readOnly } = {}) {
  if (!Array.isArray(review)) return '';
  const rows = review.slice(0, 20).map(row => {
    const [zh, en] = TASK_NAMES[row.task] || [row.task, row.task];
    return `<li data-review-item="${esc(row.evidence_id)}"><span class="k">${bi(zh, en)}${row.company_name || row.subject_ref ? ` · ${esc(row.company_name || row.subject_ref)}` : ''}<small class="v3-automation-note">“${esc(row.quote || '')}” · ${esc(itemSummary(row.item))} · ${Math.round(Number(row.confidence || 0) * 100)}%</small></span>
      <span class="v btns"><button class="btn btn-sm btn-outline-primary" type="button" data-review-decision="CONFIRMED"${readOnly ? ' disabled' : ''}${tip('确认这条信息正确，可作为证据使用', 'Confirm this is correct; it can be used as evidence')}>${bi('确认', 'Confirm')}</button><button class="btn btn-sm" type="button" data-review-decision="REJECTED"${readOnly ? ' disabled' : ''}${tip('这条信息不对，不采用', 'This is wrong; do not use it')}>${bi('不采用', 'Reject')}</button></span></li>`;
  }).join('');
  return `<div class="pb v4-assist-review" data-assist-review><h4 class="sub-title">${bi(`待人工确认（${review.length}）`, `Needs review (${review.length})`)}</h4>
    ${rows ? `<ul class="review-list v3-automation-switches">${rows}</ul>` : `<p class="meta">${bi('没有需要确认的内容', 'Nothing to review')}</p>`}</div>`;
}

const state = { data: null, error: false, admin: false, assist: null, review: null, merchants: null };


export function pageMarkup(data, { admin, readOnly, assist = null, review = null, merchants = null }) {
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
    const llmCurrent = assist?.model?.provider || null;
    const extra = group === 'llm' && assist ? assistMarkup(assist, { admin, readOnly, review, merchants }) : '';
    return `<h3 class="sub-title v4-key-group">${bi(zh, en)}</h3><div class="v4-key-grid">${items.map(item => cardMarkup(item, { admin, readOnly, llmCurrent })).join('')}${extra}</div>`;
  }).join('');
  return `<section class="card v4-key-intro"><div class="pb"><p>${intro}</p>${spend}${simOnly}${notReady}</div></section>${groups}`;
}

function render() {
  const root = $('#api-keys-root');
  if (!root) return;
  if (state.error) { root.innerHTML = `<section class="card">${stateBlock('error', '接口密钥暂未读取', 'API keys unavailable', { retry: true })}</section>`; return; }
  if (!state.data) { root.innerHTML = `<section class="card">${skeletonRows(4)}</section>`; return; }
  root.innerHTML = pageMarkup(state.data, { admin: state.admin, readOnly: !state.admin && isReadOnly(session.user), assist: state.assist, review: state.review, merchants: state.merchants });
}

function errorWords(error) {
  const code = String(error?.code || '');
  if (code === 'MERCHANT_SECRET_KEY_MISSING') return ['服务器还没有设置加密密钥，暂时不能保存', 'The server has no encryption key yet'];
  if (code === 'CREDENTIAL_URL_NOT_ALLOWED') return ['请填写以 https:// 开头的公开地址', 'Use a public address starting with https://'];
  if (code === 'CREDENTIAL_URL_INVALID') return ['请填写完整地址，以 http:// 或 https:// 开头', 'Enter a full address starting with http:// or https://'];
  if (code === 'CREDENTIAL_VALUE_REQUIRED') return ['请至少填写一项', 'Enter at least one value'];
  if (code === 'CREDENTIAL_SIM_ONLY') return ['这项服务由 SIM 统一设置', 'This service is set up by SIM'];
  if (code === 'CREDENTIAL_LOCAL_MODEL_SIM_ONLY') return ['本地模型只能由 SIM 设置，请选择云端服务商', 'A local model is set up by SIM only; choose a cloud provider'];
  if (code === 'LLM_MERCHANT_KEY_REQUIRED') return ['请先保存您自己的模型密钥，或联系 SIM 开通', 'Save your own model key first, or ask SIM to enable it'];
  if (code === 'LLM_SETTINGS_INVALID') return ['设置内容有误，请检查', 'Some settings are invalid; please check'];
  if (code === 'LLM_EVIDENCE_ALREADY_DECIDED' || code === 'LLM_EVIDENCE_NOT_IN_REVIEW') return ['这一条已经处理过了', 'This item was already handled'];
  if (code === 'MERCHANT_READ_ONLY') return ['试用已结束，续期后可以修改', 'The trial has ended; renew to change this'];
  if (error?.status === 429) return ['操作太频繁，请稍后再试', 'Too many attempts; try again later'];
  if ([400, 422].includes(error?.status)) return ['填写的内容有误，请检查', 'Some values are invalid; please check'];
  return ['保存未完成，请重试', 'Could not save; please retry'];
}

async function onSubmit(form) {
  const provider = form.dataset.keyForm; const status = form.querySelector('.v4-form-status');
  const values = Object.fromEntries([...form.querySelectorAll('input[name]')].filter(input => input.type !== 'radio' || input.checked).map(input => [input.name, input.value.trim()]).filter(([, value]) => value));
  if (!Object.keys(values).length) { status.innerHTML = bi('请至少填写一项', 'Enter at least one value'); return; }
  status.innerHTML = bi('正在保存', 'Saving');
  try {
    state.data = { ...state.data, ...await send(`${apiBase(state.admin)}/${encodeURIComponent(provider)}`, { values }, 'PUT') };
    if (provider === 'llm') await loadAssist();
    render(); toast('已加密保存', 'Saved encrypted');
    $(`[data-key-form="${CSS.escape(provider)}"] [data-key-test]`)?.focus();
  } catch (error) { status.innerHTML = bi(...errorWords(error)); }
}

const assistBase = () => state.admin ? '/api/admin/model-assist' : '/api/merchant/model-assist';

/** Collect the model assist form: {enabled, mode, tasks, monthly_budget_usd?}. Exported for tests. */
export function assistPayload(form) {
  const tasks = Object.fromEntries([...form.querySelectorAll('[data-assist-task]')].map(input => [input.dataset.assistTask, input.checked]));
  const payload = { enabled: Boolean(form.querySelector('[data-assist-enabled]')?.checked), mode: form.querySelector('input[name="assist-mode"]:checked')?.value || 'SHADOW', tasks };
  const budget = form.querySelector('[data-assist-budget]');
  if (budget && budget.value.trim() !== '') payload.monthly_budget_usd = Number(budget.value);
  return payload;
}

async function onAssistSubmit(form) {
  const status = form.querySelector('[data-assist-status]');
  status.innerHTML = bi('正在保存', 'Saving');
  try {
    state.assist = await send(assistBase(), assistPayload(form), 'PUT');
    render(); toast(...(state.assist.settings?.enabled ? ['辅助模型已开启', 'Model assist is on'] : ['设置已保存', 'Settings saved']));
    $('[data-assist-save]')?.focus();
  } catch (error) { status.innerHTML = bi(...errorWords(error)); }
}

async function onAssistClick(event) {
  const decision = event.target.closest('[data-review-decision]');
  if (!decision) return false;
  const row = decision.closest('[data-review-item]'); decision.disabled = true;
  try {
    await send(`${assistBase()}/review/${encodeURIComponent(row.dataset.reviewItem)}`, { decision: decision.dataset.reviewDecision });
    state.review = (state.review || []).filter(item => item.evidence_id !== row.dataset.reviewItem);
    render(); toast(...(decision.dataset.reviewDecision === 'CONFIRMED' ? ['已确认', 'Confirmed'] : ['已标记为不采用', 'Marked as rejected']));
  } catch (error) { decision.disabled = false; toast(...errorWords(error), { tone: 'warn' }); }
  return true;
}

async function onAssistChange(event) {
  const input = event.target;
  if (input.matches('[data-assist-allow]')) {
    input.disabled = true;
    try {
      await send(`/api/admin/model-assist/merchants/${encodeURIComponent(input.dataset.assistAllow)}`, { sim_key_allowed: input.checked }, 'PUT');
      await loadAssist(); render(); toast('已保存', 'Saved');
    } catch (error) { input.checked = !input.checked; input.disabled = false; toast(...errorWords(error), { tone: 'warn' }); }
    return;
  }
  if (!input.matches('input[type="radio"]')) return;
  input.closest('.v4-presets')?.querySelectorAll('.v4-preset').forEach(label => label.classList.toggle('is-on', label.contains(input)));
  if (input.name !== 'provider' || !input.dataset.llmModel) return;
  const form = input.closest('form');
  const unsaved = name => { const el = form.querySelector(`[data-llm-field="${name}"]`); return el && !el.closest('.field').querySelector('[data-key-saved]') ? el : null; };
  const model = unsaved('model'); const base = unsaved('base_url'); const key = unsaved('api_key');
  if (model) model.placeholder = `例 e.g. ${input.dataset.llmModel}`;
  if (base) base.placeholder = `可不填，默认 ${input.dataset.llmBase} · Optional`;
  if (key) key.placeholder = input.value === 'ollama' ? '本地模型不需要密钥 · Not needed for a local model' : '';
}

async function loadAssist() {
  try { state.assist = await managementRequest(assistBase()); } catch { state.assist = null; }
  try { state.review = (await managementRequest(`${assistBase()}/review`))?.items || []; } catch { state.review = null; }
  if (state.admin) { try { state.merchants = (await managementRequest('/api/admin/merchants'))?.items || []; } catch { state.merchants = null; } }
}

async function onClick(event) {
  if (event.target.closest('[data-state-retry]')) { void loadApiKeys(); return; }
  if (await onAssistClick(event)) return;

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
  if (state.data) await loadAssist();
  render();
}

if (typeof document !== 'undefined') {
  const root = $('#api-keys-root');
  if (root) {
    root.addEventListener('submit', event => {
      const assistForm = event.target.closest('[data-assist-form]'); if (assistForm) { event.preventDefault(); void onAssistSubmit(assistForm); return; }
      const form = event.target.closest('[data-key-form]'); if (form) { event.preventDefault(); void onSubmit(form); }
    });
    root.addEventListener('change', event => { void onAssistChange(event); });
    root.addEventListener('click', event => { void onClick(event); });
    document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'api-keys') void loadApiKeys(); });
    sessionReady.then(() => { if (!root.closest('[hidden]')) void loadApiKeys(); });
  }
}
