import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pipelineFunnel } from '../public/ui/v3/overview.js';
import { when, STAGES, stageLabel } from '../public/ui/v4/crm.js';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('pipeline funnel is cumulative by current stage, keeps lost apart and never invents counts', () => {
  const funnel = pipelineFunnel({ NEW: 2, CONTACTED: 1, REPLIED: 0, QUOTED: 0, SAMPLE: 1, NEGOTIATING: 0, WON: 1, LOST: 3 });
  assert.deepEqual(funnel.rows.map(row => row.count), [5, 3, 2, 2, 2, 1, 1]);
  assert.equal(funnel.rows[1].conversion, 60);
  assert.equal(funnel.active, 4); assert.equal(funnel.won, 1); assert.equal(funnel.lost, 3);
  assert.equal(pipelineFunnel({ NEW: 1 }), null);
  assert.equal(pipelineFunnel(null), null);
});

test('stage vocabulary matches the CRM API and due labels report overdue days', () => {
  assert.deepEqual(STAGES.map(([key]) => key), ['NEW', 'CONTACTED', 'REPLIED', 'QUOTED', 'SAMPLE', 'NEGOTIATING', 'WON', 'LOST']);
  assert.equal(stageLabel('UNKNOWN')[0], 'NEW');
  const now = new Date('2026-10-22T12:00:00');
  assert.match(when('2026-10-22T15:00:00', now).zh, /^今天 15:00$/);
  const late = when('2026-10-20T09:00:00', now);
  assert.equal(late.overdue, true); assert.equal(late.overdueDays, 2);
  assert.equal(when(null), null);
});

test('opportunities keep the category workspace hooks and add the stage pipeline and follow-up card', async () => {
  const [html, app, card, pipeline] = await Promise.all([read('index.html'), read('app.js'), read('ui/v4/followup-card.js'), read('ui/v4/pipeline.js')]);
  for (const id of ['opportunity-pipeline', 'pipeline-stage-tabs', 'pipeline-list', 'opportunity-assessment', 'opportunity-table', 'opportunity-status-tabs']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /mountFollowupCard\(detail,\{companyId/);
  assert.match(card, /crm\.setStage\(item\.opportunity_id, \{ stage: selected/);
  assert.match(card, /expected_version: item\.crm_version/);
  assert.match(card, /selected === 'LOST' && !reason/);
  assert.match(card, /crm\.addActivity\(opportunityId/);
  assert.match(card, /bar.className = 'm-actbar v4-phone-only'/);
  assert.match(pipeline, /loadPipeline\(\{ force \}\)/);
});

test('follow-up group pages use the CRM task, draft and reply-review contracts', async () => {
  const [html, tasks, drafts, review, replies] = await Promise.all([read('index.html'), read('ui/v4/tasks.js'), read('ui/v4/followups.js'), read('ui/v4/reply-review.js'), read('ui/v3/replies.js')]);
  for (const view of ['tasks', 'followups']) assert.match(html, new RegExp(`data-app-view="${view}"`));
  for (const script of ['tasks', 'followups', 'reply-review']) assert.match(html, new RegExp(`src="/ui/v4/${script}\\.js"`));
  assert.match(tasks, /crm\.updateTask\(id, \{ task_status: 'COMPLETED' \}\)/);
  assert.match(tasks, /crm\.createTask\(\{ company_id/);
  assert.match(tasks, /due: range === 'all' \? undefined : range, mine:/);
  assert.match(drafts, /crm\.decideDraft\(draft\.id, body\)/);
  assert.match(drafts, /decision: 'APPROVE', subject: form\.subject\.value\.trim\(\), body_text/);
  assert.match(drafts, /decision: 'DISCARD'/);
  assert.match(review, /decision: 'CORRECT', intent: value/);
  assert.match(replies, /data-classification-id=/);
});
