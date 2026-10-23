// Round 4 merchant workspace UI: weekly first-touch KPI, sending quota, Company Detail layout,
// sign-in, trial banners, onboarding, mailbox binding, business scope, merchant admin, feedback, roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firstTouchWeeks } from '../public/ui/v3/overview.js';
import { quotaMarkup } from '../public/ui/v4/crm.js';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('overview first-touch KPI reads this week and last week, and stays silent without the metric', () => {
  const html = firstTouchWeeks(null, { first_touch: { this_week: 12, last_week: 7 } });
  assert.match(html, /本周 12 封 · 上周 7 封/);
  assert.match(html, /This week 12 · last week 7/);
  assert.match(html, /v4-week up/);
  assert.match(firstTouchWeeks({ first_touch: { this_week: 0, last_week: 3 } }, null), /v4-week down/);
  assert.equal(firstTouchWeeks(null, { prospect: {} }), null);
  assert.equal(firstTouchWeeks(null, { first_touch: { this_week: null, last_week: 2 } }), null);
});

test('follow-up approval shows today\'s quota from the drafts payload', async () => {
  const bar = quotaMarkup({ sent_today: 8, daily_limit: 10, remaining: 2 });
  assert.match(bar, /今日发信额度/); assert.match(bar, /<b>8<\/b> \/ 10/); assert.match(bar, /今日剩余 2 封/);
  assert.match(bar, /aria-valuenow="8"/); assert.match(bar, /is-high/);
  assert.match(quotaMarkup({ sent_today: 10, daily_limit: 10, remaining: 0 }), /今日额度已用完/);
  assert.equal(quotaMarkup(null), '');
  assert.equal(quotaMarkup({ sent_today: 'x', daily_limit: 10 }), '');
  const followups = await read('ui/v4/followups.js');
  assert.match(followups, /state\.quota = payload\?\.quota \|\| null/);
  assert.match(followups, /id="followups-quota"/);
});

