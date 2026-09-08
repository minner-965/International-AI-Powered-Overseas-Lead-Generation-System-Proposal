import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSearchHit,SearchHitCorroborationService} from '../src/searchPlanning/SearchHitCorroborationService.js';
const hit={research_candidate_id:'00000000-0000-4000-8000-000000000001',query_fingerprint:'a'.repeat(64),strategy_version:'2',strategy_id:'P01',lane:'PRECISION_LANE',provider:'TAVILY',rank:2,market_id:'ae',category_id:'dresses',language:'EN',observed_at:'2026-09-08T01:00:00Z'};
test('search hit normalizes dimensions but requires observed evidence timestamp',()=>{
 const h=normalizeSearchHit(hit);assert.equal(h.provider,'tavily');assert.equal(h.market_id,'AE');assert.equal(h.language,'en');
 assert.throws(()=>normalizeSearchHit({...hit,observed_at:null}),{code:'SEARCH_HIT_OBSERVATION_TIME_REQUIRED'});
 assert.throws(()=>normalizeSearchHit({...hit,rank:0}),{code:'SEARCH_HIT_INVALID'});
 assert.throws(()=>normalizeSearchHit({...hit,lane:'OTHER'}),{code:'SEARCH_HIT_INVALID'});
});
test('provenance derives candidate identity and never accepts invented company association',async()=>{
 const calls=[];const svc=new SearchHitCorroborationService({pool:{query:async(sql,args)=>{calls.push({sql,args});return calls.length===1?{rows:[{root_domain:'www.Example.test',company_id:null}]}:{rows:[{id:'hit'}],rowCount:1};}}});
 assert.equal((await svc.record({...hit,company_id:'fabricated'})).id,'hit');assert.equal(calls[1].args[1],null);assert.equal(calls[1].args[2],'example.test');
 assert.match(calls[1].sql,/ON CONFLICT/);assert.match(calls[1].sql,/least\(existing\.first_seen/);assert.match(calls[1].sql,/greatest\(existing\.last_seen/);
});
test('unknown candidate and conflicting fingerprint fail without business writes',async()=>{
 await assert.rejects(new SearchHitCorroborationService({pool:{query:async()=>({rows:[]})}}).record(hit),{code:'SEARCH_HIT_CANDIDATE_NOT_FOUND'});
 let call=0;await assert.rejects(new SearchHitCorroborationService({pool:{query:async()=>++call===1?{rows:[{root_domain:'example.test'}]}:{rows:[],rowCount:0}}}).record(hit),{code:'SEARCH_HIT_FINGERPRINT_CONFLICT'});
 const source=readFileSync(new URL('../src/searchPlanning/SearchHitCorroborationService.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/UPDATE leadgen\.(companies|opportunity_pool|business_opportunity|outbound_messages)/);
});
