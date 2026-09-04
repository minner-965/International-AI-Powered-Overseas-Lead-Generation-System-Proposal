import { projectResearchTask,compareResearchTasks,rankCohortCandidate } from './researchTaskProjection.js';
import { createHash } from 'node:crypto';

const ACTIVE_JOB_STATES = Object.freeze(['QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING','RESOLVING','VERIFYING','PERSISTING']);
const COMPLETE_JOB_STATES = new Set(['COMPLETE','COMPLETED']);
const PRODUCT_PROFILES = new Set(['WOMENSWEAR','GENERAL_MERCHANDISE']);
const JOB_TYPES = new Set(['COMPANY_DISCOVERY','DECISION_MAKER_ENRICHMENT','CATEGORY_PROCUREMENT_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH']);
const READ_ROLES = new Set(['MANAGEMENT','DATA_ADMIN','SALES']);
const upper = value => String(value ?? '').trim().toUpperCase();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function boundedInt(value,{min=0,max=100,fallback=0}={}) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min,Math.min(max,Math.trunc(number))) : fallback;
}

function decodeCursor(value) {
  if (!value) return 0;
  try {
    const decoded = Buffer.from(String(value),'base64url').toString('utf8');
    if (!/^offset:\d+$/.test(decoded)) throw new Error('invalid');
    return boundedInt(decoded.slice(7),{max:10000});
  } catch {
    const error = new Error('Invalid cursor');
    error.code='RESEARCH_CURSOR_INVALID';
    error.status=400;
    throw error;
  }
}

function encodeCursor(offset) {
  return Buffer.from(`offset:${offset}`,'utf8').toString('base64url');
}

function publicJobStatus(row = {}) {
  const status=upper(row.status);
  if (ACTIVE_JOB_STATES.includes(status)) return status === 'QUEUED' ? 'QUEUED' : 'RUNNING';
  if (COMPLETE_JOB_STATES.has(status)) return 'COMPLETED';
  if (status === 'PARTIAL') return 'WAITING_EVIDENCE';
  if (status === 'FAILED') {
    const code=upper(row.stop_reason_code || row.last_error);
    return /(TIMEOUT|TEMPORARY|NETWORK|FETCH|429|5\d\d)/.test(code) ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
  }
  return 'WAITING_EVIDENCE';
}

function jobObjective(type) {
  return ['DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH'].includes(type) ? 'BUYER_AND_CONTACT_EVIDENCE'
    :type === 'CATEGORY_PROCUREMENT_ENRICHMENT' ? 'COMPANY_CATEGORY_EVIDENCE'
      :'COMPANY_DISCOVERY';
}

