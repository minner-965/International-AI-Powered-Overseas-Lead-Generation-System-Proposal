import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FEISHU_LABELS, FeishuBitableAdapter, buildFeishuFields, clientTokenFor, feishuConfigured, loadFeishuFieldMap } from '../src/crm/feishuBitableAdapter.js';
import { renderFollowupTemplate, FOLLOWUP_TEMPLATES } from '../src/crm/followupTemplates.js';
import { CrmService } from '../src/crm/service.js';
import { Phase7Service } from '../src/phase7/service.js';

const ENV=Object.freeze({FEISHU_APP_ID:'cli_test',FEISHU_APP_SECRET:'secret',FEISHU_BITABLE_APP_TOKEN:'bascnTest',FEISHU_BITABLE_TABLE_ID:'tblTest'});
const OUTBOX=Object.freeze({id:'66666666-6666-4666-8666-666666666666',idempotency_key:'crm:activity:abc',operation:'UPDATE_ACTIVITY',created_at:'2026-10-20T08:00:00.000Z'});

function fakeFetch(responses){
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init,body:init.body?JSON.parse(init.body):null});
    const next=responses.shift();
    if(!next)throw new Error('unexpected request');
    return{status:next.status??200,json:async()=>next.json,headers:{get:()=>next.retryAfter??null}};
  };
  return{fetchImpl,calls};
}
const tokenOk={json:{code:0,tenant_access_token:'t-1',expire:7200}};

test('Feishu adapter is configured only when all four settings are real values',()=>{
  assert.equal(feishuConfigured(ENV),true);
  assert.equal(feishuConfigured({...ENV,FEISHU_APP_SECRET:''}),false);
  assert.equal(feishuConfigured({...ENV,FEISHU_BITABLE_TABLE_ID:'REPLACE_WITH_TABLE'}),false);
});

