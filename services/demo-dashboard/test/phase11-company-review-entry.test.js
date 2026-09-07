import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('company detail preserves company identity across an absent legacy review',async()=>{
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(server,/c\.id AS id, c\.id AS company_id, r\.id AS lead_review_id/);
  const ui=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(ui,/const hasLegacyReview = Boolean\(lead\?\.lead_review_id\)/);
  assert.doesNotMatch(ui,/lead_review_id: lead\.lead_review_id \|\| id/);
  assert.match(ui,/crm:openoutreach/);
});

test('email workspace separates company approval from exact draft approval and send',async()=>{
  const ui=await readFile(new URL('../public/ui/outreach-workbench.js',import.meta.url),'utf8');
  assert.match(ui,/outreach-contact-approve/);
  assert.match(ui,/\/management-approve/);
  assert.match(ui,/approveContact\.disabled=state\.busy\|\|state\.dirty\|\|row\.opportunity_status!=='RECOMMENDED'/);
  assert.match(ui,/\/api\/outreach\/drafts\/\$\{state\.row\.draft_id\}\/approve/);
  assert.match(ui,/companies=new Map\(\)/);
  assert.match(ui,/SENT_NO_REPLY:\['已发送，未回复'/);
});