function publicJob(row = {}) {
  const publicStatus=publicJobStatus(row);
  const dispatchVisible=['QUEUED','RUNNING'].includes(publicStatus);
  const companiesSelected=Array.isArray(row.requested_company_ids)&&row.requested_company_ids.length
    ? row.requested_company_ids.length : Number(row.companies_attempted || row.candidates_found || 0);
  const companiesAttempted=Number(row.companies_attempted || 0);
  const rawStatus=upper(row.status);
  const hasFrozenCohort=Array.isArray(row.requested_company_ids)&&row.requested_company_ids.length>0;
  const completedUnits=Math.max(companiesAttempted,Number(row.candidate_verifications_completed || 0));
  const stageFloor=rawStatus==='DISCOVERING'?8:rawStatus==='CRAWLING'?30:rawStatus==='QUALIFYING'?76:rawStatus==='SCORING'?90:0;
  const stageCeiling=rawStatus==='DISCOVERING'?25:rawStatus==='CRAWLING'?68:rawStatus==='QUALIFYING'?84:rawStatus==='SCORING'?98:99;
  const progressPercent=publicStatus === 'COMPLETED' ? 100
    : publicStatus === 'QUEUED' ? 0
      : hasFrozenCohort ? Math.min(99,Math.round((companiesAttempted/companiesSelected)*100))
      : companiesSelected > 0 ? Math.max(stageFloor,Math.min(stageCeiling,
        stageFloor+Math.round((completedUnits/companiesSelected)*Math.max(0,stageCeiling-stageFloor)))) : stageFloor;
  return Object.freeze({
    job_id:row.id,
    objective:jobObjective(upper(row.job_type)),
    job_type:upper(row.job_type || 'COMPANY_DISCOVERY'),
    status:publicStatus,
    progress_stage:publicStatus === 'RUNNING' ? upper(row.status) : publicStatus,
    market_codes:Array.isArray(row.market_codes)&&row.market_codes.length ? row.market_codes.map(upper) : [upper(row.country_code)].filter(Boolean),
    product_profiles:Array.isArray(row.product_profiles)&&row.product_profiles.length ? row.product_profiles.map(upper) : [upper(row.product_profile)].filter(Boolean),
    country_name:row.country_name || row.country || null,
    city:row.city || null,
    region:row.region || null,
    product_category:row.product_category || null,
    buyer_types:Array.isArray(row.buyer_types) ? row.buyer_types : [],
    max_results:Number(row.max_results || 0),
    companies_selected:companiesSelected,
    companies_attempted:companiesAttempted,
    progress_percent:progressPercent,
    category_matches:Number(row.category_matches_passed || 0),
    verified_buyers:Number(row.verified_named_buyers || 0),
    verified_email_routes:Number(row.verified_email_routes || 0),
    candidates_found:Number(row.candidates_found || 0),
    websites_found:Number(row.websites_found || row.reachable_candidates || 0),
    provider_call_count:Number(row.provider_call_count || 0),
    provider_completed_count:Number(row.provider_completed_count || 0),
    provider_not_found_count:Number(row.provider_not_found_count || 0),
    provider_temporary_error_count:Number(row.provider_temporary_error_count || 0),
    provider_failed_count:Number(row.provider_failed_count || 0),
    reserved_units:Number(row.reserved_units || 0),
    used_units:Number(row.used_units || 0),
    released_units:Number(row.released_units || 0),
    last_provider_event_at:row.last_provider_event_at || null,
    projection_updated_at:row.projection_updated_at || null,
    search_successful_requests:Number(row.search_successful_requests || 0),
    search_failed_requests:Number(row.search_failed_requests || 0),
    candidates_checked:Number(row.candidates_checked || 0),
    companies_inserted:Number(row.companies_inserted || row.companies_promoted_new || 0),
    companies_updated:Number(row.companies_updated || row.companies_enriched_existing || 0),
    companies_rejected:Number(row.companies_rejected || row.candidates_rejected_phase4 || 0),
    companies_review_required:Number(row.companies_review_required || row.candidates_in_review || 0),
    contacts_found:Number(row.contacts_found || row.contact_routes_found ||
      Number(row.public_emails_found || 0)+Number(row.public_phones_found || 0)+
      Number(row.public_whatsapp_found || 0)+Number(row.contact_forms_found || 0)),
    verified_companies:Number(row.verified_companies || row.candidates_verified || 0),
    rejected_companies:Number(row.rejected_companies || row.candidates_rejected_phase4 || 0),
    review_required_companies:Number(row.review_required_companies || row.candidates_in_review || 0),
    blocker:publicStatus === 'FAILED_RETRYABLE' ? 'TEMPORARY_ERROR'
      :publicStatus === 'FAILED_FINAL' ? 'JOB_FAILED'
        :publicStatus === 'WAITING_EVIDENCE' ? 'EVIDENCE_REQUIRED'
          :publicStatus === 'QUEUED' && row.dispatch_state && row.dispatch_state!=='DISPATCHED' && row.dispatch_state!=='PENDING'
            ? upper(row.dispatch_state) : null,
    dispatch_state:dispatchVisible ? upper(row.dispatch_state || '') : '',
    queued_at:dispatchVisible&&row.dispatch_state ? row.created_at : null,
    expected_worker_status:dispatchVisible&&['PENDING','DISPATCHED'].includes(upper(row.dispatch_state))?'QUEUED_OR_ACTIVE':null,
    blocked_reason:row.blocked_reason || null,
    last_dispatch_attempt_at:row.last_dispatch_attempt_at || null,
    next_dispatch_attempt_at:row.next_dispatch_attempt_at || null,
    error_count:Number(row.error_count || 0),
    created_at:row.created_at,
    updated_at:row.completed_at || row.started_at || row.created_at,
    completed_at:row.completed_at || null
  });
}

export class ResearchWorkbenchService {
  constructor({pool,hunter=null,autoEvidence=null,providerAccountState=null,contactVerificationTtlDays=30,runCapUnits=20000,billingPeriodCapUnits=20000,publicDataOrigins=[]}={}) {
    if (!pool) throw new Error('ResearchWorkbenchService requires a PostgreSQL pool');
    this.pool=pool;
    this.hunter=hunter;
    this.autoEvidence=autoEvidence;
    this.providerAccountState=providerAccountState;
    this.contactVerificationTtlDays=Math.max(1,Number(contactVerificationTtlDays)||30);
    this.runCapUnits=Math.max(0,Number(runCapUnits)||0);
    this.billingPeriodCapUnits=Math.max(0,Number(billingPeriodCapUnits)||0);
    this.publicDataOrigins=publicDataOrigins;
  }

  assertReadRole(role) {
    if (!READ_ROLES.has(upper(role))) {
      const error=new Error('Role is not permitted to view research work');
      error.code='RESEARCH_ROLE_FORBIDDEN';error.status=403;throw error;
    }
  }

