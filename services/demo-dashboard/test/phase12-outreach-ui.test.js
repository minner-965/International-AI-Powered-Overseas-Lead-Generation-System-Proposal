import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const ui=await readFile(new URL('../public/ui/outreach-workbench.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/ui/v3/outreach.css',import.meta.url),'utf8');
const replies=await readFile(new URL('../public/ui/v3/replies.js',import.meta.url),'utf8');
test('review reuses exact form and approval handlers in three columns',()=>{
  for(const name of ['v3-email-company','v3-email-composer','v3-email-gates'])assert.match(ui,new RegExp(name));
  assert.match(ui,/composerColumn.append\(q\('outreach-review-form'\)/);
  assert.match(ui,/gateColumn.append\(q\('outreach-send-readiness'\)/);
  assert.match(ui,/q\('outreach-send'\)\.disabled=state.busy\|\|state.dirty/);
});
test('mail mobile and desktop retain readable compact targets',()=>{
  assert.match(css,/grid-template-columns:minmax\(180px,.85fr\) minmax\(300px,1.7fr\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/min-height:44px/);
  assert.doesNotMatch(css,/#(?:[\da-f]{3}){1,2}\b|gradient|scale\(/i);
});
test('replies use scoped workbench and actual CRM fields without writes',()=>{
  assert.match(replies,/request\('\/api\/outreach\/workbench'\)/);
  assert.match(replies,/row\.message_id\|\|row\.last_reply_at/);
  for(const field of ['row.owner','row.next_action','row.crm_sync','row.activity','row.suppression'])assert.ok(replies.includes(field));
  assert.doesNotMatch(replies,/method:\s*['"]POST|Math.random|confidence\s*\*/);
  assert.match(replies,/\/api\/outreach\/inbox\?company_id=\$\{encodeURIComponent\(companyId\)\}/);
  assert.match(replies,/Check access or try again/);
});
test('inbox restricts matching company threads and renders sanitized content as text',async()=>{
  const pure=replies.slice(replies.indexOf('const esc='),replies.indexOf('export function mountReplies'));
  const {scopedInboxRows,renderInboxRows}=await import(`data:text/javascript;base64,${Buffer.from(pure).toString('base64')}`);
  const valid={company_id:'prospect',thread_id:'thread',correlation_status:'MATCHED',subject_sanitized:'Hello',body_text_sanitized:'<img src=x>',intent:'OPT_OUT'};
  const rows=scopedInboxRows([valid,{...valid,company_id:'other'},{...valid,correlation_status:'REVIEW'},{...valid,thread_id:null}],'prospect');
  assert.equal(rows.length,1);assert.match(renderInboxRows(rows),/&lt;img src=x&gt;/);assert.match(renderInboxRows(rows),/Opt-out/);assert.match(renderInboxRows([]),/No matched incoming messages/);
});
test('reply projection excludes unsent rows and escapes actual correspondence data',async()=>{
  const pure=replies.slice(replies.indexOf('const esc='),replies.indexOf('export function mountReplies'));
  const {replyRows,renderReplyRows}=await import(`data:text/javascript;base64,${Buffer.from(pure).toString('base64')}`);
  const rows=replyRows({items:[{company_id:'unsent'},{company_id:'sent',message_id:'one',company_name:'<script>',business_contact_status:'SENT_NO_REPLY',crm_sync:'NOT_REQUIRED',activity:[]},{company_id:'reply',last_reply_at:'2026-09-07',company_name:'Example',suppression:true,next_action:'FOLLOW_UP_REQUIRED',activity:[]}]});
  assert.equal(rows.length,2);
  const html=renderReplyRows(rows);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/Sent, no reply yet/);assert.match(html,/Stop contact/);
  assert.match(html,/No activity recorded/);assert.doesNotMatch(html,/Delivered/);
});
