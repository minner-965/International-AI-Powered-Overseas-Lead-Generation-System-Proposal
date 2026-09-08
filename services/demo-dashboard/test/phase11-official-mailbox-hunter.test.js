import test from 'node:test';
import assert from 'node:assert/strict';
import { EnrichmentService } from '../src/enrichment/EnrichmentService.js';

const job={id:'11111111-1111-4111-8111-111111111111'};
const company={id:'22222222-2222-4222-8222-222222222222',official_root_domain:'buyer.example'};
const route={id:'33333333-3333-4333-8333-333333333333',contact_value_normalized:'info@buyer.example',
  source_url:'https://buyer.example/contact',verification_provider:'LOCAL_SYNTAX_DNS',verification_status:'NOT_VERIFIED'};
function fixture(routes,status='VALID'){
  const calls=[],queries=[];
  const pool={query:async(sql,values)=>{
    queries.push({sql:String(sql),values});
    return {rows:String(sql).includes('SELECT dc.*')?routes:[],rowCount:0};
  }};
  const hunter={mode:'FREE_FIRST',capabilities:{enabled:true},verifyEmail:async input=>{
    calls.push(input.email);
    const results=[{verification_status:status,verification_score:status==='VALID'?100:0}];
    const captured_at=new Date();
    await input.persistResults(results,{capturedAt:captured_at});
    return {status:'COMPLETED',results,captured_at,credits:{used:500},usage_event:{id:'44444444-4444-4444-8444-444444444444'}};
  },findEmail:async()=>{throw new Error('Unnamed official route must not use Finder');}};
  return {service:new EnrichmentService({pool,hunter,provider:{},checker:{},linkedIn:{}}),calls,queries};
}
test('official generic mailbox is verified without a named buyer and keeps its original route identity',async()=>{
  const {service,calls,queries}=fixture([route]);
  const result=await service.applyHunter(job,company,{decision_makers:[],observed_contacts:[route]});
  assert.deepEqual(calls,['info@buyer.example']);
  assert.equal(result.calls,1);
  assert.equal(result.used_units,500);
  const update=queries.find(q=>q.sql.startsWith('UPDATE leadgen.decision_maker_contacts'));
  assert.equal(update.values[0],route.id);
  assert.doesNotMatch(update.sql,/SET.*(?:evidence_origin|source_url|contact_type)/s);
  assert.ok(queries.some(q=>q.sql.includes('INSERT INTO leadgen.contact_verification_events')));
});
test('fresh verification, foreign source domains and duplicate routes avoid calls without truncating observed candidates',async()=>{
  const routes=[{...route,verification_provider:'HUNTER',verification_status:'VALID',verification_recorded:true,last_verified_at:new Date()},
    {...route,contact_value_normalized:'wrong@buyer.example',source_url:'https://elsewhere.example'},
    ...Array.from({length:7},(_,i)=>({...route,id:String(i),contact_value_normalized:`team${i}@buyer.example`}))];
  routes.push(routes[2]);
  const {service,calls}=fixture(routes);
  await service.verifyOfficialMailboxes(job,company);
  assert.equal(calls.length,7);
  assert.equal(new Set(calls).size,7);
  assert.ok(!calls.includes('info@buyer.example'));
  assert.ok(!calls.includes('wrong@buyer.example'));
});

test('provider credit capacity still stops official mailbox verification before the next call',async()=>{
  const routes=Array.from({length:7},(_,i)=>({...route,id:String(i),contact_value_normalized:`team${i}@buyer.example`}));
  const {service,calls}=fixture(routes);
  const verify=service.hunter.verifyEmail;
  service.hunter.verifyEmail=async input=>{
    if(calls.length===4)throw Object.assign(new Error('fixture capacity'),{code:'HUNTER_CREDIT_CAP'});
    return verify(input);
  };
  const result=await service.verifyOfficialMailboxes(job,company);
  assert.equal(calls.length,4);
  assert.equal(result.stop_reason,'HUNTER_BUDGET_CAP');
  assert.equal(result.budget_reached,true);
});
test('invalid official mailbox retains invalid result and creates suppression',async()=>{
  const {service,queries}=fixture([route],'INVALID');
  await service.verifyOfficialMailboxes(job,company);
  assert.ok(queries.some(q=>q.sql.includes('INSERT INTO leadgen.contact_suppressions')));
  assert.ok(queries.some(q=>q.values?.[1]==='INVALID'));
});
test('disabled automatic Hunter policy performs no mailbox lookup or external call',async()=>{
  const {service,calls,queries}=fixture([route]);
  await service.applyHunter(job,company,{decision_makers:[],observed_contacts:[route]},{hunterEnabled:false});
  assert.equal(calls.length,0);
  assert.equal(queries.length,0);
});
