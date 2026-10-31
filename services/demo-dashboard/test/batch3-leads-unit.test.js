import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {LeadUsabilityService,attemptSource,isAutomaticJob,unusableLeadSql,MAX_LEAD_ENRICHMENT_ATTEMPTS} from '../src/opportunityPool/leadUsability.js';
import {createLeadUsabilityRouter} from '../src/opportunityPool/leadUsabilityRouter.js';
import {visibleLeads,isUnusableLead,unusableBadgeMarkup,unusableToggleMarkup,hiddenNoteMarkup,restoreLead} from '../public/ui/v4/unusable-leads.js';
import {FEATURES} from '../public/ui/v4/merchants-admin.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.resolve(here,'../public');
const read=file=>readFileSync(path.join(publicDir,file),'utf8');
const C1='11111111-1111-4111-8111-111111111111',C2='22222222-2222-4222-8222-222222222222',JOB='33333333-3333-4333-8333-333333333333';

test('attempt source: only SYSTEM jobs are automatic; operator runs never skip unusable leads',()=>{
  assert.equal(MAX_LEAD_ENRICHMENT_ATTEMPTS,5);
  assert.equal(attemptSource({created_by_role:'SYSTEM',created_by_identity:'phase13-automation'}),'CONTACT_RESEARCH');
  assert.equal(attemptSource({created_by_role:'SYSTEM',created_by_identity:'phase10-auto-evidence'}),'AUTO_EVIDENCE');
  assert.equal(attemptSource({created_by_role:'SYSTEM',created_by_identity:'phase10-provider-capacity-recovery'}),'SYSTEM_RECOVERY');
  assert.equal(attemptSource({created_by_role:'MANAGEMENT',created_by_identity:'simon'}),'OPERATOR');
  assert.equal(isAutomaticJob({created_by_role:'MANAGEMENT'}),false);
  assert.match(unusableLeadSql('c'),/lead_usability_current .*status='UNUSABLE'/);
});

test('only real attempts are recorded: no executed query and no Hunter call means no attempt',async()=>{
  const inserts=[];
  const pool={async query(sql,args){
    if(sql.includes('research_search_queries'))return{rows:[{company_id:C1,executed:2}]};
    if(sql.includes('decision_maker_contacts'))return{rows:[]};
    if(sql.includes('opportunity_pool_current'))return{rows:[{company_id:C1,opportunity_pool_band:'RELEVANT'},{company_id:C2,opportunity_pool_band:'RELEVANT'}]};
    if(sql.startsWith('INSERT INTO leadgen.lead_enrichment_attempts')){inserts.push(args);return{rowCount:1,rows:[{id:'a'}]};}
    throw new Error(`unexpected SQL ${sql.slice(0,60)}`);
  }};
  const service=new LeadUsabilityService({pool});
  const result=await service.recordJobAttempts({id:JOB,created_by_role:'SYSTEM',created_by_identity:'phase13-automation'},
    [{company_id:C1,status:'COMPLETE',hunter:{calls:0},findings:{decision_makers:[]}},{company_id:C2,status:'PARTIAL',stop_reason:'PAUSED_FREE_PROVIDER_UNAVAILABLE',hunter:{calls:0}}]);
  assert.deepEqual(result,{recorded:1,marked_unusable:[],skipped_no_provider_call:1});
  assert.equal(inserts[0][0],C1);assert.equal(inserts[0][4],'NO_USABLE_EMAIL');assert.equal(inserts[0][5],2);
  assert.equal(inserts[0][11],`${JOB}:${C1}:DEFAULT`);
  // Active-band companies are counted but never marked unusable (decision 2 covers exploratory companies).
});

test('status reads tolerate a database without migration 073',async()=>{
  const service=new LeadUsabilityService({pool:{async query(){throw Object.assign(new Error('relation does not exist'),{code:'42P01'});}}});
  assert.equal((await service.statusFor([C1])).size,0);
  assert.deepEqual(await service.decorate([{company_id:C1}]),[{company_id:C1,unusable_lead:false}]);
});

test('restore route is admin only and maps refusals to 4xx',async()=>{
  const calls=[];
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.workspaceUser=req.headers['x-role']?{role:req.headers['x-role'],email:'u@x'}:null;next();});
  app.use(createLeadUsabilityRouter({service:{async restore(id,options){calls.push([id,options]);if(id===C2)throw Object.assign(new Error('not unusable'),{code:'LEAD_NOT_UNUSABLE',status:409});return{company_id:id,status:'USABLE'};},
    async history(id){return{company_id:id};}}}));
  const server=app.listen(0);const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const post=(id,role)=>fetch(`${base}/api/lead-usability/${id}/restore`,{method:'POST',headers:{'content-type':'application/json',...(role?{'x-role':role}:{})},body:JSON.stringify({reason:'found email'})});
    assert.equal((await post(C1,'MERCHANT')).status,403);
    const ok=await post(C1,'ADMIN');assert.equal(ok.status,200);assert.equal((await ok.json()).status,'USABLE');
    assert.deepEqual(calls[0],[C1,{actor:'u@x',reason:'found email'}]);
    const refused=await post(C2,'ADMIN');assert.equal(refused.status,409);assert.equal((await refused.json()).code,'LEAD_NOT_UNUSABLE');
  }finally{server.close();}
});

