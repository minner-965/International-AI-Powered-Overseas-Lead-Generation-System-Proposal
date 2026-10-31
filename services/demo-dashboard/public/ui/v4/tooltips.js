// Button explanations: every [data-tip="中文|English"] shows one floating bubble on mouse hover
// (short delay), on keyboard focus (immediately) and on touch long-press. The bubble is linked to
// its trigger with aria-describedby while shown and is kept inside the viewport.
// Phones also get a small "?" after icon-only buttons, because touch has no hover.
// Dependency-free (see docs/REUSE_CANDIDATE_REGISTRY.md: CSS tooltip pattern, Floating UI not needed).

const BUBBLE_ID = 'v4-tip';
const HOVER_DELAY = 350;
const PRESS_DELAY = 500;
const GAP = 8;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "中文|English" → { zh, en }. */
export function parseTip(text) {
  const [zh = '', en = ''] = String(text || '').split('|');
  return { zh: zh.trim(), en: en.trim() };
}

/** Attribute snippet for templates: ` data-tip="中文|English"`. */
export const tip = (zh, en) => ` data-tip="${esc(zh)}|${esc(en)}"`;

/** Place a box of size (w,h) next to the anchor rect inside a viewport of (vw,vh): above when it fits, else below. */
export function placeTip(anchor, w, h, vw, vh, gap = GAP, prefer = 'top') {
  const right = anchor.left + anchor.width + gap;
  if (prefer === 'right' && right + w <= vw - gap) {
    const top = Math.max(gap, Math.min(anchor.top + (anchor.bottom - anchor.top) / 2 - h / 2, vh - h - gap));
    return { top, left: right, placement: 'right', arrow: Math.max(12, Math.min(anchor.top + (anchor.bottom - anchor.top) / 2 - top, h - 12)) };
  }
  const above = anchor.top - h - gap;
  const below = anchor.bottom + gap;
  const placement = above >= gap || below + h > vh - gap ? 'top' : 'bottom';
  let top = placement === 'top' ? above : below;
  top = Math.max(gap, Math.min(top, vh - h - gap));
  const centre = anchor.left + anchor.width / 2;
  const left = Math.max(gap, Math.min(centre - w / 2, vw - w - gap));
  const arrow = Math.max(12, Math.min(centre - left, w - 12));
  return { top, left, placement, arrow };
}

let lastPointer = 0;
let bubble = null; let current = null; let hoverTimer = 0; let pressTimer = 0; let suppressClick = false;

function ensureBubble() {
  if (bubble?.isConnected) return bubble;
  bubble = document.createElement('div');
  bubble.id = BUBBLE_ID; bubble.className = 'v4-tip'; bubble.setAttribute('role', 'tooltip'); bubble.hidden = true;
  document.body.append(bubble);
  return bubble;
}

function describedBy(el, add) {
  const tokens = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter(token => token !== BUBBLE_ID);
  if (add) tokens.push(BUBBLE_ID);
  if (tokens.length) el.setAttribute('aria-describedby', tokens.join(' ')); else el.removeAttribute('aria-describedby');
}

export function showTip(el) {
  const text = el?.getAttribute?.('data-tip');
  if (!text || !el.isConnected) return;
  clearTimeout(hoverTimer);
  if (current && current !== el) describedBy(current, false);
  const box = ensureBubble();
  // Inside a modal dialog the bubble must live in the dialog (top layer) to stay visible.
  const host = el.closest('dialog[open]') || document.body;
  if (box.parentNode !== host) host.append(box);
  const { zh, en } = parseTip(text);
  box.innerHTML = `<span lang="zh-CN">${esc(zh)}</span>${en ? `<span lang="en">${esc(en)}</span>` : ''}`;
  box.hidden = false; box.style.left = '0px'; box.style.top = '0px';
  const rect = el.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  const spot = placeTip(rect, size.width, size.height, document.documentElement.clientWidth, window.innerHeight, GAP, el.closest('#app-sidebar') ? 'right' : 'top');
  box.style.left = `${Math.round(spot.left)}px`; box.style.top = `${Math.round(spot.top)}px`;
  box.style.setProperty('--tip-arrow', `${Math.round(spot.arrow)}px`);
  box.dataset.placement = spot.placement;
  current = el; describedBy(el, true);
}

export function hideTip() {
  clearTimeout(hoverTimer); clearTimeout(pressTimer);
  if (current) describedBy(current, false);
  current = null;
  if (bubble) bubble.hidden = true;
}

const tipTarget = node => node?.closest?.('[data-tip]');
const iconOnly = el => {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.sr-only, .sr, .count, .m-badge, .dot, [aria-hidden="true"]').forEach(node => node.remove());
  return !clone.textContent.trim() && Boolean(el.querySelector('.ti'));
};

/** Add a phone "?" after each icon-only [data-tip] control (close buttons excepted). */
export function decorate(root = document) {
  root.querySelectorAll('button[data-tip], a[data-tip]').forEach(el => {
    if (el.classList.contains('tip-q') || el.dataset.tipQ === 'off' || el.nextElementSibling?.classList.contains('tip-q')) return;
    if (el.querySelector('.ti-x') || el.closest('.v4-tip, #m-tabbar, .m-actbar, .steps')) return;
    if (!iconOnly(el)) return;
    const help = document.createElement('button');
    help.type = 'button'; help.className = 'tip-q';
    help.setAttribute('aria-label', '这个按钮的说明 What this button does');
    help.dataset.tip = el.dataset.tip;
    help.textContent = '?';
    el.after(help);
  });
}

