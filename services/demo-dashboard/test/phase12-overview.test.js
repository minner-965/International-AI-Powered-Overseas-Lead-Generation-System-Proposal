import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewModel} from '../public/ui/v3/overview.js';
import {Phase7Repository} from '../src/phase7/repository.js';

const base={metrics:{verified_active:7,unique_companies:99},opportunities:[],operations:null,research:null,workbench:null,getStatus:row=>row.status};
test('overview uses verified_active only and preserves unavailable projections',()=>{
  const m=overviewModel(base);assert.equal(m.verified,7);assert.equal(m.sent,null);assert.equal(m.pending,null);
  assert.equal(overviewModel({...base,metrics:{unique_companies:99}}).verified,null);
});
test('sent awaiting reply uses exact all-prospect projection and excludes controlled counters',()=>{
  assert.equal(overviewModel({...base,operations:{prospect:{sent_no_reply:1},controlled:{sent:80}}}).sent,1);
  assert.equal(overviewModel({...base,operations:{prospect:{smtp_accepted:5}}}).sent,null);
});
test('market scope is unique companies in supplied current opportunities',()=>{
  const m=overviewModel({...base,opportunities:[{company_id:'a',country_code:'AE',status:'RECOMMENDED'},
    {company_id:'a',country_code:'AE',status:'MANAGEMENT_APPROVED'},{company_id:'b',country_code:'MX',status:'EVIDENCE_REQUIRED'}]});
  assert.equal(m.marketTotal,2);assert.equal(m.recommended,1);assert.deepEqual(m.markets,[['AE',1],['MX',1]]);
});
test('pending counts typed action units with separate breakdown, not evidence total',()=>{
  const m=overviewModel({...base,research:{evidence_tasks:80},operations:{prospect:{pending_drafts:2,pending_management:3,pending_followups:4,pending_contacts:1},monitoring:{alerts:[{code:'INBOX'}]}}});assert.equal(m.pending,11);assert.equal(m.pendingParts.length,5);
  assert.equal(overviewModel({...base,opportunities:null}).recommended,null);
});
test('operations projection remains read-only and keeps controlled rows separate',async()=>{
  let sql='';const repo=new Phase7Repository({pool:{query:async text=>{sql=text;return{rows:[{sent_no_reply:1,pending_followups:2,controlled_sent:4,controlled_contexts:1,controlled_inbound:3,controlled_suppressed:1}]};}}});
  const result=await repo.getOutreachOperationsSummary();assert.equal(result.prospect.sent_no_reply,1);assert.equal(result.controlled.sent,4);
  assert.match(sql,/record_scope='PROSPECT'/);assert.match(sql,/crm\.opportunity_snapshot_id=coalesce\(a\.opportunity_snapshot_id/);
  assert.match(sql,/reservation\.id=m\.first_touch_reservation_id/);
  assert.match(sql,/i\.correlation_outbound_message_id=m\.id/);assert.match(sql,/ELSE m\.business_contact_status END='SENT_NO_REPLY'/);
  assert.doesNotMatch(sql,/\b(UPDATE|INSERT|DELETE)\b/);assert.doesNotMatch(sql.split('sent_no_reply,')[0],/controlled_application/);
});