  async taskRows() {
    const result=await this.pool.query(`WITH decisions AS (
      SELECT o.*,c.company_name,c.country_code,
        bbm.buyer_model,cpm.match_status category_match_status,cpm.coverage_percent evidence_coverage,
        f.readiness_blockers,
        EXISTS(SELECT 1 FROM leadgen.company_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL) company_suppressed,
        EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL) contact_suppressed
      FROM leadgen.business_opportunity_current o
      JOIN leadgen.companies c ON c.id=o.company_id
      LEFT JOIN leadgen.buyer_business_model_results bbm ON bbm.id=o.buyer_business_model_result_id
      LEFT JOIN leadgen.category_procurement_match_results cpm ON cpm.id=o.category_procurement_match_result_id
      LEFT JOIN leadgen.cooperation_feasibility_results f ON f.id=o.cooperation_feasibility_result_id
      WHERE o.business_fit_status='EVIDENCE_REQUIRED'
        AND o.display_opportunity_status='EVIDENCE_REQUIRED'
        AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l
          JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
          WHERE l.company_id=c.id AND l.link_status='CONFIRMED' AND h.customer_role='INTERNAL_EXISTING_CUSTOMER')
    )
    SELECT d.id opportunity_id,d.company_id,d.company_name,d.country_code market,d.product_profile,d.research_job_id job_id,
      d.reason_codes,d.readiness_blockers,d.category_match_status,d.evidence_coverage,d.company_suppressed,d.contact_suppressed,
      coalesce(dm.profile_relevant_buyer_count,0)::int profile_relevant_buyer_count,
      coalesce(dm.verified_buyer_role_count,0)::int verified_buyer_role_count,
      coalesce(dm.business_email_route_count,0)::int business_email_route_count,
      coalesce(dm.active_valid_email_route_count,0)::int active_valid_email_route_count,
      coalesce(dm.email_route_statuses,'{}'::text[]) email_route_statuses,
      coalesce(src.source_count,0)::int source_count,
      greatest(d.created_at,dm.latest_activity,src.latest_activity) latest_activity,
      extract(day from now()-greatest(d.created_at,dm.latest_activity,src.latest_activity))::int evidence_age_days
    FROM decisions d
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT x.id) FILTER (WHERE x.person_name IS NOT NULL AND x.verification_status='VERIFIED'
          AND x.lifecycle_status='ACTIVE' AND pr.relevance IN('HIGH','MEDIUM')) profile_relevant_buyer_count,
        count(DISTINCT x.id) FILTER (WHERE x.person_name IS NOT NULL AND x.verification_status='VERIFIED'
          AND x.lifecycle_status='ACTIVE' AND pr.relevance IN('HIGH','MEDIUM')
          AND x.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')) verified_buyer_role_count,
        count(DISTINCT dc.id) FILTER (WHERE x.person_name IS NOT NULL AND x.verification_status='VERIFIED'
          AND x.lifecycle_status='ACTIVE' AND pr.relevance IN('HIGH','MEDIUM')
          AND x.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')
          AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')) business_email_route_count,
        count(DISTINCT dc.id) FILTER (WHERE dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
          AND x.person_name IS NOT NULL AND x.verification_status='VERIFIED' AND x.lifecycle_status='ACTIVE'
          AND pr.relevance IN('HIGH','MEDIUM')
          AND x.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')
          AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($1::int*interval '1 day')) active_valid_email_route_count,
        array_remove(array_agg(DISTINCT dc.verification_status),NULL) email_route_statuses,
        max(greatest(x.updated_at,dc.updated_at)) latest_activity
      FROM leadgen.decision_makers x
      LEFT JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=x.id AND pr.product_profile=d.product_profile
      LEFT JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=x.id
      WHERE x.company_id=d.company_id
    ) dm ON true
    LEFT JOIN LATERAL (
      SELECT count(*) source_count,max(captured_at) latest_activity FROM (
        SELECT s.captured_at FROM leadgen.decision_maker_sources s JOIN leadgen.decision_makers x ON x.id=s.decision_maker_id
          WHERE x.company_id=d.company_id
        UNION ALL
        SELECT DISTINCT s.captured_at FROM leadgen.prospect_category_sources s
          JOIN leadgen.prospect_category_observations o ON o.source_id=s.id
          WHERE s.company_id=d.company_id AND o.normalized_profile=d.product_profile
      ) evidence
    ) src ON true`,[this.contactVerificationTtlDays]);
    return result.rows;
  }

  async listTasks(query={}) {
    const status=upper(query.status);
    const taskType=upper(query.task_type);
    const market=upper(query.market);
    const profile=upper(query.product_profile);
    const companyId=String(query.company_id || '').trim();
    const opportunityId=String(query.opportunity_id || '').trim();
    const jobId=String(query.job_id || '').trim();
    const limit=boundedInt(query.limit,{min:1,max:100,fallback:50});
    const offset=decodeCursor(query.cursor);
    let tasks=(await this.taskRows()).map(projectResearchTask);
    if(this.autoEvidence){
      const autoRows=await this.autoEvidence.repository.listTasks({limit:100});
      const blockerMap={CATEGORY_EVIDENCE:'PRODUCT',BUYER_MODEL_EVIDENCE:'BUYER_MODEL',NAMED_BUYER_EVIDENCE:'CONTACT',
        VERIFIED_EMAIL_EVIDENCE:'EMAIL',DECISION_REFRESH:'EVIDENCE'};
      tasks.push(...autoRows.map(row=>({
        task_id:row.id,status:'WAITING_EVIDENCE',task_type:`AUTO_${upper(row.business_blocker)}`,
        task_class:row.task_class,priority:row.task_status==='HUMAN_REVIEW_REQUIRED'?1:2,
        company_id:row.company_id,company_name:row.company_name,market:upper(row.market),
        product_profile:upper(row.product_profile),opportunity_id:null,
        job_id:row.contact_research_job_id||row.category_research_job_id||null,
        blocker:blockerMap[upper(row.business_blocker)]||'EVIDENCE',
        business_blocker:upper(row.business_blocker),auto_evidence_status:upper(row.task_status),
        auto_evidence_stage:upper(row.current_stage),human_review_required:row.human_review_required===true,
        retry_at:row.retry_at||null,budget_state:upper(row.budget_state),latest_activity:row.updated_at||row.created_at,
        updated_at:row.updated_at||row.created_at,attempt_count:Number(row.strategy_attempt_count??row.attempt_count??0),
        strategy_attempt_number:Number(row.strategy_attempt_count??0),
        strategy_code:row.current_strategy_code||null,strategy_state:upper(row.strategy_state),
        provider_retry_number:Number(row.provider_retry_count||0),worker_retry_number:Number(row.worker_retry_count||0),
        checkpoint_replay_number:Number(row.checkpoint_replay_count||0),
        technical_blocker:row.technical_blocker||null
      })));
    }
    tasks.sort(compareResearchTasks);
    if(status) tasks=tasks.filter(item=>item.status===status);
    if(taskType) tasks=tasks.filter(item=>item.task_type===taskType);
    if(market) tasks=tasks.filter(item=>item.market===market);
    if(profile) tasks=tasks.filter(item=>item.product_profile===profile);
    if(companyId) tasks=tasks.filter(item=>item.company_id===companyId);
    if(opportunityId) tasks=tasks.filter(item=>item.opportunity_id===opportunityId);
    if(jobId) tasks=tasks.filter(item=>item.job_id===jobId);
    if(upper(query.sort)==='LATEST') tasks.sort((a,b)=>String(b.latest_activity||'').localeCompare(String(a.latest_activity||''))||compareResearchTasks(a,b));
    const items=tasks.slice(offset,offset+limit);
    return {as_of:new Date().toISOString(),total:tasks.length,items,next_cursor:offset+items.length<tasks.length?encodeCursor(offset+items.length):null};
  }

