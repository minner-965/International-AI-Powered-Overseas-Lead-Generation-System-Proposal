import assert from 'node:assert/strict';
import test from 'node:test';
import { EnrichmentService } from '../src/enrichment/EnrichmentService.js';

const job={id:'11111111-1111-4111-8111-111111111111'};
const company={id:'22222222-2222-4222-8222-222222222222',official_root_domain:'buyer.example',website_url:'https://buyer.example'};
const findings={decision_makers:[{
  id:'33333333-3333-4333-8333-333333333333',person_name:'Avery Buyer',verification_status:'VERIFIED',
  normalized_role:'SENIOR_BUYER'
}]};

function serviceFor({finder,verifier}){
  const queries=[];
  const client={
    async query(sql){queries.push(String(sql));return {rowCount:1,rows:[{id:'44444444-4444-4444-8444-444444444444'}]};},
    release(){}
  };
  const pool={connect:async()=>client};
  const hunter={mode:'FREE_FIRST',capabilities:{enabled:true,mode:'FREE_FIRST'},findEmail:finder,verifyEmail:verifier};
  const service=new EnrichmentService({pool,hunter,provider:{name:'fixture'},checker:{},linkedIn:{}});
  service.upsertContact=async(_client,_jobId,_decisionMakerId,contact)=>{
    service.persistedContact=contact;
    return {id:'44444444-4444-4444-8444-444444444444'};
  };
  return {service,queries};
}

test('verified profile buyer follows Finder then Verifier and ACCEPT_ALL remains evidence required',async()=>{
  const calls=[];
  const {service,queries}=serviceFor({
    finder:async()=>{calls.push('finder');return {status:'COMPLETED',credits:{used:1000},results:[{email:'buyer@buyer.example',verification_status:'VALID',verification_score:90}]};},
    verifier:async()=>{calls.push('verifier');return {status:'COMPLETED',captured_at:new Date('2026-08-31T00:00:00Z'),credits:{used:500},
      usage_event:{id:'55555555-5555-4555-8555-555555555555'},results:[{verification_status:'ACCEPT_ALL',verification_score:82}]};}
  });
  const result=await service.applyHunter(job,company,findings);
  assert.deepEqual(calls,['finder','verifier']);
  assert.equal(result.calls,2);
  assert.equal(result.used_units,1500);
  assert.equal(service.persistedContact.verification_status,'ACCEPT_ALL');
  assert.equal(queries.some(sql=>sql.includes('contact_verification_events')),true);
  assert.equal(queries.some(sql=>sql.includes('contact_suppressions')),false);
});

test('INVALID verification creates an exact contact-level suppression',async()=>{
  const {service,queries}=serviceFor({
    finder:async()=>({status:'COMPLETED',credits:{used:1000},results:[{email:'buyer@buyer.example'}]}),
    verifier:async()=>({status:'COMPLETED',captured_at:new Date(),credits:{used:500},usage_event:{id:'55555555-5555-4555-8555-555555555555'},
      results:[{verification_status:'INVALID',verification_score:0}]})
  });
  await service.applyHunter(job,company,findings);
  assert.equal(service.persistedContact.verification_status,'INVALID');
  assert.equal(queries.some(sql=>sql.includes('contact_suppressions')),true);
});

test('temporary verification error remains temporary and never creates an INVALID suppression',async()=>{
  const {service,queries}=serviceFor({
    finder:async()=>({status:'COMPLETED',credits:{used:1000},results:[{email:'buyer@buyer.example'}]}),
    verifier:async()=>({status:'TEMPORARY_ERROR',error_code:'TIMEOUT',credits:{used:0},usage_event:{id:'55555555-5555-4555-8555-555555555555'},results:[]})
  });
  const result=await service.applyHunter(job,company,findings);
  assert.equal(result.temporary_error,true);
  assert.equal(service.persistedContact.verification_status,'TEMPORARY_ERROR');
  assert.equal(queries.some(sql=>sql.includes('contact_suppressions')),false);
});

test('credit cap becomes a deterministic batch stop reason before later network work',async()=>{
  const error=Object.assign(new Error('cap'),{code:'HUNTER_CREDIT_CAP'});
  const {service}=serviceFor({finder:async()=>{throw error;},verifier:async()=>{throw new Error('unexpected');}});
  const result=await service.applyHunter(job,company,findings);
  assert.equal(result.stop_reason,'HUNTER_BUDGET_CAP');
  assert.equal(result.budget_reached,true);
  assert.equal(result.calls,0);
});

test('a verified executive or general contact is not treated as a profile buyer',async()=>{
  let calls=0;
  const {service}=serviceFor({finder:async()=>{calls+=1;return {};},verifier:async()=>{calls+=1;return {};}});
  const result=await service.applyHunter(job,company,{decision_makers:[{...findings.decision_makers[0],normalized_role:'EXECUTIVE'}]});
  assert.equal(calls,0);
  assert.equal(result.calls,0);
});