test('Company Detail follows the company.html layout and keeps every existing hook', async () => {
  const [app, layout, card, css] = await Promise.all([read('app.js'), read('ui/v4/company-layout.js'), read('ui/v4/followup-card.js'), read('ui/v4/app.css')]);
  assert.match(app, /companyLayout\(\{ head: companyHead, basic: basicCard, evaluation, more:/);
  for (const hook of ['class="crm-detail-identity"', 'id="detail-section-nav"', 'class="crm-detail-workspace"', 'detail-panel-outreach-readiness', 'detail-panel-evidence', 'crm-detail-actions']) assert.ok(app.includes(hook), hook);
  assert.match(layout, /基本信息/); assert.match(layout, /评估依据/);
  assert.match(layout, /data-followup-slot data-m-pane="log"/);
  assert.match(layout, /\['log', '跟进记录'[\s\S]*\['info', '资料'[\s\S]*\['why', '评估依据'/);
  assert.match(card, /slot\.replaceChildren\(block\)/);
  assert.match(card, /bar\.className = 'm-actbar v4-phone-only'/);
  assert.match(css, /#detail\[data-m-seg="log"\] \[data-m-pane="log"\]/);
});

// ---------- P3: sign-in, roles, trial, onboarding, mailbox, scope, merchant admin, feedback ----------
import { viewAllowed, trialDaysLeft, isReadOnly, loginUrl, ADMIN_VIEWS, REFUSALS } from '../public/ui/v4/session.js';
import { bannerMarkup } from '../public/ui/v4/account.js';
import { onboardingModel, onboardingMarkup } from '../public/ui/v4/onboarding.js';
import { helpFor, testResultText, mailboxProblem, FALLBACK_PRESETS } from '../public/ui/v4/mailbox.js';
import { scopeModel } from '../public/ui/v4/merchant-scope.js';
import { referralIndex, restoreStatus, filterMerchants, createProblem, passwordResultMarkup } from '../public/ui/v4/merchants-admin.js';
import { safeNext, loginErrorText, passwordProblem } from '../public/ui/v4/login.js';
import { accountMarkup, usageRow } from '../public/ui/v4/me.js';

const merchant = (over = {}) => ({ id: 'm1', company_name: 'Ningbo Sunrise', status: 'TRIAL', trial_ends_at: '2026-10-28T08:00:00Z', read_only: false, quotas: { monthly_searches: 300, daily_emails: 30 }, usage: { searches_this_month: 250, emails_today: 3 }, features: { research: true, email: true }, referral_code: 'ABC123', ...over });

test('roles: merchants never open SIM-only pages; disabled features hide research', () => {
  const m = { role: 'MERCHANT', merchant: merchant() };
  for (const view of ADMIN_VIEWS) { assert.equal(viewAllowed(view, m), false, view); assert.equal(viewAllowed(view, { role: 'ADMIN', merchant: null }), true); }
  for (const view of ['overview', 'opportunities', 'companies', 'research', 'tasks', 'replies', 'followups', 'scope', 'mailbox', 'me']) assert.equal(viewAllowed(view, m), true, view);
  assert.equal(viewAllowed('research', { role: 'MERCHANT', merchant: merchant({ features: { research: false } }) }), false);
  assert.equal(viewAllowed('settings', null), true);
});

test('sign-in redirect keeps the page, refuses foreign targets and explains failures', () => {
  assert.equal(loginUrl('expired', { pathname: '/', search: '', hash: '#tasks' }), '/login.html?next=%2F%23tasks&reason=expired');
  assert.equal(safeNext('/#mailbox'), '/#mailbox');
  for (const bad of ['//evil.test', 'https://evil.test', '/login.html', '']) assert.equal(safeNext(bad), '/');
  assert.match(loginErrorText(401)[0], /邮箱或密码不正确/);
  assert.match(loginErrorText(403, 'MERCHANT_DISABLED')[0], /停用/);
  assert.match(passwordProblem('Temp12345', 'short', 'short')[0], /8 位/);
  assert.match(passwordProblem('Temp12345', 'Longer-pass-1', 'Other-pass-1')[0], /不一致/);
  assert.match(passwordProblem('Temp12345', 'Temp12345', 'Temp12345')[0], /不能与临时密码相同/);
  assert.equal(passwordProblem('Temp12345', 'Longer-pass-1', 'Longer-pass-1'), null);
  assert.match(REFUSALS.MERCHANT_MAILBOX_NOT_VERIFIED[0], /绑定/);
});

test('trial banner counts days left; an expired trial is read-only with a contact hint', () => {
  const now = new Date('2026-10-23T08:00:00Z');
  assert.equal(trialDaysLeft(merchant(), now), 5);
  assert.match(bannerMarkup({ merchant: merchant() }, now), /试用剩余 5 天/);
  assert.match(bannerMarkup({ merchant: merchant() }, now), /data-feedback-open/);
  const expired = { merchant: merchant({ status: 'EXPIRED', read_only: true }) };
  assert.equal(isReadOnly(expired), true);
  assert.match(bannerMarkup(expired, now), /试用已结束，请联系 SIM 开通/);
  assert.equal(bannerMarkup({ role: 'ADMIN', merchant: null }, now), '');
  assert.equal(bannerMarkup({ merchant: merchant({ status: 'ACTIVE', paid_until: '2027-06-01' }) }, now), '');
});

test('first-login checklist follows the API steps and points the next step at a big button', () => {
  const model = onboardingModel({ steps: [{ key: 'mailbox', done: true }, { key: 'categories', done: false }, { key: 'markets', done: false }, { key: 'first_search', done: false }] });
  assert.equal(model.count, 1); assert.equal(model.next, 'categories');
  const html = onboardingMarkup(model);
  for (const label of ['绑定发信邮箱', '选择类目', '选择市场', '开始找客户']) assert.ok(html.includes(label), label);
  assert.match(html, /class="btn btn-primary v4-onboarding-go" data-onboarding-step="categories"/);
  assert.match(html, /aria-valuenow="1"/);
  assert.equal(onboardingMarkup(onboardingModel({ steps: ['mailbox', 'categories', 'markets', 'first_search'].map(key => ({ key, done: true })) })), '');
  assert.equal(onboardingModel({}), null);
});

test('mailbox binding: presets, provider help, plain test results and form checks', () => {
  assert.deepEqual(FALLBACK_PRESETS.map(p => p.key), ['gmail', 'microsoft365', 'zoho', 'aliyun', 'tencent', 'netease', 'other']);
  assert.ok(FALLBACK_PRESETS.every(p => p.key === 'other' || (p.smtp_port === 587 && p.imap_port === 993)));
  assert.match(helpFor({ key: 'gmail' })[0], /应用专用密码/);
  assert.match(helpFor({ key: 'tencent_exmail', label: '腾讯企业邮箱' })[0], /客户端专用密码/);
  assert.match(helpFor({ key: 'aliyun_qiye' })[0], /阿里/);
  assert.match(testResultText({ ok: true })[0], /连接成功/);
  assert.match(testResultText({ ok: false, code: 'EAUTH' })[0], /用户名或密码不正确/);
  assert.match(testResultText({ ok: false, code: 'ETIMEDOUT' })[0], /连接不上服务器/);
  const body = { from_email: 'li@sunrise.test', smtp_host: 'smtp.gmail.com', imap_host: 'imap.gmail.com', smtp_port: 587, imap_port: 993 };
  assert.match(mailboxProblem(body, false)[0], /密码/);
  assert.equal(mailboxProblem({ ...body, password: 'app-pass' }, false), null);
  assert.equal(mailboxProblem(body, true), null);
  assert.match(mailboxProblem({ ...body, from_email: 'nope' }, true)[0], /发件邮箱/);
});

test('business scope lists approved active categories and active markets with the saved choice', () => {
  const model = scopeModel({ category_scope_ids: ['c1'], market_codes: ['ae'] },
    { items: [{ id: 'c1', product_profile: 'WOMENSWEAR', normalized_category: 'DRESSES', scope_status: 'ACTIVE' }, { id: 'c2', product_profile: 'WOMENSWEAR', normalized_category: 'OLD', scope_status: 'RETIRED' }] },
    { items: [{ market_code: 'AE', country_name: 'United Arab Emirates', status: 'ACTIVE', search_enabled: true }, { market_code: 'BD', status: 'ACTIVE', search_enabled: false }] });
  assert.deepEqual(model.categories.map(c => c.id), ['c1']);
  assert.equal(model.categories[0].en, 'Dresses');
  assert.deepEqual(model.markets.map(m => m.code), ['AE']);
  assert.ok(model.chosenCategories.has('c1') && model.chosenMarkets.has('AE'));
});

test('merchant admin: referral tree, restore status, filters, create checks and one-time password', () => {
  const items = [{ id: 'a', company_name: 'A', status: 'TRIAL', login_email: 'a@x.test' }, { id: 'b', company_name: 'B', status: 'EXPIRED', referred_by: { id: 'a', company_name: 'A' }, login_email: 'b@x.test' }, { id: 'c', company_name: 'C', status: 'DISABLED', referred_by: { id: 'a', company_name: 'A' } }];
  assert.deepEqual(referralIndex(items).get('a').map(m => m.id), ['b', 'c']);
  const now = new Date('2026-10-23T00:00:00Z');
  assert.equal(restoreStatus({ paid_until: '2027-01-01' }, now), 'ACTIVE');
  assert.equal(restoreStatus({ trial_ends_at: '2026-10-30' }, now), 'TRIAL');
  assert.equal(restoreStatus({ trial_ends_at: '2026-10-01' }, now), 'EXPIRED');
  assert.deepEqual(filterMerchants(items, { status: 'EXPIRED' }).map(m => m.id), ['b']);
  assert.deepEqual(filterMerchants(items, { q: 'a@x' }).map(m => m.id), ['a']);
  assert.match(createProblem({ company_name: '', login_email: 'x@y.z', trial_days: 7, quotas: {} })[0], /公司名称/);
  assert.equal(createProblem({ company_name: 'X', login_email: 'x@y.test', trial_days: 7, quotas: { monthly_searches: 10, daily_emails: 5 } }), null);
  globalThis.location = { origin: 'https://sim.example' };
  const result = passwordResultMarkup({ email: 'x@y.test', password: 'Tmp-Pass-99', created: true });
  assert.match(result, /只显示这一次/); assert.match(result, /Tmp-Pass-99/); assert.match(result, /data-copy-text=/); assert.match(result, /https:\/\/sim\.example\/login\.html/);
  delete globalThis.location;
});

test('我的 shows status, quota usage, referral code, password change and sign-out', () => {
  const html = accountMarkup({ email: 'li@sunrise.test', display_name: 'Li Na', role: 'MERCHANT', merchant: merchant() });
  for (const text of ['本月找客户', '今日发信', 'ABC123', '修改密码', '退出登录', '意见反馈', '试用中']) assert.ok(html.includes(text), text);
  assert.match(usageRow('本月找客户', 'Searches', 250, 300, '次', ''), /is-high/);
  assert.match(usageRow('今日发信', 'Emails', 30, 30, '封', ''), /is-full/);
});

test('shell wiring: session first, sign-in page, role-tagged navigation, new pages and feedback on every page', async () => {
  const [html, login, shell, feedback, admin, css] = await Promise.all(['index.html', 'login.html', 'crm-shell.js', 'ui/v4/feedback.js', 'ui/v4/merchants-admin.js', 'ui/v4/app.css'].map(read));
  assert.ok(html.indexOf('/ui/v4/session.js') < html.indexOf('/crm-shell.js'));
  for (const view of ['mailbox', 'scope', 'merchants', 'feedback-inbox']) { assert.match(html, new RegExp(`data-app-view="${view}"`)); assert.match(html, new RegExp(`data-app-nav="${view}"`)); }
  assert.match(html, /<div class="crm-nav-group" data-roles="ADMIN"><div class="crm-nav-group-title bi"><span lang="zh-CN">管理<\/span>/);
  assert.match(html, /<div class="crm-nav-group" data-roles="ADMIN"><div class="crm-nav-group-title bi"><span lang="zh-CN">数据<\/span>/);
  assert.match(html, /data-feature="research"/);
  assert.match(html, /id="logout-button"/); assert.match(html, /id="account-banner"/);
  assert.match(login, /id="password-form"/); assert.match(login, /首次登录请修改密码/);
  assert.match(shell, /viewAllowed\(known\)/);
  assert.match(feedback, /json\('\/api\/feedback', \{ page: box\.dataset\.page, message \}\)/);
  assert.match(feedback, /\/api\/admin\/feedback\/\$\{encodeURIComponent/);
  for (const action of ['extend', 'paid', 'quotas', 'reset', 'disable', 'restore']) assert.match(admin, new RegExp(`data-merchant-action="${action}"`));
  assert.match(css, /html\[data-role="MERCHANT"\] \[data-roles="ADMIN"\]/);
  assert.match(css, /\.v4-feedback-fab \{ position: fixed;/);
});
