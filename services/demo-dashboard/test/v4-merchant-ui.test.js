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
