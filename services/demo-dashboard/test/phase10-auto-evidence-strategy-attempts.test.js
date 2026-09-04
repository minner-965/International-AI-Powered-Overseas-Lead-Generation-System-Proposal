import test from 'node:test';
import assert from 'node:assert/strict';

import {AutoEvidenceOrchestrator,AutoEvidenceRepository} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';
import {AUTO_EVIDENCE_STRATEGIES,MEXICO_BUYER_ROLE_TERMS,eligibleStrategies,nextUnusedStrategy,strategyStartStage} from '../src/autoEvidence/strategyCatalog.js';

const baseTask={
  id:'22222222-2222-4222-8222-222222222222',company_id:'11111111-1111-4111-8111-111111111111',
  company_name:'Compras Ejemplo',country_code:'MX',official_root_domain:'ejemplo.mx',product_profile:'WOMENSWEAR',
  business_blocker:'EVIDENCE_REQUIRED',evidence_revision:4,execution_key:'auto-evidence:v1:wp09',
  task_status:'RUNNING',current_stage:'REFRESHING_DECISION',strategy_attempt_count:1,attempt_count:1,max_attempts:10,
  current_strategy_code:'S01_OFFICIAL_CATEGORY',strategy_version:'phase10-wp09-v1',provider_retry_count:0,
  worker_retry_count:0,budget_state:'AVAILABLE',input_digest:'a'.repeat(64),named_buyer_candidate_count:1,
  candidate_buyer_name:'María Compras'
};

class StrategyRepository{
  constructor({resolved=false,nextNumber=2,exhausted=false}={}){this.task={...baseTask};this.resolved=resolved;
    this.nextNumber=nextNumber;this.exhausted=exhausted;this.prepared=0;this.providerRetries=0;}
  async blockerState(){return{resolved:this.resolved,hard_stop:false,responsibility_conflict:false};}
  async closeCurrentStrategy(){this.task={...this.task,current_strategy_code:null,task_status:'RETRY_SCHEDULED'};return this.task;}
  async prepareNextStrategy(){this.prepared+=1;if(this.exhausted)return{...this.task,strategy:null,strategies_exhausted:true};
    const code=AUTO_EVIDENCE_STRATEGIES[this.nextNumber-1].code;this.task={...this.task,strategy_attempt_count:this.nextNumber,
      attempt_count:this.nextNumber,current_strategy_code:code,current_stage:'FINDING_BUYER',task_status:'RUNNING'};
    return{...this.task,strategy:AUTO_EVIDENCE_STRATEGIES[this.nextNumber-1]};}
  async markExhausted(_id,cooldown){this.task={...this.task,task_status:'EVIDENCE_EXHAUSTED',strategy_state:'EXHAUSTED',cooldown_until:cooldown};return this.task;}
  async completeTask(){this.task={...this.task,task_status:'COMPLETED',strategy_state:'RESOLVED'};return this.task;}
  async incrementProviderRetry(){this.providerRetries+=1;this.task={...this.task,provider_retry_count:this.providerRetries};return this.task;}
  async updateTaskOutcome(_id,input){this.task={...this.task,task_status:input.status,technical_blocker:input.technicalBlocker,
    retry_at:input.retryAt,budget_state:input.budgetState};return this.task;}
  async getTask(){return this.task;}
  async getSettledAttempt(){return null;}
  async beginStage(_task,stage){this.task={...this.task,current_stage:stage,task_status:'RUNNING'};return{started:true,task:this.task};}
  async ensureResearchJob(){return{id:'33333333-3333-4333-8333-333333333333',job_type:'DECISION_MAKER_ENRICHMENT',replay:true};}
  async settleStage(){return null;}
}

const queue=()=>({calls:[],async enqueue(name,data,options){this.calls.push({name,data,options});return`job-${this.calls.length}`;}});