  async catalogProfiles() {
    const result=await this.pool.query(`SELECT DISTINCT ON(product_profile) product_profile,eligible_product_count,
      classified_product_count,unknown_product_count,excluded_product_count,coverage_percent,created_at
      FROM leadgen.product_profile_catalog_snapshots WHERE product_profile=ANY($1::text[])
      ORDER BY product_profile,created_at DESC,id DESC`,[[...PRODUCT_PROFILES]]);
    return result.rows.map(row=>({product_profile:row.product_profile,
      rows:Number(row.classified_product_count)+Number(row.unknown_product_count)+Number(row.excluded_product_count),
      eligible_rows:Number(row.eligible_product_count),classified_rows:Number(row.classified_product_count),
      unknown_rows:Number(row.unknown_product_count),coverage_percent:Number(row.coverage_percent),captured_at:row.created_at}));
  }

  async budgetState() {
    const mode=upper(this.hunter?.capabilities?.mode || 'DISABLED');
    const result=await this.pool.query(`SELECT credit_limit_units,reserved_units,used_units,updated_at
      FROM leadgen.provider_credit_ledger WHERE provider='HUNTER' AND billing_period=to_char(now() at time zone 'UTC','YYYY-MM')`);
    const ledger=result.rows[0]||null;
    const remaining=ledger?Math.max(0,Number(ledger.credit_limit_units)-Number(ledger.reserved_units)-Number(ledger.used_units)):this.billingPeriodCapUnits;
    const state=mode==='DISABLED'?'DISABLED':remaining<=0?'BUDGET_HOLD':'READY';
    return {mode,state,per_run_cap_units:this.runCapUnits,billing_period_remaining_units:remaining,updated_at:ledger?.updated_at||null};
  }

  async getSummary() {
    const [counts,catalog,budget,automation,searchProvider]=await Promise.all([
      this.pool.query(`SELECT
        (SELECT count(*)::int FROM leadgen.research_jobs WHERE status=ANY($1::text[])) active_jobs,
        (SELECT count(DISTINCT d.id)::int FROM leadgen.decision_makers d JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id
          WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND d.lifecycle_status='ACTIVE'
            AND pr.relevance IN('HIGH','MEDIUM') AND d.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')) verified_profile_buyers,
        (SELECT count(DISTINCT dc.id)::int FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers d ON d.id=dc.decision_maker_id
          JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id
          WHERE dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL') AND dc.verification_status='VALID'
            AND dc.last_verified_at>=now()-($2::int*interval '1 day') AND d.person_name IS NOT NULL
            AND d.verification_status='VERIFIED' AND d.lifecycle_status='ACTIVE' AND pr.relevance IN('HIGH','MEDIUM')
            AND d.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')) verified_email_routes,
        (SELECT count(*)::int FROM leadgen.business_opportunity_current WHERE contact_readiness='READY' AND business_fit_status='FIT') contact_ready_opportunities`,[ACTIVE_JOB_STATES,this.contactVerificationTtlDays]),
      this.catalogProfiles(),this.budgetState(),this.autoEvidence?this.autoEvidence.summary():Promise.resolve(null),
      this.providerAccountState?this.providerAccountState.getState():Promise.resolve({status:'UNKNOWN'})
    ]);
    const tasks=await this.listTasks({limit:3});
    const row=counts.rows[0];
    const automationStatus=this.autoEvidence?.status()||null;
    const taskStatuses=Object.fromEntries((automation?.task_statuses||[]).map(item=>[upper(item.task_status),Number(item.count||0)]));
    const autoEvidence=automationStatus?{
      enabled:automationStatus.enabled===true,
      status:taskStatuses.PROVIDER_CAPACITY_WAIT>0?'PROVIDER_CAPACITY_WAIT':automationStatus.enabled?'ENABLED':'DISABLED',
      running:Number(taskStatuses.RUNNING||0),retry_scheduled:Number(taskStatuses.RETRY_SCHEDULED||0),
      provider_capacity_wait:Number(taskStatuses.PROVIDER_CAPACITY_WAIT||0),
      historical_budget_paused:Number(taskStatuses.BUDGET_PAUSED||0),human_review_required:Number(taskStatuses.HUMAN_REVIEW_REQUIRED||0),
      last_reconciled_at:automation?.latest_schedule?.occurred_at||null,
       source_service_health:automationStatus.tavilyEnabled?searchProvider.status:'DISABLED',
      email_verification_health:upper(this.hunter?.capabilities?.mode)==='DISABLED'?'DISABLED':budget.state==='BUDGET_HOLD'?'DEGRADED':'READY',
      search_service:{status:searchProvider.status,retry_after_at:searchProvider.retry_after_at||null,
        checked_at:searchProvider.checked_at||null,creation_allowed:!['CREDIT_EXHAUSTED','AUTH_ERROR'].includes(searchProvider.status)},
      tavily_usage:{...(automation?.tavily_metrics||{}),limit_mode:'PROVIDER_ACCOUNT_ONLY'}
    }:null;
    return {as_of:new Date().toISOString(),active_jobs:Number(row.active_jobs),evidence_tasks:tasks.total,
      verified_profile_buyers:Number(row.verified_profile_buyers),verified_email_routes:Number(row.verified_email_routes),
      contact_ready_opportunities:Number(row.contact_ready_opportunities),hunter_mode:budget.mode,hunter_budget_state:budget.state,
      verification_service:{state:budget.state,mode:budget.mode,per_run_cap_units:budget.per_run_cap_units,
        billing_period_remaining_units:budget.billing_period_remaining_units},catalog_profiles:catalog,priority_tasks:tasks.items,
      auto_evidence:autoEvidence};
  }