test('client_token is a stable UUID v4 derived from the outbox key',()=>{
  const token=clientTokenFor('crm:activity:abc');
  assert.match(token,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(clientTokenFor('crm:activity:abc'),token);assert.notEqual(clientTokenFor('crm:activity:abd'),token);
});

test('field map turns an outbox payload into named Bitable columns with date columns as milliseconds',()=>{
  const fields=buildFeishuFields({outbox:OUTBOX,company:{company_name:'Al Noor Fashion Trading LLC',country_code:'AE'},
    payload:{activity_type:'CALL',summary:'Discussed linen dresses',owner:'li.na',occurred_at:'2026-10-21T08:30:00.000Z',source_reference:'activity=1'}},loadFeishuFieldMap());
  assert.equal(fields['同步编号'],'crm:activity:abc');assert.equal(fields['企业'],'Al Noor Fashion Trading LLC');
  assert.equal(fields['事项'],'电话');assert.equal(fields['记录类型'],'跟进活动');assert.equal(fields['记录时间'],Date.parse('2026-10-21T08:30:00.000Z'));
  assert.equal(Object.hasOwn(fields,'截止时间'),false);
});

test('adapter appends one record, reuses the tenant token and returns the record id',async()=>{
  const {fetchImpl,calls}=fakeFetch([tokenOk,{json:{code:0,data:{record:{record_id:'rec1'}}}},{json:{code:0,data:{record:{record_id:'rec2'}}}}]);
  const adapter=new FeishuBitableAdapter({env:ENV,fetchImpl});
  const first=await adapter.sync({outbox:OUTBOX,payload:{activity_type:'CALL',summary:'x'},company:null});
  const second=await adapter.sync({outbox:{...OUTBOX,idempotency_key:'crm:activity:def'},payload:{activity_type:'NOTE',summary:'y'},company:null});
  assert.deepEqual([first.status,first.external_record_id,first.network_calls],['SYNCED','rec1',2]);
  assert.deepEqual([second.external_record_id,second.network_calls],['rec2',1]);
  assert.match(calls[1].url,/\/open-apis\/bitable\/v1\/apps\/bascnTest\/tables\/tblTest\/records\?client_token=/);
  assert.equal(calls[1].init.headers.authorization,'Bearer t-1');assert.ok(calls[1].body.fields);
});

test('adapter refreshes an expired token once and classifies retryable and permanent failures',async()=>{
  const refreshed=fakeFetch([tokenOk,{json:{code:99991663}},{json:{code:0,tenant_access_token:'t-2',expire:7200}},{json:{code:0,data:{record:{record_id:'rec9'}}}}]);
  const ok=await new FeishuBitableAdapter({env:ENV,fetchImpl:refreshed.fetchImpl}).sync({outbox:OUTBOX,payload:{},company:null});
  assert.equal(ok.external_record_id,'rec9');assert.equal(refreshed.calls[3].init.headers.authorization,'Bearer t-2');
  const limited=fakeFetch([tokenOk,{status:429,json:{code:99991400},retryAfter:'120'}]);
  const busy=await new FeishuBitableAdapter({env:ENV,fetchImpl:limited.fetchImpl}).sync({outbox:OUTBOX,payload:{},company:null});
  assert.deepEqual([busy.status,busy.retryable,busy.retry_after_seconds],['FAILED',true,120]);
  const badField=fakeFetch([tokenOk,{json:{code:1254045}}]);
  const field=await new FeishuBitableAdapter({env:ENV,fetchImpl:badField.fetchImpl}).sync({outbox:OUTBOX,payload:{},company:null});
  assert.deepEqual([field.retryable,field.code],[false,'FEISHU_1254045']);
  const authFail=fakeFetch([{json:{code:10014}}]);
  const auth=await new FeishuBitableAdapter({env:ENV,fetchImpl:authFail.fetchImpl}).sync({outbox:OUTBOX,payload:{},company:null});
  assert.deepEqual([auth.status,auth.code,auth.network_calls],['FAILED','FEISHU_AUTH_10014',1]);
});

test('CRM worker routes to Feishu and keeps unconfigured Feishu retryable without network calls',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[{company_name:'Acme',country_code:'AE'}]})},env:{CRM_PROVIDER:'feishu'}});
  const writes=[];
  service.repository={getCrmOutbox:async()=>({record_scope:'PROSPECT'}),
    claimCrmOutbox:async()=>({claimed:true,outbox:{...OUTBOX,company_id:'33333333-3333-4333-8333-333333333333',payload:{activity_type:'CALL',summary:'x'}}}),
    failCrmOutbox:async(id,input)=>{writes.push(['fail',input]);return{id,sync_status:'RETRYABLE_ERROR',attempt_count:1};},
    completeCrmOutbox:async(id,input)=>{writes.push(['complete',input]);return{id,sync_status:'SYNCED',attempt_count:1};}};
  const unconfigured=await service.processCrmSyncWork({outbox_id:OUTBOX.id});
  assert.equal(unconfigured.configuration_status,'ADAPTER_NOT_CONFIGURED');assert.equal(unconfigured.network_calls,0);
  service.env={CRM_PROVIDER:'feishu',...ENV};
  const {fetchImpl}=fakeFetch([tokenOk,{json:{code:0,data:{record:{record_id:'rec5'}}}}]);
  service.feishuAdapter=new FeishuBitableAdapter({env:service.env,fetchImpl});
  const synced=await service.processCrmSyncWork({outbox_id:OUTBOX.id});
  assert.equal(synced.status,'SYNCED');assert.deepEqual(writes.at(-1),['complete',{externalRecordId:'rec5'}]);
});

test('follow-up templates fill every placeholder, avoid reply prefixes and never quote commercial terms',()=>{
  for(const sequence of Object.keys(FOLLOWUP_TEMPLATES)){
    const draft=renderFollowupTemplate({sequence_no:sequence,company_name:'Al Noor Fashion Trading LLC',product_profile:'WOMENSWEAR',reply_to:'simon@dpv.example'});
    assert.doesNotMatch(`${draft.subject}\n${draft.body_text}`,/\[[A-Za-z -]+\]/);
    assert.doesNotMatch(draft.subject,/^(Re|Fwd?):/i);
    assert.doesNotMatch(draft.body_text,/\b(price|MOQ|lead time|payment terms|certif)/i);
    assert.match(draft.body_text,/simon@dpv\.example/);assert.match(draft.subject,/^[A-Z]/);
  }
  assert.throws(()=>renderFollowupTemplate({sequence_no:5,company_name:'A',reply_to:'a@b.c'}),{code:'CRM_FOLLOWUP_SEQUENCE_INVALID'});
  assert.throws(()=>renderFollowupTemplate({sequence_no:2,company_name:'',reply_to:'a@b.c'}),{code:'CRM_FOLLOWUP_VARIABLES_MISSING'});
});

