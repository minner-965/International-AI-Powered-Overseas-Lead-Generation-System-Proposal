import {createHash} from 'node:crypto';
import {MAX_LEAD_ENRICHMENT_ATTEMPTS,usableLeadSql} from '../opportunityPool/leadUsability.js';
import {contactVerificationTtlDays} from '../verification/contactVerificationPolicy.js';

const AUTOMATION_IDENTITY='phase13-automation';
const JOB_TYPES=Object.freeze(['DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH']);
const ACTIVE_JOB_STATES=Object.freeze(['DISCOVERING','RESOLVING','VERIFYING','PERSISTING']);

function canonicalDigest(value){
  const canonical=Object.fromEntries(Object.entries(value||{}).sort(([left],[right])=>left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// Automatic contact research (decision-maker search + Hunter email checks) for active
// opportunities. It runs only while its own control (CONTACT_RESEARCH_EXECUTION) is on and a
// search provider permitted by the spend policy is available; otherwise it returns PAUSED and
// creates or queues nothing. queueName is PHASE5_QUEUES.ENRICH_DECISION_MAKERS.
// Exploratory ("待研究") companies also get this supplementary contact verification (Simon's decision
// 2026-10-27 #2), after the active opportunities, until a usable business email is found or the company
// has used MAX_LEAD_ENRICHMENT_ATTEMPTS real attempts and is marked 无用线索 (unusable leads are skipped).
// Spend still goes through the same switch, spend mode (FREE_ONLY), provider router and Hunter caps.
export class ContactResearchReconciler{
  constructor({pool,queue,queueName,automation,selectProvider=null,env=process.env,hunterRunCapUnits=5,
    includeExploratory=String(env?.CONTACT_RESEARCH_EXPLORATORY??'true').toLowerCase()!=='false',maxExploratoryAttempts=MAX_LEAD_ENRICHMENT_ATTEMPTS}={}){
    if(!pool||!queue||!queueName||!automation)throw new Error('ContactResearchReconciler requires pool, queue, queueName and automation');
    Object.assign(this,{pool,queue,queueName,automation,selectProvider,env,hunterRunCapUnits,includeExploratory,
      maxExploratoryAttempts:Math.max(1,Number(maxExploratoryAttempts)||MAX_LEAD_ENRICHMENT_ATTEMPTS)});
  }

  // Queue worker guard: automation-created jobs do not run while the switch is off. The job stays
  // QUEUED and reconcile() queues it again once the switch is back on.
  async jobAllowed(researchJobId){
    const job=(await this.pool.query('SELECT created_by_identity FROM leadgen.research_jobs WHERE id=$1',[researchJobId])).rows[0];
    if(!job||job.created_by_identity!==AUTOMATION_IDENTITY)return {allowed:true};
    return await this.automation.isContactResearchEnabled()?{allowed:true}:{allowed:false,status:'PAUSED',reason:'PAUSED_AUTOMATION_OFF'};
  }

  async reconcile({limit=5}={}){
    const state=await this.automation.getState();
    if(!state.contact_research_automation)return{status:'PAUSED',reason:'PAUSED_AUTOMATION_OFF',created:0};
    if(this.selectProvider){
      const selected=await this.selectProvider();
      if(!selected?.provider)return{status:'PAUSED',reason:selected?.reason||'PAUSED_PROVIDER_UNAVAILABLE',created:0};
    }
    const orphaned=await this.pool.query(`UPDATE leadgen.research_jobs j SET status='FAILED',completed_at=now(),
        error_count=error_count+1,last_error='WORKER_RESTART_RECOVERY'
      WHERE j.created_by_identity=$2
        AND j.job_type=ANY($3::text[])
        AND j.status=ANY($4::text[])
        AND NOT EXISTS(SELECT 1 FROM pgboss.job work
          WHERE work.name=$1 AND work.data->>'research_job_id'=j.id::text
            AND work.state IN('created','retry','active'))
      RETURNING j.id,j.error_count`,[this.queueName,AUTOMATION_IDENTITY,JOB_TYPES,ACTIVE_JOB_STATES]);
    for(const job of orphaned.rows)await this.queue.enqueue(this.queueName,
      {research_job_id:job.id},{singletonKey:`phase13-contact-research-recovery:${job.id}:${job.error_count}`});
    // Jobs that waited while the switch was off (the worker left them QUEUED) are queued again.
    const waiting=await this.pool.query(`SELECT j.id FROM leadgen.research_jobs j
      WHERE j.created_by_identity=$2 AND j.job_type=ANY($3::text[]) AND j.status='QUEUED'
        AND NOT EXISTS(SELECT 1 FROM pgboss.job work
          WHERE work.name=$1 AND work.data->>'research_job_id'=j.id::text
            AND work.state IN('created','retry','active'))
      ORDER BY j.created_at LIMIT 10`,[this.queueName,AUTOMATION_IDENTITY,JOB_TYPES]);
    for(const job of waiting.rows)await this.queue.enqueue(this.queueName,
      {research_job_id:job.id},{singletonKey:`phase13-contact-research-resume:${job.id}`});
    const recovered=orphaned.rowCount+waiting.rowCount;
    const selected=await this.pool.query(`SELECT p.company_id,c.country_code,p.opportunity_pool_band,
        coalesce((SELECT item->>'product_profile' FROM jsonb_array_elements(coalesce(p.profile_results,'[]'::jsonb)) item
          WHERE item->>'band' IN('PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY')
          ORDER BY CASE item->>'band' WHEN 'PRECISION' THEN 1 WHEN 'RELEVANT' THEN 2 WHEN 'GENERAL_RELEVANT' THEN 3 ELSE 4 END,
            CASE WHEN item->>'category_basis'='NO_CURRENT_CATEGORY_EVIDENCE' THEN 1 ELSE 0 END LIMIT 1),'WOMENSWEAR') product_profile,
        EXISTS(SELECT 1 FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
            AND dc.evidence_origin='OFFICIAL_SITE_OBSERVED') has_official_email_candidate
      FROM leadgen.opportunity_pool_current p JOIN leadgen.companies c ON c.id=p.company_id
      LEFT JOIN leadgen.lead_enrichment_attempt_current a ON a.company_id=c.id
      WHERE ((p.is_active_business_opportunity=true AND p.opportunity_pool_band=ANY($1::text[]))
          OR ($4::boolean AND p.opportunity_pool_band='EXPLORATORY' AND coalesce(a.attempts_since_restore,0)<$5::int))
        AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND ${usableLeadSql('c')}
        AND NOT EXISTS(SELECT 1 FROM leadgen.phase13_first_touch_reservations r WHERE r.company_id=c.id)
        AND NOT EXISTS(SELECT 1 FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
          WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE' AND dc.verification_status='VALID'
            AND dc.last_verified_at>=now()-($2::int*interval '1 day'))
        AND NOT EXISTS(SELECT 1 FROM leadgen.enrichment_job_companies e
          WHERE e.company_id=c.id AND e.updated_at>=now()-interval '24 hours')
        AND NOT EXISTS(SELECT 1 FROM leadgen.research_jobs j
          WHERE c.id=ANY(coalesce(j.requested_company_ids,'{}'::uuid[]))
            AND j.job_type IN('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH')
            AND j.status IN('QUEUED','DISCOVERING','RESOLVING','VERIFYING','PERSISTING'))
      ORDER BY (p.opportunity_pool_band='EXPLORATORY'),has_official_email_candidate DESC,
        CASE p.opportunity_pool_band WHEN 'PRECISION' THEN 1 WHEN 'RELEVANT' THEN 2 ELSE 3 END,
        p.observed_at DESC,p.company_id LIMIT $3`,[state.allowed_bands,
        contactVerificationTtlDays(this.env),Math.max(1,Math.min(10,Number(limit)||5)),
        this.includeExploratory,this.maxExploratoryAttempts]);
    if(!selected.rowCount)return{status:'WAITING_CONTACT_RESEARCH_WORK',created:0,company_count:0,recovered};
    // One job per product profile, so every requested company is enriched for exactly that profile.
    const groups=new Map();
    for(const row of selected.rows){const profile=String(row.product_profile||'WOMENSWEAR').toUpperCase();
      if(!groups.has(profile))groups.set(profile,[]);groups.get(profile).push(row);}
    const jobs=[];
    for(const [profile,rows] of groups)jobs.push(await this.createJob(profile,rows));
    const exploratory=selected.rows.filter(row=>row.opportunity_pool_band==='EXPLORATORY').length;
    const created=jobs.filter(job=>job.inserted).length;
    return{status:created?'QUEUED':'REUSED',created,company_count:selected.rowCount,exploratory_company_count:exploratory,
      research_job_id:jobs[0].id,research_job_ids:jobs.map(job=>job.id),recovered};
  }

  async createJob(productProfile,rows){
    const companyIds=rows.map(row=>row.company_id);
    const marketCodes=[...new Set(rows.map(row=>String(row.country_code||'').toUpperCase()).filter(Boolean))];
    const requestPayload={market_codes:marketCodes,product_profiles:[productProfile],company_ids:companyIds,max_results:companyIds.length,
      automation_revision:'MC07_CONTACT_RESEARCH_V1'};
    const digest=canonicalDigest(requestPayload);
    const day=new Date().toISOString().slice(0,10);
    const inserted=await this.pool.query(`INSERT INTO leadgen.research_jobs
      (country,country_code,country_name,preferred_language,market_profile,product_category,product_profile,
       buyer_types,max_results,status,job_type,market_codes,product_profiles,requested_company_ids,
       idempotency_key,request_digest,created_by_identity,created_by_role,run_budget_cap_units)
      VALUES('Automated active opportunities','XX','Automated active opportunities','en','MULTI_MARKET',
        'Buyer / Procurement Enrichment',$1,$2,$3,'QUEUED','DECISION_MAKER_ENRICHMENT',$4,$5,$6,$7,$8,
        $10,'SYSTEM',$9)
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id,status,(xmax=0) inserted`,[
        productProfile,['Buyer','Procurement','Purchasing','Category','Merchandising','Sourcing'],
        companyIds.length,marketCodes,[productProfile],companyIds,`phase13-contact-research:${day}:${digest}`,digest,
        this.hunterRunCapUnits,AUTOMATION_IDENTITY]);
    const job=inserted.rows[0];
    if(job.inserted)await this.queue.enqueue(this.queueName,{research_job_id:job.id},{singletonKey:`phase13-contact-research:${job.id}`});
    return job;
  }
}
