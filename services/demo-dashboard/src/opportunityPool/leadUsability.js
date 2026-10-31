// Supplementary contact verification bookkeeping (Simon's decision 2026-10-27 #2, migration 073).
//
// Every automatic contact search of a company that actually called a provider (a search query was
// executed or Hunter was called) appends one leadgen.lead_enrichment_attempts row. A paused or blocked
// run that made no provider call is not an attempt and is not recorded.
// An exploratory ("待研究") company that reaches MAX_LEAD_ENRICHMENT_ATTEMPTS real attempts (since its
// last restore) without any usable business email is marked UNUSABLE (无用线索) by an append-only
// leadgen.lead_usability_events row. Automatic contact research and research cohort reuse skip it;
// the research and company pages hide it unless "显示无用线索 / Show unusable leads" is on. An admin
// can restore it (a RESTORED row), which starts a fresh budget of attempts.
//
// "Usable business email" = any company business mailbox (info@ / sales@ / buying@ …): an email route
// of an active contact that is not INVALID and not suppressed, and that was published on the company's
// own site, entered manually, or shares the company's domain. A named decision maker is not required.
// Sending eligibility is still decided by the outreach gates (verification, suppression, bounce checks).

export const MAX_LEAD_ENRICHMENT_ATTEMPTS=5;
export const LEAD_USABILITY_MIGRATION_KEY='073_lead_enrichment_attempts.sql';
export const UNUSABLE_REASON_CODE='NO_USABLE_BUSINESS_EMAIL_AFTER_MAX_ATTEMPTS';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const missingRelation=error=>error?.code==='42P01';

/** SQL predicate: the company `alias.column` is currently marked as an unusable lead. */
export const unusableLeadSql=(alias='c',column='id')=>
  `EXISTS(SELECT 1 FROM leadgen.lead_usability_current lu_skip WHERE lu_skip.company_id=${alias}.${column} AND lu_skip.status='UNUSABLE')`;
export const usableLeadSql=(alias='c',column='id')=>`NOT ${unusableLeadSql(alias,column)}`;

/** Which automatic path started a research job (null = operator-started; operator runs are recorded but never skip). */
export function attemptSource(job){
  if(String(job?.created_by_role||'').toUpperCase()!=='SYSTEM')return 'OPERATOR';
  const identity=String(job?.created_by_identity||'');
  if(identity==='phase13-automation')return 'CONTACT_RESEARCH';
  if(identity==='phase10-auto-evidence')return 'AUTO_EVIDENCE';
  return 'SYSTEM_RECOVERY';
}
export const isAutomaticJob=job=>attemptSource(job)!=='OPERATOR';

// The company's own domain: official root domain, else website host, else a dotted normalized domain.
const COMPANY_DOMAIN_SQL=`lower(regexp_replace(coalesce(nullif(c.official_root_domain,''),
  substring(c.website_url from '^https?://(?:www\\.)?([^/:?#]+)'),
  CASE WHEN regexp_replace(coalesce(c.normalized_domain,''),'^live:([a-z]{2}:)?','') LIKE '%.%'
    THEN regexp_replace(c.normalized_domain,'^live:([a-z]{2}:)?','') END,''),'^www\\.',''))`;
export const USABLE_EMAIL_COUNT_SQL=`SELECT c.id company_id,count(DISTINCT lower(dc.contact_value_normalized))::int usable_email_count
  FROM leadgen.companies c
  JOIN leadgen.decision_maker_contacts dc ON dc.company_id=c.id
  LEFT JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
  WHERE c.id=ANY($1::uuid[]) AND coalesce(dm.lifecycle_status,'ACTIVE')='ACTIVE'
    AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
    AND dc.contact_value_normalized ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'
    AND coalesce(upper(dc.verification_status),'') NOT IN('INVALID')
    AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.decision_maker_contact_id=dc.id AND s.lifted_at IS NULL)
    AND (dc.evidence_origin IN('OFFICIAL_SITE_OBSERVED','MANUAL_ENTRY')
      OR (${COMPANY_DOMAIN_SQL} LIKE '%.%' AND (split_part(lower(dc.contact_value_normalized),'@',2)=${COMPANY_DOMAIN_SQL}
        OR split_part(lower(dc.contact_value_normalized),'@',2) LIKE '%.'||${COMPANY_DOMAIN_SQL})))
  GROUP BY c.id`;

export class LeadUsabilityService{
  constructor({pool,maxAttempts=MAX_LEAD_ENRICHMENT_ATTEMPTS,audit=()=>{}}={}){
    if(!pool)throw new Error('LeadUsabilityService pool required');
    Object.assign(this,{pool,maxAttempts:Math.max(1,Number(maxAttempts)||MAX_LEAD_ENRICHMENT_ATTEMPTS),audit});
  }

  async usableEmailCounts(companyIds,queryable=this.pool){
    if(!companyIds.length)return new Map();
    const rows=(await queryable.query(USABLE_EMAIL_COUNT_SQL,[companyIds])).rows;
    return new Map(rows.map(row=>[String(row.company_id),Number(row.usable_email_count||0)]));
  }