  async listJobs(query={}) {
    const limit=boundedInt(query.limit,{min:1,max:100,fallback:50});
    const offset=decodeCursor(query.cursor);
    // $1 is reserved for the contact-verification TTL used by the projection.
    const params=[this.contactVerificationTtlDays];const clauses=[];
    const type=upper(query.job_type);const market=upper(query.market);const profile=upper(query.product_profile);
    const search=String(query.search || '').trim().slice(0,120);
    if(type){if(!JOB_TYPES.has(type)){const error=new Error('Invalid job type');error.status=400;throw error;}params.push(type);clauses.push(`j.job_type=$${params.length}`);}
    if(market){params.push(market);clauses.push(`($${params.length}=ANY(j.market_codes) OR j.country_code=$${params.length})`);}
    if(profile){if(!PRODUCT_PROFILES.has(profile)){const error=new Error('Invalid product profile');error.status=400;throw error;}params.push(profile);clauses.push(`($${params.length}=ANY(j.product_profiles) OR j.product_profile=$${params.length})`);}
    if(search){params.push(`%${search}%`);clauses.push(`(j.id::text ILIKE $${params.length} OR j.country_name ILIKE $${params.length}
      OR j.product_category ILIKE $${params.length}
      OR EXISTS(SELECT 1 FROM leadgen.enrichment_job_companies e JOIN leadgen.companies c ON c.id=e.company_id
        WHERE e.research_job_id=j.id AND c.company_name ILIKE $${params.length})
      OR EXISTS(SELECT 1 FROM leadgen.research_job_cohort_items ci JOIN leadgen.companies c ON c.id=ci.company_id
        WHERE ci.research_job_id=j.id AND c.company_name ILIKE $${params.length}))`);}
    const result=await this.pool.query(`SELECT j.*,
      pu.provider_call_count,pu.provider_completed_count,pu.provider_not_found_count,
      pu.provider_temporary_error_count,pu.provider_failed_count,pu.reserved_units,pu.used_units,
      pu.released_units,pu.last_provider_event_at,pu.projection_updated_at,
      (SELECT count(*)::int FROM leadgen.research_candidate_verifications v
        WHERE v.research_job_id=j.id) candidate_verifications_completed,
      (SELECT count(DISTINCT d.id)::int FROM leadgen.decision_makers d JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id
        WHERE d.research_job_id=j.id AND d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM')) verified_named_buyers,
      (SELECT count(DISTINCT dc.id)::int FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers d ON d.id=dc.decision_maker_id
        WHERE d.research_job_id=j.id AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($1::int*interval '1 day')) verified_email_routes
      FROM leadgen.research_jobs j
      LEFT JOIN leadgen.research_job_provider_usage_summary pu ON pu.research_job_id=j.id
      ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''}
      ORDER BY j.created_at DESC,j.id DESC LIMIT 1000`,params);
    let items=result.rows.map(publicJob);
    const status=upper(query.status);const blocker=upper(query.blocker);
    if(status&&status!=='ALL')items=items.filter(item=>item.status===status);
    if(blocker)items=items.filter(item=>item.blocker===blocker);
    if(upper(query.sort)==='OLDEST')items.reverse();
    const total=items.length;items=items.slice(offset,offset+limit);
    return {as_of:new Date().toISOString(),total,items,next_cursor:offset+items.length<total?encodeCursor(offset+items.length):null};
  }

