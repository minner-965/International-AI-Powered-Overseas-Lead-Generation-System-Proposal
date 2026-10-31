import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TavilySearchProvider} from '../src/search/TavilySearchProvider.js';
import {TavilyUsageAudit,TavilyUsageLedger} from '../src/search/TavilyUsageAudit.js';
import {EnrichmentService} from '../src/enrichment/EnrichmentService.js';
import {CategoryEvidenceService} from '../src/categoryProcurement/CategoryEvidenceService.js';

test('Tavily supports explicitly chosen basic/advanced with usage requested and automatic escalation off',async()=>{
 for(const depth of ['basic','advanced']){
  let body;
  const provider=new TavilySearchProvider({apiKey:'fixture',searchDepth:depth,fetchImpl:async(_url,options)=>{
   body=JSON.parse(options.body);return new Response(JSON.stringify({results:[],request_id:'fixture'}));
  }});
  const result=await provider.search({query:'fixture company',country:'AE'});
  assert.equal(body.search_depth,depth);assert.equal(body.include_usage,true);assert.equal(body.auto_parameters,false);
  assert.equal(body.include_raw_content,false);assert.equal(body.include_answer,false);
  assert.equal(result.searchDepth,depth);assert.equal(result.credits,depth==='advanced'?2:1);assert.equal(result.creditsSource,'depth_estimate');
 }
});

test('Tavily records provider-reported credits including zero rather than replacing them with an estimate',async()=>{
 for(const credits of [0,2,3]){
  const provider=new TavilySearchProvider({apiKey:'fixture',searchDepth:'advanced',fetchImpl:async()=>new Response(JSON.stringify({results:[],usage:{credits}}))});
  const result=await provider.search({query:'fixture'});assert.equal(result.credits,credits);assert.equal(result.creditsSource,'provider_reported');
 }
 for(const credits of [null,'',' ',false,-1,'unknown']){
  const provider=new TavilySearchProvider({apiKey:'fixture',searchDepth:'advanced',fetchImpl:async()=>new Response(JSON.stringify({results:[],usage:{credits}}))});
  const result=await provider.search({query:'fixture'});assert.equal(result.credits,2);assert.equal(result.creditsSource,'depth_estimate');
 }
});

test('dual-search evidence services route to advanced while injection and disabled-rollout behavior are preserved',()=>{
 const searchConfig={provider:'brave',dualSearchEnabled:true,tavilyApiKey:'fixture',tavilySearchDepth:'basic'};
 const options={pool:{},searchConfig,checker:{},hunter:{},linkedIn:{}};
 for(const Service of [EnrichmentService,CategoryEvidenceService]){
  const service=new Service(options);assert.equal(service.provider.name,'tavily');assert.equal(service.provider.searchDepth,'advanced');
  const legacy=new Service({...options,searchConfig:{...searchConfig,dualSearchEnabled:false}});assert.equal(legacy.provider.name,'brave');
  const fixture={name:'isolated-fixture'};assert.equal(new Service({...options,provider:fixture}).provider,fixture);
 }
 assert.equal(searchConfig.provider,'brave');assert.equal(searchConfig.tavilySearchDepth,'basic');
});

test('contact discovery retains legacy audit purpose for replay independently of router purpose',async()=>{
 const seen=[];
 const service=new EnrichmentService({pool:{query:async()=>({rows:[]})},provider:{name:'tavily'},checker:{},hunter:{},linkedIn:{},
  searchAudit:{search:async input=>{seen.push(input);return{results:[]};}}});
 service.persistQuery=async()=>({id:'fixture-query',query_text:'fixture',query_type:'fixture'});
 const result=await service.runSearchQueries({id:'fixture-job'},{id:'fixture-company',country_code:'AE',active_product_profiles:['WOMENSWEAR']},{strategy:{query_text:'fixture'}});
 assert.equal(result.failures,0);assert.equal(seen.length,1);assert.equal(seen[0].purpose,'DECISION_MAKER_DISCOVERY');
});