  /**
   * Records one attempt per enriched company of a finished EnrichmentService run and marks exploratory
   * companies unusable after the attempt budget. `results` are enrichCompany() results.
   * Returns {recorded, marked_unusable, skipped_no_provider_call}.
   */
  async recordJobAttempts(job,results,{strategyCode=null}={}){
    const out={recorded:0,marked_unusable:[],skipped_no_provider_call:0};
    if(!job?.id||!Array.isArray(results)||!results.length)return out;
    const ids=[...new Set(results.map(result=>String(result?.company_id||'')).filter(id=>UUID.test(id)))];
    if(!ids.length)return out;
    const source=attemptSource(job);
    // Real provider calls only: executed (COMPLETED/FAILED) search queries of this job + Hunter calls.
    const queries=new Map((await this.pool.query(`SELECT company_id,count(*)::int executed FROM leadgen.research_search_queries
      WHERE research_job_id=$1 AND company_id=ANY($2::uuid[]) AND status IN('COMPLETED','FAILED') GROUP BY company_id`,[job.id,ids])).rows
      .map(row=>[String(row.company_id),Number(row.executed||0)]));
    const usable=await this.usableEmailCounts(ids);
    const bands=new Map((await this.pool.query(`SELECT company_id,opportunity_pool_band FROM leadgen.opportunity_pool_current WHERE company_id=ANY($1::uuid[])`,[ids])).rows
      .map(row=>[String(row.company_id),row.opportunity_pool_band]));
    for(const result of results){
      const companyId=String(result?.company_id||'');if(!UUID.test(companyId))continue;
      const executed=queries.get(companyId)||0;const hunterCalls=Math.max(0,Number(result?.hunter?.calls||0));
      if(executed===0&&hunterCalls===0){out.skipped_no_provider_call++;continue;}
      const emails=usable.get(companyId)||0;
      const outcome=emails>0?'USABLE_EMAIL_FOUND':String(result?.status||'').toUpperCase()==='FAILED'?'FAILED':'NO_USABLE_EMAIL';
      const inserted=await this.pool.query(`INSERT INTO leadgen.lead_enrichment_attempts
        (company_id,research_job_id,attempt_source,opportunity_pool_band,outcome,search_queries_executed,hunter_calls,
         usable_email_count,decision_makers_found,enrichment_status,stop_reason,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,[
        companyId,job.id,source,bands.get(companyId)||null,outcome,executed,hunterCalls,emails,
        Math.max(0,Number(result?.findings?.decision_makers?.length||0)),clean(result?.status,40)||null,
        clean(result?.stop_reason||result?.hunter?.stop_reason,120)||null,`${job.id}:${companyId}:${clean(strategyCode,80)||'DEFAULT'}`]);
      if(inserted.rowCount)out.recorded++;
      if(emails===0&&bands.get(companyId)==='EXPLORATORY'){
        const marked=await this.markIfExhausted(companyId);
        if(marked)out.marked_unusable.push(companyId);
      }
    }
    return out;
  }

  /** Appends an UNUSABLE row when the attempt budget is used up without a usable email. Idempotent. */
  async markIfExhausted(companyId,{actor='lead-enrichment-automation'}={}){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('LEAD_USABILITY:'||$1,0))`,[companyId]);
      const current=(await client.query(`SELECT status FROM leadgen.lead_usability_current WHERE company_id=$1`,[companyId])).rows[0];
      const counts=(await client.query(`SELECT * FROM leadgen.lead_enrichment_attempt_current WHERE company_id=$1`,[companyId])).rows[0];
      const usable=(await this.usableEmailCounts([companyId],client)).get(String(companyId))||0;
      const attempts=Number(counts?.attempts_since_restore||0);
      if(current?.status==='UNUSABLE'||usable>0||Number(counts?.usable_attempts_since_restore||0)>0||attempts<this.maxAttempts){
        await client.query('COMMIT');return null;
      }
      const row=(await client.query(`INSERT INTO leadgen.lead_usability_events
        (company_id,status,reason_code,reason,attempt_count,last_attempt_id,actor,idempotency_key)
        VALUES($1,'UNUSABLE',$2,$3,$4,$5,$6,$7) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,[companyId,UNUSABLE_REASON_CODE,
        `${attempts} automatic contact searches found no usable business email`,attempts,counts.last_attempt_id,actor,
        `unusable:${companyId}:${counts.last_attempt_id}`])).rows[0]||null;
      await client.query('COMMIT');
      if(row)this.audit('LEAD_MARKED_UNUSABLE',{company_id:companyId,attempt_count:attempts});
      return row;
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }

  /** Admin restore: appends a RESTORED row; automatic searches may run again (fresh attempt budget). */
  async restore(companyId,{actor,reason}={}){
    if(!UUID.test(String(companyId||'')))throw fail('COMPANY_ID_INVALID','Invalid company',400);
    const who=clean(actor,200);if(!who)throw fail('ACTOR_REQUIRED','Actor is required',422);
    const why=clean(reason,1000)||'Restored by admin';
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('LEAD_USABILITY:'||$1,0))`,[companyId]);
      const current=(await client.query(`SELECT * FROM leadgen.lead_usability_current WHERE company_id=$1`,[companyId])).rows[0];
      if(current?.status!=='UNUSABLE'){await client.query('ROLLBACK');throw fail('LEAD_NOT_UNUSABLE','This company is not marked as an unusable lead',409);}
      const counts=(await client.query(`SELECT total_attempts FROM leadgen.lead_enrichment_attempt_current WHERE company_id=$1`,[companyId])).rows[0];
      const row=(await client.query(`INSERT INTO leadgen.lead_usability_events
        (company_id,status,reason_code,reason,attempt_count,actor,idempotency_key)
        VALUES($1,'RESTORED','ADMIN_RESTORED',$2,$3,$4,$5) RETURNING *`,[companyId,why,Number(counts?.total_attempts||0),who,
        `restored:${companyId}:${current.revision}`])).rows[0];
      await client.query('COMMIT');
      this.audit('LEAD_RESTORED',{company_id:companyId,actor:who});
      return publicStatus(row);
    }catch(error){if(!error.status)try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }

  /** Map company_id → {status, reason_code, attempts…}. Tolerates a database without migration 073. */
  async statusFor(companyIds){
    const ids=[...new Set((companyIds||[]).map(String).filter(id=>UUID.test(id)))];
    if(!ids.length)return new Map();
    try{
      const rows=(await this.pool.query(`SELECT i.company_id,u.status,u.reason_code,u.reason,u.created_at marked_at,u.actor,
          coalesce(a.attempts_since_restore,0)::int attempts_since_restore,coalesce(a.total_attempts,0)::int total_attempts,a.last_attempt_at
        FROM unnest($1::uuid[]) i(company_id)
        LEFT JOIN leadgen.lead_usability_current u ON u.company_id=i.company_id
        LEFT JOIN leadgen.lead_enrichment_attempt_current a ON a.company_id=i.company_id`,[ids])).rows;
      return new Map(rows.map(row=>[String(row.company_id),{status:row.status==='UNUSABLE'?'UNUSABLE':'USABLE',
        reason_code:row.status==='UNUSABLE'?row.reason_code:null,reason:row.status==='UNUSABLE'?row.reason:null,
        marked_at:row.status==='UNUSABLE'?row.marked_at:null,attempts:row.attempts_since_restore,total_attempts:row.total_attempts,
        max_attempts:this.maxAttempts,last_attempt_at:row.last_attempt_at||null}]));
    }catch(error){if(missingRelation(error))return new Map();throw error;}
  }

  /** Adds lead_usability + unusable_lead to list rows (company_id or id). */
  async decorate(rows){
    if(!Array.isArray(rows)||!rows.length)return rows;
    const status=await this.statusFor(rows.map(row=>row.company_id||row.id));
    return rows.map(row=>{const value=status.get(String(row.company_id||row.id));
      return value?{...row,lead_usability:value,unusable_lead:value.status==='UNUSABLE'}:{...row,unusable_lead:false};});
  }

  async history(companyId){
    if(!UUID.test(String(companyId||'')))throw fail('COMPANY_ID_INVALID','Invalid company',400);
    const [attempts,events]=await Promise.all([
      this.pool.query(`SELECT id,research_job_id,attempt_source,opportunity_pool_band,outcome,search_queries_executed,hunter_calls,
        usable_email_count,decision_makers_found,stop_reason,created_at FROM leadgen.lead_enrichment_attempts WHERE company_id=$1 ORDER BY revision`,[companyId]),
      this.pool.query(`SELECT id,status,reason_code,reason,attempt_count,actor,created_at FROM leadgen.lead_usability_events WHERE company_id=$1 ORDER BY revision`,[companyId])]);
    return{company_id:companyId,max_attempts:this.maxAttempts,attempts:attempts.rows,events:events.rows,
      current:(await this.statusFor([companyId])).get(String(companyId))||null};
  }
}
const publicStatus=row=>({company_id:row.company_id,status:row.status==='UNUSABLE'?'UNUSABLE':'USABLE',event:row.status,
  reason_code:row.reason_code,reason:row.reason,actor:row.actor,created_at:row.created_at});

export async function verifyLeadEnrichmentAttemptsMigration(client){
  const row=(await client.query(`SELECT to_regclass('leadgen.lead_enrichment_attempts') attempts,to_regclass('leadgen.lead_usability_events') events,
    to_regclass('leadgen.lead_usability_current') current_view,to_regclass('leadgen.lead_enrichment_attempt_current') attempt_view,
    (SELECT count(*)::int FROM pg_trigger WHERE tgname IN('lead_enrichment_attempts_history_guard','lead_usability_events_history_guard') AND NOT tgisinternal) guards`)).rows[0]||{};
  if(!row.attempts||!row.events||!row.current_view||!row.attempt_view||Number(row.guards)!==2)
    throw new Error('Migration 073 verification failed: lead enrichment attempt tables, views or guards are missing');
  return{lead_enrichment_attempts:'APPEND_ONLY',lead_usability_events:'APPEND_ONLY',max_attempts:MAX_LEAD_ENRICHMENT_ATTEMPTS};
}
