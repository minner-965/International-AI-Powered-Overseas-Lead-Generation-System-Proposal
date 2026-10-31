// Batch 3 integration: the model-assist hooks at their four call sites. With model assist off (the default)
// or in SHADOW mode every result and every database write is exactly the rule-only one; in ASSIST mode a
// hook can only add evidence or downgrade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelAssistHooks} from '../src/llm/hooks.js';
import {CategoryEvidenceService} from '../src/categoryProcurement/CategoryEvidenceService.js';
import {verifyResearchCandidates} from '../src/verification/companyVerificationService.js';
import {OpportunityPoolService,MODEL_ATTRIBUTION_REVIEW_FLAG,applyAttributionReview} from '../src/opportunityPool/OpportunityPoolService.js';
import {Phase7Service} from '../src/phase7/service.js';

const UUID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const isWrite=sql=>/^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
const plain=value=>JSON.parse(JSON.stringify(value));

// Assist doubles: the real hook layer around a run() that answers like ModelAssistService.
const offAssist={calls:0,async run(){this.calls++;return{ran:false,code:'LLM_ASSIST_OFF'};}};
const shadowAssist=items=>({async run(task){return{ran:true,task,mode:'SHADOW',extraction_version:'llm-test-v1',items,accepted:items,review:[],usable:[]};}});
const assistMode=(items,extra={})=>({async run(task){return{ran:true,task,mode:'ASSIST',extraction_version:'llm-test-v1',items,accepted:items,review:[],usable:items,...extra};}});
const hooksFor=assist=>assist?createModelAssistHooks({assist,log:null}):null;
const accepted=(item,quote,confidence=0.92,id=UUID(900))=>({evidence_id:id,status:'ACCEPTED',item,quote,confidence});

// ---------------------------------------------------------------- T1 afterPageCrawl
const PAGE='<html><body><p>Our stores sell women dresses, blouses and skirts.</p></body></html>';
function categoryHarness(hooks){
  const writes=[];
  const pool={async query(sql,params=[]){
    if(isWrite(sql))writes.push([sql.replace(/\s+/g,' ').trim(),plain(params)]);
    if(sql.includes('SELECT id,company_name'))return{rowCount:1,rows:[{id:UUID(1),company_name:'Fixture Fashion',country_code:'AE',country_name:'United Arab Emirates',website_url:'https://fixture-fashion.example/',official_root_domain:'fixture-fashion.example'}]};
    if(sql.includes('INSERT INTO leadgen.prospect_category_sources'))return{rowCount:1,rows:[{id:UUID(50),research_job_id:UUID(2),company_id:UUID(1),source_authority:params[4],captured_at:params[6],published_at:null}]};
    if(sql.includes('INSERT INTO leadgen.prospect_category_observations'))return{rowCount:1,rows:[{id:UUID(60)}]};
    if(sql.includes('SELECT merchant_id FROM leadgen.research_jobs'))return{rowCount:1,rows:[{merchant_id:null}]};
    if(sql.includes('dpv_product_category_scope_current'))return{rowCount:1,rows:[{code:'DRESSES',profile:'WOMENSWEAR',names:['dresses','vestidos']}]};
    if(sql.includes('count(*)::int FROM leadgen.prospect_category_sources'))return{rowCount:1,rows:[{sources:1,observations:writes.filter(([s])=>s.includes('prospect_category_observations')).length}]};
    return{rowCount:0,rows:[]};
  }};
  const checker={async robotsAllows(){return true;},async fetchPage(url){return{reachable:true,html:PAGE,final_url:url,captured_at:new Date('2026-10-01T00:00:00Z'),page_title:'Shop'};}};
  const service=new CategoryEvidenceService({pool,provider:{name:'tavily'},checker,searchAudit:{search:async()=>({results:[]})},
    aliasRefresher:{refresh:async()=>{}},maxPagesPerCompany:1,modelAssistHooks:hooks});
  service.backfillPhase4Evidence=async()=>({sources:0,observations:0});
  return{service,writes};
}
const collectInput={researchJobId:UUID(2),companyId:UUID(1),productProfile:'WOMENSWEAR',tavilyEnabled:false,strategy:{query_text:'fixture'}};