test('WP09 catalog exposes all ten strategies, all required Mexico roles, and no repeated query fingerprint',()=>{
  assert.equal(AUTO_EVIDENCE_STRATEGIES.length,10);
  assert.deepEqual(AUTO_EVIDENCE_STRATEGIES.map(row=>row.code),[
    'S01_OFFICIAL_CATEGORY','S02_OFFICIAL_ASSORTMENT','S03_OFFICIAL_SUPPLIER_ROUTE','S04_OFFICIAL_LEADERSHIP',
    'S05_OFFICIAL_PRESS_PDF','S06_LOCAL_LANGUAGE_ROLES','S07_INDUSTRY_DIRECTORY','S08_PUBLIC_PRO_REFERENCE',
    'S09_PERSON_CORROBORATION','S10_ALTERNATIVE_OFFICIAL_ROUTE']);
  for(const role of ['Comprador','Compradora','Gerente de Compras','Director de Compras','Jefe de Compras',
    'Abastecimiento','Gerente de Categoría','Importaciones','Sourcing'])assert.ok(MEXICO_BUYER_ROLE_TERMS.includes(role));
  const codes=[];const fingerprints=[];
  for(let index=0;index<10;index+=1){const strategy=nextUnusedStrategy(baseTask,codes,fingerprints);assert.ok(strategy);
    codes.push(strategy.code);fingerprints.push(strategy.query_fingerprint);}
  assert.equal(new Set(codes).size,10);assert.equal(new Set(fingerprints).size,10);
  assert.equal(nextUnusedStrategy(baseTask,codes,fingerprints),null);
});

test('WP11 blocker routing keeps category research separate from Buyer and email research',()=>{
  const category=eligibleStrategies({...baseTask,business_blocker:'CATEGORY_EVIDENCE',named_buyer_candidate_count:0});
  assert.deepEqual(category.map(row=>row.code),[
    'S01_OFFICIAL_CATEGORY','S02_OFFICIAL_ASSORTMENT','S05_OFFICIAL_PRESS_PDF'
  ]);
  assert.ok(category.every(row=>strategyStartStage(row,{business_blocker:'CATEGORY_EVIDENCE'})==='DISCOVERING_SOURCES'));

  const buyer=eligibleStrategies({...baseTask,business_blocker:'NAMED_BUYER_EVIDENCE',named_buyer_candidate_count:0});
  assert.deepEqual(buyer.map(row=>row.code),[
    'S03_OFFICIAL_SUPPLIER_ROUTE','S04_OFFICIAL_LEADERSHIP','S05_OFFICIAL_PRESS_PDF',
    'S06_LOCAL_LANGUAGE_ROLES','S07_INDUSTRY_DIRECTORY','S08_PUBLIC_PRO_REFERENCE',
    'S10_ALTERNATIVE_OFFICIAL_ROUTE'
  ]);
  assert.ok(buyer.every(row=>strategyStartStage(row,{business_blocker:'NAMED_BUYER_EVIDENCE'})==='FINDING_BUYER'));
  assert.equal(eligibleStrategies({...baseTask,business_blocker:'NOT_SUITABLE'}).length,0);
});

