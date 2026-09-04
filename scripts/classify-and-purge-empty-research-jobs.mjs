import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(new URL('../services/demo-dashboard/package.json',import.meta.url));
const pg=require('pg');

const ACTIVE_JOB_STATUSES=new Set(['QUEUED','RUNNING','DISCOVERING','CRAWLING','EXTRACTING','QUALIFYING','SCORING']);
const ACTIVE_TASK_STATUSES=new Set(['QUEUED','RUNNING','RETRY_SCHEDULED','TEMPORARY_PROVIDER_ERROR','BUDGET_PAUSED']);
const LIVE_QUEUE_STATES=['created','retry','active'];
const STALE_ORPHAN_MINUTES=60;
const BUSINESS_JOB_TABLES=[
  'business_opportunity_current','business_opportunity_decision_snapshots','buyer_business_model_results','category_procurement_match_results',
  'commercial_product_fit_current','commercial_product_fit_results','companies','company_facts_snapshots','company_score_runs',
  'company_verification_evidence','contact_verification_events','cooperation_feasibility_results',
  'customer_match_results','decision_maker_contacts','decision_maker_sources','decision_makers',
  'enrichment_job_companies','enrichment_public_references','product_opportunity_results',
  'prospect_category_observations','prospect_category_sources','research_candidate_verifications',
  'research_candidates','research_job_cohort_items'
];
const ATTEMPT_BUSINESS_COLUMNS=[
  'prospect_category_source_id','prospect_category_observation_id','buyer_business_model_result_id',
  'category_procurement_match_result_id','product_opportunity_result_id','cooperation_feasibility_result_id',
  'decision_maker_id','decision_maker_contact_id','contact_verification_event_id',
  'business_opportunity_decision_snapshot_id'
];

const safeUuid=value=>{
  const text=String(value||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text))throw new Error('Invalid UUID filter');
  return text;
};
const safeTimestamp=value=>{
  const date=new Date(String(value||''));
  if(Number.isNaN(date.getTime()))throw new Error('Invalid --created-before timestamp');
  return date.toISOString();
};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function parseArgs(argv){
  const output={apply:false,dryRun:true,jobId:null,taskId:null,status:null,createdBefore:null};
  for(let index=0;index<argv.length;index+=1){
    const arg=argv[index];
    if(arg==='--apply'){output.apply=true;output.dryRun=false;continue;}
    if(arg==='--dry-run'){output.dryRun=true;continue;}
    if(arg==='--job-id'){output.jobId=safeUuid(argv[++index]);continue;}
    if(arg==='--task-id'){output.taskId=safeUuid(argv[++index]);continue;}
    if(arg==='--status'){output.status=String(argv[++index]||'').trim().toUpperCase();continue;}
    if(arg==='--created-before'){output.createdBefore=safeTimestamp(argv[++index]);continue;}
    throw new Error(`Unknown argument: ${arg}`);
  }
  if(output.apply&&output.dryRun)throw new Error('Choose exactly one mode');
  return output;
}

export class ResearchJobPurgeClassifier{
  constructor({pool}){if(!pool)throw new Error('PostgreSQL pool is required');this.pool=pool;}

  async listJobs(filters={},client=this.pool){
    const where=[];const params=[];
    const add=(sql,value)=>{params.push(value);where.push(sql.replace('?',`$${params.length}`));};
    if(filters.jobId)add('j.id=?::uuid',filters.jobId);
    if(filters.status)add('upper(j.status)=?',filters.status);
    if(filters.createdBefore)add('j.created_at<?::timestamptz',filters.createdBefore);
    if(filters.taskId){params.push(filters.taskId);where.push(`EXISTS(SELECT 1 FROM leadgen.auto_evidence_tasks t
      WHERE t.id=$${params.length}::uuid AND (t.category_research_job_id=j.id OR t.contact_research_job_id=j.id
        OR EXISTS(SELECT 1 FROM leadgen.auto_evidence_task_attempts a WHERE a.task_id=t.id AND a.research_job_id=j.id)))`);}
    return (await client.query(`SELECT j.* FROM leadgen.research_jobs j ${where.length?`WHERE ${where.join(' AND ')}`:''}
      ORDER BY j.created_at,j.id`,params)).rows;
  }