test('T1 afterPageCrawl: off and SHADOW give the rule-only result and writes; ASSIST adds one observation',async()=>{
  const base=categoryHarness(null);const baseResult=await base.service.collect(collectInput);
  assert.ok(base.writes.length>=2,'rule path wrote the source and its observations');
  const t1=accepted({code:'DRESSES',raw_category:'Dresses',profile:'WOMENSWEAR',activity:'RETAIL',product_examples:[]},'Our stores sell women dresses');
  for(const assist of [offAssist,shadowAssist([t1])]){
    const run=categoryHarness(hooksFor(assist));
    assert.deepEqual(await run.service.collect(collectInput),baseResult);
    assert.deepEqual(run.writes,base.writes);
  }
  const assisted=categoryHarness(hooksFor(assistMode([t1])));
  const result=await assisted.service.collect(collectInput);
  const extra=assisted.writes.slice(base.writes.length);
  assert.equal(extra.length,1);assert.deepEqual(assisted.writes.slice(0,base.writes.length),base.writes);
  const params=extra[0][1];
  assert.equal(params[3],'PRODUCT_CATEGORY');assert.equal(params[8],'DRESSES');assert.equal(params[10],'OWN_RETAIL');
  assert.equal(params[13],'VERIFIED');assert.equal(params[17],'llm-test-v1');assert.equal(params[11],'Our stores sell women dresses');
  assert.equal(result.observations_inserted,baseResult.observations_inserted+1);
  // "OTHER" categories stay REVIEW; a hook failure never changes the rule result.
  const other=categoryHarness(hooksFor(assistMode([accepted({code:'OTHER',raw_category:'Swimwear',profile:'WOMENSWEAR',activity:'UNCLEAR',product_examples:[]},'women dresses')])));
  await other.service.collect(collectInput);assert.equal(other.writes.at(-1)[1][13],'REVIEW');assert.equal(other.writes.at(-1)[1][8],null);
  const failing=categoryHarness(hooksFor({async run(){throw new Error('model down');}}));
  assert.deepEqual(await failing.service.collect(collectInput),baseResult);assert.deepEqual(failing.writes,base.writes);
});

// ---------------------------------------------------------------- T2 checkBuyerType
const VERIFY_PAGE=`<html><head><title>Gulf Trading LLC</title></head><body><h1>Gulf Trading LLC</h1>
<p>Gulf Trading LLC is a wholesale distributor of women's apparel based in Dubai, United Arab Emirates.</p>
<p>We supply retailers across the UAE. Contact us: sales@gulf-trading.example</p></body></html>`;
function verifyHarness(){
  const writes=[];let evidenceId=0;
  const query=async(sql,params=[])=>{
    if(isWrite(sql))writes.push([sql.replace(/\s+/g,' ').trim(),plain(params.map(value=>value instanceof Date?'DATE':value))]);
    if(sql.includes('FROM leadgen.research_jobs WHERE id'))return{rowCount:1,rows:[{id:UUID(2),country:'United Arab Emirates',country_name:'United Arab Emirates',country_code:'AE',city:'Dubai',product_category:'WOMENSWEAR',merchant_id:null}]};
    if(sql.includes('FROM leadgen.research_candidates WHERE research_job_id'))return{rowCount:1,rows:[{id:UUID(3),research_job_id:UUID(2),title:'Gulf Trading LLC',url:'https://gulf-trading.example/',final_url:'https://gulf-trading.example/',candidate_type:'COMPANY_WEBSITE',rank:1}]};
    if(sql.includes('INSERT INTO leadgen.research_candidate_verifications'))return{rowCount:1,rows:[{id:UUID(4)}]};
    if(sql.includes('INSERT INTO leadgen.company_verification_evidence')){evidenceId++;
      return{rowCount:1,rows:[{id:UUID(100+evidenceId),evidence_type:params[3],evidence_value:params[4],evidence_text:params[5],source_type:params[6],source_url:params[7],confidence:Number(params[9]),verification_method:params[10]}]};}
    if(sql.includes('count(*)::int AS count'))return{rowCount:1,rows:[{count:0}]};
    return{rowCount:0,rows:[]};
  };
  const client={query,release(){}};
  const pool={query,async connect(){return client;}};
  const checker={async robotsAllows(){return true;},async fetchPage(url){return{reachable:true,html:VERIFY_PAGE,final_url:url,captured_at:'2026-10-01T00:00:00.000Z',page_title:'Gulf Trading LLC'};}};
  return{pool,checker,writes};
}
const verifyConfig={maxPages:1,delayMs:0,promote:false,allowSocialSearch:false};
const statusOf=result=>result.results[0].verification_status;

