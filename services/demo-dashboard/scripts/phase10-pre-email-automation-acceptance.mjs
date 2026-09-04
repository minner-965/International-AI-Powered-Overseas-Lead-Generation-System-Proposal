import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {resolveTargetCategoryContextFromDatabase} from '../src/categoryProcurement/targetCategoryContext.js';

const TERMINAL_OK=new Set(['COMPLETED','COMPLETE','PARTIAL','EVIDENCE_EXHAUSTED']);
const TERMINAL_FAIL=new Set(['FAILED']);
const SECRET_KEY=/(api.?key|token|password|secret|credential|refresh|authorization)/i;

export function parseAcceptanceArgs(argv=[]){
  const out={baseUrl:'http://127.0.0.1:3000',market:'AE',targetCategory:null,categoryScopeId:null,productProfile:null,scopeLimit:1,
    timeoutMinutes:20,pollSeconds:5,runLabel:null,allowLiveSearch:false,
    outputDir:process.env.ACCEPTANCE_OUTPUT_DIR||'/app/runtime/phase7/exports/phase10-pre-email-acceptance',resumeRunId:null};
  const names={
    '--base-url':'baseUrl','--market':'market','--target-category':'targetCategory','--category-scope-id':'categoryScopeId',
    '--product-profile':'productProfile','--scope-limit':'scopeLimit',
    '--timeout-minutes':'timeoutMinutes','--poll-seconds':'pollSeconds','--run-label':'runLabel',
    '--allow-live-search':'allowLiveSearch','--output-dir':'outputDir','--resume-run-id':'resumeRunId'
  };
  for(let i=0;i<argv.length;i+=1){
    const [raw,inline]=argv[i].split('=',2);const key=names[raw];if(!key)throw new Error(`Unknown argument: ${raw}`);
    const value=inline??argv[++i];if(value==null)throw new Error(`Missing value for ${raw}`);out[key]=value;
  }
  for(const key of ['scopeLimit','timeoutMinutes','pollSeconds'])out[key]=Number(out[key]);
  out.allowLiveSearch=/^(1|true|yes)$/i.test(String(out.allowLiveSearch));
  out.market=String(out.market).toUpperCase();
  out.targetCategory=out.targetCategory==null?null:String(out.targetCategory).trim();
  out.categoryScopeId=out.categoryScopeId==null?null:String(out.categoryScopeId).trim();
  out.productProfile=out.productProfile==null?null:String(out.productProfile).trim().toUpperCase();
  if(!['AE','MX'].includes(out.market))throw new Error('market must be AE or MX');
  if(out.productProfile&&!['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(out.productProfile))throw new Error('unsupported product profile');
  if(!Number.isInteger(out.scopeLimit)||out.scopeLimit<1||out.scopeLimit>100)throw new Error('scope-limit must be 1-100');
  return out;
}

export function assertStage0({categoryContext,health,provider}){
  if(!categoryContext?.targetCategory||!categoryContext?.targetCategoryScopeKey){
    throw Object.assign(new Error('TARGET_CATEGORY_CONTEXT_NOT_RESOLVED'),{exitCode:3});
  }
  if(health?.database!=='ready'||health?.phase5_jobs!=='ready'){
    throw Object.assign(new Error('RESEARCH_WORKER_NOT_READY'),{exitCode:3});
  }
  if(provider?.creation_allowed!==true||['CREDIT_EXHAUSTED','AUTH_ERROR'].includes(String(provider?.status||'').toUpperCase())){
    throw Object.assign(new Error('SEARCH_PROVIDER_NOT_AVAILABLE'),{exitCode:3});
  }
  return true;
}

const enabled=value=>String(value??'').trim().toLowerCase()==='true';
export function safeRuntimeFlags(env=process.env){return{
  AUTO_EVIDENCE_ENABLED:enabled(env.AUTO_EVIDENCE_ENABLED),
  DIRECT_DISPATCH:'MANDATORY_DIRECT_PG_BOSS',
  OUTBOUND_EMAIL_PROVIDER:String(env.OUTBOUND_EMAIL_PROVIDER||'NONE').toUpperCase(),
  GMAIL_API_ENABLED:enabled(env.GMAIL_API_ENABLED),GMAIL_INBOUND_SYNC_ENABLED:enabled(env.GMAIL_INBOUND_SYNC_ENABLED),
  OUTREACH_ENABLED:enabled(env.OUTREACH_ENABLED),LIVE_PROSPECT_SEND_APPROVED:enabled(env.LIVE_PROSPECT_SEND_APPROVED),
  RESEND_USE_CASE:String(env.RESEND_USE_CASE||'DISABLED').toUpperCase()
};}
export function assertSafeRuntime(flags){
  const unsafe=!flags.AUTO_EVIDENCE_ENABLED||flags.OUTBOUND_EMAIL_PROVIDER!=='NONE'||flags.GMAIL_API_ENABLED
    ||flags.GMAIL_INBOUND_SYNC_ENABLED||flags.OUTREACH_ENABLED||flags.LIVE_PROSPECT_SEND_APPROVED
    ||flags.RESEND_USE_CASE!=='DISABLED';
  if(unsafe)throw Object.assign(new Error('PRE_EMAIL_SAFETY_GATE_BLOCKED'),{exitCode:2});return true;
}
export function terminalOutcome(status,errorCount=0){
  const value=String(status||'').toUpperCase();
  if(TERMINAL_FAIL.has(value))return'AUTOMATION_FAILED';
  if(TERMINAL_OK.has(value))return Number(errorCount||0)>0&&value!=='PARTIAL'?'AUTOMATION_FAILED':'AUTOMATION_TERMINAL_OK';
  return null;
}
export function assertZeroSend(before,after){
  const delta=Object.fromEntries(Object.keys(before).map(key=>[key,Number(after[key]||0)-Number(before[key]||0)]));
  if(Object.values(delta).some(value=>value!==0))throw Object.assign(new Error('ZERO_SEND_ASSERTION_FAILED'),{exitCode:1,delta});
  return delta;
}
export function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,SECRET_KEY.test(key)?'[REDACTED]':redact(item)]));
  return value;
}

