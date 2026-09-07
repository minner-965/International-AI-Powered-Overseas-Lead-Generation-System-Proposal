import test from 'node:test';
import assert from 'node:assert/strict';
import {projectContactProgress,attachContactProgress,firstContactPendingSql} from '../src/outreach/contactProgress.js';
import {Phase7Service} from '../src/phase7/service.js';
import {Phase7Repository} from '../src/phase7/repository.js';
const row={company_id:'00000000-0000-4000-8000-000000000001',product_profile:'WOMENSWEAR',display_opportunity_status:'RECOMMENDED',management_contact_status:'NOT_REVIEWED'};
const sent={company_id:row.company_id,product_profile:'WOMENSWEAR',sent_at:'2026-09-07T03:20:44Z',transport_status:'SMTP_ACCEPTED'};
test('reassessment never resets accepted contact or inherits approval',()=>{
  const result=projectContactProgress({...row,assessment_revision:17},[sent]);
  assert.equal(result.contact_progress_status,'SENT_NO_REPLY');assert.equal(result.first_contact_pending,false);
  assert.equal(result.management_contact_status,'NOT_REVIEWED');assert.equal(result.display_opportunity_status,'RECOMMENDED');
});
test('new unsent draft cannot mask immutable accepted contact',()=>assert.equal(projectContactProgress({...row,draft_status:'DRAFT'},[sent]).first_contact_pending,false));
test('another category retains own fit but does not become first company contact',()=>{
  const result=projectContactProgress({...row,product_profile:'GENERAL_MERCHANDISE'},[sent]);
  assert.equal(result.has_prior_company_contact,true);assert.equal(result.first_contact_pending,false);
});
test('reply bounce and opt-out are distinct progress states',()=>{
  for(const [extra,status] of [[{reply_category:'HUMAN_POSITIVE'},'REPLIED'],[{send_status:'HARD_BOUNCED'},'BOUNCED'],[{reply_category:'OPT_OUT'},'OPTED_OUT']])assert.equal(projectContactProgress(row,[{...sent,...extra}]).contact_progress_status,status);
  assert.equal(projectContactProgress(row,[],true).first_contact_pending,false);
  assert.equal(projectContactProgress(row,[],'OPT_OUT').contact_progress_status,'OPTED_OUT');
  assert.equal(projectContactProgress(row,[],'DO_NOT_CONTACT').contact_progress_status,'DO_NOT_CONTACT');
});
test('ambiguity blocks initial contact; never treated as accepted or safe retry',()=>{
  const result=projectContactProgress(row,[{...sent,sent_at:null,transport_status:'UNKNOWN',send_status:'AMBIGUOUS'}]);
  assert.equal(result.contact_progress_status,'SEND_AMBIGUOUS');assert.equal(result.has_prior_company_contact,false);assert.equal(result.first_contact_pending,false);
});
test('fresh company remains first contact pending',()=>assert.equal(projectContactProgress(row).first_contact_pending,true));
test('delayed human reply to older mail survives newer unanswered mail and retains latest send time',()=>{
  const recent={...sent,sent_at:'2026-09-07T05:00:00Z'};
  const result=projectContactProgress(row,[{...sent,reply_category:'HUMAN_POSITIVE',reply_received_at:'2026-09-07T06:00:00Z'},recent]);
  assert.equal(result.contact_progress_status,'REPLIED');assert.equal(result.last_contact_at,recent.sent_at);
  assert.equal(result.contact_progress_reply_status,'HUMAN_POSITIVE');
});
test('export keeps historical delivery facts alongside current unsent draft approval',async()=>{
  const projected=projectContactProgress(row,[{...sent,receipt_evidence_status:'UNCONFIRMED'}]);
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env:{OUTBOUND_EMAIL_PROVIDER:'NONE'},opportunityQuery:async()=>[projected]});
  service.repository.listOutreachWorkbench=async()=>[{...row,draft_status:'DRAFT',transport_status:'NOT_ATTEMPTED',business_contact_status:'NOT_SENT'}];
  const [out]=await service.queryExportRows({exportType:'SALES_OPPORTUNITY',filters:{status:'ALL'},mode:'CURRENT_FILTER'});
  assert.equal(out.business_contact_status,'SENT_NO_REPLY');assert.equal(out.transport_status,'SMTP_ACCEPTED');
  assert.equal(out.sent_at,sent.sent_at);assert.equal(out.reply_status,'NO_REPLY_YET');assert.equal(out.draft_status,'DRAFT');assert.equal(out.next_action,'WAIT_FOR_REPLY');
});
test('projection uses historical approvals, matched reply and only company-level suppression',async()=>{
  const calls=[];const pool={query:async(sql,values)=>{calls.push(sql);assert.deepEqual(values,[[row.company_id]]);return{rows:calls.length===1?[sent]:[]};}};
  const result=await attachContactProgress(pool,[row]);assert.equal(result[0].first_contact_pending,false);
  assert.match(calls[0],/a.opportunity_snapshot_id/);assert.match(calls[0],/correlation_status='MATCHED'/);
  assert.doesNotMatch(calls[0],/controlled_application/);assert.match(calls[1],/company_suppressions/);
});
test('read failure propagates instead of inventing not-contacted state',async()=>assert.rejects(attachContactProgress({query:async()=>{throw Error('offline');}},[row]),/offline/));
test('initial queue predicate spans snapshots and is applied in SQL',()=>{const sql=firstContactPendingSql('o');assert.match(sql,/prior_mail.company_id=o.company_id/);assert.match(sql,/AMBIGUOUS/);assert.match(sql,/company_suppressions/);assert.doesNotMatch(sql,/opportunity_snapshot_id/);});
test('operations aggregates use latest corrected classifications and meaningful reply priority',async()=>{
  let sql;const repo=new Phase7Repository({pool:{query:async text=>{sql=text;return{rows:[{}]};}}});await repo.getOutreachOperationsSummary();
  assert.match(sql,/ORDER BY CASE WHEN rc.reply_category='OPT_OUT'/);
  assert.match(sql,/ORDER BY rc.created_at DESC,rc.id DESC LIMIT 1\)current_reply/);
  assert.match(sql,/m.id=i.correlation_outbound_message_id/);
  assert.doesNotMatch(sql,/m.recipient_id=t.recipient_id/);
});
