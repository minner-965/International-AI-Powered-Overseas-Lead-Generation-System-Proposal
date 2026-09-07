import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/ui/outreach-workbench.js',import.meta.url),'utf8');

test('workbench uses approval ID for sending and server-derived draft preparation',()=>{
  assert.match(source,/\/api\/outreach\/messages\/\$\{state\.row\.approval_id\}\/enqueue/);
  assert.match(source,/\/api\/outreach\/messages\/\$\{state\.row\.message_id\}\/retry-before-provider/);
  assert.doesNotMatch(source,/\/api\/outreach\/messages\/\$\{state\.row\.draft_id\}\/enqueue/);
  assert.match(source,/\/api\/outreach\/workbench\/\$\{state\.row\.company_id\}\/prepare/);
  assert.doesNotMatch(source,/SMTP_PASSWORD|SMTP_FROM_EMAIL|api[_-]?key/i);
});

test('unsaved edits prevent approvals and sends; existing messages freeze editing',()=>{
  assert.match(source,/const frozen=Boolean\(row\.message_id\)/);
  assert.match(source,/q\('outreach-approve'\)\.disabled=state\.busy\|\|state\.dirty\|\|frozen/);
  assert.match(source,/q\('outreach-save'\)\.disabled=state\.busy\|\|frozen/);
  assert.match(source,/q\('outreach-body'\)\.readOnly=frozen/);
  assert.match(source,/q\('outreach-subject'\)\.readOnly=frozen/);
  assert.match(source,/q\('outreach-send'\)\.disabled=state\.busy\|\|state\.dirty\|\|!state\.data\?\.sending_enabled\|\|\(!row\.send_allowed&&!row\.retry_allowed\)/);
  assert.match(source,/if\(state\.dirty\|\|!state\.data\?\.sending_enabled\|\|\(!state\.row\?\.send_allowed&&!state\.row\?\.retry_allowed\)\)return/);
  assert.match(source,/state\.dirty\|\|/);
  assert.match(source,/escape|const esc=/);
});

test('real operations and controlled verification counters use separate response sections',()=>{
  assert.match(source,/\/api\/outreach\/operations-summary/);
  assert.match(source,/data\.prospect/);
  assert.match(source,/data\.controlled\?\.sent/);
  assert.match(source,/data\.controlled\?\.inbound/);
  assert.doesNotMatch(source,/Math\.random|setInterval\([^)]*(?:send|enqueue)/);
});

test('review dialog supports return, focus and accessible progress feedback',()=>{
  assert.match(source,/document\.createElement\('dialog'\)/);
  assert.match(source,/aria-labelledby/);
  assert.match(source,/role="status" aria-live="polite"/);
  assert.match(source,/outreach-review-close/);
  assert.match(source,/\.focus\(\)/);
  assert.match(source,/aria-busy/);
});