test('WP10 fairness yields after one strategy instead of letting one company consume the round',async()=>{
  const repository=new StrategyRepository({nextNumber:2});const jobs=queue();
  const service=new AutoEvidenceOrchestrator({repository,queue:jobs,env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const result=await service.advance(repository.task,'REFRESHING_DECISION','NO_NEW_EVIDENCE');
  assert.equal(result.status,'FAIRNESS_YIELDED');assert.equal(result.task.strategy_attempt_count,1);
  assert.equal(result.task.current_strategy_code,null);assert.equal(repository.prepared,0);assert.equal(jobs.calls.length,0);
});

test('worklist exhaustion closes the task without a cooldown gate',async()=>{
  const repository=new StrategyRepository({nextNumber:10,exhausted:true});repository.task.strategy_attempt_count=10;
  const jobs=queue();const now=new Date('2026-09-02T00:00:00.000Z');
  const service=new AutoEvidenceOrchestrator({repository,queue:jobs,env:{AUTO_EVIDENCE_ENABLED:'true',
    AUTO_EVIDENCE_COMPANY_COOLDOWN_HOURS:'168'},now:()=>now});
  const yielded=await service.advance(repository.task,'REFRESHING_DECISION','NO_NEW_EVIDENCE');
  assert.equal(yielded.status,'FAIRNESS_YIELDED');
  const result=await service.runStage('FINDING_BUYER',{task_id:repository.task.id});
  assert.equal(result.status,'EVIDENCE_EXHAUSTED');assert.equal(result.task.strategy_attempt_count,10);
  assert.equal(result.task.cooldown_until,null);assert.equal(jobs.calls.length,0);
});

test('legacy numeric max attempts does not block the next distinct strategy',async()=>{
  const repository=new StrategyRepository({nextNumber:4});
  repository.task={...repository.task,current_strategy_code:null,current_stage:null,task_status:'RETRY_SCHEDULED'};
  const jobs=queue();
  const service=new AutoEvidenceOrchestrator({repository,queue:jobs,
    executors:{find_profile_buyer:async()=>({outcome_status:'NO_NEW_EVIDENCE'})},
    env:{AUTO_EVIDENCE_ENABLED:'true',AUTO_EVIDENCE_MAX_ATTEMPTS:'1',TAVILY_USAGE_POLICY:'PROVIDER_ACCOUNT_ONLY'}});
  const result=await service.runStage('FINDING_BUYER',{task_id:repository.task.id});
  assert.equal(repository.prepared,1);
  assert.equal(repository.task.strategy_attempt_count,4);
  assert.notEqual(result.status,'EVIDENCE_EXHAUSTED');
});

test('provider temporary error retries the same strategy without consuming a strategy attempt',async()=>{
  const repository=new StrategyRepository();const jobs=queue();
  const service=new AutoEvidenceOrchestrator({repository,queue:jobs,env:{AUTO_EVIDENCE_ENABLED:'true',
    AUTO_EVIDENCE_RETRY_BASE_SECONDS:'60'},now:()=>new Date('2026-09-02T00:00:00.000Z')});
  const result=await service.advance(repository.task,'DISCOVERING_SOURCES','TEMPORARY_ERROR');
  assert.equal(result.status,'RETRY_SCHEDULED');assert.equal(result.task.strategy_attempt_count,1);
  assert.equal(result.task.provider_retry_count,1);assert.equal(repository.prepared,0);
  assert.equal(jobs.calls[0].data.strategy_attempt_number,1);
});

test('budget pause preserves the current strategy and all counters',async()=>{
  const repository=new StrategyRepository();const service=new AutoEvidenceOrchestrator({repository,queue:queue(),
    env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const result=await service.advance(repository.task,'VERIFYING_EMAIL','BUDGET_PAUSED');
  assert.equal(result.status,'BUDGET_PAUSED');assert.equal(result.task.strategy_attempt_count,1);
  assert.equal(result.task.current_strategy_code,'S01_OFFICIAL_CATEGORY');assert.equal(result.task.provider_retry_count,0);
});

test('resolved blocker stops the strategy chain before another provider-backed dispatch',async()=>{
  const repository=new StrategyRepository({resolved:true});const jobs=queue();
  const service=new AutoEvidenceOrchestrator({repository,queue:jobs,env:{AUTO_EVIDENCE_ENABLED:'true'}});
  const result=await service.advance(repository.task,'REFRESHING_DECISION','NEW_EVIDENCE_FOUND');
  assert.equal(result.status,'COMPLETED');assert.equal(repository.prepared,0);assert.equal(jobs.calls.length,0);
});

test('stale worker lease increments only worker recovery and never creates a provider charge',async()=>{
  const task={...baseTask,current_stage:'DISCOVERING_SOURCES'};const statements=[];
  const client={async query(sql){const text=String(sql);statements.push(text);
    if(text.includes('FOR UPDATE'))return{rows:[task],rowCount:1};
    if(text.includes("event_type IN ('STARTED','SETTLED')"))return{rows:[{event_type:'STARTED',occurred_at:new Date(0)}],rowCount:1};
    if(text.includes('SET worker_retry_count='))return{rows:[{...task,worker_retry_count:1}],rowCount:1};
    if(text.startsWith('UPDATE leadgen.auto_evidence_tasks SET'))return{rows:[{...task,worker_retry_count:1}],rowCount:1};
    return{rows:[],rowCount:1};},release(){}};
  const repository=new AutoEvidenceRepository({pool:{connect:async()=>client}});
  const result=await repository.beginStage(task,'DISCOVERING_SOURCES','b'.repeat(64));
  assert.equal(result.recovered,true);assert.equal(result.task.worker_retry_count,1);
  assert.ok(statements.some(sql=>sql.includes('worker_retry_count=$2')));
  assert.ok(!statements.some(sql=>sql.includes('INSERT INTO leadgen.provider_usage_events')));
});