  async getJob(jobId) {
    const result=await this.pool.query(`SELECT j.*,
      pu.provider_call_count,pu.provider_completed_count,pu.provider_not_found_count,
      pu.provider_temporary_error_count,pu.provider_failed_count,pu.reserved_units,pu.used_units,
      pu.released_units,pu.last_provider_event_at,pu.projection_updated_at,
      (SELECT count(*)::int FROM leadgen.research_candidate_verifications v
        WHERE v.research_job_id=j.id) candidate_verifications_completed,
      (SELECT count(DISTINCT d.id)::int FROM leadgen.decision_makers d JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id
        WHERE d.research_job_id=j.id AND d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM')) verified_named_buyers,
      (SELECT count(DISTINCT dc.id)::int FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers d ON d.id=dc.decision_maker_id
        WHERE d.research_job_id=j.id AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($2::int*interval '1 day')) verified_email_routes
      FROM leadgen.research_jobs j
      LEFT JOIN leadgen.research_job_provider_usage_summary pu ON pu.research_job_id=j.id
      WHERE j.id=$1`,[jobId,this.contactVerificationTtlDays]);
    return result.rowCount?publicJob(result.rows[0]):null;
  }

  async getJobResults(jobId) {
    const job=await this.getJob(jobId);if(!job)return null;
    const companies=await this.pool.query(`SELECT e.company_id,c.company_name,c.country_code,e.product_profiles,e.attempt_status,
      e.queries_executed,e.sources_found,e.decision_makers_found,e.contact_routes_found,
      coalesce(pu.provider_call_count,0) provider_call_count,coalesce(pu.used_units,0) used_units,e.timeout_count,
      CASE WHEN e.last_error IS NULL THEN NULL WHEN e.last_error ILIKE '%timeout%' THEN 'TEMPORARY_ERROR' ELSE 'COMPANY_STAGE_FAILED' END blocker,
      e.started_at,e.completed_at
      FROM leadgen.enrichment_job_companies e JOIN leadgen.companies c ON c.id=e.company_id
      LEFT JOIN leadgen.research_job_company_provider_usage_summary pu
        ON pu.research_job_id=e.research_job_id AND pu.company_id=e.company_id
      WHERE e.research_job_id=$1 ORDER BY c.country_code,c.company_name,c.id`,[jobId]);
    const sourceRows=await this.pool.query(`SELECT source_url,captured_at,source_authority FROM leadgen.decision_maker_sources
      WHERE research_job_id=$1 ORDER BY captured_at DESC,id DESC LIMIT 100`,[jobId]);
    const stageRows=await this.pool.query(`SELECT DISTINCT ON(stage) stage,outcome_code,reason_codes,source_count,retry_number,occurred_at
      FROM leadgen.research_job_stage_events WHERE research_job_id=$1 AND stage<>'SUPPLIER_ACCESS'
      ORDER BY stage,occurred_at DESC,id DESC`,[jobId]);
    const items=companies.rows.map(row=>({company_id:row.company_id,company_name:row.company_name,market:row.country_code,
      product_profiles:row.product_profiles,status:row.attempt_status,queries_executed:Number(row.queries_executed),sources_found:Number(row.sources_found),
      verified_buyers:Number(row.decision_makers_found),contact_routes:Number(row.contact_routes_found),
      verification_calls:Number(row.provider_call_count),used_units:Number(row.used_units),
      timeout_count:Number(row.timeout_count),blocker:row.blocker,started_at:row.started_at,completed_at:row.completed_at}));
    const totals=items.reduce((sum,item)=>({companies:sum.companies+1,sources:sum.sources+item.sources_found,buyers:sum.buyers+item.verified_buyers,
      contacts:sum.contacts+item.contact_routes,verification_calls:sum.verification_calls+item.verification_calls,
      used_units:sum.used_units+item.used_units}),{companies:0,sources:0,buyers:0,contacts:0,verification_calls:0,used_units:0});
    const fallbackStages=[
      {stage:'IDENTITY',status:totals.companies?'COMPLETED':'WAITING',count:totals.companies},
      {stage:'BUYER_MODEL',status:totals.sources?'COMPLETED':'WAITING_EVIDENCE',count:totals.sources},
      {stage:'CATEGORY_PROCUREMENT',status:job.category_matches?'COMPLETED':'WAITING_EVIDENCE',count:job.category_matches},
      {stage:'BUYER_ROLE',status:totals.buyers?'COMPLETED':'WAITING_EVIDENCE',count:totals.buyers},
      {stage:'EMAIL_VERIFICATION',status:job.verified_email_routes?'COMPLETED':'WAITING_EVIDENCE',count:job.verified_email_routes},
      {stage:'DECISION_REFRESH',status:job.status==='COMPLETED'?'COMPLETED':'WAITING',count:job.status==='COMPLETED'?1:0}
    ];
    const stages=stageRows.rowCount?stageRows.rows.map(row=>({stage:row.stage,status:String(row.outcome_code||'').startsWith('EVIDENCE_REQUIRED')?'WAITING_EVIDENCE'
      :row.outcome_code==='TEMPORARY_ERROR'?'FAILED_RETRYABLE':row.outcome_code==='NOT_SUITABLE'?'COMPLETED':'COMPLETED',
      outcome:row.outcome_code,reason_codes:row.reason_codes||[],source_count:Number(row.source_count||0),retry_number:Number(row.retry_number||0),
      occurred_at:row.occurred_at})):fallbackStages;
    return {as_of:new Date().toISOString(),job,stages,items,sources:sourceRows.rows.map(row=>({source_url:row.source_url,captured_at:row.captured_at,source_authority:row.source_authority}))};
  }

