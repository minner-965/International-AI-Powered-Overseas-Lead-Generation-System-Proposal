// 手动添加企业 / Add companies manually (B1). SIM and merchants (own account) add a company and its
// business mailbox, write the first email from the approved template, approve and send it, then log
// calls / notes and move the stage. SIM may mark a test company and assign it to a merchant.
// API: /api/manual-companies (see src/companies/router.js). Every rule is checked on the server.
import { bi, esc, stateBlock, skeletonRows } from './crm.js';
import { tip } from './tooltips.js';
import { sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';
import { attachTranslateWidget } from './translate-widget.js';

const $ = (selector, root = document) => root.querySelector(selector);
const json = (url, body, method = 'POST') => managementRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const API = '/api/manual-companies';

export const COMPANY_TYPES = Object.freeze({ IMPORTER: ['进口商', 'Importer'], WHOLESALER: ['批发商', 'Wholesaler'], DISTRIBUTOR: ['分销商', 'Distributor'], RETAIL_CHAIN: ['连锁零售', 'Retail chain'], DEPARTMENT_STORE: ['百货公司', 'Department store'], RETAILER: ['零售商', 'Retailer'], ONLINE_RETAILER: ['网店', 'Online retailer'], BRAND: ['品牌商', 'Brand'], OTHER: ['其他', 'Other'] });
export const CONTACT_KINDS = Object.freeze({ GENERAL: ['公司公共邮箱', 'Company mailbox'], DEPARTMENT: ['部门邮箱', 'Department mailbox'], PERSON: ['个人邮箱', 'Named person'] });
export const STAGES = Object.freeze({ NEW: ['待联系', 'New'], CONTACTED: ['已联系', 'Contacted'], REPLIED: ['已回复', 'Replied'], QUOTED: ['已报价', 'Quoted'], SAMPLE: ['样品', 'Sample'], NEGOTIATING: ['洽谈中', 'Negotiating'], WON: ['成交', 'Won'], LOST: ['流失', 'Lost'] });
export const ACTIVITY_TYPES = Object.freeze({ CALL: ['电话', 'Call'], WHATSAPP: ['WhatsApp', 'WhatsApp'], MEETING: ['会议', 'Meeting'], NOTE: ['备注', 'Note'], EMAIL_MANUAL: ['手动邮件', 'Manual email'] });
export const TEMPLATES = Object.freeze({ '': ['自动选择', 'Choose automatically'], A_NAMED_BUYER: ['A · 写给具体负责人', 'A · Named buyer'], B_IMPORTER_WHOLESALER_DISTRIBUTOR: ['B · 进口/批发/分销商', 'B · Importer / wholesaler'], C_OFFICIAL_GENERIC_MAILBOX: ['C · 公司公共邮箱', 'C · Company mailbox'] });
const DRAFT_STATUS = Object.freeze({ PENDING_APPROVAL: ['待批准', 'Awaiting approval', 'warn'], SENDING: ['发送中', 'Sending', 'info'], SENT: ['已发送', 'Sent', 'ok'], BLOCKED: ['未发出', 'Not sent', 'bad'], FAILED: ['发送失败', 'Send failed', 'bad'], AMBIGUOUS: ['发送结果待确认', 'Result unconfirmed', 'warn'], DISCARDED: ['已放弃', 'Discarded', ''] });

// Server reason codes -> business wording (no technical terms).
export const REASONS = Object.freeze({
  TEST_RECIPIENT_NOT_ALLOWED: ['测试企业只能发到测试收件名单里的地址', 'A test company can only use an address on the test list'],
  RECIPIENT_DOMAIN_MISMATCH: ['请使用公司域名的邮箱，或填写公司公布这个邮箱的网页', 'Use a company-domain mailbox, or add the page that publishes it'],
  SUPPRESSED: ['对方已退订或被设为不再联系', 'The recipient opted out or is on the do-not-contact list'],
  HARD_BOUNCED: ['这个地址曾经退信', 'This address bounced before'],
  ALREADY_FIRST_CONTACTED: ['已经给这家公司发过开发信', 'This company already received a first email'],
  RECIPIENT_RECENTLY_CONTACTED: ['这个地址 30 天内已收到过开发信', 'This address received a first email in the last 30 days'],
  COMPANY_ASSIGNED_TO_MERCHANT: ['这家公司已分配给商家，由商家自己发', 'This company belongs to a merchant; the merchant sends'],
  COMPANY_NOT_ACTIVE: ['这家公司已停用', 'This company is inactive'],
  SENDER_CHANGED: ['发信邮箱已更换，请重新生成草稿', 'The sending mailbox changed; create a new draft'],
  SENDER_NOT_CONFIGURED: ['发信邮箱还没有设置', 'The sending mailbox is not set up'],
  MERCHANT_MAILBOX_HELD: ['发信邮箱已暂停，请重新测试连接', 'Sending is paused; test the mailbox connection again'],
  MERCHANT_MAILBOX_NOT_VERIFIED: ['请先绑定并测试发信邮箱', 'Bind and test the sending mailbox first'],
  MERCHANT_EMAIL_QUOTA_EXCEEDED: ['今日发信额度已用完', "Today's email quota is used up"],
  DAILY_LIMIT_REACHED: ['今日发信额度已用完', "Today's email quota is used up"],
  EMAIL_PAUSED: ['发信因邮箱问题暂停中', 'Sending is paused after a mailbox problem'],
  MERCHANT_FEATURE_DISABLED: ['这个账号未开通发信功能', 'Email sending is not enabled for this account'],
  MERCHANT_READ_ONLY: ['试用已结束，账号只读', 'The trial has ended; the account is read-only'],
  CONTENT_CHANGED: ['公司资料已修改，请重新生成草稿', 'Company details changed; create a new draft'],
  SMTP_CONTROLLED_RECIPIENT_REQUIRED: ['当前发信邮箱只允许发给测试地址', 'This mailbox may only send to test addresses now'],
  COMPANY_ALREADY_LISTED: ['这家公司已在客户名录中', 'This company is already in the company directory'],
  CONTACT_ALREADY_LISTED: ['这个邮箱已经添加过', 'This mailbox is already listed'],
  WEBSITE_INVALID: ['请填写正确的公司网址或域名', 'Enter a valid company website or domain'],
  EMAIL_INVALID: ['请填写正确的邮箱地址', 'Enter a valid email address'],
  CATEGORY_OUTSIDE_MERCHANT_SCOPE: ['请选择你业务范围内的类目', 'Choose one of your business categories'],
  DRAFT_ALREADY_OPEN: ['已有一封待批准的开发信', 'A first email is already waiting for approval'],
  TEMPLATE_NEEDS_NAMED_CONTACT: ['模板 A 需要具体联系人姓名', 'Template A needs a named person'],
  LOST_REASON_REQUIRED: ['标记流失时请填写原因', 'Enter a reason when marking as lost'],
  STAGE_UNCHANGED: ['已经是这个阶段', 'Already at this stage'],
  MERCHANT_SELF_SERVICE_ONLY: ['只有商家本人可以从自己的邮箱发信', 'Only the merchant can send from its own mailbox']
});
export function reasonText(error) {
  const codes = error?.details?.reason_codes || (error?.code ? [error.code] : []);
  const known = codes.map(code => REASONS[code]).filter(Boolean);
  if (known.length) return [known.map(item => item[0]).join('；'), known.map(item => item[1]).join('; ')];
  if (error?.status === 403) return ['当前账号没有此操作权限', 'Your account cannot do this'];
  if ([400, 422].includes(error?.status)) return ['填写的信息有误，请检查', 'Some details are invalid'];
  return ['未能完成，请重试', 'Could not complete; please retry'];
}

const state = { items: null, error: false, q: '', options: null, dialog: null, opener: null };
const pick = (map, key) => map[key] || [key || '—', key || '—'];
const pill = ([zh, en, tone = '']) => `<span class="pill ${tone}">${bi(zh, en)}</span>`;
const dateText = value => value ? new Date(value).toLocaleDateString('zh-CN') : '—';

export function contactLabel(contact) {
  const who = contact.person_name || contact.department_name || '';
  return `${esc(contact.email)}${who ? ` <span class="meta">· ${esc(who)}</span>` : ''}`;
}
/** Shown under the first email column: last draft or "not sent yet". */
export function draftCell(item) {
  const draft = item.latest_draft;
  if (!draft) return `<span class="meta">${bi('还未写开发信', 'No first email yet')}</span>`;
  const [zh, en, tone] = DRAFT_STATUS[draft.draft_status] || [draft.draft_status, draft.draft_status, ''];
  return `${pill([zh, en, tone])}<span class="meta">${esc(draft.normalized_recipient)} · ${esc(dateText(draft.decided_at || draft.created_at))}</span>`;
}
export function rowMarkup(item, { admin = false } = {}) {
  const id = esc(item.id);
  const stage = pick(STAGES, item.stage);
  const pending = item.latest_draft?.draft_status === 'PENDING_APPROVAL';
  const btn = (action, zh, en, tipZh, tipEn, cls = '') => `<button class="btn btn-sm${cls}" type="button" data-manual-action="${action}" data-company-id="${id}"${tip(tipZh, tipEn)}>${bi(zh, en)}</button>`;
  return `<tr data-manual-company="${id}">
    <td class="m-main"><span class="co">${esc(item.company_name)}</span><span class="meta">${esc(item.normalized_domain)}${item.is_test ? ` ${pill(['测试企业', 'Test company', 'warn'])}` : ''}</span></td>
    <td class="m-sub">${bi(item.market?.name_zh || item.market?.name_en || item.market_code, item.market?.name_en || item.market_code)}<span class="meta">${bi(item.category?.name_zh || item.category?.name_en || '', item.category?.name_en || '')} · ${bi(...pick(COMPANY_TYPES, item.company_type))}</span></td>
    <td class="v4-manual-contacts">${(item.contacts || []).length ? item.contacts.map(contact => `<span>${contactLabel(contact)}</span>`).join('') : `<span class="meta">${bi('还没有邮箱', 'No mailbox yet')}</span>`}</td>
    <td class="m-side">${pill([stage[0], stage[1], item.stage === 'LOST' ? 'bad' : item.stage === 'WON' ? 'ok' : 'info'])}<div class="v4-manual-draft">${draftCell(item)}</div></td>
    <td class="m-actions"><div class="v4-row-actions">
      ${pending ? btn('review', '查看并批准', 'Review & approve', '查看开发信内容，批准后立即发出', 'Read the first email; approving sends it now', ' btn-primary') : btn('draft', '写开发信', 'Write first email', '用批准过的开发信模板生成草稿，先预览再批准', 'Create a draft from the approved template; preview before approving', ' btn-outline-primary')}
      ${btn('contact', '添加邮箱', 'Add mailbox', '添加公司的业务邮箱：公共邮箱、部门邮箱或个人邮箱', 'Add a business mailbox of the company')}
      ${btn('activity', '记录跟进', 'Log follow-up', '记录电话、WhatsApp、会议或备注，会同步到跟进记录', 'Log a call, WhatsApp, meeting or note')}
      ${btn('stage', '更改阶段', 'Change stage', '更新这家公司的跟进阶段', 'Update the pipeline stage')}
      ${admin ? btn('test', item.is_test ? '取消测试企业' : '设为测试企业', item.is_test ? 'Unmark test' : 'Mark as test', '测试企业只能发到测试收件名单里的地址', 'A test company only sends to addresses on the test list') : ''}
      ${admin ? btn('assign', '分配给商家', 'Assign to merchant', '把这家公司交给一个商家跟进', 'Hand this company to a merchant') : ''}
    </div></td></tr>`;
}

function listMarkup() {
  if (state.error) return stateBlock('error', '企业列表暂未读取', 'Companies unavailable', { retry: true });
  if (!state.items) return skeletonRows(4);
  const needle = state.q.trim().toLowerCase();
  const items = state.items.filter(item => !needle || `${item.company_name} ${item.normalized_domain}`.toLowerCase().includes(needle));
  if (!state.items.length) return stateBlock('empty', '还没有手动添加的企业，点“添加企业”录入展会或介绍来的客户', 'No companies yet; use “Add company” for fair or referral leads');
  if (!items.length) return stateBlock('empty', '没有符合条件的企业', 'No matching company');
  const admin = Boolean(state.options?.is_admin);
  return `<div class="table-wrap"><table class="v4-manual-table"><caption class="sr-only">手动添加的企业 Companies added manually</caption><thead><tr><th scope="col">${bi('企业', 'Company')}</th><th scope="col">${bi('市场 / 类目', 'Market / category')}</th><th scope="col">${bi('业务邮箱', 'Business mailboxes')}</th><th scope="col">${bi('阶段 / 开发信', 'Stage / first email')}</th><th scope="col">${bi('操作', 'Actions')}</th></tr></thead><tbody>${items.map(item => rowMarkup(item, { admin })).join('')}</tbody></table></div>`;
}
function render() { const list = $('#manual-companies-list'); if (list) list.innerHTML = listMarkup(); }

export async function loadManualCompanies() {
  state.error = false;
  try {
    const [options, list] = await Promise.all([state.options ? Promise.resolve(state.options) : managementRequest(`${API}/options`), managementRequest(API)]);
    state.options = options; state.items = list?.items || [];
  } catch { state.error = true; state.items = null; }
  render();
}

// ---------- dialogs ----------
function dialog() {
  let box = document.getElementById('manual-company-dialog');
  if (box) return box;
  box = document.createElement('dialog'); box.id = 'manual-company-dialog'; box.className = 'sheet v4-manual-sheet'; box.setAttribute('aria-labelledby', 'manual-company-dialog-title');
  document.body.append(box);
  box.addEventListener('click', event => { if (event.target === box || event.target.closest('[data-manual-close]')) box.close(); });
  box.addEventListener('close', () => state.opener?.focus?.({ preventScroll: true }));
  return box;
}
const field = (id, zh, en, input, cls = '') => `<div class="field${cls ? ` ${cls}` : ''}"><label for="${id}">${bi(zh, en)}</label>${input}</div>`;
const options = (map, selected = '') => Object.entries(map).map(([key, [zh, en]]) => `<option value="${esc(key)}"${key === selected ? ' selected' : ''}>${esc(zh)} / ${esc(en)}</option>`).join('');
const sheet = (title, body, submit, submitTip, cancel = ['取消', 'Cancel']) => `<form method="dialog" class="v4-manual-form" novalidate><div class="sheet-head"><h3 id="manual-company-dialog-title">${title}</h3><button class="btn btn-icon" type="button" data-manual-close aria-label="关闭 Close"${tip('关闭，不保存', 'Close without saving')}><i class="ti ti-x" aria-hidden="true"></i></button></div><div class="sheet-body">${body}<p class="v4-form-status" role="status" aria-live="polite"></p></div><div class="sheet-foot"><button class="btn" type="button" data-manual-close${tip('关闭窗口', 'Close this window')}>${bi(...cancel)}</button>${submit ? `<button class="btn btn-primary" type="submit"${tip(...submitTip)}>${submit}</button>` : ''}</div></form>`;
export const contactFields = (prefix = 'contact') => `<div class="form-grid">${field(`${prefix}-email`, '业务邮箱', 'Business email', `<input id="${prefix}-email" name="email" type="email" maxlength="254" autocomplete="off" placeholder="info@company.com">`)}${field(`${prefix}-kind`, '邮箱类型', 'Mailbox type', `<select id="${prefix}-kind" name="contact_kind">${options(CONTACT_KINDS, 'GENERAL')}</select>`)}${field(`${prefix}-person`, '联系人姓名（个人邮箱必填）', 'Person name (named person)', `<input id="${prefix}-person" name="person_name" maxlength="160">`)}${field(`${prefix}-dept`, '部门（可选）', 'Department (optional)', `<input id="${prefix}-dept" name="department_name" maxlength="160" placeholder="Purchasing">`)}${field(`${prefix}-source`, '邮箱出处网页（非公司域名时必填）', 'Page publishing it (if not the company domain)', `<input id="${prefix}-source" name="source_url" type="url" maxlength="500" placeholder="https://">`, 'wide')}</div>
  <p class="meta">${bi('公司公共邮箱（info@、sales@ 等）、部门邮箱或个人邮箱都可以，不要求必须是决策人。', 'A company mailbox (info@, sales@), department or named person is fine; a decision maker is not required.')}</p>`;
const contactFrom = form => ({ email: form.email.value.trim(), contact_kind: form.contact_kind.value, person_name: form.person_name.value.trim() || undefined, department_name: form.department_name.value.trim() || undefined, source_url: form.source_url.value.trim() || undefined });

function open(kind, item = null) {
  const box = dialog(); state.dialog = { kind, item }; state.opener = document.activeElement;
  const opts = state.options || {};
  if (kind === 'create') {
    const markets = (opts.markets || []).map(m => `<option value="${esc(m.code)}">${esc(m.name_zh || m.name_en)} / ${esc(m.name_en)}</option>`).join('');
    const categories = (opts.categories || []).map(c => `<option value="${esc(c.id)}">${esc(c.name_zh || c.name_en)} / ${esc(c.name_en)}</option>`).join('');
    const merchants = (opts.merchants || []).map(m => `<option value="${esc(m.id)}">${esc(m.company_name)}</option>`).join('');
    box.innerHTML = sheet(bi('添加企业', 'Add company'), `<div class="form-grid">${field('manual-name', '公司名称', 'Company name', '<input id="manual-name" name="company_name" maxlength="200" required>', 'wide')}${field('manual-site', '公司网址或域名', 'Website or domain', '<input id="manual-site" name="website" maxlength="300" placeholder="www.company.com" required>')}${field('manual-type', '公司类型', 'Company type', `<select id="manual-type" name="company_type">${options(COMPANY_TYPES, 'IMPORTER')}</select>`)}${field('manual-market', '国家 / 市场', 'Country / market', `<select id="manual-market" name="market_code" required>${markets}</select>`)}${field('manual-category', '商品类目', 'Product category', `<select id="manual-category" name="category_scope_id" required>${categories}</select>`)}${field('manual-notes', '备注（可选）', 'Notes (optional)', '<textarea id="manual-notes" name="notes" maxlength="2000" placeholder="例如：迪拜展会认识 / e.g. met at the Dubai fair"></textarea>', 'wide')}</div>
      ${opts.is_admin ? `<div class="form-grid">${field('manual-merchant', '分配给商家（可选）', 'Assign to merchant (optional)', `<select id="manual-merchant" name="merchant_id"><option value="">不分配（SIM 自己跟进） / Keep with SIM</option>${merchants}</select>`)}<div class="field"><span class="lbl">${bi('测试企业', 'Test company')}</span><label class="v4-switch"${tip('测试企业只能发到测试收件名单里的地址', 'A test company only sends to addresses on the test list')}><input type="checkbox" role="switch" name="is_test" aria-label="测试企业 Test company"><span aria-hidden="true"></span></label></div></div>` : ''}
      <fieldset class="field"><legend class="lbl">${bi('业务邮箱（可稍后添加）', 'Business mailbox (can be added later)')}</legend>${contactFields('manual-contact')}</fieldset>`, bi('保存企业', 'Save company'), ['保存企业和邮箱', 'Save the company and mailbox']);
  } else if (kind === 'contact') {
    box.innerHTML = sheet(bi(`添加邮箱 · ${item.company_name}`, 'Add mailbox'), contactFields('manual-add'), bi('保存邮箱', 'Save mailbox'), ['保存这个业务邮箱', 'Save this business mailbox']);
  } else if (kind === 'draft') {
    const contacts = (item.contacts || []).map(c => `<option value="${esc(c.id)}">${esc(c.email)}${c.person_name ? ` (${esc(c.person_name)})` : ''}</option>`).join('');
    box.innerHTML = contacts ? sheet(bi(`写开发信 · ${item.company_name}`, 'Write first email'), `<div class="form-grid">${field('manual-draft-to', '发给', 'Send to', `<select id="manual-draft-to" name="contact_id">${contacts}</select>`)}${field('manual-draft-template', '开发信模板', 'Template', `<select id="manual-draft-template" name="template_key">${options(TEMPLATES)}</select>`)}</div><p class="meta">${bi('先生成草稿预览，确认无误后再批准发送。', 'A draft is created for preview; nothing is sent until you approve it.')}</p>`, bi('生成草稿', 'Create draft'), ['生成草稿，暂不发送', 'Create the draft; nothing is sent yet'])
      : sheet(bi(`写开发信 · ${item.company_name}`, 'Write first email'), `<p>${bi('请先添加这家公司的业务邮箱。', 'Add a business mailbox for this company first.')}</p>`, '', null, ['关闭', 'Close']);
  } else if (kind === 'review') {
    const draft = item.latest_draft;
    box.innerHTML = sheet(bi(`批准开发信 · ${item.company_name}`, 'Approve first email'), previewMarkup({ to: draft.normalized_recipient, subject: draft.subject, body: draft.body_text }) + `<p class="meta">${bi('批准后立即从发信邮箱发出；不受市场发信时段限制。', 'Approving sends it now from the sending mailbox, outside the market send window too.')}</p><div class="v4-translate-host" data-manual-translate></div><button class="btn btn-danger btn-sm" type="button" data-manual-discard="${esc(draft.id)}"${tip('放弃这封草稿，不发送', 'Discard this draft without sending')}>${bi('放弃草稿', 'Discard draft')}</button>`, bi('批准并发送', 'Approve & send'), ['批准并立即发送这封开发信', 'Approve and send this first email now']);
  } else if (kind === 'activity') {
    box.innerHTML = sheet(bi(`记录跟进 · ${item.company_name}`, 'Log follow-up'), `<div class="form-grid">${field('manual-act-type', '方式', 'Type', `<select id="manual-act-type" name="activity_type">${options(ACTIVITY_TYPES, 'CALL')}</select>`)}${field('manual-act-result', '结果（可选）', 'Result (optional)', '<input id="manual-act-result" name="result" maxlength="200">')}${field('manual-act-summary', '内容', 'Summary', '<textarea id="manual-act-summary" name="summary" maxlength="2000" required></textarea>', 'wide')}${field('manual-act-next', '下次跟进（可选）', 'Next follow-up (optional)', '<input id="manual-act-next" name="next_follow_up_at" type="date">')}</div>`, bi('保存', 'Save'), ['保存这条跟进记录', 'Save this follow-up']);
  } else if (kind === 'stage') {
    box.innerHTML = sheet(bi(`更改阶段 · ${item.company_name}`, 'Change stage'), `<div class="form-grid">${field('manual-stage', '阶段', 'Stage', `<select id="manual-stage" name="stage">${options(STAGES, item.stage)}</select>`)}${field('manual-stage-lost', '流失原因（选流失时必填）', 'Lost reason (if lost)', '<input id="manual-stage-lost" name="lost_reason" maxlength="500">')}${field('manual-stage-note', '备注（可选）', 'Note (optional)', '<input id="manual-stage-note" name="note" maxlength="1000">', 'wide')}</div>`, bi('保存', 'Save'), ['保存新的阶段', 'Save the new stage']);
  } else if (kind === 'test') {
    box.innerHTML = sheet(bi(`${item.is_test ? '取消测试企业' : '设为测试企业'} · ${item.company_name}`, item.is_test ? 'Unmark test company' : 'Mark as test company'), `<p>${bi(item.is_test ? '取消后，这家公司按正常客户处理：只能发到公司域名邮箱或有出处的邮箱。' : '测试企业的开发信只能发到测试收件名单里的地址。', item.is_test ? 'It becomes a normal company: only company-domain or sourced mailboxes.' : 'First emails for a test company go only to addresses on the test list.')}</p>`, bi('确认', 'Confirm'), ['保存测试企业设置', 'Save the test setting']);
  } else if (kind === 'assign') {
    const merchants = (opts.merchants || []).map(m => `<option value="${esc(m.id)}">${esc(m.company_name)}</option>`).join('');
    box.innerHTML = sheet(bi(`分配给商家 · ${item.company_name}`, 'Assign to merchant'), field('manual-assign', '商家', 'Merchant', `<select id="manual-assign" name="merchant_id">${merchants}</select>`), bi('分配', 'Assign'), ['把这家公司交给所选商家', 'Give this company to the merchant']);
  }
  if (kind === 'review') attachPreviewTranslation(box.querySelector('[data-manual-translate]'), item.latest_draft);
  if (!box.open) box.showModal();
  box.querySelector('input, select, textarea, button[type="submit"]')?.focus();
}
/** Read-only translation of a draft (subject or body) so the sender can check what the buyer reads. */
export function attachPreviewTranslation(host, draft) {
  if (!host || !draft) return null;
  const view = text => ({ get: () => text || '', set: () => {} });
  return attachTranslateWidget(host, { readOnly: true, targets: [{ label: ['正文', 'Body'], ...view(draft.body_text) }, { label: ['主题', 'Subject'], ...view(draft.subject) }] });
}
export const previewMarkup = ({ to, subject, body }) => `<dl class="facts v4-mail-preview"><div><dt>${bi('收件人', 'To')}</dt><dd>${esc(to)}</dd></div><div><dt>${bi('主题', 'Subject')}</dt><dd>${esc(subject)}</dd></div></dl><pre class="v4-mail-body" tabindex="0" aria-label="邮件正文 Email body">${esc(body)}</pre>`;

async function submit(form) {
  const { kind, item } = state.dialog || {};
  const status = form.querySelector('.v4-form-status');
  const button = form.querySelector('[type="submit"]');
  const show = pair => { status.innerHTML = bi(...pair); };
  button.disabled = true; show(['正在保存', 'Saving']);
  try {
    if (kind === 'create') {
      const contact = contactFrom(form);
      const body = { company_name: form.company_name.value.trim(), website: form.website.value.trim(), company_type: form.company_type.value, market_code: form.market_code.value, category_scope_id: form.category_scope_id.value, notes: form.notes.value.trim() || undefined, ...(form.merchant_id?.value ? { merchant_id: form.merchant_id.value } : {}), ...(form.is_test?.checked ? { is_test: true } : {}), ...(contact.email ? { contact } : {}) };
      if (!body.company_name || !body.website) { show(['请填写公司名称和网址', 'Enter the company name and website']); button.disabled = false; return; }
      await json(API, body); dialog().close(); toast('企业已添加', 'Company added');
    } else if (kind === 'contact') {
      await json(`${API}/${encodeURIComponent(item.id)}/contacts`, contactFrom(form)); dialog().close(); toast('邮箱已添加', 'Mailbox added');
    } else if (kind === 'draft') {
      const draft = await json(`${API}/${encodeURIComponent(item.id)}/first-touch-drafts`, { contact_id: form.contact_id.value, ...(form.template_key.value ? { template_key: form.template_key.value } : {}) });
      await loadManualCompanies(); const fresh = state.items?.find(row => row.id === item.id) || { ...item, latest_draft: draft };
      open('review', fresh); return;
    } else if (kind === 'review') {
      show(['正在发送', 'Sending']);
      const result = await json(`${API}/first-touch-drafts/${encodeURIComponent(item.latest_draft.id)}/decision`, { decision: 'APPROVE' });
      dialog().close();
      if (result?.status === 'SENT') toast('开发信已发出', 'First email sent'); else toast('邮件未确认发出，请查看状态', 'Not confirmed as sent; check the status', { tone: 'warn' });
    } else if (kind === 'activity') {
      const next = form.next_follow_up_at.value;
      await json(`${API}/${encodeURIComponent(item.id)}/activities`, { activity_type: form.activity_type.value, summary: form.summary.value.trim(), result: form.result.value.trim() || undefined, ...(next ? { next_follow_up_at: new Date(`${next}T09:00:00`).toISOString() } : {}) });
      dialog().close(); toast('跟进已记录', 'Follow-up logged');
    } else if (kind === 'stage') {
      await json(`${API}/${encodeURIComponent(item.id)}/stage`, { stage: form.stage.value, lost_reason: form.lost_reason.value.trim() || undefined, note: form.note.value.trim() || undefined });
      dialog().close(); toast('阶段已更新', 'Stage updated');
    } else if (kind === 'test') {
      await json(`${API}/${encodeURIComponent(item.id)}/test-flag`, { is_test: !item.is_test }, 'PUT'); dialog().close(); toast('已保存', 'Saved');
    } else if (kind === 'assign') {
      await json(`${API}/${encodeURIComponent(item.id)}/assign`, { merchant_id: form.merchant_id.value }); dialog().close(); toast('已分配给商家', 'Assigned to the merchant');
    }
    void loadManualCompanies();
  } catch (error) { show(reasonText(error)); button.disabled = false; }
}

function mount() {
  const root = $('#manual-companies-root');
  if (!root) return;
  root.innerHTML = `<section class="card v4-manual-card"><div class="toolbar"><label class="search inline" for="manual-companies-search"><i class="ti ti-search" aria-hidden="true"></i><span class="sr-only">搜索企业 Search companies</span><input id="manual-companies-search" type="search" autocomplete="off" placeholder="公司或域名 / Company or domain"></label><span class="grow"></span><button class="btn" type="button" data-first-touch-test-open${tip('用真实开发信模板给自己的邮箱发一封测试信', 'Send a test of the real first email to your own mailbox')}><i class="ti ti-mail-forward" aria-hidden="true"></i>${bi('发测试首封', 'Send test first email')}</button><button class="btn btn-primary" type="button" data-manual-create${tip('录入展会、老客户介绍等渠道认识的企业和业务邮箱', 'Add a company met at a fair or through a referral')}><i class="ti ti-plus" aria-hidden="true"></i>${bi('添加企业', 'Add company')}</button></div><div id="manual-companies-list" aria-live="polite"></div></section>`;
  render();
  root.addEventListener('click', event => {
    if (event.target.closest('[data-state-retry]')) { void loadManualCompanies(); return; }
    if (event.target.closest('[data-manual-create]')) { open('create'); return; }
    const action = event.target.closest('[data-manual-action]');
    if (!action) return;
    const item = state.items?.find(row => String(row.id) === action.dataset.companyId);
    if (item) open(action.dataset.manualAction, item);
  });
  root.addEventListener('input', event => { if (event.target.id === 'manual-companies-search') { state.q = event.target.value; render(); } });
  document.addEventListener('submit', event => { if (event.target.closest('#manual-company-dialog')) { event.preventDefault(); void submit(event.target); } });
  document.addEventListener('click', async event => {
    const discard = event.target.closest('[data-manual-discard]');
    if (!discard) return;
    try { await json(`${API}/first-touch-drafts/${encodeURIComponent(discard.dataset.manualDiscard)}/decision`, { decision: 'DISCARD' }); dialog().close(); toast('草稿已放弃', 'Draft discarded'); void loadManualCompanies(); }
    catch (error) { toast(...reasonText(error), { tone: 'bad' }); }
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'manual-companies') void loadManualCompanies(); });
  sessionReady.then(() => { if (!document.querySelector('#view-manual-companies')?.hidden) void loadManualCompanies(); });
}
if (typeof document !== 'undefined') mount();