test('T2 checkBuyerType: off and SHADOW are identical to rules; ASSIST adds capped evidence and never raises the outcome',async()=>{
  const base=verifyHarness();const baseResult=await verifyResearchCandidates(base.pool,UUID(2),verifyConfig,{checker:base.checker});
  const t2=accepted({kind:'BUYER_TYPE',buyer_type:'RETAIL_CHAIN',source_url:'https://gulf-trading.example/'},'We supply retailers across the UAE');
  for(const assist of [offAssist,shadowAssist([t2])]){
    const run=verifyHarness();
    const result=await verifyResearchCandidates(run.pool,UUID(2),verifyConfig,{checker:run.checker,modelAssistHooks:hooksFor(assist)});
    assert.deepEqual(result,baseResult);assert.deepEqual(run.writes,base.writes);
  }
  const run=verifyHarness();
  const result=await verifyResearchCandidates(run.pool,UUID(2),verifyConfig,{checker:run.checker,modelAssistHooks:hooksFor(assistMode([t2]))});
  const modelRows=run.writes.filter(([sql,params])=>sql.includes('company_verification_evidence')&&params[6]==='MODEL_ASSIST_OFFICIAL_PAGE');
  assert.equal(modelRows.length,1);assert.equal(modelRows[0][1][3],'RETAIL_CHAIN');assert.ok(modelRows[0][1][9]<=0.85);
  assert.match(modelRows[0][1][10],/^MODEL_ASSIST_T2:/);
  const rank={REJECTED:0,REVIEW:1,VERIFIED_BUSINESS:2};
  assert.ok(rank[statusOf(result)]<=rank[statusOf(baseResult)],'model evidence never raises the verification outcome');
});

// ---------------------------------------------------------------- T3 checkAttribution
function poolHarness(){
  const inserts=[];
  const evidence=[{id:UUID(201),company_id:UUID(1),evidence_type:'WHOLESALER',evidence_text:'We are a wholesale distributor of apparel',source_url:'https://acme.example/about',source_type:'OFFICIAL_WEBSITE',confidence:0.95}];
  const company={id:UUID(1),company_name:'Acme Wholesale',verification_status:'VERIFIED',country_code:'AE',website_url:'https://acme.example/',official_root_domain:'acme.example'};
  const client={release(){},async query(sql,args){
    if(sql.includes('clock_timestamp'))return{rows:[{observed_at:'2026-10-27T00:00:00Z'}]};
    if(sql.startsWith('SELECT * FROM leadgen.companies'))return{rows:[company]};
    if(sql.includes('FROM leadgen.company_verification_evidence'))return{rows:evidence};
    if(sql.includes('opportunity_pool_current'))return{rows:[]};
    if(sql.startsWith('INSERT'))inserts.push(plain(args));
    if(sql.startsWith('INSERT'))return{rows:[{id:'d',company_id:args[0]}]};
    return{rows:[]};
  }};
  const pool={async connect(){return client;},async query(sql){
    if(sql.includes('FROM leadgen.companies WHERE id=ANY'))return{rows:[company]};
    if(sql.includes('FROM leadgen.prospect_category_observations o'))return{rows:[]};
    if(sql.includes('FROM leadgen.company_verification_evidence'))return{rows:evidence};
    return{rows:[]};
  }};
  return{pool,inserts};
}

test('T3 checkAttribution: off and SHADOW append the rule decision unchanged; ASSIST needs_review excludes and flags',async()=>{
  const decorate=service=>{service.leadUsability=null;return service;};
  const base=poolHarness();await decorate(new OpportunityPoolService({pool:base.pool})).refresh({companyIds:[UUID(1)]});
  assert.equal(base.inserts.length,1);
  const own=accepted({evidence_id:UUID(201),attribution:'THIRD_PARTY_ARTICLE'},'wholesale distributor');
  for(const assist of [offAssist,shadowAssist([own])]){
    const run=poolHarness();await decorate(new OpportunityPoolService({pool:run.pool,modelAssistHooks:hooksFor(assist)})).refresh({companyIds:[UUID(1)]});
    assert.deepEqual(run.inserts,base.inserts);
  }
  // Off: the first answer stops the loop (one switch read, not one per evidence row).
  offAssist.calls=0;const off=poolHarness();
  await decorate(new OpportunityPoolService({pool:off.pool,modelAssistHooks:hooksFor(offAssist)})).refresh({companyIds:[UUID(1)]});
  assert.equal(offAssist.calls,1);
  const run=poolHarness();
  const service=decorate(new OpportunityPoolService({pool:run.pool,modelAssistHooks:hooksFor(assistMode([own]))}));
  const review=await service.attributionReview([UUID(1)]);
  assert.deepEqual([...review.ids],[UUID(201)]);assert.deepEqual([...review.companies],[UUID(1)]);
  await service.refresh({companyIds:[UUID(1)]});
  const flags=run.inserts[0][11];assert.ok(flags.includes(MODEL_ATTRIBUTION_REVIEW_FLAG));
  assert.deepEqual(applyAttributionReview({tables:{company_verification_evidence:[{id:UUID(201)},{id:UUID(202)}],prospect_category_observations:[]}},review).tables.company_verification_evidence,[{id:UUID(202)}]);
  // OWN_STATEMENT never revives anything and never flags.
  const kept=poolHarness();
  await decorate(new OpportunityPoolService({pool:kept.pool,modelAssistHooks:hooksFor(assistMode([accepted({evidence_id:UUID(201),attribution:'OWN_STATEMENT'},'wholesale distributor')]))})).refresh({companyIds:[UUID(1)]});
  assert.deepEqual(kept.inserts,base.inserts);
});