  async selectCohort({limit=5,excludeCompanyIds=[]}={}) {
    const bounded=boundedInt(limit,{min:1,max:20,fallback:5});
    const origins=this.publicDataOrigins.length?this.publicDataOrigins:['live_discovered','fixed_public_candidate','fixed_public_profile','directory_live','osm_live','legacy_public_web'];
    const rows=await this.pool.query(`SELECT o.id opportunity_id,o.company_id,c.company_name,c.country_code market,o.product_profile,o.research_job_id job_id,
      o.reason_codes,cpm.match_status category_match_status,cpm.coverage_percent evidence_coverage,f.readiness_blockers,
      false company_suppressed,false contact_suppressed,
      coalesce(dm.profile_relevant_buyer_count,0)::int profile_relevant_buyer_count,
      coalesce(dm.verified_buyer_role_count,0)::int verified_buyer_role_count,
      coalesce(dm.business_email_route_count,0)::int business_email_route_count,
      coalesce(dm.active_valid_email_route_count,0)::int active_valid_email_route_count,
      coalesce(dm.email_route_statuses,'{}'::text[]) email_route_statuses,
      coalesce(src.source_count,0)::int source_count,greatest(o.created_at,dm.latest_activity,src.latest_activity) latest_activity,
      extract(day from now()-greatest(o.created_at,dm.latest_activity,src.latest_activity))::int evidence_age_days
      FROM leadgen.business_opportunity_current o JOIN leadgen.companies c ON c.id=o.company_id
      LEFT JOIN leadgen.category_procurement_match_results cpm ON cpm.id=o.category_procurement_match_result_id
      LEFT JOIN leadgen.cooperation_feasibility_results f ON f.id=o.cooperation_feasibility_result_id
      LEFT JOIN LATERAL (SELECT count(DISTINCT d.id) FILTER(WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM')) profile_relevant_buyer_count,
        count(DISTINCT d.id) FILTER(WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM') AND d.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')) verified_buyer_role_count,
        count(DISTINCT dc.id) FILTER(WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED'
          AND pr.relevance IN('HIGH','MEDIUM') AND d.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')
          AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')) business_email_route_count,
        count(DISTINCT dc.id) FILTER(WHERE d.person_name IS NOT NULL AND d.verification_status='VERIFIED'
          AND pr.relevance IN('HIGH','MEDIUM') AND d.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING')
          AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($1::int*interval '1 day')) active_valid_email_route_count,
        array_remove(array_agg(DISTINCT dc.verification_status),NULL) email_route_statuses,max(greatest(d.updated_at,dc.updated_at)) latest_activity
        FROM leadgen.decision_makers d LEFT JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id AND pr.product_profile=o.product_profile
        LEFT JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=d.id WHERE d.company_id=c.id) dm ON true
      LEFT JOIN LATERAL (SELECT count(DISTINCT s.id) source_count,max(s.captured_at) latest_activity
        FROM leadgen.prospect_category_sources s JOIN leadgen.prospect_category_observations obs ON obs.source_id=s.id
        WHERE s.company_id=c.id AND obs.normalized_profile=o.product_profile) src ON true
      WHERE c.country_code IN('AE','MX') AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND c.data_origin=ANY($2::text[]) AND c.explicit_exclusion_reason IS NULL
        AND (c.official_root_domain IS NOT NULL OR c.website_url IS NOT NULL)
        AND o.business_fit_status='EVIDENCE_REQUIRED' AND o.relationship_status='NEW_PROSPECT'
        AND NOT EXISTS(SELECT 1 FROM leadgen.company_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
          WHERE l.company_id=c.id AND l.link_status='CONFIRMED' AND h.customer_role='INTERNAL_EXISTING_CUSTOMER')`,[this.contactVerificationTtlDays,origins]);
    const excluded=new Set(excludeCompanyIds.map(String));
    const ranked=rows.rows.filter(row=>!excluded.has(String(row.company_id))).map(rankCohortCandidate)
      .sort((a,b)=>Number(a.cohort_priority)-Number(b.cohort_priority)||String(b.latest_activity||'').localeCompare(String(a.latest_activity||''))||String(a.company_name).localeCompare(String(b.company_name),'en'));
    const seen=new Set();const selected=[];
    for(const row of ranked){if(seen.has(row.company_id))continue;seen.add(row.company_id);selected.push(row);if(selected.length>=bounded)break;}
    return selected.map(row=>({company_id:row.company_id,company_name:row.company_name,market:row.market,product_profile:row.product_profile,
      priority:row.cohort_priority,selection_reason:row.selection_reason,opportunity_id:row.opportunity_id}));
  }

  async assertWaveBGate(waveAJobId) {
    const result=await this.pool.query(`SELECT id,status,stop_reason_code,error_count,completed_at
      FROM leadgen.research_jobs WHERE id=$1 AND research_wave='A'`,[waveAJobId]);
    if(!result.rowCount){const error=new Error('Wave A result is required');error.code='PHASE9_WAVE_A_REQUIRED';error.status=409;throw error;}
    const row=result.rows[0];
    if(!['COMPLETE','COMPLETED'].includes(upper(row.status)) || row.stop_reason_code || Number(row.error_count)>0 || !row.completed_at){
      const error=new Error('Wave A gate has not passed');error.code='PHASE9_WAVE_A_GATE_NOT_PASSED';error.status=409;throw error;
    }
    const sendCheck=await this.pool.query(`SELECT
      (SELECT count(*)::int FROM leadgen.outbound_messages) messages,
      (SELECT count(*)::int FROM leadgen.outbound_message_attempts) attempts`);
    if(Number(sendCheck.rows[0].messages)>0||Number(sendCheck.rows[0].attempts)>0){
      const error=new Error('Outbound activity gate is closed');error.code='PHASE9_NO_SEND_GATE_FAILED';error.status=409;throw error;
    }
    return row;
  }