test('category evidence retains legacy audit purpose for replay and skips network when disabled',async()=>{
 const seen=[];
 const pool={query:async sql=>sql.includes('SELECT id,company_name')?{rowCount:1,rows:[{id:'fixture-company',company_name:'Fixture',country_code:'AE'}]}:{rowCount:1,rows:[{id:'fixture-query',sources:0,observations:0}]}};
 const service=new CategoryEvidenceService({pool,provider:{name:'tavily'},checker:{},searchAudit:{search:async input=>{seen.push(input);return{results:[]};}}});
 service.backfillPhase4Evidence=async()=>({sources:0,observations:0});
 const input={researchJobId:'fixture-job',companyId:'fixture-company',productProfile:'WOMENSWEAR',strategy:{query_text:'fixture'}};
 await service.collect(input);assert.equal(seen.length,1);assert.equal(seen[0].purpose,'CATEGORY_BUYER_EVIDENCE');
 await service.collect({...input,tavilyEnabled:false});assert.equal(seen.length,1);
});

test('company verification routes explicitly while preserving historical social provenance and crawler rules',()=>{
 const source=readFileSync(new URL('../src/verification/companyVerificationService.js',import.meta.url),'utf8');
 assert.match(source,/createPurposeSearchProvider\(\{ \.\.\.config\.searchConfig, provider: 'tavily' \}, 'COMPANY_VERIFICATION'\)/);
 assert.match(source,/purpose:'COMPANY_SOCIAL_EVIDENCE'/);
 assert.match(source,/source_type NOT IN\('TAVILY_BASIC_SEARCH','TAVILY_ADVANCED_SEARCH'\)/);
 assert.match(source,/provider\.searchDepth === 'advanced' \? 'TAVILY_ADVANCED_SEARCH' : 'TAVILY_BASIC_SEARCH'/);
 assert.match(source,/checker\.robotsAllows\(url\)/);assert.match(source,/decideCandidateVerification\(\{\s*evidence, contacts, officialConfidence: official\.confidence/);
 // Batch 3 C1: the verification decision moved into the pure rule module.
 const rules=readFileSync(new URL('../src/verification/verificationRules.js',import.meta.url),'utf8');
 assert.match(rules,/Number\(officialConfidence\) >= 0\.7/);assert.match(rules,/identity && location && officialOk && materialBusiness/);
});

test('all three legacy audit fingerprints replay without charging; advanced depth is independently keyed',async()=>{
 for(const purpose of ['CATEGORY_BUYER_EVIDENCE','DECISION_MAKER_DISCOVERY','COMPANY_SOCIAL_EVIDENCE']){
  const ledger=new TavilyUsageLedger();
  const request={query:'fixture company',count:5,country:'AE',countryName:'United Arab Emirates'};
  const input={researchJobId:'fixture-job',companyId:'fixture-company',purpose,endpoint:'api.tavily.com/search',request};
  // Exact pre-router basic fingerprint shape. A purpose rename would invalidate this receipt.
  const legacyHash=createHash('sha256').update(JSON.stringify({research_job_id:input.researchJobId,company_id:input.companyId,
   purpose,endpoint:input.endpoint,request:{query:request.query,count:5,country:'AE',country_name:request.countryName}})).digest('hex');
  const claim=await ledger.claim(input);assert.equal(claim.request_fingerprint,legacyHash);
  await ledger.settle(claim,{usedUnits:1,status:'NOT_FOUND',providerRequestId:'legacy-receipt',resultCount:0});
  let calls=0;
  const provider={name:'tavily',endpoint:'https://api.tavily.com/search',searchDepth:'basic',search:async()=>{calls+=1;return{requestId:'advanced-receipt',credits:2,results:[]};}};
  const audit=new TavilyUsageAudit({provider,ledger});
  const replay=await audit.search(input);assert.equal(replay.replay,true);assert.equal(calls,0);assert.equal(replay.requestId,'legacy-receipt');
  provider.searchDepth='advanced';
  const advanced=await audit.search(input);assert.equal(calls,1);assert.notEqual(advanced.usage_event.request_fingerprint,legacyHash);
  const advancedReplay=await audit.search(input);assert.equal(advancedReplay.replay,true);assert.equal(calls,1);
 }
});
