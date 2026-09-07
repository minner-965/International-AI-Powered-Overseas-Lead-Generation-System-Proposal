import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(`../${relative}`,import.meta.url),'utf8');

test('controlled email verification is a bilingual management workflow with explicit final confirmation',async()=>{
  const html=await read('public/index.html');
  for(const hook of ['controlled-mail-panel','controlled-context-create','controlled-context-list','controlled-management-approve','controlled-draft-form','controlled-draft-approve','controlled-send-confirm','controlled-send-enqueue','controlled-mail-feedback'])assert.match(html,new RegExp(`id="${hook}"`));
  assert.match(html,/受控邮箱验证/);assert.match(html,/Controlled email verification/);
  assert.match(html,/type="checkbox"/);assert.match(html,/id="controlled-send-enqueue"[^>]*disabled/);
  assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/ui\/controlled-email-verification\.js/);
});

test('controlled email UI uses existing APIs in approval order and never renders a recipient address',async()=>{
  const source=await read('public/ui/controlled-email-verification.js');
  const ordered=[
    '/api/outreach/controlled-tests/runtime',
    '/api/outreach/controlled-tests?limit=20',
    "managementRequest('/api/outreach/controlled-tests'",
    '/management-approve',
    '/drafts`,',
    '/approve`,',
    '/enqueue`,'
  ];
  for(const route of ordered)assert.ok(source.includes(route),route);
  assert.match(source,/state\.runtime\?\.ready/);
  assert.match(source,/confirm\?\.checked/);
  assert.match(source,/draft_status\)\.toUpperCase\(\)!=='PENDING_REVIEW'/);
  assert.match(source,/toggleAttribute\('aria-busy',busy\)/);
  assert.doesNotMatch(source,/\.recipient_hash|\.sender_identity|\.reply_to|\.normalized_recipient/);
  assert.doesNotMatch(source,/console\.(?:log|info|debug|warn|error)/);
});

test('controlled email layout keeps touch targets and collapses without page-level horizontal overflow',async()=>{
  const [pages,responsive]=await Promise.all([read('public/ui/phase8-pages.css'),read('public/ui/phase8-responsive.css')]);
  assert.match(pages,/\.p11-controlled-context[\s\S]*?min-height:\s*44px/);
  assert.match(pages,/\.p11-controlled-action \.btn,[\s\S]*?min-height:\s*44px/);
  assert.match(pages,/\.p11-controlled-layout[\s\S]*?min-width:\s*0/);
  assert.match(responsive,/@media \(max-width:\s*767px\)[\s\S]*?\.p11-controlled-layout,[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(responsive,/\.p11-controlled-steps[\s\S]*?overflow-x:\s*auto/);
});
