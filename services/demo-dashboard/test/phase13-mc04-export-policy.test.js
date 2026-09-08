import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveExportRequest,projectExportRow,outreachExportValue,OUTREACH_EXPORT_LABELS} from '../src/dataExchange/exportPolicy.js';
const columns=['opportunity_pool_band','is_active_business_opportunity','contact_readiness','email_send_eligibility','review_flags'];
const request={exportType:'SALES_OPPORTUNITY',format:'CSV',mode:'CURRENT_FILTER',requesterRole:'SALES',columns};
test('MC04 exports separate business/contact/email/review dimensions with bilingual labels',()=>{
 const resolved=resolveExportRequest(request);assert.deepEqual(resolved.columns,columns);
 for(const key of columns)assert.match(OUTREACH_EXPORT_LABELS[key],/ \/ /);
 assert.match(outreachExportValue('PRECISION'),/Precision/);assert.match(outreachExportValue(['NO_CONTACT_FOUND'],'contact_readiness'),/No contact found/);
 assert.match(outreachExportValue('NOT_EVALUATED_FOR_SEND'),/pending review/);
 assert.equal(outreachExportValue(['UNRESOLVED_INTERNAL_REASON'],'review_flags'),'待复核 / Review required');
});
test('MC04 columns do not loosen formula or finance protections',()=>{
 assert.match(projectExportRow({review_flags:'=HYPERLINK("x")'},resolveExportRequest(request)).review_flags,/^'/);
 assert.throws(()=>resolveExportRequest({...request,columns:[...columns,'supplier_cost']}),/not permitted/);
 assert.throws(()=>resolveExportRequest({...request,columns:['api_key']}),/not permitted/);
});
