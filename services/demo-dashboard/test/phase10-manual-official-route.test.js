import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Phase7Repository} from '../src/phase7/repository.js';
import {Phase7Service} from '../src/phase7/service.js';

const U='11111111-1111-4111-8111-111111111111';

test('official route reconciliation requires current official evidence and excludes suppression and customer-history conflict',async()=>{
  let captured='';
  const pool={query:async sql=>{captured=String(sql);return{rows:[{id:U}],rowCount:1};}};
  const result=await new Phase7Repository({pool}).syncManualOfficialRoutes({verificationTtlDays:30,sourceTtlDays:90});
  assert.equal(result.created,1);
  for(const contract of ["evidence_origin='OFFICIAL_SITE_OBSERVED'","verification_status='VERIFIED'",
    "lifecycle_status='ACTIVE'",'company_suppressions','contact_suppressions','INTERNAL_EXISTING_CUSTOMER',
    "dc.source_url~'^https?://'",'official_root_domain','source_id'])assert.match(captured,new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(captured,/SUPPLIER_PORTAL/);assert.match(captured,/VENDOR_REGISTRATION/);assert.match(captured,/CONTACT_FORM/);
  assert.doesNotMatch(captured,/INSERT INTO leadgen\.(?:outbound_messages|outreach_approvals|business_opportunity_management_events)/);
});

test('manual route actions append a revision and require an outcome for terminal states',async()=>{
  const queries=[];
  const current={id:U,task_key:'a'.repeat(64),revision:1,company_id:U,product_profile:'WOMENSWEAR',
    route_type:'CONTACT_FORM',official_url:'https://example.com/contact',official_contact:null,source_id:U,
    verified_at:new Date(),captured_at:new Date(),owner_identity:null,manual_action_status:'READY',qualification_basis:{official_domain_verified:true}};
  const client={query:async(sql,params=[])=>{
    queries.push({sql:String(sql),params});
    if(String(sql).includes('ORDER BY revision DESC'))return{rows:[current],rowCount:1};
    if(String(sql).startsWith('INSERT INTO leadgen.official_route_manual_tasks'))return{rows:[{...current,revision:2,manual_action_status:'IN_PROGRESS'}],rowCount:1};
    return{rows:[],rowCount:0};
  },release(){}};
  const repository=new Phase7Repository({pool:{query:client.query,connect:async()=>client}});
  await assert.rejects(()=>repository.recordManualOfficialRouteAction(U,{status:'COMPLETED',actor:'sales.owner'}),
    error=>error.code==='MANUAL_ROUTE_OUTCOME_REQUIRED');
  const row=await repository.recordManualOfficialRouteAction(U,{status:'IN_PROGRESS',actor:'sales.owner',requestId:'request-1'});
  assert.equal(row.revision,2);assert.equal(row.manual_action_status,'IN_PROGRESS');
  const insert=queries.find(item=>item.sql.startsWith('INSERT INTO leadgen.official_route_manual_tasks'));
  assert.equal(insert.params[1],2);assert.equal(insert.params[2],U);assert.equal(insert.params[11],'sales.owner');
  assert.ok(queries.some(item=>item.sql==='COMMIT'));
});

test('service boundary reports zero automated submissions, sends and approvals',async()=>{
  const pool={query:async()=>({rows:[],rowCount:0})};
  const service=new Phase7Service({pool,env:{CONTACT_VERIFICATION_TTL_DAYS:'30',AUTO_EVIDENCE_SOURCE_TTL_DAYS:'90'}});
  service.repository={
    syncManualOfficialRoutes:async()=>({created:3}),
    recordManualOfficialRouteAction:async()=>({id:U,manual_action_status:'IN_PROGRESS'})
  };
  assert.deepEqual(await service.reconcileManualOfficialRoutes({identity:'data.owner'}),{
    status:'COMPLETED',created:3,provider_calls:0,automatic_submissions:0,messages_sent:0
  });
  const action=await service.recordManualOfficialRouteAction(U,{status:'IN_PROGRESS'},{identity:'sales.owner'});
  assert.equal(action.messages_sent,0);assert.equal(action.management_approvals_created,0);assert.equal(action.automatic_submissions,0);
});

test('manual official route UI reuses Contact Queue and exposes accessible busy and outcome states',async()=>{
  const [html,ui]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/ui/contact-queue.js',import.meta.url),'utf8')
  ]);
  for(const hook of ['manual-official-route-title','manual-official-route-status','manual-official-route-list'])
    assert.match(html,new RegExp(`id="${hook}"`));
  assert.match(html,/location\.protocol==='file:'[^\n]+http:\/\/127\.0\.0\.1:3000\/#opportunities/);
  assert.match(ui,/\/api\/workspace\/manual-official-routes\?status=ACTIVE/);
  assert.match(ui,/\/api\/manual-official-routes\/\$\{button\.dataset\.routeId\}\/actions/);
  assert.match(ui,/aria-live="polite"/);assert.match(ui,/aria-busy/);assert.match(ui,/maxlength="2000" required/);
  assert.doesNotMatch(ui,/outbound|sendApproved|management-approve/);
});

test('workspace queue reads are sanitized and do not expose decision or qualification internals',async()=>{
  const pool={query:async()=>({rows:[],rowCount:0})};
  const service=new Phase7Service({pool});
  service.repository={
    listContactQueue:async()=>[{queue_id:U,queue_status:'ACTIVE',owner_identity:null,company_name:'Example',country_code:'AE',
      product_profile:'WOMENSWEAR',approved_by:'manager',approved_at:'2026-09-03',input_digest:'secret',reason_codes:['INTERNAL']}],
    listManualOfficialRoutes:async()=>[{id:U,company_name:'Example',country_code:'AE',product_profile:'WOMENSWEAR',
      route_type:'CONTACT_FORM',official_url:'https://example.com/contact',official_contact:null,verified_at:'2026-09-03',
      manual_action_status:'READY',qualification_basis:{internal:true},source_id:U,task_key:'a'.repeat(64)}]
  };
  const contact=(await service.listWorkspaceContactQueue())[0];
  const route=(await service.listWorkspaceManualOfficialRoutes())[0];
  assert.equal(contact.input_digest,undefined);assert.equal(contact.reason_codes,undefined);
  assert.equal(route.qualification_basis,undefined);assert.equal(route.source_id,undefined);assert.equal(route.task_key,undefined);
});