async function snapshot(pool){
  const counts=(await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.companies) companies,
    (SELECT count(*)::int FROM leadgen.sources) sources,
    (SELECT count(*)::int FROM leadgen.contacts) contacts,
    (SELECT count(*)::int FROM leadgen.research_jobs) research_jobs,
    (SELECT count(*)::int FROM leadgen.auto_evidence_tasks) auto_evidence_tasks,
    (SELECT count(*)::int FROM leadgen.provider_usage_events) provider_usage_events,
    (SELECT count(*)::int FROM leadgen.business_opportunity_current) opportunities`)).rows[0];
  const zeroSend=(await pool.query(`SELECT
    (SELECT count(*)::int FROM leadgen.outreach_drafts) outreach_drafts,
    (SELECT count(*)::int FROM leadgen.outreach_approvals) outreach_approvals,
    (SELECT count(*)::int FROM leadgen.outbound_messages) outbound_messages,
    (SELECT count(*)::int FROM leadgen.outbound_message_attempts) outbound_attempts,
    (SELECT count(*)::int FROM leadgen.email_webhook_inbox) email_webhook_inbox,
    (SELECT count(*)::int FROM leadgen.inbound_messages) inbound_messages,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm_outbox,
    (SELECT count(*)::int FROM leadgen.gmail_ambiguous_send_events) ambiguous_send_events`)).rows[0];
  return{captured_at:new Date().toISOString(),counts,zero_send:zeroSend};
}

async function api(baseUrl,pathname,options={}){
  const response=await fetch(new URL(pathname,baseUrl),{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const text=await response.text();let body;try{body=JSON.parse(text);}catch{body={text:text.slice(0,500)}}
  if(!response.ok)throw Object.assign(new Error(`API_${response.status}`),{status:response.status,body:redact(body)});
  return body;
}

async function collectLineage(pool,jobId){
  const job=(await pool.query(`SELECT id,status,job_type,idempotency_key,dispatch_execution_key,created_at,started_at,completed_at,
    candidates_found,companies_crawled,companies_qualified,error_count FROM leadgen.research_jobs WHERE id=$1`,[jobId])).rows[0];
  const companyIds=(await pool.query(`SELECT DISTINCT company_id FROM leadgen.research_candidate_verifications
    WHERE research_job_id=$1 AND company_id IS NOT NULL ORDER BY company_id`,[jobId])).rows.map(item=>item.company_id);
  const relatedJobs=(await pool.query(`SELECT id,status,job_type,idempotency_key,product_category,product_profile,created_at,completed_at,
    companies_attempted,decision_makers_found,contact_routes_found,category_matches_passed,category_matches_unknown,error_count
    FROM leadgen.research_jobs WHERE id=$1 OR idempotency_key=$2
      OR ($3::uuid[]<>'{}' AND requested_company_ids&&$3::uuid[] AND created_at>=$4)
    ORDER BY created_at,id`,[jobId,`post-discovery-category:${jobId}`,companyIds,job.created_at])).rows;
  const relatedJobIds=relatedJobs.map(item=>item.id);
  const outbox=(await pool.query(`SELECT id,research_job_id,execution_key,dispatch_state,checkpoint,queue_job_id,attempt_count,
    created_at,dispatched_at,completed_at,last_error_code FROM leadgen.research_job_dispatch_outbox WHERE research_job_id=$1`,[jobId])).rows[0]||null;
  const provider=(await pool.query(`SELECT id,status,used_units,created_at,completed_at FROM leadgen.provider_usage_events
    WHERE research_job_id=$1 ORDER BY created_at,id`,[jobId])).rows;
  const tasks=(await pool.query(`SELECT DISTINCT t.id,t.company_id,t.product_profile,t.business_blocker,t.evidence_revision,
    t.category_research_job_id,t.contact_research_job_id,t.target_category_scope_key,t.target_category_code,
    t.execution_key,t.task_status,t.current_stage,t.strategy_attempt_count,t.provider_retry_count,t.worker_retry_count,t.created_at,t.updated_at
    FROM leadgen.auto_evidence_tasks t LEFT JOIN leadgen.auto_evidence_task_attempts a ON a.task_id=t.id
    WHERE t.category_research_job_id=ANY($1::uuid[]) OR t.contact_research_job_id=ANY($1::uuid[])
      OR a.research_job_id=ANY($1::uuid[]) OR (t.company_id=ANY($2::uuid[]) AND t.created_at>=$3)
    ORDER BY t.created_at,t.id`,[relatedJobIds,companyIds,job.created_at])).rows;
  const attempts=tasks.length?(await pool.query(`SELECT id,task_id,research_job_id,strategy_code,strategy_attempt_number,stage,event_type,
    outcome_status,provider_usage_event_id,query_fingerprint,provider_retry_count,worker_retry_count,occurred_at
    FROM leadgen.auto_evidence_task_attempts WHERE task_id=ANY($1::uuid[]) ORDER BY occurred_at,id`,[tasks.map(item=>item.id)])).rows:[];
  return{job,related_jobs:relatedJobs,related_research_job_ids:relatedJobIds,company_ids:companyIds,
    outbox,provider_usage_events:provider,auto_evidence_tasks:tasks,strategy_attempts:attempts,
    provider_used_units:provider.reduce((sum,item)=>sum+Number(item.used_units||0),0)};
}

async function waitForDownstream(pool,jobId,deadline,pollMilliseconds){
  while(Date.now()<deadline){
    const state=(await pool.query(`WITH promoted AS (
        SELECT DISTINCT company_id FROM leadgen.research_candidate_verifications
        WHERE research_job_id=$1 AND company_id IS NOT NULL AND verification_status='VERIFIED_BUSINESS'
          AND promotion_status IN('PROMOTED_NEW','ENRICHED_EXISTING')
      ), category_job AS (
        SELECT id,status FROM leadgen.research_jobs WHERE idempotency_key=$2 LIMIT 1
      ) SELECT (SELECT count(*)::int FROM promoted) promoted_companies,
        (SELECT id FROM category_job) category_job_id,(SELECT status FROM category_job) category_job_status,
        (SELECT count(*)::int FROM leadgen.category_procurement_match_results r
          WHERE r.company_id IN(SELECT company_id FROM promoted) AND r.created_at>=(SELECT created_at FROM leadgen.research_jobs WHERE id=$1)) category_matches,
        (SELECT count(*)::int FROM leadgen.business_opportunity_current o
          WHERE o.company_id IN(SELECT company_id FROM promoted) AND o.created_at>=(SELECT created_at FROM leadgen.research_jobs WHERE id=$1)) opportunities`,
      [jobId,`post-discovery-category:${jobId}`])).rows[0];
    if(Number(state.promoted_companies)===0)return{...state,outcome:'NO_PROMOTED_COMPANY'};
    if(['COMPLETED','PARTIAL','EVIDENCE_EXHAUSTED'].includes(state.category_job_status)
      &&Number(state.category_matches)>0&&Number(state.opportunities)>0)return{...state,outcome:'DOWNSTREAM_TERMINAL'};
    if(state.category_job_status==='FAILED')throw Object.assign(new Error('CATEGORY_AUTOMATION_FAILED'),{exitCode:1});
    await new Promise(resolve=>setTimeout(resolve,pollMilliseconds));
  }
  throw Object.assign(new Error('DOWNSTREAM_AUTOMATION_TIMEOUT'),{exitCode:4});
}

async function collectBusinessOutcome(pool,jobId,lineage){
  const relatedJobIds=[...lineage.related_research_job_ids,...lineage.auto_evidence_tasks.flatMap(item=>[item.category_research_job_id,item.contact_research_job_id])]
    .filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index);
  const categoryMatches=(await pool.query(`SELECT id,research_job_id,company_id,match_status,band,score,coverage_percent,
    matched_scope_ids,observed_categories,created_at FROM leadgen.category_procurement_match_results
    WHERE research_job_id=ANY($1::uuid[]) ORDER BY created_at,id`,[relatedJobIds])).rows;
  const companyIds=[...new Set(categoryMatches.map(item=>item.company_id).filter(Boolean))];
  const namedBuyers=(await pool.query(`SELECT dm.id,dm.company_id,dm.research_job_id,dm.normalized_role,dm.verification_status,
    dm.lifecycle_status,dm.evidence_strength,count(dmc.id)::int verified_route_count
    FROM leadgen.decision_makers dm LEFT JOIN leadgen.decision_maker_contacts dmc ON dmc.decision_maker_id=dm.id
      AND dmc.verification_status IN ('VALID','VERIFIED')
    WHERE dm.research_job_id=ANY($1::uuid[]) GROUP BY dm.id ORDER BY dm.created_at,dm.id`,[relatedJobIds])).rows;
  const officialRoutes=companyIds.length?(await pool.query(`SELECT id,company_id,route_type,manual_action_status,
    outcome,verified_at,captured_at FROM leadgen.official_route_manual_task_current
    WHERE company_id=ANY($1::uuid[]) ORDER BY created_at,id`,[companyIds])).rows:[];
  const opportunities=(await pool.query(`SELECT id,company_id,research_job_id,system_recommendation_status,contact_readiness,
    policy_contact_status,display_opportunity_status,business_fit_status,management_contact_status,assessment_revision,created_at
    FROM leadgen.business_opportunity_current WHERE research_job_id=ANY($1::uuid[]) ORDER BY created_at,id`,[relatedJobIds])).rows;
  return{
    related_research_job_ids:relatedJobIds,
    category_match_outcome:{count:categoryMatches.length,statuses:[...new Set(categoryMatches.map(item=>item.match_status))],results:categoryMatches},
    named_buyer_readiness:{ready:namedBuyers.some(item=>Number(item.verified_route_count)>0),count:namedBuyers.length,
      verified_route_count:namedBuyers.reduce((sum,item)=>sum+Number(item.verified_route_count||0),0),results:namedBuyers},
    official_route_readiness:{ready:officialRoutes.length>0,count:officialRoutes.length,
      route_types:[...new Set(officialRoutes.map(item=>item.route_type))],results:officialRoutes},
    business_opportunity_result:{count:opportunities.length,statuses:[...new Set(opportunities.map(item=>item.display_opportunity_status))],results:opportunities}
  };
}

async function main(){
  const args=parseAcceptanceArgs(process.argv.slice(2));const flags=safeRuntimeFlags();assertSafeRuntime(flags);
  if(!args.allowLiveSearch&&!args.resumeRunId)throw Object.assign(new Error('LIVE_SEARCH_NOT_ALLOWED'),{exitCode:3});
  const runLabel=args.runLabel||`phase10-pre-email-acceptance-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}`;
  const output=path.resolve(args.outputDir,runLabel);await fs.mkdir(path.join(output,'sanitized-api-captures'),{recursive:true});
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:4});
  let exitCode=0;
  try{
    const health=await api(args.baseUrl,'/api/health');
    const provider=await api(args.baseUrl,'/api/research/provider-status');
    let contextInput={target_category:args.targetCategory,approved_category_scope_id:args.categoryScopeId,product_profile:args.productProfile};
    if(args.resumeRunId&&!args.targetCategory&&!args.categoryScopeId&&!args.productProfile){
      const resumed=(await pool.query(`SELECT product_category,product_profile FROM leadgen.research_jobs WHERE id=$1`,[args.resumeRunId])).rows[0];
      if(!resumed)throw Object.assign(new Error('RESUME_RESEARCH_JOB_NOT_FOUND'),{exitCode:3});
      contextInput=resumed;
    }
    const categoryContext=await resolveTargetCategoryContextFromDatabase(pool,contextInput);
    assertStage0({categoryContext,health,provider});
    const before=await snapshot(pool);let jobId=args.resumeRunId;
    if(!jobId){
      const idempotencyKey=runLabel.slice(0,200);
      const payload={country:args.market==='AE'?'United Arab Emirates':'Mexico',country_code:args.market,
        country_name:args.market==='AE'?'United Arab Emirates':'Mexico',city:'',region:'',
        ...(!args.categoryScopeId?{product_category:categoryContext.targetCategory}:{}),
        ...(args.categoryScopeId?{approved_category_scope_id:args.categoryScopeId}:{}),
        ...(args.productProfile?{product_profile:args.productProfile}:{}),
        buyer_types:['Department Store','Large Retail Group','Regional Retail Chain','Importer','Wholesaler','Distributor'],
        max_results:args.scopeLimit,idempotency_key:idempotencyKey};
      const created=await api(args.baseUrl,'/api/research/jobs',{method:'POST',headers:{'idempotency-key':idempotencyKey},body:JSON.stringify(payload)});
      jobId=created.job_id||created.id;await fs.writeFile(path.join(output,'sanitized-api-captures','job-created.json'),JSON.stringify(redact(created),null,2));
    }
    const deadline=Date.now()+args.timeoutMinutes*60000;let job;let outcome;
    do{job=await api(args.baseUrl,`/api/research/jobs/${encodeURIComponent(jobId)}`);outcome=terminalOutcome(job.status,job.error_count);
      if(outcome)break;await new Promise(resolve=>setTimeout(resolve,args.pollSeconds*1000));}while(Date.now()<deadline);
    if(!outcome)throw Object.assign(new Error('AUTOMATION_TIMEOUT'),{exitCode:4});
    if(outcome!=='AUTOMATION_TERMINAL_OK')throw Object.assign(new Error(outcome),{exitCode:1});
    const downstream=await waitForDownstream(pool,jobId,deadline,args.pollSeconds*1000);
    const lineage=await collectLineage(pool,jobId);if(!lineage.outbox)throw Object.assign(new Error('DISPATCH_OUTBOX_MISSING'),{exitCode:1});
    if(lineage.outbox.dispatch_state!=='COMPLETED')throw Object.assign(new Error('DISPATCH_OUTBOX_NOT_COMPLETED'),{exitCode:1});
    const summaryUnits=Number(job.used_units||0);if(summaryUnits!==lineage.provider_used_units)throw Object.assign(new Error('PROVIDER_USAGE_PROJECTION_DRIFT'),{exitCode:1});
    const businessOutcome=await collectBusinessOutcome(pool,jobId,lineage);
    if(downstream.outcome==='DOWNSTREAM_TERMINAL'
      &&(!businessOutcome.category_match_outcome.count||!businessOutcome.business_opportunity_result.count)){
      throw Object.assign(new Error('DOWNSTREAM_BUSINESS_RESULT_MISSING'),{exitCode:1});
    }
    const after=await snapshot(pool);const zeroSendDelta=assertZeroSend(before.zero_send,after.zero_send);
    const report={status:'PASS',run_label:runLabel,research_job_id:jobId,terminal_status:job.status,manual_stage_intervention:false,
      target_category:categoryContext.targetCategory,target_category_code:categoryContext.targetCategoryCode,
      target_category_scope_key:categoryContext.targetCategoryScopeKey,category_context_source:categoryContext.source,
      optional_product_profile:args.productProfile,resolved_legacy_compatibility_profile:categoryContext.productProfile,
      stage_0:{target_category_context:'RESOLVED',research_worker:'HEALTHY',provider_status:provider.status,email_paths:'DISABLED'},
      category_match_outcome:businessOutcome.category_match_outcome,
      named_buyer_readiness:businessOutcome.named_buyer_readiness,
      official_route_readiness:businessOutcome.official_route_readiness,
      business_opportunity_result:businessOutcome.business_opportunity_result,
      downstream_automation:downstream,
      flags,before,after,zero_send_delta:zeroSendDelta,lineage_summary:{dispatch_outbox_id:lineage.outbox.id,
        pg_boss_id:lineage.outbox.queue_job_id,provider_event_ids:lineage.provider_usage_events.map(item=>item.id),
        provider_used_units:lineage.provider_used_units,auto_evidence_task_ids:lineage.auto_evidence_tasks.map(item=>item.id),
        strategy_attempt_ids:lineage.strategy_attempts.map(item=>item.id)}};
    await Promise.all([
      fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)),
      fs.writeFile(path.join(output,'lineage.json'),JSON.stringify(redact(lineage),null,2)),
      fs.writeFile(path.join(output,'zero-send-proof.json'),JSON.stringify({before:before.zero_send,after:after.zero_send,delta:zeroSendDelta},null,2)),
      fs.writeFile(path.join(output,'timings.json'),JSON.stringify({created_at:lineage.job.created_at,started_at:lineage.job.started_at,completed_at:lineage.job.completed_at},null,2)),
      fs.writeFile(path.join(output,'report.md'),`# Phase 10 Pre-email Acceptance\n\n- Status: PASS\n- ResearchJob: \`${jobId}\`\n- Target category: \`${categoryContext.targetCategory}\`\n- Category context: \`${categoryContext.source}\`\n- Optional product profile requested: \`${args.productProfile||'NULL'}\`\n- Terminal: \`${job.status}\`\n- Category match results: ${businessOutcome.category_match_outcome.count}\n- Named buyer ready: ${businessOutcome.named_buyer_readiness.ready?'YES':'NO'}\n- Official route ready: ${businessOutcome.official_route_readiness.ready?'YES':'NO'}\n- Business opportunities: ${businessOutcome.business_opportunity_result.count}\n- Provider used units: ${lineage.provider_used_units}\n- Email/CRM delta: 0\n`)
    ]);
    process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  }catch(error){exitCode=error.exitCode||1;process.stderr.write(`${JSON.stringify({status:'FAIL',code:error.message,detail:redact(error.body||null)})}\n`);}
  finally{await pool.end();}
  process.exitCode=exitCode;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await main();