function onPointerOver(event) {
  if (event.pointerType === 'touch') return;
  const el = tipTarget(event.target);
  if (!el || el === current) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showTip(el), HOVER_DELAY);
}
function onPointerOut(event) {
  const el = tipTarget(event.target);
  if (!el || el.contains(event.relatedTarget)) return;
  clearTimeout(hoverTimer);
  if (el === current && document.activeElement !== el) hideTip();
}
function onFocusIn(event) {
  const el = tipTarget(event.target);
  if (!el) return;
  let keyboard = Date.now() - lastPointer > 800;
  try { keyboard = keyboard && event.target.matches(':focus-visible'); } catch { /* older engines */ }
  if (keyboard) showTip(el);
}
function onPointerDown(event) {
  lastPointer = Date.now();
  const el = tipTarget(event.target);
  if (event.pointerType !== 'touch' || !el) { if (current && !tipTarget(event.target)) hideTip(); return; }
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { showTip(el); suppressClick = true; }, PRESS_DELAY);
}
function onClick(event) {
  const help = event.target.closest?.('.tip-q');
  if (help) { event.preventDefault(); event.stopPropagation(); if (current === help) hideTip(); else showTip(help); return; }
  if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); }
}

export function installTooltips(doc = document) {
  if (doc.documentElement.dataset.tipsInstalled) return;
  doc.documentElement.dataset.tipsInstalled = 'true';
  doc.addEventListener('pointerover', onPointerOver);
  doc.addEventListener('pointerout', onPointerOut);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', event => { if (tipTarget(event.target) === current) hideTip(); });
  doc.addEventListener('pointerdown', onPointerDown, true);
  ['pointerup', 'pointercancel', 'pointermove'].forEach(type => doc.addEventListener(type, event => { if (event.type !== 'pointermove' || event.pointerType === 'touch') clearTimeout(pressTimer); }, true));
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('contextmenu', event => { if (event.pointerType !== 'mouse' && tipTarget(event.target) && current) event.preventDefault(); });
  doc.addEventListener('keydown', event => { if (event.key === 'Escape' && current) hideTip(); });
  window.addEventListener('scroll', () => { if (current) hideTip(); }, { passive: true, capture: true });
  window.addEventListener('resize', hideTip);
  document.addEventListener('crm:viewchange', hideTip);
  decorate(doc);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; decorate(doc); if (current && !current.isConnected) hideTip(); }); })
    .observe(doc.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined' && document.body) installTooltips();

/** What each workspace page is for (menu entries, links and the phone workbench grid). */
export const VIEW_TIPS = Object.freeze({
  overview: ['工作台：今日待办、待审批和本周进展', 'Workbench: to-dos, approvals and progress'],
  companies: ['系统为您找到的全部海外企业及其资料', 'Every overseas company found for you'],
  'contact-ready': ['已有可用联系方式、可以开始联系的企业', 'Companies ready to contact'],
  opportunities: ['按跟进阶段管理有合作机会的客户', 'Manage prospects by follow-up stage'],
  research: ['客户搜索：按市场和类目查找海外客户', 'Lead search: find overseas buyers by market and category'],
  jobs: ['全部客户搜索的明细与进度', 'Every lead search and its progress'],
  tasks: ['今天要做的跟进事项', "Today's follow-up to-dos"],
  replies: ['客户回复的邮件，确认意向并安排下一步', 'Customer replies and next steps'],
  followups: ['审核系统起草的跟进邮件，批准后按计划发出', 'Approve drafted follow-up emails'],
  'contact-queue': ['审核第一封开发信，确认后才会发出', 'Review first-touch emails before sending'],
  'data-import': ['上传客户、订单或商品表格', 'Upload customer, order or product sheets'],
  'data-export': ['把客户名单等导出为 Excel 或 CSV', 'Export lists to Excel or CSV'],
  settings: ['显示方式等通用设置', 'General settings'],
  categories: ['设定可供货的商品类目', 'Set the categories you supply'],
  markets: ['设定要开发的国家和地区', 'Choose the countries to prospect'],
  'customer-match': ['参考已有成交客户判断新客户', 'Existing-customer profile for judging prospects'],
  evidence: ['企业资料来源与评估依据', 'Company sources and assessment basis'],
  me: ['账户、额度与全部功能', 'Account, quota and every function'],
  scope: ['选择您要开发的商品类目和目标市场', 'Choose your categories and target markets'],
  mailbox: ['绑定您自己的发信邮箱，开发信以您公司的名义发出', 'Bind your own mailbox so email goes out under your company name'],
  merchants: ['开通和管理商家账号、试用期与额度', 'Open and manage merchant accounts, trials and quotas'],
  'feedback-inbox': ['查看商家提交的意见反馈', 'Read feedback sent by merchants'],
  'manual-companies': ['录入展会、老客户介绍等渠道认识的企业，写开发信并跟进', 'Add companies from fairs or referrals, write the first email and follow up'],
  'api-keys': ['设置找客户、邮箱核验、翻译等服务的接口密钥；只显示末四位', 'Set the API keys for search, email checks and translation; only the last four characters are shown']
});
export const viewTip = view => { const [zh, en] = VIEW_TIPS[view] || ['打开这个页面', 'Open this page']; return tip(zh, en); };
