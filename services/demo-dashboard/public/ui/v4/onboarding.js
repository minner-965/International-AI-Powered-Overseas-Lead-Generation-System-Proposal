// First-login checklist on the workbench (GET /api/merchant/onboarding):
// ① 绑定发信邮箱 ② 选择类目 ③ 选择市场 ④ 开始客户搜索. Hidden once every step is done or when
// the account has no checklist; each step has one big button that opens the right page.
import { bi, esc } from './crm.js';
import { tip } from './tooltips.js';
import { session, sessionReady } from './session.js';
import { managementRequest } from '../../phase7-ui.js';

export const STEPS = Object.freeze([
  { key: 'mailbox', zh: '绑定发信邮箱', en: 'Bind your sending mailbox', hintZh: '开发信以您公司的名义、从您的邮箱发出', hintEn: 'Emails go out from your own mailbox', action: ['去绑定', 'Bind mailbox'], view: 'mailbox', tipZh: '打开绑定发信邮箱页面，选择邮箱服务商并测试连接', tipEn: 'Open the mailbox page, pick your provider and test it' },
  { key: 'categories', zh: '选择类目', en: 'Choose categories', hintZh: '选择您能供货的商品类目', hintEn: 'Pick the product categories you supply', action: ['选择类目', 'Choose categories'], view: 'scope', section: 'categories', tipZh: '打开我的业务范围，勾选您能供货的类目', tipEn: 'Open your business scope and tick the categories you supply' },
  { key: 'markets', zh: '选择市场', en: 'Choose markets', hintZh: '选择想开发的国家和地区', hintEn: 'Pick the countries to sell to', action: ['选择市场', 'Choose markets'], view: 'scope', section: 'markets', tipZh: '打开我的业务范围，勾选想开发的国家', tipEn: 'Open your business scope and tick the countries' },
  { key: 'first_search', zh: '开始客户搜索', en: 'Start a lead search', hintZh: '按您的类目和市场发起第一次客户搜索', hintEn: 'Start your first lead search with your scope', action: ['新建客户搜索', 'New lead search'], view: 'research', dialog: true, tipZh: '按已选的类目和市场新建客户搜索，会使用本月额度', tipEn: 'Start a search with your scope; uses this month\'s quota' }
]);

/** Merge the API steps with the fixed order; unknown keys are ignored. */
export function onboardingModel(payload) {
  const done = new Map((payload?.steps || []).map(step => [step.key, step.done === true]));
  if (!done.size) return null;
  const steps = STEPS.map(step => ({ ...step, done: done.get(step.key) === true }));
  const count = steps.filter(step => step.done).length;
  return { steps, count, complete: count === steps.length, next: steps.find(step => !step.done)?.key || null };
}

export function onboardingMarkup(model) {
  if (!model || model.complete) return '';
  return `<section class="card v4-onboarding" aria-labelledby="onboarding-title"><div class="ph"><div><h3 id="onboarding-title">${bi('开始使用：4 步完成设置', 'Get started in 4 steps')}</h3><p>${bi(`已完成 ${model.count} / 4 · 完成后系统会按您的范围持续找客户`, `${model.count} of 4 done · then searches run on your scope`)}</p></div><div class="v4-onboarding-meter" role="progressbar" aria-label="设置进度 Setup progress" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${model.count}"><span style="width:${model.count * 25}%"></span></div></div>
    <ol class="v4-onboarding-steps">${model.steps.map((step, index) => `<li class="${step.done ? 'is-done' : step.key === model.next ? 'is-next' : ''}"><span class="n" aria-hidden="true">${step.done ? '<i class="ti ti-check"></i>' : index + 1}</span><span class="t"><b>${bi(step.zh, step.en)}</b><small>${bi(step.hintZh, step.hintEn)}</small></span>${step.done ? `<span class="pill ok">${bi('已完成', 'Done')}</span>` : `<button type="button" class="btn ${step.key === model.next ? 'btn-primary' : 'btn-outline-primary'} v4-onboarding-go" data-onboarding-step="${esc(step.key)}"${tip(step.tipZh, step.tipEn)}>${bi(...step.action)}<i class="ti ti-arrow-right" aria-hidden="true"></i></button>`}</li>`).join('')}</ol></section>`;
}

let model = null;
function place() {
  const overview = document.getElementById('view-overview');
  if (!overview) return;
  let host = document.getElementById('overview-onboarding');
  if (!host) {
    host = document.createElement('div'); host.id = 'overview-onboarding';
    const heading = overview.querySelector('.v3-overview-heading');
    if (heading) heading.after(host); else overview.prepend(host);
  }
  host.innerHTML = onboardingMarkup(model);
  host.hidden = !host.innerHTML;
}

export async function loadOnboarding() {
  if (!session.user?.merchant) return;
  try { model = onboardingModel(await managementRequest('/api/merchant/onboarding')); }
  catch { model = null; }
  place();
}

if (typeof document !== 'undefined' && document.getElementById('view-overview')) {
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-onboarding-step]');
    if (!go) return;
    const step = STEPS.find(item => item.key === go.dataset.onboardingStep);
    if (!step) return;
    location.hash = `#${step.view}`;
    if (step.section) requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('crm:scopesection', { detail: { section: step.section } })));
    if (step.dialog) requestAnimationFrame(() => document.querySelector('#research-new-job-open')?.click());
  });
  document.addEventListener('crm:viewchange', event => { if (event.detail?.view === 'overview') void loadOnboarding(); });
  document.addEventListener('crm:onboarding', () => void loadOnboarding());
  sessionReady.then(user => { if (user.merchant) void loadOnboarding(); });
}