test('CRM service validates input before touching storage',async()=>{
  const touched=[];
  const repository=new Proxy({},{get:(_target,name)=>async()=>{touched.push(name);return{};}});
  const service=new CrmService({repository,env:{}});const user={identity:'li.na',role:'SALES'};
  const id='44444444-4444-4444-8444-444444444444';
  await assert.rejects(()=>service.setStage('not-a-uuid',{stage:'QUOTED'},user),{code:'CRM_INVALID_ID',status:400});
  await assert.rejects(()=>service.setStage(id,{stage:'SHIPPED'},user),{code:'CRM_VALUE_INVALID'});
  await assert.rejects(()=>service.setStage(id,{stage:'LOST'},user),{code:'CRM_LOST_REASON_REQUIRED'});
  await assert.rejects(()=>service.addActivity(id,{activity_type:'CALL'},user),{code:'CRM_FIELD_REQUIRED'});
  await assert.rejects(()=>service.addActivity(id,{activity_type:'CALL',summary:'x',occurred_at:'2099-01-01'},user),{code:'CRM_DATE_INVALID'});
  await assert.rejects(()=>service.addActivity(id,{activity_type:'CONTACTED',summary:'x'},user),{code:'CRM_VALUE_INVALID'});
  await assert.rejects(()=>service.updateTask(id,{},user),{code:'CRM_NO_CHANGE'});
  await assert.rejects(()=>service.reviewReply(id,{decision:'CORRECT'},user),{code:'CRM_VALUE_INVALID'});
  await assert.rejects(()=>service.setStage(id,{stage:'QUOTED'},{}),{code:'CRM_FIELD_REQUIRED'});
  assert.deepEqual(touched,[]);
  assert.deepEqual(await service.scanFollowups(),{status:'DISABLED',created:0});
});

test('follow-up sending waits while SIM sender is paused and the scan never sends',async()=>{
  const pool={query:async()=>({rows:[{merchant_id:null}],rowCount:1})};
  const service=new CrmService({pool,repository:{},env:{},automationControl:{getState:async()=>({auto_first_touch_email:false,sim_sender_paused:true})},outboundProvider:{senderEmail:'s@dpv.example'}});
  assert.deepEqual(await service.sendApprovedFollowup({draft_id:'44444444-4444-4444-8444-444444444444'}),
    {status:'WAITING',code:'EMAIL_PAUSED',draft_id:'44444444-4444-4444-8444-444444444444'});
  const source=await readFile(new URL('../src/crm/service.js',import.meta.url),'utf8');
  const scan=source.slice(source.indexOf('async scanFollowups'),source.indexOf('async sendApprovedFollowup'));
  assert.doesNotMatch(scan,/outboundProvider|\.send\(/);
});

test('CRM routes are mounted with role guards and the scan queue is opt-in',async()=>{
  const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const router=await readFile(new URL('../src/crm/router.js',import.meta.url),'utf8');
  const queue=await readFile(new URL('../src/jobs/phase5Queue.js',import.meta.url),'utf8');
  assert.match(server,/app\.use\('\/api\/crm',createCrmRouter/);
  assert.match(router,/followup-drafts\/:id\/decision',\.\.\.approve/);
  for(const line of router.split('\n').filter(value=>/router\.(post|patch)\(/.test(value)))assert.match(line,/\.\.\.(salesWrite|approve)/);
  assert.match(queue,/booleanEnv\(env\.CRM_FOLLOWUP_DRAFTS_ENABLED,false\)/);
});

test('Feishu rows use the business labels of the import template',()=>{
  const map=loadFeishuFieldMap();
  const row=(operation,payload)=>buildFeishuFields({outbox:{...OUTBOX,operation},payload,company:null},map);
  assert.deepEqual([row('UPDATE_ACTIVITY',{activity_type:'CONTACTED',summary:'First-touch email sent'})['事项'],row('UPDATE_ACTIVITY',{activity_type:'CONTACTED',summary:'First-touch email sent'})['内容']],['已发开发信','已发送开发信']);
  assert.equal(row('UPDATE_ACTIVITY',{activity_type:'CONTACTED',summary:'Follow-up email 3 sent'})['事项'],'已发跟进邮件');
  assert.equal(row('UPDATE_ACTIVITY',{activity_type:'REPLIED',summary:'Reply received: HUMAN_POSITIVE'})['内容'],'收到客户回复');
  assert.deepEqual([row('CREATE_TASK',{task_type:'QUOTATION'})['记录类型'],row('CREATE_TASK',{task_type:'QUOTATION'})['事项']],['新任务','报价']);
  assert.equal(row('CREATE_TASK',{task_type:'MEETING'})['事项'],'会议安排');
  assert.deepEqual([row('UPDATE_OPPORTUNITY',{stage:'NEGOTIATING'})['记录类型'],row('UPDATE_OPPORTUNITY',{stage:'NEGOTIATING'})['阶段']],['阶段变化','洽谈']);
  assert.equal(row('UPDATE_ACTIVITY',{activity_type:'CALL',summary:'客户要求周五再联系'})['内容'],'客户要求周五再联系');
  assert.equal(Object.keys(FEISHU_LABELS.stage).length,8);
});