  async freezeCohort({jobId,wave,items}) {
    if(!Array.isArray(items)||!items.length){const error=new Error('Cohort is empty');error.code='PHASE9_COHORT_EMPTY';error.status=409;throw error;}
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const stored=[];
      for(let index=0;index<items.length;index+=1){
        const item=items[index];
        const snapshot=await client.query(`SELECT id FROM leadgen.product_profile_catalog_snapshots
          WHERE product_profile=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[item.product_profile]);
        if(!snapshot.rowCount){const error=new Error('Catalog snapshot is required');error.code='PHASE9_CATALOG_SNAPSHOT_REQUIRED';throw error;}
        const current=await client.query(`SELECT c.verification_status,c.lifecycle_status,o.relationship_status
          FROM leadgen.companies c JOIN leadgen.business_opportunity_current o ON o.company_id=c.id AND o.product_profile=$2
          WHERE c.id=$1`,[item.company_id,item.product_profile]);
        if(!current.rowCount){const error=new Error('Current opportunity is required');error.code='PHASE9_OPPORTUNITY_REQUIRED';throw error;}
        const state=current.rows[0];
        const inputDigest=digest({job_id:jobId,company_id:item.company_id,product_profile:item.product_profile,
          market:item.market,wave,rank:index+1,selection_reason:item.selection_reason,snapshot_id:snapshot.rows[0].id});
        const reasonCode=String(item.selection_reason||'EVIDENCE_REQUIRED').toUpperCase().replace(/[^A-Z0-9_]+/g,'_').slice(0,80);
        const inserted=await client.query(`INSERT INTO leadgen.research_job_cohort_items
          (research_job_id,company_id,product_profile,product_profile_catalog_snapshot_id,market_code,research_wave,
           selection_rank,selection_reason_code,company_verification_status_snapshot,company_lifecycle_status_snapshot,
           relationship_status_snapshot,selection_input_digest,selected_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) RETURNING *`,[
          jobId,item.company_id,item.product_profile,snapshot.rows[0].id,item.market,wave,index+1,
          reasonCode,state.verification_status,state.lifecycle_status,
          state.relationship_status,inputDigest
        ]);
        stored.push(inserted.rows[0]);
      }
      await client.query('COMMIT');
      return stored;
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }

  async recordDecisionRefreshEvents(jobId) {
    const rows=await this.pool.query(`SELECT ci.id cohort_item_id,ci.company_id,ci.product_profile,
      o.id opportunity_snapshot_id,o.buyer_business_model_result_id,o.category_procurement_match_result_id,
      o.product_opportunity_result_id,o.cooperation_feasibility_result_id,o.business_fit_status,
      o.system_recommendation_status,o.contact_readiness,o.reason_codes
      FROM leadgen.research_job_cohort_items ci
      JOIN leadgen.business_opportunity_current o ON o.company_id=ci.company_id AND o.product_profile=ci.product_profile
      WHERE ci.research_job_id=$1 ORDER BY ci.selection_rank`,[jobId]);
    const inserted=[];
    for(const row of rows.rows){
      const outcome=row.system_recommendation_status==='RECOMMENDED'&&row.contact_readiness==='READY'&&row.business_fit_status==='FIT'
        ? 'RECOMMENDED_CONTACT_READY' : row.business_fit_status==='NOT_SUITABLE' ? 'NOT_SUITABLE' : 'EVIDENCE_REQUIRED';
      const inputDigest=digest({job_id:jobId,cohort_item_id:row.cohort_item_id,stage:'DECISION_REFRESH',
        opportunity_snapshot_id:row.opportunity_snapshot_id,outcome});
      const event=await this.pool.query(`INSERT INTO leadgen.research_job_stage_events
        (research_job_id,cohort_item_id,stage,event_type,outcome_code,reason_codes,retry_number,source_count,
         input_digest,idempotency_key,buyer_business_model_result_id,category_procurement_match_result_id,
         product_opportunity_result_id,cooperation_feasibility_result_id,business_opportunity_decision_snapshot_id,occurred_at)
        VALUES ($1,$2,'DECISION_REFRESH','STAGE_EVALUATED',$3,$4,0,0,$5,$5,$6,$7,$8,$9,$10,now())
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,[
        jobId,row.cohort_item_id,outcome,row.reason_codes||[],inputDigest,row.buyer_business_model_result_id,
        row.category_procurement_match_result_id,row.product_opportunity_result_id,row.cooperation_feasibility_result_id,
        row.opportunity_snapshot_id
      ]);
      if(event.rowCount)inserted.push(event.rows[0].id);
    }
    return inserted;
  }
}

export { publicJobStatus,publicJob,decodeCursor,encodeCursor,ACTIVE_JOB_STATES };
