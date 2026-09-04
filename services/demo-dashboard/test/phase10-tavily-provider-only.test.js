import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {autoEvidenceConfig,AutoEvidenceRepository} from '../src/autoEvidence/AutoEvidenceOrchestrator.js';
import {TavilyUsageAudit} from '../src/search/TavilyUsageAudit.js';

const root=process.env.DPV_PROJECT_ROOT
  ?path.resolve(process.env.DPV_PROJECT_ROOT)
  :path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');

test('legacy Tavily limit variables are ignored and absent from active configuration',()=>{
  const config=autoEvidenceConfig({TAVILY_INTERNAL_LIMITS_ENABLED:'true',MAX_TAVILY_CREDITS_PER_DAY_UNITS:'1',
    MAX_TAVILY_CREDITS_PER_RUN_UNITS:'1',TAVILY_DISCOVERY_DAILY_UNITS:'0',TAVILY_EVIDENCE_DAILY_UNITS:'0',
    MAX_TAVILY_UNITS_PER_COMPANY_PROFILE_CYCLE:'1'});
  for(const key of ['tavilyInternalLimitsEnabled','tavilyDailyCapUnits','tavilyRunCapUnits',
    'tavilyDiscoveryDailyUnits','tavilyEvidenceDailyUnits','tavilyCompanyProfileCycleUnits'])
    assert.equal(key in config,false);
});

test('one hundred distinct Tavily requests are audited without a local quota rejection',async()=>{
  const provider={name:'tavily',endpoint:'https://api.tavily.com/search',calls:0,
    async search(){this.calls+=1;return{requestId:`r-${this.calls}`,credits:1,results:[]};}};
  const audit=new TavilyUsageAudit({provider});
  for(let index=0;index<100;index+=1){
    const result=await audit.search({researchJobId:'job',purpose:'CATEGORY_BUYER_EVIDENCE',request:{query:`distinct ${index}`}});
    assert.equal(result.usage_event.used_units,1);
  }
  assert.equal(provider.calls,100);
});

test('candidate selection retains correctness gates but contains no budget allocation predicate',async()=>{
  let sql='';const repository=new AutoEvidenceRepository({pool:{async query(statement){sql=String(statement);return{rows:[]};}}});
  await repository.selectCandidates({limit:10});
  assert.match(sql,/NOT EXISTS \(SELECT 1 FROM leadgen\.company_suppressions/);
  assert.match(sql,/INTERNAL_EXISTING_CUSTOMER/);
  assert.doesNotMatch(sql,/credit_limit|reserved_units|budget_window/i);
});

test('active production sources and deployment config contain no retired Tavily quota keys',()=>{
  const sources=[
    fs.readFileSync(path.join(root,'.env.example'),'utf8'),
    fs.readFileSync(path.join(root,'compose.yaml'),'utf8'),
    ...['server.js','autoEvidence/AutoEvidenceOrchestrator.js','search/TavilyUsageAudit.js']
      .map(file=>fs.readFileSync(path.join(root,'services/demo-dashboard/src',file),'utf8'))
  ].join('\n');
  assert.doesNotMatch(sources,/MAX_TAVILY_CREDITS|TAVILY_INTERNAL_LIMITS|TAVILY_(?:DISCOVERY|EVIDENCE)_DAILY|AUTO_EVIDENCE_MAX_ATTEMPTS|AUTO_EVIDENCE_COMPANY_COOLDOWN/);
});