test('UI: unusable leads are hidden by default, the filter shows them, admin sees a restore button',async()=>{
  const rows=[{company_id:C1,company_name:'A'},{company_id:C2,company_name:'B',unusable_lead:true,lead_usability:{status:'UNUSABLE',attempts:5}}];
  assert.deepEqual(visibleLeads(rows).rows.map(row=>row.company_name),['A']);assert.equal(visibleLeads(rows).hidden,1);
  assert.equal(visibleLeads(rows,true).rows.length,2);
  assert.equal(isUnusableLead(rows[1]),true);assert.equal(unusableBadgeMarkup(rows[0]),'');
  const badge=unusableBadgeMarkup(rows[1],{admin:true});
  assert.match(badge,/无用线索/);assert.match(badge,/Unusable lead/);assert.match(badge,/data-lead-restore="22222222/);assert.match(badge,/自动查找 5 次/);
  assert.doesNotMatch(unusableBadgeMarkup(rows[1],{admin:false}),/data-lead-restore/);
  const toggle=unusableToggleMarkup('show-unusable-leads-research');
  assert.match(toggle,/显示无用线索/);assert.match(toggle,/Show unusable leads/);assert.match(toggle,/data-show-unusable-leads/);assert.match(toggle,/data-tip=/);
  assert.match(hiddenNoteMarkup(2),/已隐藏 2 家无用线索/);assert.equal(hiddenNoteMarkup(0),'');
  let request;const body=await restoreLead(C2,{fetchImpl:async(url,options)=>{request=[url,options];return{ok:true,json:async()=>({status:'USABLE'})};}});
  assert.equal(request[0],`/api/lead-usability/${C2}/restore`);assert.equal(request[1].method,'POST');assert.equal(body.status,'USABLE');
  await assert.rejects(restoreLead(C2,{fetchImpl:async()=>({ok:false,status:409,json:async()=>({code:'LEAD_NOT_UNUSABLE'})})}),error=>error.code==='LEAD_NOT_UNUSABLE');
  // Company directory and research results wire the same filter; the company directory toggle has a stable hook.
  const html=read('index.html');
  assert.match(html,/id="show-unusable-leads" data-show-unusable-leads/);
  const app=read('app.js');assert.match(app,/visibleLeads\(state\.leads,\$\('#show-unusable-leads'\)\?\.checked === true\)/);
  assert.match(app,/\$\('#show-unusable-leads'\)\?\.addEventListener\('change'/);
  const research=read('ui/phase9-research-workbench.js');assert.match(research,/unusableToggleMarkup\('show-unusable-leads-research'/);
  assert.match(read('ui/v4/app.css'),/\.v4-unusable-filter/);
});

const walk=dir=>readdirSync(dir).flatMap(name=>{const full=path.join(dir,name);return statSync(full).isDirectory()?walk(full):[full];});
test('rename: no user-visible 研究任务 / Research job wording remains for the lead-search feature; hooks are kept',()=>{
  const files=walk(publicDir).filter(file=>/\.(html|js)$/.test(file));
  for(const file of files){
    const text=readFileSync(file,'utf8');
    assert.doesNotMatch(text,/研究任务|找客户（/,path.relative(publicDir,file));
    assert.doesNotMatch(text,/New Research Job|Research Jobs?\b|Start Research|Research Workbench/,path.relative(publicDir,file));
  }
  const html=read('index.html');
  assert.match(html,/<span lang="zh-CN">新建客户搜索<\/span><span lang="en">New Lead Search<\/span>/);
  assert.match(html,/data-app-nav="research" data-nav-group="research jobs" data-feature="research"/);
  assert.match(html,/<span lang="zh-CN">客户搜索<\/span><span lang="en">Lead search<\/span>/);
  assert.match(html,/id="research-new-job-open"/);
  assert.match(read('crm-shell.js'),/research:\['客户搜索','Lead search'/);
  assert.match(read('ui/v4/me.js'),/\['research', '客户搜索', 'Lead search'/);
  assert.deepEqual(FEATURES[0],['research','客户搜索','Lead search']);
  assert.match(read('ui/v4/tooltips.js'),/research: \['客户搜索：/);
  assert.match(read('ui/v4/onboarding.js'),/action: \['新建客户搜索', 'New lead search'\]/);
  assert.match(read('ui/v3/automation-control.js'),/'客户搜索','Lead search'/);
});