// ---------------------------------------------------------------- T5 classifyReply
function replyHarness(hooks,body='Please send your catalogue of dresses.'){
  const recorded={classifications:[],suppressions:[],enqueued:[]};
  const service=new Phase7Service({pool:{query:async()=>({rowCount:1,rows:[{id:UUID(7),merchant_id:null,company_id:UUID(1),thread_id:UUID(8),
    subject_sanitized:'Re: dresses',body_text_sanitized:body,company_wide_opt_out:false,is_automatic:false,is_out_of_office:false,is_dsn:false}]})},
    queue:{async enqueue(name,data,options){recorded.enqueued.push([name,data,options]);return'job-1';}},env:{},modelAssistHooks:hooks});
  service.repository.createReplyClassification=async row=>{recorded.classifications.push(plain(row));return{id:UUID(9),intent:row.intent};};
  service.repository.suppressRecipientForInbound=async(id,scope)=>{recorded.suppressions.push([id,scope]);};
  return{service,recorded};
}

test('T5 classifyReply: off and SHADOW keep the rule classification; ASSIST adds opt-out or holds a task',async()=>{
  const base=replyHarness(null);const baseResult=await base.service.classifyInboundWork({inbound_message_id:UUID(7)});
  assert.equal(baseResult.intent,'CATALOGUE');
  const optOut=accepted({intent:'OPT_OUT'},'Please send',0.95);
  for(const assist of [offAssist,shadowAssist([optOut])]){
    const run=replyHarness(hooksFor(assist));
    assert.deepEqual(await run.service.classifyInboundWork({inbound_message_id:UUID(7)}),baseResult);
    assert.deepEqual(run.recorded,base.recorded);
  }
  // ASSIST opt-out: unsubscribe at once, still pending review.
  const opted=replyHarness(hooksFor(assistMode([optOut])));
  const optedResult=await opted.service.classifyInboundWork({inbound_message_id:UUID(7)});
  assert.equal(optedResult.intent,'OPT_OUT');assert.equal(opted.recorded.suppressions.length,1);
  assert.equal(opted.recorded.classifications[0].review_status,'PENDING_REVIEW');
  assert.ok(opted.recorded.classifications[0].reason_codes.includes('MODEL_ASSIST_OPT_OUT'));
  // ASSIST without an agreeing intent: activity only, the task waits for a person.
  const held=replyHarness(hooksFor(assistMode([accepted({intent:'QUESTION'},'Please send',0.9)])));
  await held.service.classifyInboundWork({inbound_message_id:UUID(7)});
  assert.deepEqual(held.recorded.enqueued[0][1],{inbound_message_id:UUID(7),hold_task:true});
  // ASSIST agreeing intent at >= 0.85: same as rules (task allowed).
  const agreed=replyHarness(hooksFor(assistMode([accepted({intent:'CATALOGUE'},'Please send',0.9)])));
  await agreed.service.classifyInboundWork({inbound_message_id:UUID(7)});
  assert.deepEqual(agreed.recorded.enqueued,base.recorded.enqueued);
  // A rule opt-out is never removed by the model.
  const ruleOptOut=replyHarness(hooksFor(assistMode([accepted({intent:'CATALOGUE'},'remove',0.95)])),'Please remove me from your list.');
  assert.equal((await ruleOptOut.service.classifyInboundWork({inbound_message_id:UUID(7)})).intent,'OPT_OUT');
});

test('createSalesFollowupWork with hold_task records the activity without an automatic task',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[]})},queue:{enqueue:async()=>'job'},env:{}});
  const inbound={id:UUID(7),company_id:UUID(1),thread_id:UUID(8),intent:'CATALOGUE',confidence:0.9,subject_sanitized:'Re',body_text_sanitized:'Please send your catalogue.',reply_category:'HUMAN_POSITIVE'};
  service.repository.getInboundForTask=async()=>inbound;
  const effects=[];service.repository.applyInboundCrmEffects=async input=>{effects.push(input);return{outboxes:[],task:input.task?{id:'t'}:null,activity:{id:'a'}};};
  await service.createSalesFollowupWork({inbound_message_id:UUID(7)});
  await service.createSalesFollowupWork({inbound_message_id:UUID(7),hold_task:true});
  assert.ok(effects[0].task);assert.equal(effects[1].task,null);assert.equal(effects[1].activity_type,effects[0].activity_type);
});
