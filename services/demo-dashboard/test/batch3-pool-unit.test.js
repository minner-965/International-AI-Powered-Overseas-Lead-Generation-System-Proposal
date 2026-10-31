import test from 'node:test';
import assert from 'node:assert/strict';
import {OpportunityPoolService,OPPORTUNITY_POOL_VERSION,OPPORTUNITY_POOL_V1_VERSION,projectPoolDecision,projectSnapshot,
  reevaluationChange,businessDigest,decisionDigest} from '../src/opportunityPool/OpportunityPoolService.js';
import {classifySnapshot} from '../src/opportunityPool/classifier.js';
import {parseArgs,renderSummary} from '../scripts/reevaluate-opportunity-pool.mjs';

const contact={contact_readiness:['NO_CONTACT_FOUND'],email_eligibility:{status:'BLOCKED',reason_codes:[],send_authorized:false}};
const business=(band,extra={})=>({company_id:'c',new_opportunity_pool_band:band,category_basis:'EXACT_CATEGORY',company_type_basis:{suitable_by_evidence:true},
  notes:[],profile_results:[],evidence_references:[],...extra});

test('v2_MC08 is the live rule; v1_MC04 stays importable and v1 rows keep their version',()=>{
  assert.equal(OPPORTUNITY_POOL_VERSION,'v2_MC08');assert.equal(OPPORTUNITY_POOL_V1_VERSION,'v1_MC04');
  assert.equal(typeof classifySnapshot,'function');
  assert.equal(projectPoolDecision(business('PRECISION'),contact).rule_version,'v1_MC04');
  assert.equal(projectPoolDecision(business('PRECISION',{rule_version:'v2_MC08'}),contact).rule_version,'v2_MC08');
  const snapshot={observed_at:'2026-10-27T00:00:00Z',tables:{companies:[{id:'c',company_name:'C',verification_status:'VERIFIED'}]}};
  assert.equal(projectSnapshot(snapshot)[0].rule_version,'v2_MC08');
  assert.equal(projectSnapshot(snapshot,{ruleVersion:'v1_MC04'})[0].rule_version,'v1_MC04');
});

test('re-evaluation change: only band or business-input changes append; contact-only changes do not',()=>{
  const v1=projectPoolDecision(business('GENERAL_RELEVANT'),contact);
  const v2=projectPoolDecision(business('GENERAL_RELEVANT',{rule_version:'v2_MC08'}),contact);
  const stored={...v1,input_digest:decisionDigest(v1)};
  assert.equal(reevaluationChange(null,{v2Row:v2,v2Digest:decisionDigest(v2),v1Row:v1}),'NEW');
  assert.equal(reevaluationChange(stored,{v2Row:v2,v2Digest:decisionDigest(v2),v1Row:v1}),'UNCHANGED');
  const down=projectPoolDecision(business('EXPLORATORY',{rule_version:'v2_MC08'}),contact);
  assert.equal(reevaluationChange(stored,{v2Row:down,v2Digest:decisionDigest(down),v1Row:v1}),'BAND_CHANGED');
  // Contact readiness / eligibility differ (e.g. verification TTL policy) but business inputs are the same.
  const contactChanged={...stored,contact_readiness_labels:['EMAIL_READY'],email_send_eligibility:{verification_ttl_days:30,send_authorized:false},input_digest:'x'.repeat(64)};
  assert.equal(reevaluationChange(contactChanged,{v2Row:v2,v2Digest:decisionDigest(v2),v1Row:v1}),'UNCHANGED');
  const evidence=projectPoolDecision(business('GENERAL_RELEVANT',{evidence_references:[{id:'e1'}]}),contact);
  assert.equal(reevaluationChange(stored,{v2Row:v2,v2Digest:decisionDigest(v2),v1Row:evidence}),'INPUTS_CHANGED');
  // A stored v2 decision is compared with v2; jsonb round trips (key order, dates) do not count as changes.
  const storedV2={...JSON.parse(JSON.stringify(v2)),input_digest:'y'.repeat(64)};
  assert.equal(reevaluationChange(storedV2,{v2Row:v2,v2Digest:decisionDigest(v2),v1Row:v1}),'UNCHANGED');
  assert.equal(businessDigest({...v2,evidence_references:[{captured_at:new Date('2026-10-01T00:00:00Z')}]}),
    businessDigest({...v2,evidence_references:[{captured_at:'2026-10-01T00:00:00.000Z'}]}));
});

test('reevaluate dry run uses a READ ONLY transaction and never inserts; apply inserts only changed companies',async()=>{
  const statements=[];let released=0;
  const v1=projectPoolDecision(business('GENERAL_RELEVANT'),contact);
  const stored=[{...v1,company_id:'same',input_digest:decisionDigest({...v1,company_id:'same'})},{...v1,company_id:'down',input_digest:'z'.repeat(64)}];
  const client={release(){released++;},async query(sql,args){statements.push(sql);
    if(sql.includes('opportunity_pool_current'))return{rows:stored};
    if(sql.includes('clock_timestamp'))return{rows:[{observed_at:'2026-10-27T00:00:00Z'}]};
    if(sql.startsWith('SELECT * FROM leadgen.companies'))return{rows:[{id:'same',company_name:'Same'},{id:'down',company_name:'Down'}]};
    if(sql.startsWith('INSERT'))return{rows:[{id:args[0]}]};
    return{rows:[]};}};
  const service=new OpportunityPoolService({pool:{async connect(){return client;}}});
  const original=service.reevaluate;
  const dry=await original.call(service,{apply:false});
  assert.equal(statements[0],'BEGIN READ ONLY');assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.some(sql=>sql.startsWith('INSERT')));assert.equal(dry.dry_run,true);assert.equal(dry.appended,0);
  statements.length=0;
  const applied=await original.call(service,{apply:true});
  assert.equal(statements[0],'BEGIN');assert.ok(statements.includes('COMMIT'));
  assert.equal(statements.filter(sql=>sql.startsWith('INSERT')).length,applied.changes.length);
  assert.equal(released,2);
});

test('re-evaluation script: dry run by default, --apply opt-in, plain summary',()=>{
  assert.deepEqual(parseArgs(['--database-url','postgresql://x/y']),{apply:false,json:false,databaseUrl:'postgresql://x/y'});
  assert.equal(parseArgs(['--apply','--database-url','u']).apply,true);
  const text=renderSummary({dry_run:true,rule_version:'v2_MC08',total:3,counts:{UNCHANGED:1,BAND_CHANGED:1,INPUTS_CHANGED:1,NEW:0},appended:0,
    changes:[{company_name:'A',from_band:'GENERAL_RELEVANT',to_band:'EXPLORATORY',change:'BAND_CHANGED'}]});
  assert.match(text,/预览（未写入）/);assert.match(text,/A：泛相关 → 待研究（档位变化）/);assert.doesNotMatch(text,/undefined/);
});
