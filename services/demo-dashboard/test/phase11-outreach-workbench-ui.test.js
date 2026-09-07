import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
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

test('disabled send explains server reasons and a failed refresh invalidates cached permission',()=>{
  assert.match(source,/sending_blocked_reasons/);
  assert.match(source,/row\.send_blocked_reasons/);
  assert.match(source,/CONTACT_VERIFICATION_EXPIRED/);
  assert.match(source,/state\.data\.sending_enabled=false;state\.data\.read_failed=true/);
  assert.match(source,/aria-describedby','outreach-send-readiness/);
  assert.doesNotMatch(source,/Sending awaits administrator setup/);
});

test('approved drafts show the actionable send step instead of repeating draft review',()=>{
  const renderer=source.slice(source.indexOf('const nextAction='),source.indexOf('const activityLabels='));
  const render=(row,data={sending_enabled:true})=>vm.runInNewContext(`${renderer}\nnextAction('REVIEW_DRAFT')`,{state:{row,data},bi:(zh,en)=>`${zh}|${en}`});
  assert.equal(render({draft_status:'APPROVED',send_allowed:true}),'待发送|Ready to send');
  assert.equal(render({draft_status:'APPROVED',send_blocked_reasons:['SEND_RATE_CAP_BLOCKED']}),'发送额度待恢复|Send allowance pending');
  assert.equal(render({draft_status:'APPROVED'},{sending_enabled:false}),'发信权限待确认|Sending permission pending');
  assert.equal(render({draft_status:'APPROVED',send_blocked_reasons:['CONTACT_VERIFICATION_EXPIRED']}),'联系条件待复核|Contact review required');
  assert.equal(render({draft_status:'DRAFT'}),'审核草稿|Review draft');
});

test('review, verification and recipient eligibility share semantic V3 status badges',()=>{
  assert.match(source,/data-state-badge state-\$\{tone\}/);
  assert.match(source,/row\.verification_status==='VALID'\?status\('VALID'\):status\('VERIFICATION_REQUIRED'\)/);
  assert.match(source,/row\.eligibility_status==='ELIGIBLE'\?status\('ELIGIBLE'\)/);
  assert.match(source,/VALID:\['已核验','Verified'\],ELIGIBLE:\['条件通过','Eligible'\]/);
});
