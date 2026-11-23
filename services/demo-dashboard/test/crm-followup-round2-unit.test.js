// Round two of the follow-up rules: suggested win probability, reminders counted from an event and
// the preview, and the screens for them. No database, no external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {estimateWinProbability,planReminders,summarizeReminderPlan,DEFAULT_REMINDER_RULES} from '../src/crm/deals.js';
import {estimateMarkup} from '../public/ui/v4/deal-card.js';
import {previewMarkup,rulesMarkup} from '../public/ui/v4/sales-reports.js';

const now=new Date('2026-11-22T10:00:00Z');
const ago=days=>new Date(now.getTime()-days*86_400_000).toISOString();

test('win estimate: five weighted parts, 1-99, won and lost fixed',()=>{
  // QUOTED 40, no history 50, two follow-ups 40, no amount data 50, 2 days in stage 90
  const e=estimateWinProbability({company_id:'c1',pipeline_stage:'QUOTED',recent_activity_7d:2,stage_changed_at:ago(2)},{},now);
  assert.equal(e.score,Math.round(40*0.35+50*0.2+40*0.2+50*0.1+90*0.15));
  assert.deepEqual(e.parts.map(part=>part.key),['stage','history','follow_ups','amount','dwell']);
  assert.deepEqual(e.advice,[]);
  const history={companies:new Map([['c1',{won:0,lost:3}]]),averageWon:new Map([['USD',10000]])};
  const weak=estimateWinProbability({company_id:'c1',pipeline_stage:'NEGOTIATING',recent_activity_7d:0,stage_changed_at:ago(30),deal_amount:100000,deal_currency:'USD'},history,now);
  assert.deepEqual(weak.advice,['STALLED_IN_STAGE','NO_RECENT_FOLLOW_UP','LOW_PAST_WIN_RATE','AMOUNT_UNUSUAL']);
  assert.equal(weak.parts.find(part=>part.key==='dwell').points,10,'never below 10');
  const close=estimateWinProbability({company_id:'c2',pipeline_stage:'NEGOTIATING',recent_activity_7d:9,stage_changed_at:ago(0),deal_amount:9000,deal_currency:'USD'},{...history,companies:new Map([['c2',{won:4,lost:0}]])},now);
  assert.equal(close.score,Math.round(75*0.35+100*0.2+100*0.2+80*0.1+100*0.15));assert.ok(close.score<=99);
  assert.equal(estimateWinProbability({pipeline_stage:'WON'}).score,100);assert.equal(estimateWinProbability({pipeline_stage:'LOST'}).score,0);
});

test('reminders count from an event: once per event, never while open, a new event starts again',()=>{
  const rules={...DEFAULT_REMINDER_RULES};
  const quoted={company_id:'a',company_name:'Al Noor',pipeline_stage:'QUOTED',stage_changed_at:ago(5),last_touch_at:ago(5)};
  const quiet={company_id:'b',company_name:'Gulf Home',pipeline_stage:'CONTACTED',stage_changed_at:ago(20),last_touch_at:ago(10)};
  const planned={company_id:'c',company_name:'Casa',pipeline_stage:'NEGOTIATING',stage_changed_at:ago(1),last_touch_at:ago(1),next_action_due_at:ago(2)};
  let plan=planReminders([quoted,quiet,planned],rules,[],now);
  assert.deepEqual(plan.create.map(row=>[row.company_id,row.rule]),[['a','QUOTED_NO_REPLY'],['b','NO_FOLLOW_UP'],['c','NEXT_ACTION_DUE']]);
  assert.equal(plan.create[0].event_at,quoted.stage_changed_at);assert.equal(plan.create[1].event_at,quiet.last_touch_at);
  // Closed long ago for the same quote: not again. A new quote (new stage change): again.
  const done=[{company_id:'a',source_rule:'QUOTED_NO_REPLY',task_status:'COMPLETED',closed_at:ago(4),source_event_at:quoted.stage_changed_at}];
  plan=planReminders([quoted],rules,done,now);
  assert.deepEqual(plan.skipped.map(row=>row.reason),['same_event']);
  const requoted={...quoted,stage_changed_at:ago(4)};
  assert.equal(planReminders([requoted],rules,done,now).create.length,1,'a new quote starts a new cycle');
  assert.deepEqual(planReminders([quoted],rules,[{company_id:'a',source_rule:'QUOTED_NO_REPLY',task_status:'OPEN',source_event_at:null}],now).skipped.map(row=>row.reason),['open']);
  assert.deepEqual(planReminders([requoted],rules,[{company_id:'a',source_rule:'QUOTED_NO_REPLY',task_status:'CANCELLED',closed_at:ago(1),source_event_at:ago(30)}],now).skipped.map(row=>row.reason),['recently_closed']);
  const capped=planReminders([quoted,quiet,planned],rules,[],now,{limit:1});
  assert.equal(capped.create.length,1);assert.deepEqual(capped.skipped.map(row=>row.reason),['over_limit','over_limit']);
  const summary=summarizeReminderPlan(capped);
  assert.deepEqual(summary.QUOTED_NO_REPLY,{matched:1,creatable:1,skipped:{open:0,same_event:0,recently_closed:0,over_limit:0},examples:['Al Noor']});
  assert.equal(summary.NO_FOLLOW_UP.skipped.over_limit,1);
});

test('screens: suggested probability explained, preview button and result, gate fields, overdue reschedule reason',async()=>{
  const html=estimateMarkup({estimate:{score:47,parts:[{key:'stage',points:40,weight:0.35},{key:'dwell',points:10,weight:0.15}],advice:['STALLED_IN_STAGE']}});
  assert.match(html,/建议赢率 47%/);assert.match(html,/当前阶段[\s\S]*40 × 35%/);assert.match(html,/停了 14 天以上/);
  assert.equal(estimateMarkup({estimate:null}),'');
  const rules=rulesMarkup({enabled:true,no_follow_up_days:7,quoted_no_reply_days:3,sample_no_confirm_days:7});
  assert.match(rules,/data-rules-preview[^>]*data-tip=/);
  const preview=previewMarkup({enabled:false,checked:4,rules:{QUOTED_NO_REPLY:{matched:2,creatable:1,skipped:{open:1,same_event:0,recently_closed:0,over_limit:0},examples:['Al Noor']}}});
  assert.match(preview,/检查了 4 家/);assert.match(preview,/符合 2 · 会新建 1/);assert.match(preview,/已有未完成 1/);assert.match(preview,/例如：Al Noor/);assert.match(preview,/自动提醒目前是关闭的/);
  const followup=await readFile(new URL('../public/ui/v4/followup-card.js',import.meta.url),'utf8');
  assert.match(followup,/name="expected_close_date"/);assert.match(followup,/name="won_confirmation"/);assert.match(followup,/stageGateProblem\(item\.pipeline_stage, selected/);
  const tasks=await readFile(new URL('../public/ui/v4/tasks.js',import.meta.url),'utf8');
  assert.match(tasks,/改期原因（已逾期，必填）/);assert.match(tasks,/CRM_RESCHEDULE_REASON_REQUIRED/);
});