  async unknownLineageColumns(client=this.pool){
    const known=new Set([
      ...BUSINESS_JOB_TABLES.map(table=>`${table}.research_job_id`),
      'provider_usage_events.research_job_id','research_job_stage_events.research_job_id',
      'research_job_company_provider_usage_summary.research_job_id','research_job_provider_usage_summary.research_job_id',
      'research_job_dispatch_outbox.research_job_id','research_search_queries.research_job_id',
      'auto_evidence_task_attempts.research_job_id','auto_evidence_tasks.category_research_job_id',
      'auto_evidence_tasks.contact_research_job_id','auto_evidence_resume_outbox.original_research_job_id',
      'auto_evidence_resume_outbox.continuation_research_job_id','auto_evidence_ownership_repair_events.old_research_job_id',
      'auto_evidence_ownership_repair_events.continuation_research_job_id','research_jobs.resumed_from_research_job_id',
      'research_job_purge_items.deleted_research_job_id'
    ]);
    const rows=(await client.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='leadgen' AND table_name<>'research_jobs'
        AND (column_name ILIKE '%research%job%id%' OR column_name ILIKE '%discovered%job%id%'
          OR column_name ILIKE '%verified%job%id%' OR column_name ILIKE '%decision%job%id%'
          OR column_name ILIKE '%created%job%id%')`)).rows;
    return rows.filter(row=>!known.has(`${row.table_name}.${row.column_name}`));
  }

  async classifyJob(job,{client=this.pool,unknownColumns=null}={}){
    const unknown=unknownColumns||await this.unknownLineageColumns(client);
    const taskRows=(await client.query(`SELECT DISTINCT t.* FROM leadgen.auto_evidence_tasks t
      WHERE t.category_research_job_id=$1 OR t.contact_research_job_id=$1
        OR EXISTS(SELECT 1 FROM leadgen.auto_evidence_task_attempts a WHERE a.task_id=t.id AND a.research_job_id=$1)
        OR EXISTS(SELECT 1 FROM leadgen.auto_evidence_resume_outbox o WHERE o.task_id=t.id
          AND (o.original_research_job_id=$1 OR o.continuation_research_job_id=$1))`,[job.id])).rows;
    const taskIds=taskRows.map(row=>row.id);
    const companyIds=[...new Set([
      ...taskRows.map(row=>row.company_id),...(Array.isArray(job.requested_company_ids)?job.requested_company_ids:[])
    ].filter(Boolean))];
    const businessParts=BUSINESS_JOB_TABLES.map(table=>`(SELECT count(*) FROM leadgen.${table} WHERE research_job_id=$1)`).join('+');
    const counts=(await client.query(`SELECT
      (SELECT count(*)::int FROM leadgen.research_job_stage_events WHERE research_job_id=$1) stage_event_count,
      (SELECT count(*)::int FROM leadgen.research_job_stage_events WHERE research_job_id=$1 AND event_type IN('STARTED','RUNNING','CLAIMED')) worker_stage_claim_count,
      (SELECT count(*)::int FROM leadgen.research_job_stage_events WHERE research_job_id=$1 AND
        (coalesce(source_count,0)>0 OR buyer_business_model_result_id IS NOT NULL OR category_procurement_match_result_id IS NOT NULL
          OR product_opportunity_result_id IS NOT NULL OR cooperation_feasibility_result_id IS NOT NULL
          OR decision_maker_id IS NOT NULL OR decision_maker_contact_id IS NOT NULL
          OR contact_verification_event_id IS NOT NULL OR business_opportunity_decision_snapshot_id IS NOT NULL)) business_stage_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_task_attempts WHERE research_job_id=$1 AND event_type IN('STARTED','RUNNING','CLAIMED')) task_claim_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_task_attempts WHERE research_job_id=$1 AND
        (${ATTEMPT_BUSINESS_COLUMNS.map(column=>`${column} IS NOT NULL`).join(' OR ')} OR coalesce(new_url_count,0)>0
          OR coalesce(usable_evidence_count,0)>0 OR coalesce(named_buyer_candidate_count,0)>0 OR coalesce(valid_contact_count,0)>0)) task_business_count,
      (SELECT count(*)::int FROM leadgen.provider_usage_events WHERE research_job_id=$1) provider_usage_event_count,
      (SELECT coalesce(sum(used_units),0)::numeric FROM leadgen.provider_usage_events WHERE research_job_id=$1) provider_used_units,
      (SELECT count(*)::int FROM leadgen.provider_usage_events WHERE research_job_id=$1 AND provider_request_id IS NOT NULL) provider_request_id_count,
      (SELECT count(*)::int FROM leadgen.research_search_queries WHERE research_job_id=$1) search_query_checkpoint_count,
      (SELECT count(*)::int FROM leadgen.research_jobs WHERE resumed_from_research_job_id=$1) child_continuation_count,
      (SELECT count(*)::int FROM leadgen.research_jobs WHERE resumed_from_research_job_id=$1
        AND status IN('QUEUED','RUNNING','DISCOVERING','CRAWLING','QUALIFYING','SCORING')) active_child_continuation_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_resume_outbox WHERE original_research_job_id=$1 OR continuation_research_job_id=$1) continuation_outbox_count,
      (SELECT count(*)::int FROM leadgen.research_job_dispatch_outbox WHERE research_job_id=$1 AND dispatch_state IN('PENDING','PROCESSING','RETRY_PENDING')) research_pending_outbox_count,
      (SELECT count(*)::int FROM leadgen.auto_evidence_resume_outbox WHERE (original_research_job_id=$1 OR continuation_research_job_id=$1)
        AND dispatch_state IN('PENDING','PROCESSING','RETRY_PENDING')) resume_pending_outbox_count,
      (SELECT count(*)::int FROM pgboss.job WHERE state::text=ANY($2::text[]) AND
        (data->>'job_id'=$1::text OR data->>'research_job_id'=$1::text OR
          (cardinality($3::text[])>0 AND data->>'task_id'=ANY($3::text[])))) live_queue_job_count,
      (${businessParts})::int direct_business_reference_count`,[job.id,LIVE_QUEUE_STATES,taskIds])).rows[0];
    let ambiguousReferenceCount=0;
    for(const ref of unknown){
      const identifier=value=>`"${String(value).replaceAll('"','""')}"`;
      const found=await client.query(`SELECT count(*)::int count FROM leadgen.${identifier(ref.table_name)}
        WHERE ${identifier(ref.column_name)}=$1`,[job.id]);
      ambiguousReferenceCount+=Number(found.rows[0].count);
    }
    const taskBusiness=Number(counts.task_business_count);
    const businessStage=Number(counts.business_stage_count);
    const businessOutputReferenceCount=Number(counts.direct_business_reference_count)+taskBusiness+businessStage;
    const currentBoundTasks=taskRows.filter(row=>row.category_research_job_id===job.id||row.contact_research_job_id===job.id);
    const recordedClaims=Number(counts.worker_stage_claim_count)+Number(counts.task_claim_count);
    const workerClaimCount=Math.max(recordedClaims,job.started_at?1:0);
    const checkpointCount=currentBoundTasks.filter(row=>row.current_stage||Number(row.checkpoint_replay_count||0)>0).length;
    const continuationCount=Number(counts.child_continuation_count)+Number(counts.continuation_outbox_count)
      +(job.resumed_from_research_job_id?1:0);
    const activeContinuationCount=Number(counts.active_child_continuation_count)+currentBoundTasks.filter(row=>
      ACTIVE_TASK_STATUSES.has(String(row.task_status||'').toUpperCase())&&job.resumed_from_research_job_id).length;
    const pendingOutboxCount=Number(counts.research_pending_outbox_count)+Number(counts.resume_pending_outbox_count);
    const liveQueueJobCount=Number(counts.live_queue_job_count);
    const providerUsageEventCount=Number(counts.provider_usage_event_count);
    const providerUsedUnits=Number(counts.provider_used_units);
    const providerRequestIdCount=Number(counts.provider_request_id_count);
    const legacyProviderCalls=Number(job.search_api_requests||0)+Number(job.social_search_api_requests||0)+Number(job.hunter_calls||0);
    const emailCounts=companyIds.length?(await client.query(`SELECT
      (SELECT count(*) FROM leadgen.outreach_drafts WHERE company_id=ANY($1::uuid[]))+
      (SELECT count(*) FROM leadgen.outreach_approvals WHERE company_id=ANY($1::uuid[]))+
      (SELECT count(*) FROM leadgen.outbound_messages WHERE company_id=ANY($1::uuid[])) count`,[companyIds])).rows[0]:{count:0};
    const crmCounts=taskIds.length?(await client.query(`SELECT count(*)::int count FROM leadgen.crm_sync_outbox WHERE task_id=ANY($1::uuid[])`,[taskIds])).rows[0]:{count:0};
    const emailSideEffectCount=Number(emailCounts.count);
    const crmSideEffectCount=Number(crmCounts.count);
    const createdAtMs=new Date(job.created_at||0).getTime();
    const staleOrphan=String(job.status||'').toUpperCase()==='QUEUED'&&!job.started_at
      &&Number.isFinite(createdAtMs)&&Date.now()-createdAtMs>=STALE_ORPHAN_MINUTES*60000
      &&recordedClaims===0&&pendingOutboxCount===0&&liveQueueJobCount===0&&continuationCount===0&&checkpointCount===0
      &&providerUsageEventCount===0&&providerUsedUnits===0&&providerRequestIdCount===0&&legacyProviderCalls===0
      &&businessOutputReferenceCount===0&&emailSideEffectCount===0&&crmSideEffectCount===0&&ambiguousReferenceCount===0;
    const isActive=(!staleOrphan&&ACTIVE_JOB_STATUSES.has(String(job.status||'').toUpperCase()))||currentBoundTasks.some(row=>
      ACTIVE_TASK_STATUSES.has(String(row.task_status||'').toUpperCase()));
    const hasActiveLease=currentBoundTasks.some(row=>String(row.task_status||'').toUpperCase()==='RUNNING')
      ||String(job.status||'').toUpperCase()==='RUNNING';
    const duplicate=(await client.query(`SELECT count(*)::int count FROM leadgen.research_jobs other WHERE other.id<>$1 AND
      (($2::text IS NOT NULL AND other.idempotency_key=$2) OR ($3::text IS NOT NULL AND other.request_digest=$3))`,[
      job.id,job.idempotency_key||null,job.request_digest||null
    ])).rows[0].count>0;
    let classification;
    if(staleOrphan){classification='EMPTY_STALE_ORPHAN';
    }else if(isActive||hasActiveLease||pendingOutboxCount>0||liveQueueJobCount>0||continuationCount>0||checkpointCount>0){
      classification='ACTIVE_OR_RECOVERABLE';
    }else if(ambiguousReferenceCount>0){classification='AMBIGUOUS_REFERENCE';
    }else if(businessOutputReferenceCount>0){classification='BUSINESS_OUTPUT_PRESENT';
    }else if(providerUsageEventCount>0||providerUsedUnits>0||providerRequestIdCount>0||legacyProviderCalls>0){
      classification='PROVIDER_USED_NO_BUSINESS_RESULT';
    }else if(duplicate){classification='DUPLICATE_EMPTY_TASK';
    }else if(workerClaimCount===0&&!job.started_at){classification='EMPTY_NEVER_STARTED';
    }else{classification='EMPTY_FAILED_BEFORE_SIDE_EFFECT';}
    const eligibleClass=['EMPTY_STALE_ORPHAN','EMPTY_NEVER_STARTED','EMPTY_FAILED_BEFORE_SIDE_EFFECT','DUPLICATE_EMPTY_TASK'].includes(classification);
    const hardDeleteEligible=eligibleClass&&!isActive&&!hasActiveLease&&pendingOutboxCount===0&&liveQueueJobCount===0
      &&continuationCount===0&&checkpointCount===0&&providerUsageEventCount===0&&providerRequestIdCount===0
      &&providerUsedUnits===0&&legacyProviderCalls===0&&businessOutputReferenceCount===0&&emailSideEffectCount===0
      &&crmSideEffectCount===0&&ambiguousReferenceCount===0;
    const reason=hardDeleteEligible?'STRICT_ZERO_SIDE_EFFECT_FORMULA_PASSED':classification;
    return{
      research_job_id:job.id,auto_evidence_task_id:taskIds.length===1?taskIds[0]:null,status:job.status,
      created_at:job.created_at,started_at:job.started_at,finished_at:job.completed_at,
      worker_claim_count:workerClaimCount,stage_event_count:Number(counts.stage_event_count),
      business_stage_event_count:businessStage+taskBusiness,provider_usage_event_count:providerUsageEventCount,
      provider_used_units:providerUsedUnits,provider_request_id_count:providerRequestIdCount,
      checkpoint_count:checkpointCount,business_output_reference_count:businessOutputReferenceCount,
      continuation_count:continuationCount,active_continuation_count:activeContinuationCount,
      pending_outbox_count:pendingOutboxCount,live_queue_job_count:liveQueueJobCount,
      email_side_effect_count:emailSideEffectCount,crm_side_effect_count:crmSideEffectCount,
      ambiguous_reference_count:ambiguousReferenceCount,classification,hard_delete_eligible:hardDeleteEligible,reason
    };
  }

  async classify(filters={}){
    const unknown=await this.unknownLineageColumns();
    const jobs=await this.listJobs(filters);
    const items=[];
    for(const job of jobs)items.push(await this.classifyJob(job,{unknownColumns:unknown}));
    const classes=['EMPTY_STALE_ORPHAN','EMPTY_NEVER_STARTED','EMPTY_FAILED_BEFORE_SIDE_EFFECT','DUPLICATE_EMPTY_TASK',
      'PROVIDER_USED_NO_BUSINESS_RESULT','BUSINESS_OUTPUT_PRESENT','ACTIVE_OR_RECOVERABLE','AMBIGUOUS_REFERENCE'];
    const summary=Object.fromEntries(classes.map(name=>[name,items.filter(item=>item.classification===name).length]));
    summary.HARD_DELETE_ELIGIBLE=items.filter(item=>item.hard_delete_eligible).length;
    return{items,summary,unknown_lineage_columns:unknown};
  }

  async purgeEligible(filters,{actor='phase10-empty-job-purge',reason='STRICT_EMPTY_JOB_POLICY'}={}){
    const auditReady=(await this.pool.query(`SELECT to_regclass('leadgen.research_job_purge_runs') runs,
      to_regclass('leadgen.research_job_purge_items') items`)).rows[0];
    if(!auditReady.runs||!auditReady.items)throw Object.assign(new Error('Purge audit migration is required before apply'),{
      code:'PURGE_AUDIT_MIGRATION_REQUIRED'});
    const candidates=(await this.classify(filters)).items.filter(item=>item.hard_delete_eligible);
    const run=await this.pool.query(`INSERT INTO leadgen.research_job_purge_runs(actor,reason)
      VALUES($1,$2) RETURNING id`,[actor,reason]);
    const results=[];
    for(const candidate of candidates){
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        const locked=(await client.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1 FOR UPDATE`,[candidate.research_job_id])).rows[0];
        if(!locked){await client.query('ROLLBACK');results.push({research_job_id:candidate.research_job_id,status:'RACE_ABORTED'});continue;}
        await client.query(`SELECT id FROM leadgen.auto_evidence_tasks WHERE category_research_job_id=$1 OR contact_research_job_id=$1 FOR UPDATE`,[locked.id]);
        const current=await this.classifyJob(locked,{client});
        if(!current.hard_delete_eligible){await client.query('ROLLBACK');results.push({research_job_id:locked.id,status:'RACE_ABORTED'});continue;}
        const childCounts={};
        for(const [name,sql] of [
          ['task_attempts',`DELETE FROM leadgen.auto_evidence_task_attempts WHERE research_job_id=$1`],
          ['stage_events',`DELETE FROM leadgen.research_job_stage_events WHERE research_job_id=$1`],
          ['dispatch_outbox',`DELETE FROM leadgen.research_job_dispatch_outbox WHERE research_job_id=$1`],
          ['search_queries',`DELETE FROM leadgen.research_search_queries WHERE research_job_id=$1`]
        ])childCounts[name]=(await client.query(sql,[locked.id])).rowCount;
        const tasks=await client.query(`DELETE FROM leadgen.auto_evidence_tasks
          WHERE category_research_job_id=$1 OR contact_research_job_id=$1 RETURNING id`,[locked.id]);
        childCounts.tasks=tasks.rowCount;
        await client.query(`DELETE FROM leadgen.research_jobs WHERE id=$1`,[locked.id]);
        const auditClassification=current.classification==='EMPTY_STALE_ORPHAN'?'EMPTY_NEVER_STARTED':current.classification;
        await client.query(`INSERT INTO leadgen.research_job_purge_items
          (purge_run_id,deleted_research_job_id,deleted_task_id,classification,deleted_child_counts,
           eligibility_snapshot_hash,actor,reason) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,[
          run.rows[0].id,locked.id,tasks.rows[0]?.id||null,auditClassification,JSON.stringify(childCounts),
          hash(current),actor,reason
        ]);
        await client.query('COMMIT');results.push({research_job_id:locked.id,status:'DELETED',child_counts:childCounts});
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
    return{purge_run_id:run.rows[0].id,results};
  }
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',
    password:process.env.POSTGRES_PASSWORD,max:6});
  try{
    const classifier=new ResearchJobPurgeClassifier({pool});
    const filters={jobId:args.jobId,taskId:args.taskId,status:args.status,createdBefore:args.createdBefore};
    const result=args.apply?await classifier.purgeEligible(filters):await classifier.classify(filters);
    console.log(JSON.stringify({mode:args.apply?'APPLY':'DRY_RUN',...result},null,2));
  }finally{await pool.end();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
