import test from 'node:test';
import assert from 'node:assert/strict';
import {Phase7Service} from '../src/phase7/service.js';
import {OUTREACH_EXPORT_LABELS,outreachExportValue,resolveExportRequest,serializeCsv,projectExportRow} from '../src/dataExchange/index.js';

test('outreach export offers all18 business fields and bilingual headers without private payloads',()=>{
  assert.equal(Object.keys(OUTREACH_EXPORT_LABELS).length,18);
  const resolved=resolveExportRequest({exportType:'SALES_OPPORTUNITY',format:'CSV',mode:'CURRENT_FILTER',requesterRole:'SALES',columns:Object.keys(OUTREACH_EXPORT_LABELS)});
  const projected=projectExportRow({company_name:'Company',business_contact_status:outreachExportValue('SENT_NO_REPLY'),body_text:'private reply',password:'secret'},resolved);
  const csv=serializeCsv(resolved.columns,[projected],OUTREACH_EXPORT_LABELS);
  assert.match(csv,/公司 \/ Company/);assert.match(csv,/已发送，未回复/);assert.doesNotMatch(csv,/private reply|secret/);
  assert.notEqual(outreachExportValue('SMTP_ACCEPTED'),outreachExportValue('RECEIVED_CONFIRMED'));
  assert.equal(outreachExportValue('TOPS; DRESSES','matched_categories'),'上衣 / Tops; 连衣裙 / Dresses');
  assert.match(outreachExportValue('NO_REPLY_YET'),/No reply yet/);
  assert.match(outreachExportValue('NOT_ASSIGNED'),/Not assigned/);
});
test('monitoring exposes configuration facts and observed failures without authentication values',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},env:{SMTP_HOST:'private-host',SMTP_USER:'private-user',SMTP_PASSWORD:'private-password'}});
  service.repository.getOutreachOperationsSummary=async()=>({prospect:{smtp_accepted:1},controlled:{sent:1}});
  service.repository.getOutreachMonitoring=async()=>({last_inbound_sync:'2026-09-07T00:00:00Z',last_successful_sync:null,imap_sync_failure:1,send_ambiguous:0});
  const result=await service.getOutreachOperationsSummary();
  assert.equal(result.monitoring.smtp_configured,true);assert.equal(result.monitoring.prospect_pilot_open,false);
  assert.deepEqual(result.monitoring.alerts,[{code:'IMAP_SYNC_FAILURE',count:1}]);
  assert.doesNotMatch(JSON.stringify(result),/private-host|private-user|private-password/);
});
