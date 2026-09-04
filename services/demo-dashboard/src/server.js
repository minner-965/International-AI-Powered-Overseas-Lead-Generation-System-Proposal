import express from 'express';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { resolveMx } from 'node:dns/promises';
import { persistGeneratedQueries, discoverResearchCandidates } from './search/discoveryService.js';
import { checkResearchCandidateContacts } from './contact/researchContactService.js';
import { verifyResearchCandidates } from './verification/companyVerificationService.js';
import { getMarketProfile, listConfiguredMarkets } from './market/marketProfiles.js';
import { productScopeForCategory } from './market/productProfiles.js';
import { normalizeManagementProductScope } from './matching/managementIcpProfiles.js';
import { createTelemetryService, instrumentPgPool } from './observability/telemetry.js';
import { createPhase5Queue, PHASE5_QUEUES } from './jobs/phase5Queue.js';
import { ScoringService } from './scoring/scoringService.js';
import { CustomerMatchService } from './matching/customerMatchService.js';
import { IcpProfileService } from './matching/icpProfileService.js';
import { createReferenceDataImportService } from './referenceData/referenceDataImportService.js';
import { SharedHistoryImportService } from './referenceData/sharedHistoryImportService.js';
import { OkkiHistoryService } from './referenceData/okkiHistoryService.js';
import { createCompanyLifecycleService } from './lifecycle/companyLifecycleService.js';
import { EnrichmentService } from './enrichment/EnrichmentService.js';
import { CategoryEvidenceService } from './categoryProcurement/CategoryEvidenceService.js';
import { CategoryProcurementService,buildCategoryProcurementWorkItems } from './categoryProcurement/CategoryProcurementService.js';
import { CategoryScopeService } from './categoryProcurement/CategoryScopeService.js';
import { queryCategoryProcurementOpportunities } from './categoryProcurement/opportunitiesRoute.js';
import { AutoEvidenceOrchestrator,autoEvidenceConfig,createAutoEvidenceQueueHandlers,createAutoEvidenceExecutors } from './autoEvidence/index.js';
import { hiddenMarketCodes, isMarketVisible } from '../public/market-visibility.js';
import { Phase7Service } from './phase7/service.js';
import { createPhase7QueueHandlers } from './phase7/queueHandlers.js';
import { createPhase7Router, registerPhase7RawWebhookRoutes } from './phase7/router.js';
import { createManagementAuth } from './phase7/managementAuth.js';
import { ResearchWorkbenchService } from './research/ResearchWorkbenchService.js';
import { createResearchRouter } from './research/router.js';
import { OrchestratorHealthService } from './orchestration/OrchestratorHealthService.js';
import { ResearchDirectDispatchService,ResearchJobDirectExecutor } from './research/ResearchDirectDispatchService.js';
import {TavilyProviderAccountState} from './search/TavilyProviderAccountState.js';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const httpListenEnabled = !/^(0|false|no|off)$/i.test(process.env.HTTP_LISTEN_ENABLED || 'true');
const n8nEnrichmentWebhookUrl = process.env.N8N_ENRICHMENT_WEBHOOK_URL || '';
const n8nCategoryProcurementWebhookUrl = process.env.N8N_CATEGORY_PROCUREMENT_WEBHOOK_URL || '';
const n8nWebhookTimeoutMs = Math.max(1000, Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 5000));
const internalApiToken = process.env.INTERNAL_API_TOKEN || '';
const managementAuth = createManagementAuth(process.env);
const hiddenCompanyMarketSql = hiddenMarketCodes().map(code=>`'${code.replaceAll("'", "''")}'`).join(',');
const companyMarketVisibleSql = (alias = 'c') => hiddenCompanyMarketSql
  ? `upper(coalesce(${alias}.country_code,'')) NOT IN (${hiddenCompanyMarketSql})`
  : 'TRUE';
const excludesConfirmedExistingCustomerSql = (alias = 'c') => `NOT EXISTS (
  SELECT 1 FROM leadgen.historical_customer_company_links ecl
  JOIN leadgen.historical_customers hc ON hc.id=ecl.historical_customer_id
  WHERE ecl.company_id=${alias}.id AND ecl.link_status='CONFIRMED'
    AND hc.customer_role='INTERNAL_EXISTING_CUSTOMER'
)`;
const telemetry = createTelemetryService({
  enabled: /^(1|true|yes|on)$/i.test(process.env.OTEL_ENABLED || ''),
  serviceName: 'dpv-leadgen-dashboard'
});
const effectivePhase10Config = autoEvidenceConfig(process.env);

function canonicalDigest(value) {
  const canonical = Object.fromEntries(Object.entries(value || {}).sort(([left],[right])=>left.localeCompare(right)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
const searchConfig = Object.freeze({
  provider: String(process.env.SEARCH_PROVIDER || 'tavily').toLowerCase(),
  braveApiKey: process.env.BRAVE_SEARCH_API_KEY || '',
  dataForSeoLogin: process.env.DATAFORSEO_LOGIN || '',
  dataForSeoPassword: process.env.DATAFORSEO_PASSWORD || '',
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  tavilyEndpoint: process.env.TAVILY_SEARCH_ENDPOINT || 'https://api.tavily.com/search',
  tavilySearchDepth: String(process.env.TAVILY_SEARCH_DEPTH || 'basic').toLowerCase(),
  resultsPerQuery: Math.max(1, Math.min(20, Number(process.env.SEARCH_RESULTS_PER_QUERY || 5))),
  maxQueries: Math.max(1, Math.min(5, Number(process.env.SEARCH_MAX_QUERIES_PER_JOB || 5))),
  timeoutMs: Math.max(1000, Number(process.env.SEARCH_REQUEST_TIMEOUT_MS || 15000)),
  storageRightsConfirmed: /^(1|true|yes)$/i.test(process.env.SEARCH_STORAGE_RIGHTS_CONFIRMED || ''),
  contactConfig: Object.freeze({
    maxCandidates: Math.max(1, Math.min(20, Number(process.env.CONTACT_CHECK_MAX_CANDIDATES || 5))),
    maxPagesPerCandidate: Math.max(1, Math.min(4, Number(process.env.CONTACT_CHECK_MAX_PAGES_PER_CANDIDATE || 4))),
    timeoutMs: Math.max(1000, Number(process.env.CONTACT_FETCH_TIMEOUT_MS || 10000)),
    delayMs: Math.max(0, Number(process.env.CONTACT_FETCH_DELAY_MS || 500)),
    maxResponseBytes: Math.max(10000, Number(process.env.CONTACT_MAX_RESPONSE_BYTES || 2000000)),
    userAgent: String(process.env.CONTACT_USER_AGENT || 'DPVLeadResearchDemo/1.0'),
    maxRedirects: 5
  }),
  companyVerifyConfig: Object.freeze({
    maxCandidates: Math.max(1, Math.min(20, Number(process.env.COMPANY_VERIFY_MAX_CANDIDATES || 5))),
    maxPages: Math.max(1, Math.min(8, Number(process.env.COMPANY_VERIFY_MAX_PAGES || 8))),
    timeoutMs: Math.max(1000, Number(process.env.COMPANY_VERIFY_TIMEOUT_MS || 10000)),
    delayMs: Math.max(0, Number(process.env.COMPANY_VERIFY_DELAY_MS || 350)),
    maxResponseBytes: Math.max(10000, Number(process.env.COMPANY_VERIFY_MAX_RESPONSE_BYTES || 2000000)),
    userAgent: String(process.env.CONTACT_USER_AGENT || 'DPVLeadResearchDemo/1.0')
  })
});
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'leadgen',
  user: process.env.POSTGRES_USER || 'leadgen',
  password: process.env.POSTGRES_PASSWORD,
});
instrumentPgPool(pool, telemetry);
const tavilyProviderAccountState=new TavilyProviderAccountState({pool,apiKey:searchConfig.tavilyApiKey,
  usageEndpoint:process.env.TAVILY_USAGE_ENDPOINT||'https://api.tavily.com/usage',
  refreshIntervalMs:Number(process.env.TAVILY_USAGE_REFRESH_INTERVAL_MS||300000),
  timeoutMs:Number(process.env.TAVILY_USAGE_TIMEOUT_MS||10000)});
const tavilyUsageConfig=Object.freeze({providerAccountState:tavilyProviderAccountState});

const scoringService = new ScoringService({ pool });
const customerMatchService = new CustomerMatchService({ pool });
const icpProfileService = new IcpProfileService({ pool });
const referenceDataImports = createReferenceDataImportService({ pool });
const sharedHistoryImports = new SharedHistoryImportService({ pool });
const okkiHistory = new OkkiHistoryService({ pool });
const companyLifecycleService = createCompanyLifecycleService({ pool });
const enrichmentService = new EnrichmentService({
  pool,
  searchConfig,
  tavilyUsageConfig,
  crawlerConfig: searchConfig.contactConfig,
  hunterConfig: {
    apiKey: process.env.HUNTER_API_KEY || '',
    mode: process.env.HUNTER_MODE || '',
    endpoint: process.env.HUNTER_API_ENDPOINT || 'https://api.hunter.io/v2',
    timeoutMs: Number(process.env.HUNTER_REQUEST_TIMEOUT_MS || 12000),
    runCapUnits: Number(process.env.MAX_HUNTER_CREDITS_PER_RUN_UNITS || 20000),
    dailyCapUnits: Number(process.env.MAX_HUNTER_CREDITS_PER_DAY_UNITS || 20000),
    billingPeriodCapUnits: Number(process.env.MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS || 20000)
  },
  linkedInConfig: {
    mode: process.env.LINKEDIN_DISCOVERY_MODE || 'SEARCH_DISCOVERY_ONLY',
    officialApiToken: process.env.LINKEDIN_OFFICIAL_API_TOKEN || '',
    officialApiApproved: /^(1|true|yes)$/i.test(process.env.LINKEDIN_OFFICIAL_API_APPROVED || ''),
    crawlPermissionId: process.env.LINKEDIN_CRAWL_PERMISSION_ID || '',
    crawlPermissionExpiresAt: process.env.LINKEDIN_CRAWL_PERMISSION_EXPIRES_AT || '',
    crawlAllowedPaths: String(process.env.LINKEDIN_CRAWL_ALLOWED_PATHS || '').split(',').map(value=>value.trim()).filter(Boolean)
  },
  maxCompanies: Number(process.env.ENRICHMENT_MAX_COMPANIES || 100),
  maxQueriesPerCompany: Number(process.env.ENRICHMENT_MAX_QUERIES_PER_COMPANY || 5),
  maxPagesPerCompany: Number(process.env.ENRICHMENT_MAX_PAGES_PER_COMPANY || 6),
  providerTemporaryErrorThreshold:Number(process.env.ENRICHMENT_PROVIDER_TEMPORARY_ERROR_THRESHOLD || 3),
  audit
});
const categoryEvidenceService = new CategoryEvidenceService({
  pool,searchConfig,tavilyUsageConfig,crawlerConfig:searchConfig.contactConfig,
  maxQueriesPerProfile:Number(process.env.CATEGORY_PROCUREMENT_MAX_QUERIES_PER_PROFILE || 4),
  maxQueriesPerCompany:Number(process.env.CATEGORY_PROCUREMENT_MAX_QUERIES_PER_COMPANY || 8),
  maxPagesPerCompany:Number(process.env.CATEGORY_PROCUREMENT_MAX_PAGES_PER_COMPANY || 12),
  maxDiscoveryDepth:Number(process.env.CATEGORY_PROCUREMENT_MAX_DISCOVERY_DEPTH || 2)
});
const categoryProcurementService = new CategoryProcurementService({pool});
const categoryScopeService = new CategoryScopeService({pool});

function optionalUuid(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw Object.assign(new Error(`${label} must be a UUID`), { code: 'PHASE5_INVALID_ID' });
  }
  return value;
}

async function phase5CompanyScope({ companyId = null, researchJobId = null, all = false } = {}) {
  companyId = optionalUuid(companyId, 'company_id');
  researchJobId = optionalUuid(researchJobId, 'research_job_id');
  if (companyId) {
    const result = await pool.query('SELECT id,research_job_id FROM leadgen.companies WHERE id=$1', [companyId]);
    if (!result.rowCount) throw Object.assign(new Error('Company not found'), { code: 'COMPANY_NOT_FOUND' });
    return result.rows;
  }
  if (!researchJobId && !all) throw Object.assign(new Error('A company, research job or explicit all scope is required'), { code: 'PHASE5_SCOPE_REQUIRED' });
  const params = [];
  const clauses = ["c.verification_status='VERIFIED'", "c.lifecycle_status='ACTIVE'", "c.explicit_exclusion_reason IS NULL"];
  if (researchJobId) {
    params.push(researchJobId);
    clauses.push(`(c.research_job_id=$${params.length} OR v.research_job_id=$${params.length})`);
  }
  const result = await pool.query(`
    SELECT DISTINCT c.id,coalesce(c.research_job_id,v.research_job_id) AS research_job_id
    FROM leadgen.companies c
    LEFT JOIN leadgen.research_candidate_verifications v ON v.company_id=c.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY c.id LIMIT 500`, params);
  return result.rows;
}

async function scoreCompanySet(data, job) {
  const companies = await phase5CompanyScope({
    companyId: data.company_id || null,
    researchJobId: data.research_job_id || null,
    all: data.all === true
  });
  const results = [];
  for (const company of companies) {
    results.push(await scoringService.scoreCompany({
      companyId: company.id,
      researchJobId: data.research_job_id || company.research_job_id || null,
      executionKey: job?.id ? `${job.id}:${company.id}` : null
    }));
  }
  return { processed: results.length, score_run_ids: results.map(row => row.id) };
}

async function matchCompanySet(data, job) {
  const companies = await phase5CompanyScope({
    companyId: data.company_id || null,
    researchJobId: data.research_job_id || null,
    all: data.all === true
  });
  const results = [];
  for (const company of companies) {
    const options = {
      companyId: company.id,
      researchJobId: data.research_job_id || company.research_job_id || null,
      profileId: data.profile_id || null,
      productScope: data.product_scope || data.product_profile || null,
      executionKey: job?.id ? `${job.id}:${company.id}` : null
    };
    results.push(data.profile_id
      ? await customerMatchService.evaluateAndPersist(options)
      : await customerMatchService.evaluateAndPersistDual(options));
  }
  return { processed: results.length, match_result_ids: results.flatMap(row => row.id ? [row.id] : [row.management_baseline?.id,row.mx_historical_reference?.id].filter(Boolean)) };
}

async function schedulePostDiscoveryAutomation(jobId) {
  const jobResult=await pool.query(`SELECT * FROM leadgen.research_jobs
    WHERE id=$1 AND job_type='COMPANY_DISCOVERY'`,[jobId]);
  if(!jobResult.rowCount)return {companies:0,category_job_id:null,enrichment_job_id:null};
  const sourceJob=jobResult.rows[0];
  const promoted=await pool.query(`SELECT DISTINCT v.company_id,c.country_code
    FROM leadgen.research_candidate_verifications v
    JOIN leadgen.companies c ON c.id=v.company_id
    WHERE v.research_job_id=$1 AND v.verification_status='VERIFIED_BUSINESS'
      AND v.promotion_status IN('PROMOTED_NEW','ENRICHED_EXISTING')
      AND c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
    ORDER BY v.company_id`,[jobId]);
  const companyIds=promoted.rows.map(row=>row.company_id);
  if(!companyIds.length)return {companies:0,category_job_id:null,enrichment_job_id:null};
  const productProfiles=[String(sourceJob.product_profile||'WOMENSWEAR').toUpperCase()];

  const categoryIdempotencyKey=`post-discovery-category:${jobId}`;
  let categoryJob=(await pool.query(`SELECT * FROM leadgen.research_jobs WHERE idempotency_key=$1`,[categoryIdempotencyKey])).rows[0];
  if(!categoryJob){
    categoryJob=await createCategoryProcurementResearchJob({companyIds,maxResults:companyIds.length,
      idempotencyKey:categoryIdempotencyKey,productProfiles});
  }
  if(categoryJob.status==='QUEUED'){
    const items=buildCategoryProcurementWorkItems({job_id:categoryJob.id,company_ids:companyIds,
      product_profiles:categoryJob.product_profiles});
    await pool.query(`UPDATE leadgen.research_jobs SET status='DISCOVERING',started_at=coalesce(started_at,now()),
      category_profiles_attempted=$2,last_error=NULL WHERE id=$1`,[categoryJob.id,items.length]);
    for(const item of items){
      const payload=categoryProcurementQueuePayload({...item,
        execution_key:`category-procurement:${categoryJob.id}:${item.company_id}:${item.product_profile}`});
      await phase5Queue.enqueue(PHASE5_QUEUES.COLLECT_CATEGORY_BUYER_EVIDENCE,payload,
        {singletonKey:`phase6.1:collect:${payload.execution_key}`});
    }
  }

  audit('POST_DISCOVERY_AUTOMATION_SCHEDULED',{job_id:jobId,companies:companyIds.length,
    category_job_id:categoryJob.id,enrichment_job_id:null,route:'CATEGORY_GATE_FIRST'});
  return {companies:companyIds.length,category_job_id:categoryJob.id,enrichment_job_id:null};
}

function categoryProcurementQueuePayload(data={}) {
  const profile=String(data.product_profile||'').toUpperCase();
  const executionKey=data.execution_key||`category-procurement:${data.job_id}:${data.company_id}:${profile}`;
  return {job_id:data.job_id,company_id:data.company_id,product_profile:profile,execution_key:executionKey,
    buyer_business_model_result_id:data.buyer_business_model_result_id||null,
    category_procurement_match_result_id:data.category_procurement_match_result_id||null,
    product_opportunity_result_id:data.product_opportunity_result_id||null};
}

async function refreshCategoryProcurementJobProgress(researchJobId,{error=null}={}) {
  const summary=await pool.query(`SELECT
    (SELECT count(DISTINCT (r.company_id,r.product_profile))::int
       FROM leadgen.category_procurement_match_results r WHERE r.research_job_id=$1) result_count,
    (SELECT count(DISTINCT r.company_id)::int
       FROM leadgen.category_procurement_match_results r WHERE r.research_job_id=$1) companies,
    (SELECT count(*)::int FROM leadgen.prospect_category_sources s WHERE s.research_job_id=$1) sources,
    (SELECT count(*)::int FROM leadgen.prospect_category_observations o WHERE o.research_job_id=$1) observations,
    (SELECT count(*)::int FROM leadgen.buyer_business_model_results b WHERE b.research_job_id=$1) buyers,
    (SELECT count(*)::int FROM leadgen.category_procurement_match_results r
       WHERE r.research_job_id=$1 AND r.match_status='CATEGORY_PROCUREMENT_MATCH') passed,
    (SELECT count(*)::int FROM leadgen.category_procurement_match_results r
       WHERE r.research_job_id=$1 AND r.score IS NULL) unknown,
    (SELECT coalesce(sum(po.candidate_count),0)::int
       FROM leadgen.product_opportunity_results po WHERE po.research_job_id=$1) opportunities,
    (SELECT count(*)::int FROM leadgen.cooperation_feasibility_results f
       WHERE f.research_job_id=$1 AND f.category_procurement_match_result_id IS NOT NULL) cooperation_count`,[researchJobId]);
  const job=await pool.query(`SELECT cardinality(requested_company_ids)*cardinality(product_profiles) expected,
    category_procurement_errors FROM leadgen.research_jobs
    WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT'`,[researchJobId]);
  if(!job.rowCount)return null;
  const counts=summary.rows[0];const expected=Number(job.rows[0].expected||0);
  const complete=expected>0&&Number(counts.cooperation_count)>=expected;
  const terminal=complete||Boolean(error)&&expected>0&&
    Number(job.rows[0].category_procurement_errors||0)+1>=expected;
  const updated=await pool.query(`UPDATE leadgen.research_jobs SET
    companies_attempted=GREATEST(companies_attempted,$2),companies_qualified=GREATEST(companies_qualified,$2),
    category_sources_found=$3,category_observations_found=$4,buyer_models_classified=$5,
    category_matches_passed=$6,category_matches_unknown=$7,product_opportunities_found=$8,
    category_procurement_errors=category_procurement_errors+CASE WHEN $9::text IS NULL THEN 0 ELSE 1 END,
    error_count=error_count+CASE WHEN $9::text IS NULL THEN 0 ELSE 1 END,
    last_error=CASE WHEN $9::text IS NULL THEN last_error ELSE left($9,500) END,
    status=CASE WHEN $10 THEN CASE WHEN category_procurement_errors+CASE WHEN $9::text IS NULL THEN 0 ELSE 1 END>0 THEN 'PARTIAL' ELSE 'COMPLETED' END ELSE status END,
    completed_at=CASE WHEN $10 THEN now() ELSE completed_at END
    WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT' RETURNING *`,[
    researchJobId,Number(counts.companies||0),Number(counts.sources||0),Number(counts.observations||0),
    Number(counts.buyers||0),Number(counts.passed||0),Number(counts.unknown||0),Number(counts.opportunities||0),error,terminal]);
  return updated.rows[0]||null;
}

async function collectCategoryBuyerEvidenceWork(data) {
  const payload=categoryProcurementQueuePayload(data);
  try{
    await pool.query(`UPDATE leadgen.research_jobs SET status='CRAWLING',started_at=coalesce(started_at,now())
      WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT' AND status IN('QUEUED','DISCOVERING','CRAWLING')`,[payload.job_id]);
    const result=await categoryEvidenceService.collect({researchJobId:payload.job_id,companyId:payload.company_id,productProfile:payload.product_profile});
    const queueJobId=await phase5Queue.enqueue(PHASE5_QUEUES.CLASSIFY_BUYER_BUSINESS_MODEL,payload,{singletonKey:`phase6.1:buyer:${payload.execution_key}`});
    await refreshCategoryProcurementJobProgress(payload.job_id);return{...result,queue_job_id:queueJobId};
  }catch(error){await refreshCategoryProcurementJobProgress(payload.job_id,{error:String(error.message||error)});throw error;}
}

async function classifyBuyerBusinessModelWork(data){const payload=categoryProcurementQueuePayload(data);try{
  const result=await categoryProcurementService.classifyBuyerAndPersist({researchJobId:payload.job_id,companyId:payload.company_id,productProfile:payload.product_profile,executionKey:payload.execution_key});
  const next={...payload,buyer_business_model_result_id:result.id};const queueJobId=await phase5Queue.enqueue(PHASE5_QUEUES.CALCULATE_CATEGORY_PROCUREMENT_MATCH,next,{singletonKey:`phase6.1:match:${payload.execution_key}`});
  await refreshCategoryProcurementJobProgress(payload.job_id);return{buyer_business_model_result_id:result.id,buyer_model:result.buyer_model,queue_job_id:queueJobId};
}catch(error){await refreshCategoryProcurementJobProgress(payload.job_id,{error:String(error.message||error)});throw error;}}

async function calculateCategoryProcurementMatchWork(data){const payload=categoryProcurementQueuePayload(data);try{
  await pool.query(`UPDATE leadgen.research_jobs SET status='SCORING' WHERE id=$1 AND status NOT IN('COMPLETED','FAILED')`,[payload.job_id]);
  const result=await categoryProcurementService.calculateCategoryMatchAndPersist({researchJobId:payload.job_id,companyId:payload.company_id,productProfile:payload.product_profile,executionKey:payload.execution_key,buyerBusinessModelResultId:payload.buyer_business_model_result_id});
  const next={...payload,category_procurement_match_result_id:result.id};const queueJobId=await phase5Queue.enqueue(PHASE5_QUEUES.CALCULATE_PRODUCT_OPPORTUNITIES,next,{singletonKey:`phase6.1:opportunity:${payload.execution_key}`});
  await refreshCategoryProcurementJobProgress(payload.job_id);return{category_procurement_match_result_id:result.id,score:result.score,band:result.band,match_status:result.match_status,queue_job_id:queueJobId};
}catch(error){await refreshCategoryProcurementJobProgress(payload.job_id,{error:String(error.message||error)});throw error;}}

async function calculateProductOpportunitiesWork(data){const payload=categoryProcurementQueuePayload(data);try{
  const result=await categoryProcurementService.calculateProductOpportunityAndPersist({researchJobId:payload.job_id,companyId:payload.company_id,productProfile:payload.product_profile,executionKey:payload.execution_key,categoryProcurementMatchResultId:payload.category_procurement_match_result_id});
  await categoryProcurementService.calculateCommercialFitAndPersist({researchJobId:payload.job_id,companyId:payload.company_id,productProfile:payload.product_profile,executionKey:payload.execution_key,categoryProcurementMatchResultId:payload.category_procurement_match_result_id});
  const next={...payload,product_opportunity_result_id:result.id};const queueJobId=await phase5Queue.enqueue(PHASE5_QUEUES.RECALCULATE_COOPERATION_V3,next,{singletonKey:`phase6.1:cooperation:${payload.execution_key}`});
  await refreshCategoryProcurementJobProgress(payload.job_id);return{product_opportunity_result_id:result.id,recommendation_status:result.recommendation_status,candidate_count:result.candidate_count,queue_job_id:queueJobId};
}catch(error){await refreshCategoryProcurementJobProgress(payload.job_id,{error:String(error.message||error)});throw error;}}

async function recalculateCooperationV3Work(data){const payload=categoryProcurementQueuePayload(data);try{
  const result=await categoryProcurementService.calculateCooperationAndPersist({researchJobId:payload.job_id,companyId:payload.company_id,productProfile:payload.product_profile,executionKey:payload.execution_key,categoryProcurementMatchResultId:payload.category_procurement_match_result_id,productOpportunityResultId:payload.product_opportunity_result_id});
  const updatedJob=await refreshCategoryProcurementJobProgress(payload.job_id);
  if(['COMPLETED','PARTIAL'].includes(updatedJob?.status)){
    await phase7Service.repository.refreshOpportunityDecisions({
      ttlDays:Number(process.env.OUTREACH_ELIGIBILITY_TTL_DAYS||7)
    });
    await enqueueAutoEvidenceEvent(`category-procurement-completed:${payload.job_id}`,{
      research_job_id:payload.job_id
    });
  }
  return{cooperation_result_id:result.id,readiness:result.opportunity_readiness,product_access_matrix:result.product_access_matrix};
}catch(error){await refreshCategoryProcurementJobProgress(payload.job_id,{error:String(error.message||error)});throw error;}}

const phase7QueueProxy = Object.freeze({
  enqueue: (...args) => phase5Queue.enqueue(...args)
});
const phase7Service = new Phase7Service({
  pool,queue:phase7QueueProxy,hunter:enrichmentService.hunter,env:process.env,audit,
  opportunityQuery: query => queryCategoryProcurementOpportunities({
    pool,query,publicDataOriginSql,companyMarketVisibleSql,excludesConfirmedExistingCustomerSql
  })
});
const phase7QueueHandlers = createPhase7QueueHandlers({service:phase7Service});
const autoEvidenceExecutors=createAutoEvidenceExecutors({
  pool,categoryEvidenceService,categoryProcurementService,enrichmentService,
  phase7Repository:phase7Service.repository,
  tavilyEnabled:/^(1|true|yes|on)$/i.test(process.env.AUTO_EVIDENCE_TAVILY_ENABLED||'true'),
  hunterEnabled:/^(1|true|yes|on)$/i.test(process.env.AUTO_EVIDENCE_HUNTER_ENABLED||'true'),
  sourceTtlDays:Number(process.env.AUTO_EVIDENCE_SOURCE_TTL_DAYS||90),
  contactVerificationTtlDays:Number(process.env.CONTACT_VERIFICATION_TTL_DAYS||30)
});
const autoEvidenceService = new AutoEvidenceOrchestrator({
  pool,
  queue:phase7QueueProxy,
  providerAccountState:tavilyProviderAccountState,
  env:process.env,
  audit,
  executors:autoEvidenceExecutors
});
const orchestratorHealth = new OrchestratorHealthService({
  pool,
  intervalMinutes:Number(process.env.AUTO_EVIDENCE_RECONCILE_MINUTES || 30),
  queuedThresholdMinutes:Number(process.env.ORCHESTRATOR_QUEUED_THRESHOLD_MINUTES || 10),
  retryDelayMinutes:Number(process.env.ORCHESTRATOR_RETRY_DELAY_MINUTES || 5)
});
const autoEvidenceQueueHandlers=createAutoEvidenceQueueHandlers({service:autoEvidenceService});

const enqueueAutoEvidenceEvent=(eventKey,payload={})=>phase5Queue.enqueue(PHASE5_QUEUES.SCHEDULE_AUTO_EVIDENCE,
  {schedule_source:'RECONCILIATION',reconcile_bucket:String(eventKey),batch_size:10,...payload},
  {singletonKey:`phase10:auto-evidence:event:${String(eventKey).slice(0,180)}`});

let researchDirectDispatchService;
let researchDirectExecutor;

const phase5Queue = createPhase5Queue({
  telemetry,
  audit,
  handlers: {
    [PHASE5_QUEUES.SCORE_COMPANY]: scoreCompanySet,
    [PHASE5_QUEUES.SCORE_ALL_ELIGIBLE]: scoreCompanySet,
    [PHASE5_QUEUES.RECALCULATE_CUSTOMER_MATCH]: matchCompanySet,
    [PHASE5_QUEUES.REBUILD_ICP_PROFILE]: (data) => String(data.reference_market || '').toUpperCase() === 'MX'
      ? icpProfileService.buildMexicoHistoricalReference({ actor: data.actor || 'phase5-queue' })
      : icpProfileService.buildHistoricalDraft({
        name: data.name,
        marketScope: data.market_scope || [],
        productScope: data.product_scope || [],
        actor: data.actor || 'phase5-queue'
      }),
    [PHASE5_QUEUES.REPLAY_RULE_VERSION]: async (data, job) => {
      if (data.rule_version && data.rule_version !== 'dpv-score-v1') {
        throw Object.assign(new Error('Requested rule version is not installed'), { code: 'RULE_VERSION_NOT_INSTALLED' });
      }
      return scoreCompanySet(data, job);
    },
    [PHASE5_QUEUES.ENRICH_DECISION_MAKERS]: async data => {
      const enrichment = await enrichmentService.runJob(data.research_job_id);
      const decisions = await phase7Service.repository.refreshOpportunityDecisions({
        ttlDays:Number(process.env.OUTREACH_ELIGIBILITY_TTL_DAYS || 7)
      });
      const stageEvents = await researchWorkbenchService.recordDecisionRefreshEvents(data.research_job_id);
      const autoEvidenceScheduleJobId=await enqueueAutoEvidenceEvent(`enrichment-completed:${data.research_job_id}`,
        {research_job_id:data.research_job_id});
      return {
        ...enrichment,
        decision_refresh:{
          evaluated:Number(decisions.evaluated || 0),
          inserted:Number(decisions.inserted || 0),
          unchanged:Number(decisions.unchanged || 0),
          stage_events:stageEvents.length
        },auto_evidence_schedule_job_id:autoEvidenceScheduleJobId
      };
    },
    [PHASE5_QUEUES.COLLECT_CATEGORY_BUYER_EVIDENCE]: collectCategoryBuyerEvidenceWork,
    [PHASE5_QUEUES.CLASSIFY_BUYER_BUSINESS_MODEL]: classifyBuyerBusinessModelWork,
    [PHASE5_QUEUES.CALCULATE_CATEGORY_PROCUREMENT_MATCH]: calculateCategoryProcurementMatchWork,
    [PHASE5_QUEUES.CALCULATE_PRODUCT_OPPORTUNITIES]: calculateProductOpportunitiesWork,
    [PHASE5_QUEUES.RECALCULATE_COOPERATION_V3]: recalculateCooperationV3Work,
    ...autoEvidenceQueueHandlers,
    ...phase7QueueHandlers,
    [PHASE5_QUEUES.EXECUTE_RESEARCH_JOB]:data=>researchDirectDispatchService.execute(data)
  }
});

researchDirectExecutor=new ResearchJobDirectExecutor({pool,audit,stages:{
  generateQueries:async jobId=>{
    const client=await pool.connect();
    try{await client.query('BEGIN');const job=await client.query('SELECT * FROM leadgen.research_jobs WHERE id=$1',[jobId]);
      if(!job.rowCount)throw Object.assign(new Error('Research job not found'),{code:'RESEARCH_JOB_NOT_FOUND'});
      await persistGeneratedQueries(client,job.rows[0],searchConfig);await client.query('COMMIT');
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  },
  discover:jobId=>discoverResearchCandidates(pool,jobId,searchConfig,{tavilyUsageConfig}),
  checkContacts:jobId=>checkResearchCandidateContacts(pool,jobId,searchConfig.contactConfig),
  verify:jobId=>verifyResearchCandidates(pool,jobId,{...searchConfig.companyVerifyConfig,searchConfig,tavilyUsageConfig,promote:true,allowSocialSearch:true}),
  score:async(jobId,executionKey)=>{
    const jobResult=await pool.query('SELECT product_profile FROM leadgen.research_jobs WHERE id=$1',[jobId]);
    if(!jobResult.rowCount)throw Object.assign(new Error('Research job not found'),{code:'RESEARCH_JOB_NOT_FOUND'});
    const productScope=jobResult.rows[0].product_profile;
    await scoreCompanySet({research_job_id:jobId},{id:`${executionKey}:score`});
    await matchCompanySet({research_job_id:jobId,product_scope:productScope},{id:`${executionKey}:match`});
  },
  completed:async jobId=>{
    const downstream=await schedulePostDiscoveryAutomation(jobId);
    await enqueueAutoEvidenceEvent(`research-direct-completed:${jobId}`,{research_job_id:jobId});
    return downstream;
  }
}});
researchDirectDispatchService=new ResearchDirectDispatchService({pool,queue:phase5Queue,executor:researchDirectExecutor,audit});

const publicDataOrigins = [
  'live_discovered',
  'fixed_public_candidate',
  'fixed_public_profile',
  'directory_live',
  'osm_live',
  'legacy_public_web'
];
const publicDataOriginSql = publicDataOrigins.map(value => `'${value}'`).join(',');
const researchWorkbenchService = new ResearchWorkbenchService({
  pool,
  hunter:enrichmentService.hunter,
  autoEvidence:autoEvidenceService,
  providerAccountState:tavilyProviderAccountState,
  contactVerificationTtlDays:Number(process.env.CONTACT_VERIFICATION_TTL_DAYS || process.env.OUTREACH_VERIFICATION_TTL_DAYS || 30),
  runCapUnits:Number(process.env.MAX_HUNTER_CREDITS_PER_RUN_UNITS || 20000),
  billingPeriodCapUnits:Number(process.env.MAX_HUNTER_CREDITS_PER_BILLING_PERIOD_UNITS || 20000),
  publicDataOrigins
});

registerPhase7RawWebhookRoutes(app,{service:phase7Service,queue:phase7QueueProxy});

app.use((_req, res, next) => {
  // This management workspace shows mutable research, scoring and job state.
  // Prevent a previous response or static bundle from masking a completed run.
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '16mb' }));
app.use('/vendor/tabler', express.static(new URL('../node_modules/@tabler/core/dist', import.meta.url).pathname));
app.use('/vendor/tabler-icons', express.static(new URL('../node_modules/@tabler/icons-webfont/dist', import.meta.url).pathname));
app.use(express.static(new URL('../public', import.meta.url).pathname));

function audit(event, fields = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

function requireInternalToken(req, res, next) {
  if (!internalApiToken || req.get('authorization') !== `Bearer ${internalApiToken}`) {
    return res.status(401).json({ error: 'Internal API authentication failed' });
  }
  next();
}

app.use(createPhase7Router({service:phase7Service,queue:phase7QueueProxy,requireInternalToken,env:process.env,managementAuth}));
app.use('/api/research',createResearchRouter({service:researchWorkbenchService,managementAuth}));

const categoryScopeRead=[managementAuth.authenticate,managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES')];
const categoryScopeWrite=[managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN')];
const categoryScopeApprove=[managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','MANAGEMENT_APPROVER')];

app.get('/api/category-scopes/candidates',...categoryScopeRead,async(req,res,next)=>{
  try{res.json({items:await categoryScopeService.listCandidates(req.query)});}catch(error){next(error);}
});
app.get('/api/category-scopes/revisions',...categoryScopeRead,async(req,res,next)=>{
  try{res.json({items:await categoryScopeService.listRevisions(req.query)});}catch(error){next(error);}
});
app.get('/api/category-scopes/current',...categoryScopeRead,async(req,res,next)=>{
  try{
    const params=[];let where='';
    if(req.query.product_profile){params.push(clean(req.query.product_profile,80).toUpperCase());where='WHERE product_profile=$1';}
    const result=await pool.query(`SELECT * FROM leadgen.dpv_product_category_scope_current ${where}
      ORDER BY product_profile,normalized_category,id`,params);
    res.json({items:result.rows});
  }catch(error){next(error);}
});
app.post('/api/category-scopes/revisions',...categoryScopeWrite,async(req,res,next)=>{
  try{
    const result=await categoryScopeService.createDraft({...req.body,actor:req.managementUser.identity});
    audit('CATEGORY_SCOPE_DRAFT_CREATED',{revision_id:result.id,revision:result.revision,actor:req.managementUser.identity});
    res.status(result.idempotent_replay?200:201).json(result);
  }catch(error){next(error);}
});
app.post('/api/category-scopes/revisions/:id/approve',...categoryScopeApprove,async(req,res,next)=>{
  try{
    const result=await categoryScopeService.approveRevision({...req.body,draft_revision_id:optionalUuid(req.params.id,'draft_revision_id'),
      actor:req.managementUser.identity,actor_role:req.managementUser.role});
    audit('CATEGORY_SCOPE_REVISION_APPROVED',{revision_id:result.id,revision:result.revision,actor:req.managementUser.identity});
    const scheduleJobId=await enqueueAutoEvidenceEvent(`category-scope-approved:${result.id}`,
      {category_scope_revision_id:result.id});
    res.status(result.idempotent_replay?200:201).json({...result,auto_evidence_schedule_job_id:scheduleJobId});
  }catch(error){next(error);}
});

app.get('/api/auto-evidence/summary',...categoryScopeRead,async(_req,res,next)=>{
  try{res.json({...autoEvidenceService.status(),...(await autoEvidenceService.repository.summary())});}catch(error){next(error);}
});
app.get('/api/auto-evidence/tasks',...categoryScopeRead,async(req,res,next)=>{
  try{res.json({items:await autoEvidenceService.repository.listTasks(req.query)});}catch(error){next(error);}
});
app.get('/api/auto-evidence/exceptions',...categoryScopeRead,async(req,res,next)=>{
  try{res.json({items:await autoEvidenceService.repository.listExceptions(req.query)});}catch(error){next(error);}
});
app.post('/api/internal/auto-evidence/events',requireInternalToken,async(req,res,next)=>{
  try{res.status(202).json(await autoEvidenceService.scheduleEvent(req.body||{}));}catch(error){next(error);}
});
app.post('/api/internal/auto-evidence/reconcile',requireInternalToken,async(req,res,next)=>{
  try{
    if(req.body?.controlled_batch===true){
      const error=new Error('Controlled batches require an authenticated management session');
      error.code='AUTO_EVIDENCE_CONTROLLED_BATCH_AUTH_REQUIRED';error.status=403;throw error;
    }
    res.status(202).json(await autoEvidenceService.reconcile(req.body||{}));
  }catch(error){next(error);}
});
app.post('/api/internal/orchestrator/heartbeat',requireInternalToken,async(req,res,next)=>{
  try{res.status(202).json(await orchestratorHealth.heartbeat(req.body||{}));}catch(error){next(error);}
});
app.post('/api/internal/orchestrator/watchdog',requireInternalToken,async(req,res,next)=>{
  try{res.status(202).json(await orchestratorHealth.watchdog({dispatch:dispatchResearchJob,limit:req.body?.limit}));}
  catch(error){next(error);}
});
app.post('/api/internal/research/direct-dispatch/reconcile',requireInternalToken,async(req,res,next)=>{
  try{res.status(202).json(await researchDirectDispatchService.reconcile({limit:req.body?.limit}));}catch(error){next(error);}
});
app.get('/api/orchestrator/status',...categoryScopeRead,async(_req,res,next)=>{
  try{
    const reconciliation=await orchestratorHealth.status('dpvPhase10AutoEvidenceReconciliation');
    res.json({research_dispatch:{state:'DIRECT_PG_BOSS'},reconciliation});
  }catch(error){next(error);}
});
app.post('/api/auto-evidence/controlled-batch',managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN'),async(req,res,next)=>{
    try{
      const result=await autoEvidenceService.runControlledBatch(req.body||{}, {
        trusted_management:true,
        operator_identity:req.managementUser.identity,
        operator_role:req.managementUser.role,
        approval_reference:clean(req.body?.approval_reference,160)
      });
      res.status(202).json(result);
    }catch(error){next(error);}
  });

const verifiedCompanySources = [
  ['Al Sammran Garments Trading LLC', 'https://sammran.com/'],
  ['ELK Fashion Dubai', 'https://elkfashiondubai.com/'],
  ['Dusong Chen Garments Trading FZE', 'https://dusongchengarments.com/'],
  ['Khair Garments Trading', 'https://khairgarments.com/'],
  ['Lancy Readymade Garments Trading LLC', 'https://www.lancygarments.com/'],
  ['House of Fashion Arabia', 'https://houseoffashion.ae/'],
  ['Rabeea Al Majed Textile Trading LLC', 'https://www.rabeeaalmajed.com/'],
  ['Marhaba Fashion', 'https://www.marhabafashion.com/'],
  ['Wahat Al Salam Textile Trading LLC', 'https://wahatalsalamtextiles.com/'],
  ['Leyla Luxury', 'https://leylaluxury.online/'],
  ['Visionary Goods Wholesalers LLC', 'https://www.visionarygoodsdubai.com/']
];

const publicBusinessProfiles = [
  {
    name: 'TKD Lingerie', website: 'http://www.tkdlingerie.com', city: 'Dubai', sizeBand: 'small',
    sourceUrl: 'https://www.linkedin.com/company/tkd-fashion-llc',
    description: 'Independent UAE women’s lingerie, swimwear and nightwear retailer with Dubai and Abu Dhabi boutiques, online retail and products sourced from multiple brands.',
    categories: 'Women apparel; lingerie; swimwear; nightwear; independent boutique; multi-brand retail'
  },
  {
    name: 'Palermo Trading LLC', website: 'http://www.palermotrading.com', city: 'Dubai', sizeBand: 'small',
    sourceUrl: 'https://www.linkedin.com/company/palermo-trading',
    description: 'Boutique luxury retail operator with 11-50 employees. Public company profile states it partners with niche maisons and emerging designers and supports wholesale distribution and omnichannel rollout.',
    categories: 'Women apparel; boutique; multi-brand retail; wholesale distribution; emerging designers'
  },
  {
    name: 'Orchid Trading CO.LLC', website: 'https://www.orchid-uae.com', city: 'Dubai', sizeBand: 'micro',
    sourceUrl: 'https://www.linkedin.com/company/orchid-treading-co-llc',
    description: 'Dubai retail apparel and fashion partnership with 2-10 employees. Public company profile says it sources products from around the world for women and men and operates an online store.',
    categories: 'Women apparel; fashion retail; online store; global sourcing'
  },
  {
    name: 'Sand Dollar Dubai Beachwear Boutique', website: 'http://www.sanddollardubai.com', city: 'Dubai', sizeBand: 'small',
    sourceUrl: 'https://www.linkedin.com/company/sand-dollar-beachwear-boutique/',
    description: 'Independent multi-brand resort and swimwear retailer with 11-50 employees and several UAE boutique locations, selling women’s beachwear, resortwear and swimwear.',
    categories: 'Women apparel; beachwear; resortwear; swimwear; multi-brand boutique'
  },
  {
    name: 'Opera Trading Co.', website: 'http://www.operatradingco.com', city: 'Dubai', sizeBand: 'medium',
    sourceUrl: 'https://www.linkedin.com/company/opera-trading-company',
    description: 'Privately held Dubai fashion retailer with 51-200 employees and a portfolio of multi-brand boutiques across leading Dubai destinations.',
    categories: 'Women apparel; fashion retail; multi-brand boutiques; regional retail'
  },
  {
    name: 'Al Hala Trading Establishment', website: 'https://www.leem.com/sa', city: 'Dubai', sizeBand: 'large',
    sourceUrl: 'https://www.linkedin.com/company/al-hala-trading-establishment',
    description: 'Large apparel and fashion retail business with 201-500 employees, women’s fashion operations and stores across UAE and Saudi Arabia. Retained for coverage but treated as harder to access than SMEs.',
    categories: 'Women apparel; modest fashion; retail chain; department stores; regional network'
  }
];

function clean(value = '') {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanDisplay(value = '') {
  return clean(value).replace(/[•·]{2,}/g, ' · ').replace(/\s+([,.;:!?])/g, '$1').slice(0, 5000);
}
function normalizeName(value) {
  return clean(value).toLowerCase().replace(/\b(l\.?l\.?c|fze|llc|co|company|trading|establishment)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
function firstEmail(text) {
  return text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+?\.(?:co\.uk|com|net|org|ae|biz|info|io|me)/i)?.[0] || null;
}
function firstPhone(text) {
  return text.match(/(?:\+971|0)[\s()-]*\d(?:[\s()-]*\d){7,10}/)?.[0] || null;
}
function normalizePhone(value) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('971') && digits.length >= 11) return `+971 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  if (digits.startsWith('0') && digits.length === 9) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return clean(value);
}
function normalizeCity(value = '') {
  const text = clean(value);
  if (/dubai|دبي/i.test(text)) return 'Dubai';
  if (/ajman|عجمان/i.test(text)) return 'Ajman';
  if (/sharjah|الشارقة/i.test(text)) return 'Sharjah';
  return 'UAE';
}
function evidenceExcerpt(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return text.slice(0, 350);
  const start = Math.max(0, match.index - 90);
  const end = Math.min(text.length, match.index + 310);
  return `${start ? '…' : ''}${clean(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

function extractBusinessSocialProfiles($) {
  const allowed = /(^|\.)(instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|wa\.me|whatsapp\.com)$/i;
  const profiles = $('a[href]').map((_i, node) => {
    const href = clean($(node).attr('href'));
    try {
      const url = new URL(href);
      return allowed.test(url.hostname.replace(/^www\./, '')) ? url.href : null;
    } catch { return null; }
  }).get().filter(Boolean);
  return [...new Set(profiles)].slice(0, 12);
}

async function fetchText(url, timeout = 15000) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'DPVBusinessDirectory/1.0 (public-source research)' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function scoreLive(record) {
  const text = `${record.name} ${record.description} ${record.categories || ''}`.toLowerCase();
  const womenswear = /women|woman|ladies|womenswear|female fashion|dress|gown|camisole|slip dress|sundress|skirt|blouse|\btops?\b|\btrousers?\b|\bpants?\b|jumpsuit|romper|co-ord|\bsets?\b|\bsuits?\b|jacket|coat|outerwear|knit|cardigan|sweater|legging|shorts|abaya/.test(text);
  const otherOnly = /children|childrenswear|kids|baby|infant|boys|girls|menswear|men's|male fashion/.test(text) && !womenswear;
  const product = womenswear ? 20 : /fashion|apparel|garment|cloth|textile/.test(text) ? 10 : 2;
  const market = /dubai|uae|united arab emirates|ajman|sharjah/.test(text) ? 15 : 8;
  const strongImporter = /wholesale|wholesaler|distribut|\bimport/.test(text);
  const trading = /trading|supplier|supply|b2b/.test(text);
  const chain = /supermarket chain|supermarkets|hypermarkets|department stores|retail chain|regional network/.test(text);
  const excludedModel = (/buying house|private label|manufactur/.test(text) && !chain) || otherOnly;
  const importer = excludedModel ? 0 : strongImporter ? 15 : trading ? 7 : 0;
  const evidence = excludedModel ? 0 : chain ? 15 : strongImporter ? 10 : trading ? 5 : 0;
  const sizeBand = record.sizeBand || (/\b(501|1000|5000)\+?\s*employees|multinational|largest retailer/.test(text) ? 'large'
    : /\b(201|500)\+?\s*employees|regional network|hypermarkets|supermarket chain/.test(text) ? 'large'
      : /\b(51|200)\+?\s*employees/.test(text) ? 'medium'
        : /\b(2|10|11|50)\+?\s*employees|independent|family-owned|boutique|single store|small business/.test(text) ? 'small' : 'unknown');
  const accessibility = sizeBand === 'micro' || sizeBand === 'small' ? 10 : sizeBand === 'medium' ? 7 : sizeBand === 'large' ? 3 : 6;
  const buying = /sourc|procurement|buyer|\bimport|multi-brand|emerging designers|brand partnership|wholesale distribution/.test(text) ? 10 : strongImporter ? 5 : 0;
  const decision = 0;
  const contact = record.email ? 5 : record.phone ? 3 : record.socialProfiles?.length ? 2 : record.website ? 1 : 0;
  let total = product + market + importer + evidence + accessibility + buying + decision + contact;
  if (!strongImporter && !trading && !chain) total = Math.min(total, 54);
  if (excludedModel) total = Math.min(total, 45);
  return {
    components: [product, market, importer, evidence, accessibility, buying, decision, contact],
    total, tier: total >= 75 ? 'A' : total >= 55 ? 'B' : 'C',
    isB2b: !excludedModel && (strongImporter || trading), importerFit: !excludedModel && strongImporter,
    chainFit: !excludedModel && chain, excludedModel, sizeBand,
    procurementAccessFit: !excludedModel && ['micro', 'small', 'medium'].includes(sizeBand)
  };
}

function selectEvidenceBlocks($) {
  const pattern = /women|ladies|womenswear|dress|gown|camisole|sundress|skirt|blouse|top|trouser|pants|jumpsuit|romper|co-ord|set|suit|jacket|coat|outerwear|knit|cardigan|sweater|legging|shorts|abaya|wholesale|wholesaler|distribut|import|supermarket|retail chain|department store|supplier/i;
  const blocks = $('h1,h2,h3,p,li').map((_i, node) => cleanDisplay($(node).text())).get()
    .filter(text => text.length >= 25 && text.length <= 700 && pattern.test(text));
  return [...new Set(blocks)].slice(0, 4).join(' ').slice(0, 2400);
}

async function verifyPublicEmail(email, officialWebsite) {
  if (!email) return { status: 'unknown', method: 'no_email', detail: '未发现公开邮箱。', checkedAt: new Date() };
  const normalized = email.toLowerCase();
  const domain = normalized.split('@')[1];
  const officialHost = hostname(officialWebsite);
  const domainMatchesWebsite = Boolean(officialHost && (officialHost === domain || officialHost.endsWith(`.${domain}`) || domain.endsWith(`.${officialHost}`)));
  let mxValid = false;
  try { mxValid = (await resolveMx(domain)).length > 0; } catch { mxValid = false; }
  if (domainMatchesWebsite && mxValid) return {
    status: 'valid', method: 'official_website+dns_mx',
    detail: '企业官网公开；邮箱域名 MX 邮件服务有效；未发送测试邮件。', checkedAt: new Date()
  };
  if (mxValid) return {
    status: 'unknown', method: 'public_source+dns_mx',
    detail: '公开来源提供；邮箱域名 MX 有效，但尚未确认该邮箱属于企业官网；未发送测试邮件。', checkedAt: new Date()
  };
  return {
    status: 'risky', method: domainMatchesWebsite ? 'official_website+dns_mx' : 'public_source+dns_mx',
    detail: '公开来源可见，但未检测到有效 MX 邮件服务；请人工复核。', checkedAt: new Date()
  };
}

async function collectVerifiedWebsites() {
  const settled = await Promise.allSettled(verifiedCompanySources.map(async ([name, url]) => {
      const html = await fetchText(url);
      const $ = load(html);
      $('script,style,noscript,svg').remove();
      const text = cleanDisplay($('body').text()).slice(0, 20000);
      const evidence = selectEvidenceBlocks($) || cleanDisplay($('meta[name="description"]').attr('content') || '').slice(0, 1200);
      const mailtoEmail = clean($('a[href^="mailto:"]').first().attr('href') || '').replace(/^mailto:/i, '').split('?')[0];
      const socialProfiles = extractBusinessSocialProfiles($);
      return {
        name, city: normalizeCity(/ajman/i.test(text) && !/dubai/i.test(text) ? 'Ajman' : 'Dubai'),
        address: clean($('[itemprop="address"]').first().text()), website: url,
        description: evidence || `${name} 企业官网公开页面。`, categories: 'All women apparel; dresses; tops; skirts; trousers; sets; outerwear; knitwear; apparel',
        email: firstEmail(mailtoEmail) || firstEmail(text), phone: normalizePhone(firstPhone(text)), socialProfiles, provider: '企业官网', officialWebsite: true,
        sourceUrl: url, providerReference: hostname(url), evidenceKind: 'company_claim',
        dataOrigin: 'fixed_public_candidate'
      };
  }));
  for (const result of settled.filter(item => item.status === 'rejected'))
    console.warn(`Live source skipped: ${result.reason.message}`);
  return settled.filter(item => item.status === 'fulfilled').map(item => item.value);
}

async function collectPublicBusinessProfiles() {
  return publicBusinessProfiles.map(profile => ({
    ...profile,
    address: '', email: null, phone: null,
    socialProfiles: [profile.sourceUrl], provider: 'LinkedIn 公开企业主页',
    providerReference: profile.sourceUrl.split('/').filter(Boolean).pop(), evidenceKind: 'public_business_social_profile',
    dataOrigin: 'fixed_public_profile'
  }));
}

async function collectEmiratesOnline() {
  const url = 'https://www.emirates-online.net/English/cat/clothing-wholesalers';
  const html = await fetchText(url);
  const $ = load(html);
  const records = [];
  const seen = new Set();
  $('a[href^="/English/item/"]').each((_index, element) => {
    const href = $(element).attr('href');
    const name = clean($(element).find('h4').first().text());
    if (!href || !name || seen.has(href)) return;
    seen.add(href);
    const paragraphs = $(element).find('p').map((_i, p) => clean($(p).text())).get();
    const description = paragraphs.find(p => p && p !== 'ADDRESS:' && !/United Arab Emirates$/i.test(p)) || 'Listed in the Clothing Wholesalers category.';
    const address = paragraphs.find(p => /United Arab Emirates$/i.test(p)) || '';
    records.push({
      name, city: normalizeCity(address),
      address: cleanDisplay(address), website: null, description: cleanDisplay(`${description} 该企业列于服装批发商公开目录。`),
      categories: 'Clothing wholesalers; women clothing candidates', email: null, phone: null, provider: 'Emirates Online 商业目录',
      sourceUrl: new URL(href, url).href, providerReference: href.split('/').pop(), evidenceKind: 'business_directory',
      dataOrigin: 'directory_live'
    });
  });
  return records;
}

async function collectOpenStreetMap() {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.maprva.org/api/interpreter'
  ];
  const query = '[out:json][timeout:20];nwr["shop"~"clothes|fashion|department_store"](25.12,55.15,25.35,55.45);out center tags 80;';
  let payload;
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'DPVBusinessDirectory/1.0 (public-source research)'
        }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(endpoint.includes('overpass-api.de') ? 15000 : 25000)
      });
      if (!response.ok) throw new Error(`${new URL(endpoint).hostname} returned ${response.status}`);
      payload = await response.json();
      break;
    } catch (error) { lastError = error; }
  }
  if (!payload) throw lastError;
  return payload.elements.filter(item => item.tags?.name).map(item => {
    const t = item.tags;
    const address = clean([t['addr:housenumber'], t['addr:street'], t['addr:district'], t['addr:city'] || 'Dubai'].filter(Boolean).join(', '));
    const website = t.website || t['contact:website'] || null;
    const sourceUrl = `https://www.openstreetmap.org/${item.type}/${item.id}`;
    return {
      name: cleanDisplay(t.name), city: normalizeCity(t['addr:city'] || 'Dubai'), address, website,
      description: cleanDisplay(`${t.description || ''} ${t.shop || ''} ${t.brand || ''} 公开地图中的服装零售或百货企业条目。`),
      categories: `OpenStreetMap; clothing retail candidate`,
      email: t.email || t['contact:email'] || null, phone: normalizePhone(t.phone || t['contact:phone'] || null),
      socialProfiles: [t['contact:instagram'], t['contact:facebook'], t['contact:linkedin'], t['contact:tiktok']].filter(Boolean),
      provider: 'OpenStreetMap 公开地图', sourceUrl,
      providerReference: `${item.type}/${item.id}`, evidenceKind: 'geospatial_business_listing',
      dataOrigin: 'osm_live'
    };
  });
}

async function collectLive(limit = 50) {
  const results = [];
  const errors = [];
  for (const collector of [collectVerifiedWebsites, collectEmiratesOnline, collectOpenStreetMap, collectPublicBusinessProfiles]) {
    try { results.push(...await collector()); } catch (error) { errors.push(error.message); }
  }
  const unique = new Map();
  for (const record of results) {
    const key = hostname(record.website) || normalizeName(record.name);
    if (!key) continue;
    if (!unique.has(key)) unique.set(key, record);
    else {
      const prior = unique.get(key);
      prior.description = clean(`${prior.description} ${record.description}`).slice(0, 5000);
      prior.sourceUrl2 = record.sourceUrl;
      prior.sourceProvider2 = record.provider;
      prior.socialProfiles = [...new Set([...(prior.socialProfiles || []), ...(record.socialProfiles || [])])];
      prior.sizeBand = record.sizeBand || prior.sizeBand;
    }
  }
  const ranked = [...unique.values()].map(record => ({ ...record, score: scoreLive(record) }))
    .sort((a, b) => b.score.total - a.score.total || a.name.localeCompare(b.name)).slice(0, limit);
  if (!ranked.length) throw new Error(`No live records collected. ${errors.join('; ')}`);

  const client = await pool.connect();
  let newCompanies = 0;
  let updatedCompanies = 0;
  const touchedCompanyIds=[];
  try {
    await client.query('BEGIN');
    for (const record of ranked) {
      const s = record.score;
      const identity = `live:${hostname(record.website) || normalizeName(record.name).replace(/\s+/g, '-')}`;
      const existed = await client.query('SELECT id FROM leadgen.companies WHERE normalized_domain=$1', [identity]);
      if (existed.rowCount) updatedCompanies += 1; else newCompanies += 1;
      const company = await client.query(`
        INSERT INTO leadgen.companies
          (company_name, normalized_domain, country_code, city, website_url, company_type,
           company_description, product_categories, importer_wholesaler_evidence,
           chain_store_supply_evidence, qualification_status, is_b2b, company_size_band,
           procurement_access_fit, size_evidence, social_profiles,
           importer_wholesaler_fit, chain_supply_fit, source_record_count, data_origin, last_collected_at)
        VALUES ($1,$2,'AE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
        ON CONFLICT (normalized_domain) DO UPDATE SET
          company_name=EXCLUDED.company_name, city=EXCLUDED.city,
          website_url=coalesce(EXCLUDED.website_url,leadgen.companies.website_url),
          company_type=EXCLUDED.company_type, company_description=EXCLUDED.company_description,
          product_categories=EXCLUDED.product_categories,
          importer_wholesaler_evidence=EXCLUDED.importer_wholesaler_evidence,
          chain_store_supply_evidence=EXCLUDED.chain_store_supply_evidence,
          qualification_status=EXCLUDED.qualification_status, is_b2b=EXCLUDED.is_b2b,
          company_size_band=EXCLUDED.company_size_band,
          procurement_access_fit=EXCLUDED.procurement_access_fit,
          size_evidence=EXCLUDED.size_evidence,
          social_profiles=EXCLUDED.social_profiles,
          importer_wholesaler_fit=EXCLUDED.importer_wholesaler_fit,
          chain_supply_fit=EXCLUDED.chain_supply_fit, data_origin=EXCLUDED.data_origin,
          last_collected_at=now(), updated_at=now()
        RETURNING id`, [
          record.name, identity, normalizeCity(record.city), record.website,
          s.excludedModel ? '排除：非女装或 OEM/采购代理模式' : s.importerFit ? '全品类女装进口商/批发商候选' : s.isB2b ? '全品类女装 B2B 贸易候选' : '全品类女装零售候选',
          cleanDisplay(record.description), ['全品类女装', '连衣裙', '上衣', '半身裙', '裤装', '套装', '外套', '针织衫', '内搭', '其他女装'],
          s.importerFit ? `公开来源包含批发、进口或分销表述：${evidenceExcerpt(record.description, /wholesale|wholesaler|distribut|\bimport/i)}` : null,
          s.chainFit ? `公开来源包含连锁零售供货表述：${evidenceExcerpt(record.description, /supermarket chain|supermarkets|hypermarkets|department stores|retail chain|regional network/i)}` : null,
          s.importerFit && s.chainFit ? 'qualified' : s.isB2b ? 'needs_review' : 'rejected',
          s.isB2b, s.sizeBand, s.procurementAccessFit,
          s.sizeBand === 'large' ? '公开资料显示为大型或跨区域企业：保留搜索覆盖，但合作可达性分较低。' :
            s.procurementAccessFit ? '公开资料显示为中小企业、独立精品店或区域经营者：优先人工接触。' : '公开资料不足，企业规模待核验。',
          JSON.stringify(record.socialProfiles || []), s.importerFit, s.chainFit, record.sourceUrl2 ? 2 : 1,
          record.dataOrigin || 'legacy_public_web'
        ]);
      const companyId = company.rows[0].id;
      touchedCompanyIds.push(companyId);
      const sources = [[record.provider, record.sourceUrl, record.providerReference, record.evidenceKind]];
      if (record.sourceUrl2) sources.push([record.sourceProvider2, record.sourceUrl2, null, 'corroborating_listing']);
      for (const source of sources) await client.query(`
        INSERT INTO leadgen.sources (company_id, provider_name, source_url, provider_reference, raw_payload, evidence_kind)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (company_id,provider_name,source_url) DO UPDATE SET
          provider_reference=EXCLUDED.provider_reference, raw_payload=EXCLUDED.raw_payload,
          evidence_kind=EXCLUDED.evidence_kind, captured_at=now()`,
        [companyId, ...source.slice(0, 3), JSON.stringify({ live: true, captured_at: new Date().toISOString(), evidence: cleanDisplay(record.description).slice(0, 1200) }), source[3]]);
      await client.query(`UPDATE leadgen.companies SET source_record_count=(SELECT count(*) FROM leadgen.sources WHERE company_id=$1) WHERE id=$1`, [companyId]);
      if (record.email || record.phone) {
        const verification = await verifyPublicEmail(record.email, record.officialWebsite ? record.website : null);
        const existingContact = await client.query(`
          SELECT id FROM leadgen.contacts WHERE company_id=$1 AND (
            (business_email IS NOT NULL AND $2::text IS NOT NULL AND lower(business_email)=lower($2)) OR
            (business_email IS NULL AND $2::text IS NULL AND coalesce(business_phone,'')=coalesce($3,''))
          )
          ORDER BY created_at LIMIT 1`, [companyId, record.email, record.phone]);
        if (existingContact.rowCount) await client.query(`
          UPDATE leadgen.contacts SET department='企业公开商务联系', business_email=$2, business_phone=$3,
            email_verification_status=$4, source_url=$5, verification_method=$6, verification_detail=$7,
            verification_checked_at=$8, updated_at=now() WHERE id=$1`,
          [existingContact.rows[0].id, record.email, record.phone, verification.status, record.sourceUrl,
            verification.method, verification.detail, verification.checkedAt]);
        else await client.query(`
          INSERT INTO leadgen.contacts
            (company_id,department,business_email,business_phone,email_verification_status,source_url,
             verification_method,verification_detail,verification_checked_at)
          VALUES ($1,'企业公开商务联系',$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, record.email, record.phone, verification.status, record.sourceUrl,
            verification.method, verification.detail, verification.checkedAt]);
      }
      await client.query(`
        INSERT INTO leadgen.lead_reviews
          (company_id, product_match, lead_score, tier, score_explanation, approval_status,
           outreach_draft, send_status, owner, next_action, product_fit_score, market_fit_score,
           importer_fit_score, evidence_score, scale_score, buying_signal_score, decision_maker_score, contact_validity_score)
        VALUES ($1,'全品类女装：覆盖所有女性服装品类',$2,$3,$4,'pending',NULL,'disabled','人工研究员',$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (company_id) DO UPDATE SET
          product_match=EXCLUDED.product_match, lead_score=EXCLUDED.lead_score, tier=EXCLUDED.tier,
          score_explanation=EXCLUDED.score_explanation, send_status='disabled', owner=EXCLUDED.owner,
          next_action=EXCLUDED.next_action, product_fit_score=EXCLUDED.product_fit_score,
          market_fit_score=EXCLUDED.market_fit_score, importer_fit_score=EXCLUDED.importer_fit_score,
          evidence_score=EXCLUDED.evidence_score, scale_score=EXCLUDED.scale_score,
          buying_signal_score=EXCLUDED.buying_signal_score, decision_maker_score=EXCLUDED.decision_maker_score,
          contact_validity_score=EXCLUDED.contact_validity_score, updated_at=now()`, [
          companyId, s.total, s.tier,
          `评估日期：${new Date().toISOString()}。评估依据：商品类目适配、目标市场、渠道属性、企业规模、采购信号和联系方式。`,
          s.excludedModel ? '不联系：不符合女装目标或属于排除模式' : s.tier === 'A' ? '外联前人工核验公司、联系人和需求' : '继续补充女装采购与联系人证据', ...s.components
        ]);
    }
    const providers = [...new Set(ranked.map(record => record.provider))];
    const collectionRun = await client.query(`
      INSERT INTO leadgen.collection_runs
        (target_product,providers,fetched_records,new_companies,updated_companies,source_errors)
      VALUES ('全品类女装（包括但不限于连衣裙、上衣、半身裙、裤装、套装、外套、针织衫、内搭及其他女装）',$1,$2,$3,$4,$5)
      RETURNING id,completed_at`,
      [providers, results.length, newCompanies, updatedCompanies, errors]);
    await client.query('COMMIT');
    let autoEvidenceScheduleJobId=null;
    let autoEvidenceScheduleStatus='QUEUED';
    try {
      autoEvidenceScheduleJobId=await enqueueAutoEvidenceEvent(`live-collection:${collectionRun.rows[0].id}`,{
        collection_run_id:collectionRun.rows[0].id,new_companies:newCompanies,updated_companies:updatedCompanies,
        company_ids:[...new Set(touchedCompanyIds)]
      });
    } catch (queueError) {
      autoEvidenceScheduleStatus='RETRYABLE_ERROR';
      audit('AUTO_EVIDENCE_EVENT_ENQUEUE_FAILED',{source:'LIVE_COLLECTION',code:queueError?.code||'QUEUE_UNAVAILABLE'});
    }
    return {
      metrics: await metrics(pool), providers, sourceErrors: errors,
      fetchedRecords: results.length, newCompanies, updatedCompanies,
      auto_evidence_schedule_job_id:autoEvidenceScheduleJobId,
      auto_evidence_schedule_status:autoEvidenceScheduleStatus
    };
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}

async function metrics(db = pool) {
  const { rows } = await db.query(`
    SELECT
      count(*)::int AS unique_companies,
      count(*) FILTER (WHERE is_b2b)::int AS b2b_companies,
      count(*) FILTER (WHERE importer_wholesaler_fit)::int AS importer_wholesalers,
      count(*) FILTER (WHERE company_size_band IN ('micro','small','medium'))::int AS sme_companies,
      count(*) FILTER (WHERE chain_supply_fit)::int AS chain_suppliers,
      count(*) FILTER (WHERE coalesce(sr.tier,r.tier) = 'A')::int AS tier_a,
      count(*) FILTER (WHERE coalesce(sr.tier,r.tier) = 'A' AND coalesce(r.approval_status,'pending') = 'pending')::int AS pending_approval,
      count(*) FILTER (WHERE r.approval_status = 'approved')::int AS approved,
      count(*) FILTER (WHERE r.send_status <> 'disabled')::int AS send_enabled,
      count(*) FILTER (WHERE c.verification_status='VERIFIED' AND c.lifecycle_status='ACTIVE'
        AND c.explicit_exclusion_reason IS NULL)::int AS verified_active,
      count(*) FILTER (WHERE c.verification_status='REVIEW')::int AS review,
      count(*) FILTER (WHERE c.verification_status='REJECTED')::int AS rejected,
      count(*) FILTER (WHERE c.lifecycle_status='STALE')::int AS stale,
      count(*) FILTER (WHERE c.lifecycle_status='SUPERSEDED')::int AS superseded,
      count(*) FILTER (WHERE c.lifecycle_status='DUPLICATE')::int AS duplicate,
      count(*) FILTER (WHERE c.lifecycle_status='ARCHIVED')::int AS archived,
      count(*) FILTER (WHERE c.verification_status='REVIEW' AND c.data_origin IN
        ('fixed_public_candidate','fixed_public_profile','directory_live','osm_live','legacy_public_web','manual','seed'))::int
        AS legacy_pending_review,
      round(100.0 * count(*) FILTER (WHERE s.source_count > 0) / nullif(count(*),0), 1) AS source_traceability_pct,
      coalesce(sum(c.source_record_count - 1),0)::int AS duplicates_merged,
      max(c.last_collected_at) AS last_collected_at
    FROM leadgen.companies c
    LEFT JOIN leadgen.lead_reviews r ON r.company_id = c.id
    LEFT JOIN LATERAL (SELECT tier FROM leadgen.company_score_runs sx
      WHERE sx.company_id=c.id ORDER BY sx.calculated_at DESC,sx.id DESC LIMIT 1) sr ON true
    LEFT JOIN (SELECT company_id, count(*) source_count FROM leadgen.sources GROUP BY company_id) s
      ON s.company_id = c.id
    WHERE c.data_origin IN (${publicDataOriginSql})
      AND ${companyMarketVisibleSql('c')}`);
  const lastRun = await db.query('SELECT new_companies,updated_companies,fetched_records,completed_at FROM leadgen.collection_runs ORDER BY completed_at DESC LIMIT 1');
  return { ...rows[0], data_origin: 'mixed_public_provenance', last_run: lastRun.rows[0] || null };
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const queue = await phase5Queue.health();
    res.json({ status: 'ok', database: 'ready', phase5_jobs: queue.status });
  }
  catch (error) { res.status(503).json({ status: 'error', error: error.message }); }
});

app.post('/api/live/collect', managementAuth.authenticate,
  managementAuth.requireRoles('DATA_ADMIN','MANAGEMENT'), async (req, res, next) => {
  try {
    const requested = Number(req.body?.limit || 50);
    const limit = Math.max(10, Math.min(100, requested));
    const result=await collectLive(limit);
    res.json({ run: 'completed', ...result });
  } catch (e) { next(e); }
});

app.get('/api/metrics', async (_req, res, next) => {
  try { res.json(await metrics(pool)); } catch (e) { next(e); }
});

function researchJobResponse(row) {
  const { id, ...fields } = row;
  return { job_id: id, ...fields };
}

async function dispatchResearchJob(job){
  const result=await researchDirectDispatchService.dispatch(job.id);
  if(result.state!=='DISPATCHED'&&result.state!=='COMPLETED')throw Object.assign(new Error('Direct research queue is unavailable'),{code:'QUEUE_UNAVAILABLE'});
  return {accepted:true,status_code:202,mode:'DIRECT_QUEUE',queue_job_id:result.queue_job_id||null};
}

async function triggerEnrichmentWorkflow(job) {
  if (!n8nEnrichmentWebhookUrl) throw new Error('Enrichment workflow webhook is not configured');
  const response = await fetch(n8nEnrichmentWebhookUrl, {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({
      job_id:job.id,
      job_type:job.job_type,
      market_codes:job.market_codes,
      product_profiles:job.product_profiles,
      requested_company_ids:job.requested_company_ids,
      max_results:job.max_results
    }),
    signal:AbortSignal.timeout(n8nWebhookTimeoutMs)
  });
  if (!response.ok) throw new Error(`Enrichment workflow returned HTTP ${response.status}`);
  return { accepted:true,status_code:response.status };
}

async function triggerCategoryProcurementWorkflow(job) {
  if (!n8nCategoryProcurementWebhookUrl) throw new Error('Category Procurement workflow webhook is not configured');
  const response = await fetch(n8nCategoryProcurementWebhookUrl, {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({
      job_id:job.id,
      job_type:'CATEGORY_PROCUREMENT_ENRICHMENT',
      product_profiles:job.product_profiles||['WOMENSWEAR','GENERAL_MERCHANDISE']
    }),
    signal:AbortSignal.timeout(n8nWebhookTimeoutMs)
  });
  if (!response.ok) throw new Error(`Category Procurement workflow returned HTTP ${response.status}`);
  return { accepted:true,status_code:response.status };
}

async function createCategoryProcurementResearchJob({companyIds=[],maxResults=100,idempotencyKey=null,
  productProfiles=['WOMENSWEAR','GENERAL_MERCHANDISE']}={}) {
  const uniqueIds=[...new Set((companyIds||[]).map(value=>optionalUuid(value,'company_id')).filter(Boolean))];
  const requestedProfiles=[...new Set((productProfiles||[]).map(value=>String(value||'').trim().toUpperCase()))]
    .filter(value=>['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(value));
  if(!requestedProfiles.length)throw Object.assign(new Error('At least one supported product profile is required'),{
    code:'CATEGORY_PROCUREMENT_PROFILE_INVALID'});
  const params=[];
  const clauses=[`c.data_origin IN (${publicDataOriginSql})`,companyMarketVisibleSql('c'),"c.verification_status='VERIFIED'",
    "c.lifecycle_status='ACTIVE'",'c.explicit_exclusion_reason IS NULL',excludesConfirmedExistingCustomerSql('c')];
  if(uniqueIds.length){params.push(uniqueIds);clauses.push(`c.id=ANY($${params.length}::uuid[])`);}
  params.push(Math.max(1,Math.min(100,Number(maxResults)||100)));
  const selected=await pool.query(`SELECT c.id,c.country_code FROM leadgen.companies c
    WHERE ${clauses.join(' AND ')} ORDER BY c.country_code,c.company_name,c.id LIMIT $${params.length}`,params);
  if(uniqueIds.length&&selected.rowCount!==uniqueIds.length){
    throw Object.assign(new Error('One or more companies are not verified active Category Procurement targets'),{code:'CATEGORY_PROCUREMENT_COMPANY_INELIGIBLE'});
  }
  if(!selected.rowCount)throw Object.assign(new Error('No verified active companies are available for Category Procurement'),{code:'CATEGORY_PROCUREMENT_SCOPE_EMPTY'});
  await tavilyProviderAccountState.ensureCanCreate();
  const requestedCompanyIds=selected.rows.map(row=>row.id);
  const marketCodes=[...new Set(selected.rows.map(row=>row.country_code).filter(Boolean))];
  const created=await pool.query(`INSERT INTO leadgen.research_jobs
    (country,country_code,country_name,preferred_language,market_profile,product_category,product_profile,
     buyer_types,max_results,status,job_type,market_codes,product_profiles,requested_company_ids,
     category_profiles_attempted,idempotency_key,request_digest)
    VALUES ('MULTI_MARKET','XX','Multi-market','en','MULTI_MARKET','Category Procurement Match','WOMENSWEAR',
      '{}',$1,'QUEUED','CATEGORY_PROCUREMENT_ENRICHMENT',$2,$3,$4,$5,$6,$7)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`,[
    requestedCompanyIds.length,marketCodes,requestedProfiles,requestedCompanyIds,requestedCompanyIds.length*requestedProfiles.length,
    idempotencyKey?String(idempotencyKey).slice(0,200):randomUUID(),canonicalDigest({requestedCompanyIds,marketCodes,productProfiles:requestedProfiles})]);
  return created.rows[0];
}

function categoryProcurementJobResponse(row) {
  return {
    job_id:row.id,status:row.status,job_type:row.job_type,market_codes:row.market_codes||[],
    product_profiles:row.product_profiles||[],company_count:(row.requested_company_ids||[]).length,
    category_profiles_attempted:Number(row.category_profiles_attempted||0),
    category_sources_found:Number(row.category_sources_found||0),
    category_observations_found:Number(row.category_observations_found||0),
    buyer_models_classified:Number(row.buyer_models_classified||0),
    category_matches_passed:Number(row.category_matches_passed||0),
    category_matches_unknown:Number(row.category_matches_unknown||0),
    product_opportunities_found:Number(row.product_opportunities_found||0),
    category_procurement_errors:Number(row.category_procurement_errors||0),
    created_at:row.created_at,started_at:row.started_at,completed_at:row.completed_at,last_error:row.last_error||null
  };
}

app.get('/api/markets', (_req, res) => {
  res.json({
    markets: listConfiguredMarkets().filter(market=>isMarketVisible(market.country_code)),
    generic_fallback: true
  });
});

app.get('/api/research/provider-status',managementAuth.authenticate,
  managementAuth.requireRoles('DATA_ADMIN','MANAGEMENT','SALES'),async(_req,res,next)=>{
  try{
    const state=await tavilyProviderAccountState.getState();
    res.json({provider:'SEARCH',status:state.status,retry_after_at:state.retry_after_at||null,
      checked_at:state.checked_at||null,creation_allowed:!['CREDIT_EXHAUSTED','AUTH_ERROR'].includes(state.status)});
  }catch(error){next(error);}
});

app.post('/api/research/provider-status/refresh',managementAuth.authenticate,
  managementAuth.requireRoles('DATA_ADMIN','MANAGEMENT'),async(_req,res,next)=>{
  try{
    const state=await tavilyProviderAccountState.refreshUsage({force:true,source:'ADMIN_REFRESH'});
    res.json({provider:'SEARCH',status:state.status,retry_after_at:state.retry_after_at||null,
      checked_at:state.checked_at||null,creation_allowed:!['CREDIT_EXHAUSTED','AUTH_ERROR'].includes(state.status)});
  }catch(error){next(error);}
});

app.post('/api/research/jobs', managementAuth.authenticate,
  managementAuth.requireRoles('DATA_ADMIN','MANAGEMENT'), async (req, res, next) => {
  try {
    const requestedCountryName = clean(req.body?.country_name || req.body?.country);
    let requestedCountryCode = clean(req.body?.country_code).toUpperCase();
    if (!requestedCountryCode) {
      requestedCountryCode = listConfiguredMarkets().find(item => item.country_name.toLowerCase() === requestedCountryName.toLowerCase())?.country_code || '';
    }
    if (!/^[A-Z]{2}$/.test(requestedCountryCode)) {
      return res.status(400).json({ error: 'Invalid research job', detail: 'country_code must be a two-letter code' });
    }
    const marketProfile = getMarketProfile(requestedCountryCode, requestedCountryName);
    const country = requestedCountryName || marketProfile.countryName;
    const city = clean(req.body?.city);
    const region = clean(req.body?.region);
    const preferredLanguage = clean(req.body?.preferred_language) || marketProfile.defaultLanguage;
    const productCategory = clean(req.body?.product_category);
    const explicitProductProfile = clean(req.body?.product_profile).toUpperCase();
    const mappedProductProfile = productScopeForCategory(productCategory);
    const productProfile = explicitProductProfile || mappedProductProfile;
    const buyerTypes = Array.isArray(req.body?.buyer_types)
      ? [...new Set(req.body.buyer_types.map(clean).filter(Boolean))]
      : [];
    const maxResults = Number(req.body?.max_results ?? 20);
    if (!country || !productCategory || !productProfile || !buyerTypes.length || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      return res.status(400).json({
        error: 'Invalid research job',
        detail: 'country, supported product_category/product_profile, buyer_types and max_results (1-100) are required'
      });
    }
    if (!['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(productProfile)) {
      return res.status(400).json({ error: 'Invalid research job', detail: 'product_profile must be WOMENSWEAR or GENERAL_MERCHANDISE' });
    }
    if (explicitProductProfile && mappedProductProfile && explicitProductProfile !== mappedProductProfile) {
      return res.status(400).json({ error: 'Invalid research job', detail: 'product_profile does not match product_category' });
    }
    await tavilyProviderAccountState.ensureCanCreate();
    const requestPayload = {
      country_code:marketProfile.countryCode,country_name:country,city:city || null,region:region || null,
      preferred_language:preferredLanguage,product_category:productCategory,product_profile:productProfile,
      buyer_types:buyerTypes,max_results:maxResults
    };
    const requestDigest = canonicalDigest(requestPayload);
    const idempotencyKey = clean(req.get('idempotency-key') || req.body?.idempotency_key).slice(0,200) || randomUUID();
    const created=await researchDirectDispatchService.createAtomic(async client=>{
      const {rows}=await client.query(`INSERT INTO leadgen.research_jobs
        (country,country_code,country_name,city,region,preferred_language,market_profile,
         product_category,product_profile,buyer_types,max_results,status,idempotency_key,request_digest,
         created_by_identity,created_by_role,run_budget_cap_units)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'QUEUED',$12,$13,$14,$15,$16)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
      RETURNING *, (xmax=0) AS inserted`, [country, marketProfile.countryCode, country, city || null, region || null,
      preferredLanguage, marketProfile.profileKey, productCategory, productProfile, buyerTypes, maxResults,
      idempotencyKey,requestDigest,req.managementUser.identity,req.managementUser.role,
      Number(process.env.MAX_HUNTER_CREDITS_PER_RUN_UNITS || 20000)]);
      return rows[0];
    });
    const job = created.job;
    if (!job.inserted) {
      return res.status(200).json({ id:job.id,job_id:job.id,status:job.status,idempotent_replay:true });
    }
    audit('RESEARCH_JOB_CREATED', { job_id: job.id });
    const state=created.dispatch?.state||'RETRY_PENDING';
    audit('RESEARCH_DIRECT_QUEUE_REQUESTED',{job_id:job.id,dispatch_state:state});
    return res.status(202).json({id:job.id,job_id:job.id,status:'QUEUED',dispatch:'direct_queue',dispatch_state:state});
  } catch (error) { next(error); }
});

app.get('/api/research/jobs', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT j.*,pu.provider_call_count,pu.provider_completed_count,
      pu.provider_not_found_count,pu.provider_temporary_error_count,pu.provider_failed_count,
      pu.reserved_units,pu.used_units,pu.released_units,pu.last_provider_event_at,pu.projection_updated_at
      FROM leadgen.research_jobs j LEFT JOIN leadgen.research_job_provider_usage_summary pu ON pu.research_job_id=j.id
      ORDER BY j.created_at DESC,j.id DESC LIMIT 100`);
    res.json(rows.map(researchJobResponse));
  } catch (error) { next(error); }
});

app.get('/api/research/jobs/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT j.*,pu.provider_call_count,pu.provider_completed_count,
      pu.provider_not_found_count,pu.provider_temporary_error_count,pu.provider_failed_count,
      pu.reserved_units,pu.used_units,pu.released_units,pu.last_provider_event_at,pu.projection_updated_at
      FROM leadgen.research_jobs j LEFT JOIN leadgen.research_job_provider_usage_summary pu ON pu.research_job_id=j.id
      WHERE j.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Research job not found' });
    res.json(researchJobResponse(rows[0]));
  } catch (error) { next(error); }
});

app.post('/api/enrichment/jobs', managementAuth.authenticate,
  managementAuth.requireRoles('DATA_ADMIN','MANAGEMENT'), async (req, res, next) => {
  try {
    await tavilyProviderAccountState.ensureCanCreate();
    const marketCodes = [...new Set((Array.isArray(req.body?.market_codes) ? req.body.market_codes : ['AE','MX'])
      .map(value=>clean(value).toUpperCase()).filter(Boolean))];
    let productProfiles = [...new Set((Array.isArray(req.body?.product_profiles) ? req.body.product_profiles : ['WOMENSWEAR','GENERAL_MERCHANDISE'])
      .map(value=>clean(value).toUpperCase()).filter(Boolean))];
    let companyIds = [...new Set((Array.isArray(req.body?.company_ids) ? req.body.company_ids : [])
      .map(value=>optionalUuid(value,'company_id')).filter(Boolean))];
    if (!marketCodes.length || marketCodes.some(code=>!['AE','MX'].includes(code))) {
      return res.status(400).json({ error:'Invalid enrichment job',detail:'market_codes must contain AE and/or MX' });
    }
    if (!productProfiles.length || productProfiles.some(value=>!['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(value))) {
      return res.status(400).json({ error:'Invalid enrichment job',detail:'product_profiles must contain WOMENSWEAR and/or GENERAL_MERCHANDISE' });
    }
    const researchWave = clean(req.body?.research_wave).slice(0,1).toUpperCase();
    if(researchWave && !['A','B'].includes(researchWave))return res.status(400).json({error:'Invalid enrichment wave',code:'PHASE9_WAVE_INVALID'});
    const waveCap=researchWave==='A'?5:researchWave==='B'?15:100;
    const requestedMaxResults = Number(req.body?.max_results ?? waveCap);
    const maxResults = Number.isFinite(requestedMaxResults) ? Math.max(1,Math.min(waveCap,Math.trunc(requestedMaxResults))) : waveCap;
    let selectedCohort=[];
    if(researchWave){
      let excluded=[];
      if(researchWave==='B'){
        const waveAJobId=optionalUuid(req.body?.wave_a_job_id,'wave_a_job_id');
        await researchWorkbenchService.assertWaveBGate(waveAJobId);
        const prior=await pool.query('SELECT company_id FROM leadgen.research_job_cohort_items WHERE research_job_id=$1',[waveAJobId]);
        excluded=prior.rows.map(row=>row.company_id);
      }
      selectedCohort=await researchWorkbenchService.selectCohort({limit:maxResults,excludeCompanyIds:excluded});
      if(!selectedCohort.length)return res.status(409).json({error:'No eligible enrichment cohort',code:'PHASE9_COHORT_EMPTY'});
      companyIds=selectedCohort.map(item=>item.company_id);
      productProfiles=[...new Set(selectedCohort.map(item=>item.product_profile))];
    }
    const requestPayload={market_codes:marketCodes,product_profiles:productProfiles,company_ids:companyIds,max_results:maxResults,research_wave:researchWave||null};
    const requestDigest=canonicalDigest(requestPayload);
    const idempotencyKey=clean(req.get('idempotency-key')||req.body?.idempotency_key).slice(0,200)||randomUUID();
    const result = await pool.query(`INSERT INTO leadgen.research_jobs
      (country,country_code,country_name,preferred_language,market_profile,product_category,product_profile,
       buyer_types,max_results,status,job_type,market_codes,product_profiles,requested_company_ids,
       idempotency_key,request_digest,created_by_identity,created_by_role,research_wave,run_budget_cap_units)
      VALUES ('AE / MX','XX','AE / MX','en','MULTI_MARKET','Buyer / Procurement Enrichment',$1,$2,$3,
        'QUEUED',$13,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *, (xmax=0) AS inserted`,[
      productProfiles[0],['Buyer','Procurement','Purchasing','Category','Merchandising','Sourcing'],maxResults,
      marketCodes,productProfiles,companyIds,idempotencyKey,requestDigest,req.managementUser.identity,req.managementUser.role,
      researchWave||null,Number(process.env.MAX_HUNTER_CREDITS_PER_RUN_UNITS||20000),
      researchWave?'REAL_OPPORTUNITY_RESEARCH':'DECISION_MAKER_ENRICHMENT'
    ]);
    const job = result.rows[0];
    if(!job.inserted)return res.status(200).json({job_id:job.id,id:job.id,status:job.status,idempotent_replay:true});
    if(researchWave){
      try{await researchWorkbenchService.freezeCohort({jobId:job.id,wave:researchWave,items:selectedCohort});}
      catch(error){
        await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),stop_reason_code=$2,error_count=error_count+1 WHERE id=$1`,[job.id,error.code||'COHORT_FREEZE_FAILED']);
        throw error;
      }
    }
    audit('PHASE6_ENRICHMENT_JOB_CREATED',{ job_id:job.id,markets:marketCodes,product_profiles:productProfiles });
    try {
      const dispatch = await triggerEnrichmentWorkflow(job);
      audit('PHASE6_N8N_DISPATCH_SUCCEEDED',{ job_id:job.id,status_code:dispatch.status_code });
      res.status(202).json({ job_id:job.id,id:job.id,status:'QUEUED',dispatch:'accepted' });
    } catch (dispatchError) {
      const safeError = clean(dispatchError.message).slice(0,500);
      await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),error_count=error_count+1,last_error=$2 WHERE id=$1`,[job.id,safeError]);
      audit('PHASE6_N8N_DISPATCH_FAILED',{ job_id:job.id,error:safeError });
      res.status(502).json({ error:'Enrichment workflow dispatch failed',job_id:job.id,status:'FAILED' });
    }
  } catch (error) { next(error); }
});

app.get('/api/enrichment/jobs', managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'), async (_req,res,next) => {
  try {
    const result = await pool.query(`SELECT * FROM leadgen.research_jobs
      WHERE job_type IN('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH') ORDER BY created_at DESC,id DESC LIMIT 100`);
    res.json(result.rows.map(researchJobResponse));
  } catch (error) { next(error); }
});

app.get('/api/enrichment/jobs/:id', managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'), async (req,res,next) => {
  try {
    const job = await enrichmentService.getJob(optionalUuid(req.params.id,'enrichment_job_id'));
    if (!job) return res.status(404).json({ error:'Enrichment job not found' });
    res.json(researchJobResponse(job));
  } catch (error) { next(error); }
});

app.get('/api/enrichment/jobs/:id/results', managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'), async (req,res,next) => {
  try {
    const jobId = optionalUuid(req.params.id,'enrichment_job_id');
    const job = await enrichmentService.getJob(jobId);
    if (!job) return res.status(404).json({ error:'Enrichment job not found' });
    const result = await pool.query(`SELECT e.company_id,c.company_name,e.market_code,e.product_profiles,e.attempt_status,
      e.queries_executed,e.sources_found,e.decision_makers_found,e.contact_routes_found,e.provider_calls,e.timeout_count,
      e.last_error,e.started_at,e.completed_at,
      coalesce(f.results,'[]'::json) AS feasibility
      FROM leadgen.enrichment_job_companies e JOIN leadgen.companies c ON c.id=e.company_id
      LEFT JOIN LATERAL (SELECT json_agg(json_build_object(
        'product_profile',x.product_profile,'score',x.cooperation_feasibility_score,'band',x.feasibility_band,
        'matrix',x.access_opportunity_matrix,'readiness',x.opportunity_readiness,'relationship_status',x.relationship_status,
        'barriers',x.barrier_signals,'missing_evidence',x.missing_evidence) ORDER BY x.product_profile) results
        FROM leadgen.cooperation_feasibility_results x WHERE x.research_job_id=e.research_job_id AND x.company_id=e.company_id) f ON true
      WHERE e.research_job_id=$1 ORDER BY c.country_code,c.company_name`,[jobId]);
    res.json({ job:researchJobResponse(job),items:result.rows });
  } catch (error) { next(error); }
});

app.post('/api/internal/enrichment/jobs/:id/run', requireInternalToken, async (req,res,next) => {
  try {
    const jobId = optionalUuid(req.params.id,'enrichment_job_id');
    const job = await enrichmentService.getJob(jobId);
    if (!job) return res.status(404).json({ error:'Enrichment job not found' });
    const queueId = await phase5Queue.enqueue(PHASE5_QUEUES.ENRICH_DECISION_MAKERS,{ research_job_id:jobId },{ singletonKey:`phase6:${jobId}` });
    if (req.body?.wait === true) {
      const requestedTimeout = Number(req.body?.timeout_ms ?? 600000);
      const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1000,Math.min(900000,Math.trunc(requestedTimeout))) : 600000;
      const queued = await phase5Queue.waitFor(PHASE5_QUEUES.ENRICH_DECISION_MAKERS,queueId,{ timeoutMs });
      if (queued.state !== 'completed') return res.status(500).json({ status:queued.state,queue_job_id:queueId,error:'Enrichment queue job did not complete' });
      return res.json({ status:'completed',queue_job_id:queueId,result:queued.output });
    }
    res.status(202).json({ status:'queued',queue_job_id:queueId,queue:PHASE5_QUEUES.ENRICH_DECISION_MAKERS });
  } catch (error) { next(error); }
});

app.patch('/api/internal/enrichment/jobs/:id/status', requireInternalToken, async (req,res,next) => {
  try {
    const status = clean(req.body?.status).toUpperCase();
    if (!['QUEUED','DISCOVERING','RESOLVING','VERIFYING','PERSISTING','COMPLETE','PARTIAL','FAILED'].includes(status)) {
      return res.status(400).json({ error:'Invalid enrichment status' });
    }
    const result = await pool.query(`UPDATE leadgen.research_jobs SET status=$2,
      started_at=CASE WHEN $2<>'QUEUED' THEN coalesce(started_at,now()) ELSE started_at END,
      completed_at=CASE WHEN $2 IN ('COMPLETE','PARTIAL','FAILED') THEN now() ELSE NULL END,
      last_error=CASE WHEN $2='FAILED' THEN $3 ELSE last_error END
      WHERE id=$1 AND job_type IN('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH') RETURNING *`,[
      optionalUuid(req.params.id,'enrichment_job_id'),status,clean(req.body?.error,500)||null
    ]);
    if (!result.rowCount) return res.status(404).json({ error:'Enrichment job not found' });
    res.json(researchJobResponse(result.rows[0]));
  } catch (error) { next(error); }
});

app.get('/api/research/jobs/:id/queries', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT id,query_text,query_type,country,city,product_category,buyer_type,provider,
        country_code,country_name,region,preferred_language,market_profile,
        status,result_count,error_message,created_at,executed_at
      FROM leadgen.research_search_queries
      WHERE research_job_id=$1 ORDER BY created_at,id`, [req.params.id]);
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/research/jobs/:id/candidates', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const params = [req.params.id];
    const clauses = ['c.research_job_id=$1'];
    if (req.query.candidate_type) { params.push(req.query.candidate_type); clauses.push(`c.candidate_type=$${params.length}`); }
    if (req.query.status) { params.push(req.query.status); clauses.push(`c.candidate_status=$${params.length}`); }
    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT c.*,
        coalesce(query_refs.items,'[]'::json) AS found_by_queries,
        coalesce(contact_refs.items,'[]'::json) AS contacts,
        coalesce(fetch_refs.items,'[]'::json) AS fetches
      FROM leadgen.research_candidates c
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'query_id',q.id,'query',q.query_text,'query_type',q.query_type,'rank',cq.rank
        ) ORDER BY cq.rank,q.query_text) AS items
        FROM leadgen.research_candidate_queries cq
        JOIN leadgen.research_search_queries q ON q.id=cq.research_search_query_id
        WHERE cq.research_candidate_id=c.id
      ) query_refs ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'id',ct.id,'contact_type',ct.contact_type,'contact_value',ct.contact_value,
          'normalized_value',ct.normalized_value,'source_url',ct.source_url,
          'source_page_title',ct.source_page_title,'verification_status',ct.verification_status,
          'verification_method',ct.verification_method,'syntax_valid',ct.syntax_valid,
          'mx_present',ct.mx_present,'phone_country_context',ct.phone_country_context,
          'normalization_status',ct.normalization_status,'captured_at',ct.captured_at
        ) ORDER BY CASE ct.contact_type WHEN 'EMAIL' THEN 1 WHEN 'WHATSAPP' THEN 2 WHEN 'PHONE' THEN 3 ELSE 4 END,ct.contact_value) AS items
        FROM leadgen.research_candidate_contacts ct WHERE ct.research_candidate_id=c.id
      ) contact_refs ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'requested_url',f.requested_url,'final_url',f.final_url,'http_status',f.http_status,
          'reachable',f.reachable,'content_type',f.content_type,'page_title',f.page_title,
          'robots_allowed',f.robots_allowed,'fetch_status',f.fetch_status,
          'error_message',f.error_message,'captured_at',f.captured_at
        ) ORDER BY f.captured_at,f.id) AS items
        FROM leadgen.research_candidate_fetches f WHERE f.research_candidate_id=c.id
      ) fetch_refs ON true
      WHERE ${clauses.join(' AND ')}
      ORDER BY c.rank,c.title
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/research/candidates/:candidateId/contacts', async (req, res, next) => {
  try {
    const candidate = await pool.query('SELECT id,research_job_id,title,url,contactability_status FROM leadgen.research_candidates WHERE id=$1', [req.params.candidateId]);
    if (!candidate.rowCount) return res.status(404).json({ error: 'Research candidate not found' });
    const { rows } = await pool.query(`
      SELECT id,contact_type,contact_value,normalized_value,source_url,source_page_title,
        verification_status,verification_method,syntax_valid,mx_present,phone_country_context,
        normalization_status,captured_at,created_at
      FROM leadgen.research_candidate_contacts
      WHERE research_candidate_id=$1
      ORDER BY CASE contact_type WHEN 'EMAIL' THEN 1 WHEN 'WHATSAPP' THEN 2 WHEN 'PHONE' THEN 3 ELSE 4 END,
        contact_value,source_url`, [req.params.candidateId]);
    res.json({ candidate: candidate.rows[0], contacts: rows });
  } catch (error) { next(error); }
});

const phase4FilterValues = Object.freeze({
  business_type: new Set(['importer','wholesaler','distributor','general_trading']),
  business_type_status: new Set(['VERIFIED','SUPPORTED','UNKNOWN','CONTRADICTED']),
  company_size: new Set(['MICRO','SMALL','MEDIUM','LARGE','ENTERPRISE','UNKNOWN']),
  sme_relevance: new Set(['HIGH','MEDIUM','LOW','UNKNOWN']),
  partnership_accessibility: new Set(['HIGH','MEDIUM','LOW','UNKNOWN']),
  verification_status: new Set(['VERIFIED_BUSINESS','REVIEW','REJECTED']),
  promotion_status: new Set(['NOT_READY','READY_TO_PROMOTE','PROMOTED_NEW','ENRICHED_EXISTING','REJECTED']),
  bucket: new Set(['all','sme_regional','strategic'])
});

function validatedFilter(value, allowed, label) {
  if (value == null || value === '') return null;
  if (!allowed.has(value)) throw Object.assign(new Error(`Invalid ${label} filter`), { statusCode: 400 });
  return value;
}

app.get('/api/research/jobs/:id/verifications', async (req, res, next) => {
  try {
    const params = [req.params.id];
    const clauses = ['v.research_job_id=$1'];
    const add = (sql, value) => { params.push(value); clauses.push(sql.replace('?', `$${params.length}`)); };
    const businessType = validatedFilter(req.query.business_type, phase4FilterValues.business_type, 'business_type');
    const businessStatus = validatedFilter(req.query.business_type_status, phase4FilterValues.business_type_status, 'business_type_status');
    if (businessType) {
      const column = { importer:'importer_status', wholesaler:'wholesaler_status', distributor:'distributor_status', general_trading:'general_trading_status' }[businessType];
      add(`v.${column}=?`, businessStatus || 'VERIFIED');
    } else if (businessStatus) {
      const start = params.length + 1;
      params.push(businessStatus, businessStatus, businessStatus, businessStatus);
      clauses.push(`(v.importer_status=$${start} OR v.wholesaler_status=$${start + 1} OR v.distributor_status=$${start + 2} OR v.general_trading_status=$${start + 3})`);
    }
    const sizes = String(req.query.company_size || '').split(',').map(value => value.trim()).filter(Boolean);
    if (sizes.length) {
      if (sizes.some(value => !phase4FilterValues.company_size.has(value))) return res.status(400).json({ error: 'Invalid company_size filter' });
      add('v.company_size=ANY(?::text[])', sizes);
    }
    for (const key of ['sme_relevance','partnership_accessibility','verification_status','promotion_status']) {
      const value = validatedFilter(req.query[key], phase4FilterValues[key], key);
      if (value) add(`v.${key}=?`, value);
    }
    if (req.query.strategic_account != null) {
      if (!['true','false'].includes(String(req.query.strategic_account))) return res.status(400).json({ error: 'Invalid strategic_account filter' });
      add('v.strategic_account=?', req.query.strategic_account === 'true');
    }
    if (req.query.contactable != null) {
      if (!['true','false'].includes(String(req.query.contactable))) return res.status(400).json({ error: 'Invalid contactable filter' });
      clauses.push(req.query.contactable === 'true'
        ? "EXISTS (SELECT 1 FROM leadgen.research_candidate_contacts cx WHERE cx.research_candidate_id=v.research_candidate_id)"
        : "NOT EXISTS (SELECT 1 FROM leadgen.research_candidate_contacts cx WHERE cx.research_candidate_id=v.research_candidate_id)");
    }
    const bucket = validatedFilter(req.query.bucket || 'all', phase4FilterValues.bucket, 'bucket');
    if (bucket === 'sme_regional') clauses.push("v.sme_relevance IN ('HIGH','MEDIUM') AND v.partnership_accessibility IN ('HIGH','MEDIUM')");
    if (bucket === 'strategic') clauses.push('v.strategic_account=true');
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const filterParams = [...params];
    params.push(limit, offset);
    const where = clauses.join(' AND ');
    const { rows } = await pool.query(`
      SELECT v.*,c.title AS candidate_title,c.url AS candidate_url,c.contactability_status,
        coalesce(ev.evidence_count,0)::int AS evidence_count,
        coalesce(ct.contact_count,0)::int AS contact_count,
        coalesce(sa.social_accounts,'[]'::json) AS social_accounts
      FROM leadgen.research_candidate_verifications v
      JOIN leadgen.research_candidates c ON c.id=v.research_candidate_id
      LEFT JOIN LATERAL (SELECT count(*) AS evidence_count FROM leadgen.company_verification_evidence e WHERE e.research_candidate_id=v.research_candidate_id) ev ON true
      LEFT JOIN LATERAL (SELECT count(*) AS contact_count FROM leadgen.research_candidate_contacts x WHERE x.research_candidate_id=v.research_candidate_id) ct ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('platform',s.platform,'profile_url',s.profile_url,
          'verification_status',s.verification_status,'source_url',s.source_url) ORDER BY s.platform) AS social_accounts
        FROM leadgen.company_social_accounts s
        WHERE s.research_candidate_id=v.research_candidate_id AND s.account_type='BUSINESS' AND s.verification_status<>'REJECTED'
      ) sa ON true
      WHERE ${where}
      ORDER BY v.strategic_account DESC,
        CASE v.partnership_accessibility WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
        c.rank,v.resolved_company_name
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const filteredCount = await pool.query(`
      SELECT count(*)::int AS total
      FROM leadgen.research_candidate_verifications v
      WHERE ${where}`, filterParams);
    const summary = await pool.query(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE verification_status='VERIFIED_BUSINESS')::int AS verified,
        count(*) FILTER (WHERE verification_status='REVIEW')::int AS review,
        count(*) FILTER (WHERE verification_status='REJECTED')::int AS rejected,
        count(*) FILTER (WHERE sme_relevance IN ('HIGH','MEDIUM') AND partnership_accessibility IN ('HIGH','MEDIUM'))::int AS sme_regional,
        count(*) FILTER (WHERE strategic_account)::int AS strategic,
        count(*) FILTER (WHERE promotion_status='PROMOTED_NEW')::int AS promoted_new,
        count(*) FILTER (WHERE promotion_status='ENRICHED_EXISTING')::int AS enriched_existing
      FROM leadgen.research_candidate_verifications WHERE research_job_id=$1`, [req.params.id]);
    res.json({ job_id: req.params.id, total: filteredCount.rows[0].total, summary: summary.rows[0], items: rows });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.get('/api/research/candidates/:candidateId/verification', async (req, res, next) => {
  try {
    const verification = await pool.query(`
      SELECT v.*,c.title AS candidate_title,c.url AS candidate_url,c.provider,c.contactability_status
      FROM leadgen.research_candidate_verifications v
      JOIN leadgen.research_candidates c ON c.id=v.research_candidate_id
      WHERE v.research_candidate_id=$1`, [req.params.candidateId]);
    if (!verification.rowCount) return res.status(404).json({ error: 'Candidate verification not found' });
    const [evidence, contacts, socials] = await Promise.all([
      pool.query(`SELECT * FROM leadgen.company_verification_evidence WHERE research_candidate_id=$1 ORDER BY evidence_type,confidence DESC,source_url`, [req.params.candidateId]),
      pool.query(`SELECT id,contact_type,contact_value,normalized_value,source_url,source_page_title,
        verification_status,verification_method,phone_country_context,normalization_status,captured_at
        FROM leadgen.research_candidate_contacts WHERE research_candidate_id=$1 ORDER BY contact_type,contact_value`, [req.params.candidateId]),
      pool.query(`SELECT id,platform,profile_url,account_type,verification_status,source_url,source_type,captured_at FROM leadgen.company_social_accounts WHERE research_candidate_id=$1 AND account_type='BUSINESS' AND verification_status<>'REJECTED' ORDER BY platform,profile_url`, [req.params.candidateId])
    ]);
    res.json({ ...verification.rows[0], evidence: evidence.rows, contacts: contacts.rows, social_accounts: socials.rows });
  } catch (error) { next(error); }
});

app.post('/api/internal/research/jobs/:id/generate-queries', requireInternalToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const jobResult = await client.query('SELECT * FROM leadgen.research_jobs WHERE id=$1', [req.params.id]);
    if (!jobResult.rowCount) return res.status(404).json({ error: 'Research job not found' });
    await client.query('BEGIN');
    const queries = await persistGeneratedQueries(client, jobResult.rows[0], searchConfig);
    await client.query('COMMIT');
    res.json({
      job_id: req.params.id,
      query_count: queries.length,
      queries: queries.map(query => ({
        id: query.id, query: query.query_text, query_type: query.query_type,
        buyer_type: query.buyer_type, provider: query.provider, status: query.status
      }))
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally { client.release(); }
});

app.post('/api/internal/research/jobs/:id/discover', requireInternalToken, async (req, res, next) => {
  try {
    const result = await telemetry.withSpan('phase5.external.search', {
      research_job_id: req.params.id,
      provider: searchConfig.provider,
      operation: 'candidate_discovery'
    }, async span => {
      const discovered = await discoverResearchCandidates(pool, req.params.id, searchConfig,{tavilyUsageConfig});
      span.setAttribute('result_count', discovered.candidates_found || 0);
      span.setAttribute('credits', discovered.credits_used || 0);
      return discovered;
    });
    audit('SEARCH_DISCOVERY_COMPLETED', {
      job_id: req.params.id,
      provider: result.provider,
      successful_requests: result.successful_requests,
      failed_requests: result.failed_requests,
      candidates_found: result.candidates_found,
      candidates_checked: result.candidates_checked,
      contactable_candidates: result.contactable_candidates
    });
    res.json(result);
  } catch (error) {
    audit('SEARCH_DISCOVERY_FAILED', { job_id: req.params.id, code: error.code || 'SEARCH_DISCOVERY_ERROR' });
    next(error);
  }
});

app.post('/api/internal/research/jobs/:id/check-contacts', requireInternalToken, async (req, res, next) => {
  try {
    const job = await pool.query('SELECT id FROM leadgen.research_jobs WHERE id=$1', [req.params.id]);
    if (!job.rowCount) return res.status(404).json({ error: 'Research job not found' });
    const result = await telemetry.withSpan('phase5.external.contact-check', {
      research_job_id: req.params.id,
      operation: 'contact_check'
    }, () => checkResearchCandidateContacts(pool, req.params.id, searchConfig.contactConfig));
    audit('CANDIDATE_CONTACT_CHECK_COMPLETED', { job_id: req.params.id, ...result });
    res.json({ job_id: req.params.id, ...result });
  } catch (error) {
    audit('CANDIDATE_CONTACT_CHECK_FAILED', { job_id: req.params.id });
    next(error);
  }
});

app.post('/api/internal/research/jobs/:id/verify-companies', requireInternalToken, async (req, res, next) => {
  try {
    const result = await telemetry.withSpan('phase5.external.company-verification', {
      research_job_id: req.params.id,
      provider: searchConfig.provider,
      operation: 'company_verification'
    }, async span => {
      const verified = await verifyResearchCandidates(pool, req.params.id, {
        ...searchConfig.companyVerifyConfig,
        searchConfig,
        promote: req.body?.promote !== false,
        allowSocialSearch: req.body?.allow_social_search === true
      });
      span.setAttribute('result_count', verified.checked || verified.verified || 0);
      span.setAttribute('credits', verified.socialSearchCreditsUsed || 0);
      return verified;
    });
    audit('PHASE4_COMPANY_VERIFICATION_COMPLETED', {
      job_id: req.params.id,
      verified: result.verified,
      review: result.review,
      rejected: result.rejected,
      promoted_new: result.promotedNew,
      enriched_existing: result.enrichedExisting
    });
    const categoryProcurementCompanyIds=[...new Set((result.results||[])
      .filter(item=>item.company_id&&item.verification_status==='VERIFIED_BUSINESS'
        &&['PROMOTED_NEW','ENRICHED_EXISTING'].includes(item.promotion_status))
      .map(item=>item.company_id))];
    if(categoryProcurementCompanyIds.length){
      let categoryJob=null;
      try{
        categoryJob=await createCategoryProcurementResearchJob({companyIds:categoryProcurementCompanyIds,maxResults:categoryProcurementCompanyIds.length});
        await triggerCategoryProcurementWorkflow(categoryJob);
        audit('PHASE6_1_FRESH_DISCOVERY_ENQUEUED',{source_job_id:req.params.id,job_id:categoryJob.id,companies:categoryProcurementCompanyIds.length});
        result.category_procurement_job_id=categoryJob.id;
      }catch(categoryError){
        if(categoryJob)await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),
          category_procurement_errors=category_procurement_errors+1,error_count=error_count+1,last_error=$2 WHERE id=$1`,[
          categoryJob.id,clean(categoryError.message,500)]);
        audit('PHASE6_1_FRESH_DISCOVERY_ENQUEUE_FAILED',{source_job_id:req.params.id,code:categoryError.code||'CATEGORY_PROCUREMENT_DISPATCH_ERROR'});
      }
    }
    result.auto_evidence_schedule_job_id=await enqueueAutoEvidenceEvent(`company-verification:${req.params.id}`,
      {research_job_id:req.params.id,company_ids:categoryProcurementCompanyIds});
    res.json(result);
  } catch (error) {
    audit('PHASE4_COMPANY_VERIFICATION_FAILED', { job_id: req.params.id, code: error.code || 'PHASE4_VERIFICATION_ERROR' });
    next(error);
  }
});

app.patch('/api/research/jobs/:id/status', requireInternalToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const requestedStatus = clean(req.body?.status).toUpperCase();
    const allowedTransitions = {
      QUEUED: new Set(['DISCOVERING', 'FAILED']),
      DISCOVERING: new Set(['CRAWLING', 'FAILED']),
      CRAWLING: new Set(['QUALIFYING', 'FAILED']),
      QUALIFYING: new Set(['SCORING', 'COMPLETED', 'FAILED']),
      SCORING: new Set(['COMPLETED', 'FAILED']),
      COMPLETED: new Set(),
      FAILED: new Set()
    };
    if (!Object.hasOwn(allowedTransitions, requestedStatus)) {
      return res.status(400).json({ error: 'Invalid research job status' });
    }
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM leadgen.research_jobs WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Research job not found' });
    }
    const job = current.rows[0];
    if (requestedStatus !== job.status && !allowedTransitions[job.status]?.has(requestedStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Invalid research job transition', from: job.status, to: requestedStatus });
    }
    const safeError = requestedStatus === 'FAILED' ? clean(req.body?.last_error || 'Workflow execution failed').slice(0, 500) : null;
    const { rows } = await client.query(`
      UPDATE leadgen.research_jobs SET
        status=$2,
        started_at=CASE WHEN $2='DISCOVERING' THEN coalesce(started_at,now()) ELSE started_at END,
        completed_at=CASE WHEN $2 IN ('COMPLETED','FAILED') THEN coalesce(completed_at,now()) ELSE completed_at END,
        error_count=CASE WHEN $2='FAILED' AND status<>'FAILED' AND error_count=0 THEN 1 ELSE error_count END,
        last_error=CASE WHEN $2='FAILED' THEN $3 WHEN $2='COMPLETED' THEN NULL ELSE last_error END
      WHERE id=$1
      RETURNING *`, [job.id, requestedStatus, safeError]);
    await client.query('COMMIT');
    const event = requestedStatus === 'DISCOVERING' ? 'RESEARCH_JOB_STARTED'
      : requestedStatus === 'CRAWLING' ? 'RESEARCH_JOB_CRAWLING'
        : requestedStatus === 'QUALIFYING' ? 'RESEARCH_JOB_QUALIFYING'
          : requestedStatus === 'SCORING' ? 'RESEARCH_JOB_SCORING'
            : requestedStatus === 'COMPLETED' ? 'RESEARCH_JOB_COMPLETED'
        : requestedStatus === 'FAILED' ? 'RESEARCH_JOB_FAILED' : 'RESEARCH_JOB_STATUS_UPDATED';
    audit(event, { job_id: job.id, status: requestedStatus });
    let autoEvidenceScheduleJobId=null;
    let autoEvidenceScheduleStatus=null;
    if(requestedStatus==='COMPLETED'){
      try{
        autoEvidenceScheduleJobId=await phase5Queue.enqueue(PHASE5_QUEUES.SCHEDULE_AUTO_EVIDENCE,{
          schedule_source:'RECONCILIATION',reconcile_bucket:`research-job-completed:${job.id}`,
          research_job_id:job.id,batch_size:10
        },{singletonKey:`phase10:auto-evidence:research-job-completed:${job.id}`});
        autoEvidenceScheduleStatus='QUEUED';
      }catch(queueError){
        autoEvidenceScheduleStatus='RETRYABLE_ERROR';
        audit('AUTO_EVIDENCE_EVENT_ENQUEUE_FAILED',{source:'RESEARCH_JOB_COMPLETED',job_id:job.id,
          code:queueError?.code||'QUEUE_UNAVAILABLE'});
      }
    }
    res.json({...researchJobResponse(rows[0]),auto_evidence_schedule_job_id:autoEvidenceScheduleJobId,
      auto_evidence_schedule_status:autoEvidenceScheduleStatus});
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

app.get('/api/companies/:id/score', async (req, res, next) => {
  try {
    const score = await scoringService.getLatest(req.params.id);
    if (!score) return res.status(404).json({ error: 'Company score not found' });
    res.json(score);
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/score-history', async (req, res, next) => {
  try {
    res.json(await scoringService.getHistory(req.params.id, { limit: Number(req.query.limit || 50) }));
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/customer-match', async (req, res, next) => {
  try {
    const matches = await customerMatchService.getLatestReferences(req.params.id, { productScope: req.query.product_scope || null });
    if (!matches.management_baseline && !matches.mx_historical_reference) return res.status(404).json({ error: 'Customer match not found' });
    res.json(matches);
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/customer-match-history', async (req, res, next) => {
  try {
    res.json(await customerMatchService.getHistory(req.params.id, { limit: Number(req.query.limit || 50), productScope: req.query.product_scope || null }));
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/lifecycle-history', async (req, res, next) => {
  try {
    const history = await companyLifecycleService.getLifecycleHistory(optionalUuid(req.params.id, 'company_id'));
    if (!history) return res.status(404).json({ error: 'Company not found' });
    res.json(history);
  } catch (error) { next(error); }
});

app.get('/api/icp/profiles', async (_req, res, next) => {
  try { res.json(await icpProfileService.listProfiles()); } catch (error) { next(error); }
});

app.get('/api/icp/profiles/:id', async (req, res, next) => {
  try {
    const profile = await customerMatchService.getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'ICP profile not found' });
    res.json(profile);
  } catch (error) { next(error); }
});

app.get('/api/import-batches', async (req, res, next) => {
  try { res.json({ items: await sharedHistoryImports.listBatches({ limit: Number(req.query.limit || 50) }) }); }
  catch (error) { next(error); }
});

app.get('/api/crm-history/import-summary', async (_req, res, next) => {
  try {
    const summary = await okkiHistory.importSummary();
    if (!summary) return res.status(404).json({ error:'Historical CRM import not found' });
    res.json(summary);
  } catch (error) { next(error); }
});

app.get('/api/crm-history', async (req, res, next) => {
  try {
    res.json(await okkiHistory.list({
      limit:Number(req.query.limit || 50),offset:Number(req.query.offset || 0),search:req.query.search || '',
      country:req.query.country || '',status:req.query.status || ''
    }));
  } catch (error) { next(error); }
});

app.get('/api/crm-history/:id', async (req, res, next) => {
  try {
    const result = await okkiHistory.get(optionalUuid(req.params.id,'crm_history_id'));
    if (!result) return res.status(404).json({ error:'Historical CRM record not found' });
    res.json(result);
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/crm-history', async (req, res, next) => {
  try {
    const result = await okkiHistory.getForCompany(optionalUuid(req.params.id,'company_id'));
    if (!result) return res.status(404).json({ error:'Linked historical CRM record not found' });
    res.json(result);
  } catch (error) { next(error); }
});

app.get('/api/leads/:id/decision-makers', async (req,res,next) => {
  try {
    const companyId = optionalUuid(req.params.id,'company_id');
    const result = await pool.query(`SELECT d.id,d.company_id,d.person_name,d.department_name,d.raw_title,d.normalized_role,
      d.role_relevance,d.market_code,d.verification_status,d.lifecycle_status,d.evidence_strength,d.last_verified_at,d.source_count,
      coalesce(pr.items,'[]'::json) AS product_relevance,
      coalesce(src.items,'[]'::json) AS sources,
      coalesce(ct.items,'[]'::json) AS contacts
      FROM leadgen.decision_makers d JOIN leadgen.companies c ON c.id=d.company_id
      LEFT JOIN LATERAL (SELECT json_agg(json_build_object('product_profile',r.product_profile,'relevance',r.relevance,'reason',r.reason) ORDER BY r.product_profile) items
        FROM leadgen.decision_maker_product_relevance r WHERE r.decision_maker_id=d.id) pr ON true
      LEFT JOIN LATERAL (SELECT json_agg(json_build_object('url',s.source_url,'source_type',s.source_type,'source_authority',s.source_authority,
        'captured_at',s.captured_at,'evidence_text',s.evidence_text,'evidence_status',s.evidence_status,'is_primary',s.is_primary) ORDER BY s.is_primary DESC,s.captured_at DESC) items
        FROM leadgen.decision_maker_sources s WHERE s.decision_maker_id=d.id AND s.research_job_id=d.research_job_id) src ON true
      LEFT JOIN LATERAL (SELECT json_agg(json_build_object('contact_type',x.contact_type,'value',x.contact_value_raw,
        'verification_status',x.verification_status,'verification_provider',x.verification_provider,'last_verified_at',x.last_verified_at,
        'source_url',x.source_url,'is_generic',x.is_generic,'is_department',x.is_department) ORDER BY
        CASE x.contact_type WHEN 'DEPARTMENT_EMAIL' THEN 1 WHEN 'BUSINESS_EMAIL' THEN 2 WHEN 'SUPPLIER_PORTAL' THEN 3 WHEN 'VENDOR_REGISTRATION' THEN 4 WHEN 'CONTACT_FORM' THEN 5 ELSE 6 END) items
        FROM leadgen.decision_maker_contacts x WHERE x.decision_maker_id=d.id AND x.research_job_id=d.research_job_id) ct ON true
      WHERE d.company_id=$1 AND ${companyMarketVisibleSql('c')}
      ORDER BY (d.lifecycle_status='ACTIVE') DESC,(d.verification_status='VERIFIED') DESC,
        CASE d.role_relevance WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,d.updated_at DESC`,[companyId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/leads/:id/contact-routes', async (req,res,next) => {
  try {
    const companyId = optionalUuid(req.params.id,'company_id');
    const result = await pool.query(`SELECT x.id,x.decision_maker_id,x.contact_type,x.contact_value_raw AS value,
      x.verification_status,x.verification_provider,x.verification_score,x.last_verified_at,x.source_url,x.is_generic,x.is_department,
      d.person_name,d.department_name,d.raw_title,d.normalized_role,d.verification_status AS role_verification_status
      FROM leadgen.decision_maker_contacts x JOIN leadgen.decision_makers d ON d.id=x.decision_maker_id
      JOIN leadgen.companies c ON c.id=d.company_id
      WHERE d.company_id=$1 AND d.lifecycle_status='ACTIVE' AND x.research_job_id=d.research_job_id AND ${companyMarketVisibleSql('c')}
      ORDER BY CASE x.contact_type WHEN 'DEPARTMENT_EMAIL' THEN 1 WHEN 'BUSINESS_EMAIL' THEN 2 WHEN 'SUPPLIER_PORTAL' THEN 3
        WHEN 'VENDOR_REGISTRATION' THEN 4 WHEN 'BUSINESS_PHONE' THEN 5 WHEN 'BUSINESS_WHATSAPP' THEN 6 WHEN 'CONTACT_FORM' THEN 7 ELSE 8 END,
        (x.verification_status='VALID') DESC,x.updated_at DESC`,[companyId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/cooperation-feasibility', async (req,res,next) => {
  try {
    const companyId = optionalUuid(req.params.id,'company_id');
    const productProfile = clean(req.query.product_profile).toUpperCase();
    const params = [companyId];
    const profileClause = productProfile ? (params.push(productProfile),`AND f.product_profile=$${params.length}`) : '';
    const result = await pool.query(`SELECT DISTINCT ON (f.product_profile)
      f.id,f.company_id,f.product_profile,f.cooperation_feasibility_score,f.feasibility_band,
      f.access_opportunity_matrix,f.opportunity_readiness,f.relationship_status,f.management_match,
      f.mexico_historical_match,f.dpv_score,f.dimension_breakdown,f.reason_codes,f.barrier_signals,
      f.missing_evidence,f.supplier_route_count,f.verified_decision_maker_count,f.usable_contact_route_count,
      f.evidence_source_count,f.rule_version,f.calculated_at,
      coalesce(src.items,'[]'::json) AS evidence_sources
      FROM leadgen.cooperation_feasibility_results f JOIN leadgen.companies c ON c.id=f.company_id
      LEFT JOIN LATERAL (SELECT json_agg(DISTINCT jsonb_build_object('url',s.source_url,'source_type',s.source_type,
        'source_authority',s.source_authority,'captured_at',s.captured_at)) items
        FROM leadgen.cooperation_feasibility_sources fs JOIN leadgen.decision_maker_sources s ON s.id=fs.decision_maker_source_id
        WHERE fs.feasibility_result_id=f.id) src ON true
      WHERE f.company_id=$1 ${profileClause} AND ${companyMarketVisibleSql('c')}
      ORDER BY f.product_profile,f.calculated_at DESC,f.id DESC`,params);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/companies/:id/category-procurement-matches', async (req,res,next) => {
  try{
    const companyId=optionalUuid(req.params.id,'company_id');
    const profile=clean(req.query.product_profile).toUpperCase();
    if(profile&&!['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(profile))return res.status(400).json({error:'Invalid product profile'});
    const rows=(await categoryProcurementService.getCompanyResults(companyId)).filter(item=>!profile||item.product_profile===profile);
    const auto=await pool.query(`SELECT DISTINCT ON(product_profile) product_profile,id,task_status,current_stage,
      category_research_job_id,contact_research_job_id FROM leadgen.auto_evidence_tasks
      WHERE company_id=$1 ORDER BY product_profile,created_at DESC,id DESC`,[companyId]);
    const autoByProfile=new Map(auto.rows.map(item=>[item.product_profile,item]));
    res.json(rows.map(item=>({
      category_procurement_match_result_id:item.category_procurement_match_result_id,product_profile:item.product_profile,
      category_procurement_match_score:item.category_procurement_match_score,category_procurement_match_band:item.category_procurement_match_band,
      category_procurement_match_status:item.category_procurement_match_status,category_procurement_coverage:item.category_procurement_coverage,
      buyer_business_model:item.buyer_business_model,buyer_subtype:item.buyer_subtype,observed_categories:item.observed_categories,
      observed_customer_categories:item.observed_customer_categories,matched_scopes:item.matched_scopes,
      scope_revision_id:item.scope_revision_id,scope_revision:item.scope_revision,match_basis:item.match_basis,
      similarity_rule:item.similarity_rule,catalog_completeness_non_blocking:item.catalog_completeness_non_blocking,
      reason_codes:item.reason_codes,missing_evidence:item.missing_evidence,dimensions:item.dimensions,
      supplier_access_band:item.supplier_access_band,product_access_matrix:item.product_access_matrix,
      readiness:item.readiness,readiness_blockers:item.readiness_blockers,created_at:item.created_at,
      auto_evidence_task_id:autoByProfile.get(item.product_profile)?.id||null,
      auto_evidence_status:autoByProfile.get(item.product_profile)?.task_status||null,
      auto_evidence_stage:autoByProfile.get(item.product_profile)?.current_stage||null,
      human_review_required:autoByProfile.get(item.product_profile)?.task_status==='HUMAN_REVIEW_REQUIRED'
    })));
  }catch(error){next(error);}
});

app.get('/api/companies/:id/buyer-business-model', async (req,res,next) => {
  try{
    const companyId=optionalUuid(req.params.id,'company_id');
    const rows=await categoryProcurementService.getCompanyResults(companyId);
    res.json(rows.map(item=>({product_profile:item.product_profile,buyer_business_model:item.buyer_business_model,
      buyer_subtype:item.buyer_subtype,eligibility_status:item.buyer_eligibility_status||null,
      confidence_band:item.buyer_confidence_band||null,category_procurement_match_status:item.category_procurement_match_status,
      created_at:item.created_at})));
  }catch(error){next(error);}
});

app.get('/api/companies/:id/commercial-product-fit', async (req,res,next) => {
  try{res.json(await categoryProcurementService.getCompanyCommercialFitResults(optionalUuid(req.params.id,'company_id')));}
  catch(error){next(error);}
});

app.get('/api/companies/:id/product-opportunities', async (req,res,next) => {
  try{
    const companyId=optionalUuid(req.params.id,'company_id');
    const rows=await categoryProcurementService.getCompanyResults(companyId);
    res.json(rows.map(item=>({product_profile:item.product_profile,
      category_procurement_match_result_id:item.category_procurement_match_result_id,
      category_procurement_match_status:item.category_procurement_match_status,
      category_procurement_match_score:item.category_procurement_match_score,
      category_procurement_match_band:item.category_procurement_match_band,
      category_procurement_coverage:item.category_procurement_coverage,
      match_basis:item.match_basis,matched_scopes:item.matched_scopes||[],
      observed_customer_categories:item.observed_customer_categories||[],
      reason_codes:item.reason_codes||[],
      created_at:item.product_opportunity?.created_at||null})));
  }catch(error){next(error);}
});

app.post('/api/category-procurement/jobs', managementAuth.authenticate,
  managementAuth.requireRoles('DATA_ADMIN','MANAGEMENT'), async (req,res,next) => {
  try{
    const companyIds=Array.isArray(req.body?.company_ids)?req.body.company_ids:[];
    const job=await createCategoryProcurementResearchJob({companyIds,maxResults:req.body?.max_results||100});
    if(job.job_type!=='CATEGORY_PROCUREMENT_ENRICHMENT')throw new Error('Unexpected Category Procurement job type');
    audit('PHASE6_1_CATEGORY_PROCUREMENT_JOB_CREATED',{job_id:job.id,companies:job.requested_company_ids.length,
      profiles:['WOMENSWEAR','GENERAL_MERCHANDISE'],status:'QUEUED'});
    try{
      const dispatch=await triggerCategoryProcurementWorkflow(job);
      audit('PHASE6_1_N8N_DISPATCH_SUCCEEDED',{job_id:job.id,status_code:dispatch.status_code});
      res.status(202).json({...categoryProcurementJobResponse(job),status:'QUEUED',dispatch:'accepted'});
    }catch(dispatchError){
      const safeError=clean(dispatchError.message,500);
      const failed=await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),
        error_count=error_count+1,category_procurement_errors=category_procurement_errors+1,last_error=$2
        WHERE id=$1 RETURNING *`,[job.id,safeError]);
      audit('PHASE6_1_N8N_DISPATCH_FAILED',{job_id:job.id,error:safeError});
      res.status(502).json({error:'Category Procurement workflow dispatch failed',...categoryProcurementJobResponse(failed.rows[0])});
    }
  }catch(error){next(error);}
});

app.get('/api/category-procurement/jobs/:id', managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'), async (req,res,next) => {
  try{
    const id=optionalUuid(req.params.id,'category_procurement_job_id');
    const result=await pool.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT'`,[id]);
    if(!result.rowCount)return res.status(404).json({error:'Category Procurement job not found'});
    res.json(categoryProcurementJobResponse(result.rows[0]));
  }catch(error){next(error);}
});

app.get('/api/category-procurement/jobs/:id/results', managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','DATA_ADMIN','SALES'), async (req,res,next) => {
  try{
    const id=optionalUuid(req.params.id,'category_procurement_job_id');
    const job=await pool.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT'`,[id]);
    if(!job.rowCount)return res.status(404).json({error:'Category Procurement job not found'});
    const result=await pool.query(`SELECT r.id category_procurement_match_result_id,r.company_id,c.company_name,c.country_code,
      r.product_profile,r.score category_procurement_match_score,r.band category_procurement_match_band,
      r.match_status category_procurement_match_status,r.coverage_percent category_procurement_coverage,
      b.buyer_model buyer_business_model,b.buyer_subtype,r.observed_categories,
      f.supplier_access_band,f.product_access_matrix,f.opportunity_readiness readiness,f.readiness_blockers,r.created_at
      FROM leadgen.category_procurement_match_results r JOIN leadgen.companies c ON c.id=r.company_id
      JOIN leadgen.buyer_business_model_results b ON b.id=r.buyer_business_model_result_id
      LEFT JOIN leadgen.cooperation_feasibility_results f ON f.category_procurement_match_result_id=r.id
      WHERE r.research_job_id=$1 ORDER BY c.country_code,c.company_name,r.product_profile`,[id]);
    res.json({job:categoryProcurementJobResponse(job.rows[0]),items:result.rows});
  }catch(error){next(error);}
});

app.post('/api/internal/category-procurement/jobs/:id/run', requireInternalToken, async (req,res,next) => {
  try{
    const jobId=optionalUuid(req.params.id,'category_procurement_job_id');
    const jobResult=await pool.query(`SELECT * FROM leadgen.research_jobs WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT'`,[jobId]);
    if(!jobResult.rowCount)return res.status(404).json({error:'Category Procurement job not found'});
    const job=jobResult.rows[0];
    const items=buildCategoryProcurementWorkItems({job_id:jobId,company_ids:job.requested_company_ids,
      product_profiles:['WOMENSWEAR','GENERAL_MERCHANDISE']});
    await pool.query(`UPDATE leadgen.research_jobs SET status='DISCOVERING',started_at=coalesce(started_at,now()),
      category_profiles_attempted=$2,last_error=NULL WHERE id=$1`,[jobId,items.length]);
    const queueJobs=[];
    for(const item of items){
      const payload=categoryProcurementQueuePayload({...item,execution_key:`category-procurement:${jobId}:${item.company_id}:${item.product_profile}`});
      queueJobs.push(await phase5Queue.enqueue(PHASE5_QUEUES.COLLECT_CATEGORY_BUYER_EVIDENCE,payload,
        {singletonKey:`phase6.1:collect:${payload.execution_key}`}));
    }
    if(req.body?.wait===true){
      const requestedTimeout=Number(req.body?.timeout_ms??900000);
      const timeoutMs=Number.isFinite(requestedTimeout)?Math.max(1000,Math.min(900000,Math.trunc(requestedTimeout))):900000;
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline){
        const current=await pool.query('SELECT * FROM leadgen.research_jobs WHERE id=$1',[jobId]);
        if(['COMPLETED','PARTIAL','FAILED'].includes(current.rows[0].status))return res.json({status:current.rows[0].status,
          queued_items:items.length,job:categoryProcurementJobResponse(current.rows[0])});
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      return res.status(202).json({status:'SCORING',queued_items:items.length,queue_job_ids:queueJobs});
    }
    res.status(202).json({status:'QUEUED',queued_items:items.length,queue_job_ids:queueJobs});
  }catch(error){next(error);}
});

app.patch('/api/internal/category-procurement/jobs/:id/status', requireInternalToken, async (req,res,next) => {
  try{
    const status=clean(req.body?.status).toUpperCase();
    if(!['QUEUED','DISCOVERING','CRAWLING','SCORING','COMPLETED','PARTIAL','FAILED'].includes(status))return res.status(400).json({error:'Invalid Category Procurement status'});
    const result=await pool.query(`UPDATE leadgen.research_jobs SET status=$2,
      started_at=CASE WHEN $2<>'QUEUED' THEN coalesce(started_at,now()) ELSE started_at END,
      completed_at=CASE WHEN $2 IN('COMPLETED','PARTIAL','FAILED') THEN now() ELSE NULL END,
      last_error=CASE WHEN $2='FAILED' THEN left($3,500) ELSE last_error END
      WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT' RETURNING *`,[
      optionalUuid(req.params.id,'category_procurement_job_id'),status,clean(req.body?.error,500)||null]);
    if(!result.rowCount)return res.status(404).json({error:'Category Procurement job not found'});
    res.json(categoryProcurementJobResponse(result.rows[0]));
  }catch(error){next(error);}
});

app.get('/api/opportunities', async (req,res,next) => {
  try{
    const defaultCategoryProcurementOrder='CATEGORY_PROCUREMENT_MATCH → DIRECT_END_BUYER → category_procurement_match_band/score → decision_maker → best_contact/contact_verification → supplier_access_band → product_access_matrix → customer_match → historical_customer_match → dpv_score → NULLS LAST';
    // Stable opportunity_key = concat(company_id, product_profile). Public V3 fields:
    // category_procurement_match_score, category_procurement_match_band, category_procurement_match_status,
    // category_procurement_coverage, buyer_business_model, buyer_subtype, observed_categories,
    // match_basis, matched_scopes, observed_customer_categories,
    // supplier_access_band, product_access_matrix, readiness, readiness_blockers.
    // Default priority: CATEGORY_PROCUREMENT_MATCH → DIRECT_END_BUYER → category_procurement_match_band/score
    // → decision_maker → best_contact → supplier_access_band → product_access_matrix
    // → customer_match → historical_customer_match → dpv_score; NULLS LAST.
    // Historical axes remain separate: mr.opportunity_matrix, access_opportunity_matrix and product_access_matrix.
    const filters={
      status:req.query.status === undefined ? 'RECOMMENDED' : req.query.status,
      ...req.query,
      buyer_business_model:req.query.buyer_business_model,
      buyer_subtype:req.query.buyer_subtype,
      category_procurement_match_band:req.query.category_procurement_match_band,
      category_procurement_match_status:req.query.category_procurement_match_status,
      product_access_matrix:req.query.product_access_matrix
    };
    const rows=await queryCategoryProcurementOpportunities({
      pool,query:filters,publicDataOriginSql,companyMarketVisibleSql,excludesConfirmedExistingCustomerSql
    });
    void defaultCategoryProcurementOrder;
    res.json(rows);
  }catch(error){next(error);}
});

app.post('/api/internal/scoring/recalculate', requireInternalToken, async (req,res,next) => {
  try{
    const scope={company_id:req.body?.company_id||null,research_job_id:req.body?.research_job_id||null,
      all:req.body?.all===true,product_scope:normalizeManagementProductScope(req.body?.product_scope||req.body?.product_profile||'')||null};
    if(!scope.company_id&&!scope.research_job_id&&!scope.all)return res.status(400).json({error:'A company, research job or explicit all scope is required'});
    const scoreQueue=scope.company_id?PHASE5_QUEUES.SCORE_COMPANY:PHASE5_QUEUES.SCORE_ALL_ELIGIBLE;
    const ids=await phase5Queue.enqueueFlow([
      {ref:'score',name:scoreQueue,data:scope},
      {ref:'match',name:PHASE5_QUEUES.RECALCULATE_CUSTOMER_MATCH,data:scope,dependsOn:['score']}
    ]);
    if(req.body?.wait===true){
      const score=await phase5Queue.waitFor(scoreQueue,ids.score,{timeoutMs:120000});
      const match=await phase5Queue.waitFor(PHASE5_QUEUES.RECALCULATE_CUSTOMER_MATCH,ids.match,{timeoutMs:120000});
      if(score.state!=='completed'||match.state!=='completed')return res.status(500).json({status:'failed',jobs:ids,score_state:score.state,match_state:match.state});
      return res.json({status:'completed',jobs:ids,score:score.output,match:match.output});
    }
    res.status(202).json({status:'queued',jobs:ids});
  }catch(error){next(error);}
});

app.post('/api/internal/customer-match/recalculate', requireInternalToken, async (req,res,next) => {
  try{
    const data={company_id:req.body?.company_id||null,research_job_id:req.body?.research_job_id||null,
      all:req.body?.all===true,profile_id:req.body?.profile_id||null,
      product_scope:normalizeManagementProductScope(req.body?.product_scope||req.body?.product_profile||'')||null};
    if(!data.company_id&&!data.research_job_id&&!data.all)return res.status(400).json({error:'A company, research job or explicit all scope is required'});
    const id=await phase5Queue.enqueue(PHASE5_QUEUES.RECALCULATE_CUSTOMER_MATCH,data);
    res.status(202).json({status:'queued',job_id:id,queue:PHASE5_QUEUES.RECALCULATE_CUSTOMER_MATCH});
  }catch(error){next(error);}
});

app.post('/api/internal/scoring/replay', requireInternalToken, async (req,res,next) => {
  try{
    const data={company_id:req.body?.company_id||null,research_job_id:req.body?.research_job_id||null,
      all:req.body?.all===true,rule_version:req.body?.rule_version||'dpv-score-v1'};
    if(!data.company_id&&!data.research_job_id&&!data.all)return res.status(400).json({error:'A company, research job or explicit all scope is required'});
    const id=await phase5Queue.enqueue(PHASE5_QUEUES.REPLAY_RULE_VERSION,data);
    res.status(202).json({status:'queued',job_id:id,queue:PHASE5_QUEUES.REPLAY_RULE_VERSION});
  }catch(error){next(error);}
});

app.post('/api/internal/icp/rebuild', requireInternalToken, async (req,res,next) => {
  try{
    const id=await phase5Queue.enqueue(PHASE5_QUEUES.REBUILD_ICP_PROFILE,{
      name: clean(req.body?.name) || undefined,
      reference_market: clean(req.body?.reference_market).toUpperCase() || undefined,
      market_scope:Array.isArray(req.body?.market_scope)?req.body.market_scope.map(clean).filter(Boolean):[],
      product_scope:Array.isArray(req.body?.product_scope)?req.body.product_scope.map(clean).filter(Boolean):[],
      actor:clean(req.body?.actor)||'internal-api'});
    res.status(202).json({status:'queued',job_id:id,queue:PHASE5_QUEUES.REBUILD_ICP_PROFILE});
  }catch(error){next(error);}
});

app.post('/api/internal/icp/profiles/:id/activate', requireInternalToken, async (req,res,next) => {
  try{res.json(await icpProfileService.activateProfile(req.params.id,{actor:clean(req.body?.actor)||'internal-api'}));}
  catch(error){next(error);}
});

app.get('/api/internal/phase5/diagnostics', requireInternalToken, async (_req,res,next) => {
  try{res.json({queues:await phase5Queue.health(),traces:telemetry.snapshot()});}
  catch(error){next(error);}
});

app.post('/api/internal/data-cleanup/dry-run', requireInternalToken, async (req, res, next) => {
  try {
    const result = await companyLifecycleService.dryRun({
      cleanupBatchId: clean(req.body?.cleanup_batch_id),
      performedBy: clean(req.body?.performed_by) || 'phase5-v2-management-review',
      backupReference: clean(req.body?.backup_reference)
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

app.get('/api/internal/data-cleanup/batches/:batchId', requireInternalToken, async (req, res, next) => {
  try {
    const result = await companyLifecycleService.getBatch(clean(req.params.batchId));
    if (!result) return res.status(404).json({ error: 'Cleanup batch not found' });
    res.json(result);
  } catch (error) { next(error); }
});

app.post('/api/reference-data/imports/dry-run', requireInternalToken, async (req, res, next) => {
  try {
    const result = await referenceDataImports.dryRun({
      importType: clean(req.body?.import_type).toUpperCase(),
      sourceFilename: clean(req.body?.source_filename),
      csvText: req.body?.csv_text,
      createdBy: clean(req.body?.created_by) || 'management-api'
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

app.post('/api/reference-data/imports/:id/commit', requireInternalToken, async (req, res, next) => {
  try { res.json(await referenceDataImports.commit(req.params.id, { actor: clean(req.body?.actor) || 'management-api' })); }
  catch (error) { next(error); }
});

app.get('/api/reference-data/imports/:id', requireInternalToken, async (req, res, next) => {
  try {
    const result = await referenceDataImports.getImport(req.params.id);
    if (!result) return res.status(404).json({ error: 'Reference import not found' });
    res.json(result);
  } catch (error) { next(error); }
});

app.get('/api/leads', async (req, res, next) => {
  try {
    const params = [];
    const clauses = [
      `c.data_origin IN (${publicDataOriginSql})`,
      companyMarketVisibleSql('c'),
      excludesConfirmedExistingCustomerSql('c')
    ];
    if (req.query.tier) { params.push(req.query.tier); clauses.push(`r.tier = $${params.length}`); }
    if (req.query.approval) { params.push(req.query.approval); clauses.push(`r.approval_status = $${params.length}`); }
    if (req.query.verification_status) { params.push(String(req.query.verification_status).toUpperCase()); clauses.push(`c.verification_status = $${params.length}`); }
    if (req.query.lifecycle_status) { params.push(String(req.query.lifecycle_status).toUpperCase()); clauses.push(`c.lifecycle_status = $${params.length}`); }
    if (req.query.size === 'sme') clauses.push("c.company_size_band IN ('micro','small','medium')");
    if (req.query.size === 'large') clauses.push("c.company_size_band IN ('large','enterprise')");
    if (req.query.size === 'unknown') clauses.push("c.company_size_band = 'unknown'");
    if (req.query.country) { params.push(String(req.query.country).toUpperCase()); clauses.push(`c.country_code = $${params.length}`); }
    const { rows } = await pool.query(`
      SELECT c.id, c.company_name, c.city, c.company_type, c.normalized_domain,
        c.website_url, c.data_origin, c.importer_wholesaler_fit, c.chain_supply_fit, c.source_record_count,
        c.research_job_id, c.company_size_band, c.procurement_access_fit, c.size_evidence, c.social_profiles,
        c.verification_status,c.lifecycle_status,c.last_verified_at,c.verification_source_count,
        c.verification_freshness,c.explicit_exclusion_reason,c.product_categories AS product_profiles,
        r.lead_score, r.tier, r.approval_status, r.send_status, r.next_action
      FROM leadgen.companies c JOIN leadgen.lead_reviews r ON r.company_id = c.id
      WHERE ${clauses.join(' AND ')} ORDER BY r.lead_score DESC, c.company_name`, params);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get('/api/export/leads', managementAuth.authenticate,
  managementAuth.requireRoles('SALES','MANAGEMENT'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id,c.company_name,c.city,c.website_url,c.company_type,c.company_description,
        c.data_origin,c.research_job_id,
        c.verification_status,c.lifecycle_status,c.last_verified_at,c.verification_source_count,
        c.verification_freshness,c.explicit_exclusion_reason,c.product_categories AS product_profiles,
        c.importer_wholesaler_fit,c.chain_supply_fit,c.importer_wholesaler_evidence,
        c.chain_store_supply_evidence,c.source_record_count,c.created_at,c.last_collected_at,
        c.company_size_band,c.procurement_access_fit,c.size_evidence,c.social_profiles,
        r.product_match,r.lead_score,r.tier,r.approval_status,r.next_action,
        ct.business_email,ct.business_phone,ct.email_verification_status,
        ct.verification_method,ct.verification_detail,ct.verification_checked_at,
        coalesce(src.sources,'[]'::json) AS sources
      FROM leadgen.companies c
      JOIN leadgen.lead_reviews r ON r.company_id=c.id
      LEFT JOIN LATERAL (
        SELECT business_email,business_phone,email_verification_status,verification_method,
          verification_detail,verification_checked_at
        FROM leadgen.contacts WHERE company_id=c.id
          AND lifecycle_status='ACTIVE'
        ORDER BY (business_email IS NOT NULL) DESC, verification_checked_at DESC NULLS LAST LIMIT 1
      ) ct ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('provider',provider_name,'url',source_url,
          'captured_at',captured_at,'evidence_kind',evidence_kind) ORDER BY captured_at DESC) AS sources
        FROM leadgen.sources WHERE company_id=c.id
      ) src ON true
      WHERE c.data_origin IN (${publicDataOriginSql})
        AND ${companyMarketVisibleSql('c')}
        AND ${excludesConfirmedExistingCustomerSql('c')}
      ORDER BY r.lead_score DESC,c.company_name`);
    res.json({ generated_at: new Date().toISOString(), target_product: '全品类女装（包括但不限于连衣裙、上衣、半身裙、裤装、套装、外套、针织衫、内搭及其他女装）', leads: rows });
  } catch (e) { next(e); }
});

app.get('/api/leads/:id', managementAuth.tryAuthenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, r.*, ct.full_name, ct.job_title, ct.business_email, ct.business_phone,
        ct.email_verification_status,ct.verification_method,ct.verification_detail,ct.verification_checked_at,
        ct.contact_verification_status,ct.contact_lifecycle_status,ct.contact_last_verified_at,
        c.product_categories AS product_profiles,
        coalesce(src.sources,'[]'::json) AS sources
      FROM leadgen.companies c
      JOIN leadgen.lead_reviews r ON r.company_id = c.id
      LEFT JOIN LATERAL (
        SELECT full_name,job_title,business_email,business_phone,email_verification_status,
          verification_method,verification_detail,verification_checked_at,
          contact_verification_status, lifecycle_status AS contact_lifecycle_status,last_verified_at AS contact_last_verified_at
        FROM leadgen.contacts WHERE company_id=c.id
        ORDER BY (lifecycle_status='ACTIVE') DESC,(business_email IS NOT NULL) DESC,verification_checked_at DESC NULLS LAST LIMIT 1
      ) ct ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('provider',provider_name,'url',source_url,
          'captured_at',captured_at,'evidence_kind',evidence_kind) ORDER BY captured_at DESC) AS sources
        FROM leadgen.sources WHERE company_id=c.id
      ) src ON true
      WHERE c.id = $1 AND ${companyMarketVisibleSql('c')}
      `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead=rows[0];
    if (!['SALES','MANAGEMENT','OUTREACH_APPROVER','SENDER_OPERATOR'].includes(req.managementUser?.role)) {
      for (const field of ['full_name','job_title','business_email','business_phone','email_verification_status',
        'verification_method','verification_detail','verification_checked_at','contact_verification_status',
        'contact_lifecycle_status','contact_last_verified_at']) delete lead[field];
      lead.contact_access='RESTRICTED';
    }
    res.json(lead);
  } catch (e) { next(e); }
});

app.patch('/api/leads/:id/approval', managementAuth.authenticate,
  managementAuth.requireRoles('MANAGEMENT','MANAGEMENT_APPROVER'), async (req, res, next) => {
  try {
    if (!['approved', 'rejected', 'pending', 'needs_changes'].includes(req.body.status))
      return res.status(400).json({ error: 'Invalid approval status' });
    const { rows } = await pool.query(`
      UPDATE leadgen.lead_reviews r SET approval_status=$1, updated_at=now(), send_status='disabled'
      FROM leadgen.companies c WHERE r.company_id=c.id AND c.id=$2
      RETURNING r.company_id, r.approval_status, r.send_status`, [req.body.status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const badRequestCodes = new Set([
    'PHASE5_SCOPE_REQUIRED','UNSUPPORTED_IMPORT_TYPE','CSV_FILENAME_REQUIRED','CSV_SIZE_INVALID',
    'CSV_PARSE_FAILED','CSV_SCHEMA_INVALID','IMPORT_NOT_VALIDATED','RULE_VERSION_NOT_INSTALLED','PHASE5_INVALID_ID',
    'CLEANUP_BATCH_INVALID','CLEANUP_BACKUP_REQUIRED','CLEANUP_BATCH_EXISTS','OPPORTUNITY_STATUS_INVALID'
  ]);
  const notFoundCodes = new Set(['COMPANY_NOT_FOUND','IMPORT_NOT_FOUND','CLEANUP_BATCH_NOT_FOUND']);
  const declaredStatus=Number(error.status);
  const status = Number.isInteger(declaredStatus)&&declaredStatus>=400&&declaredStatus<=599
    ? declaredStatus : badRequestCodes.has(error.code) ? 400 : notFoundCodes.has(error.code) ? 404 : 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message,
    code: error.code || undefined,...(error.created===false?{created:false,research_job_id:null}:{}) });
});

async function start() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try { await pool.query('SELECT 1'); break; }
    catch (error) {
      if (attempt === 30) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  // Non-search workers intentionally receive no Tavily credential. They must not
  // overwrite the shared provider projection with a false AUTH_ERROR at startup.
  if(httpListenEnabled||searchConfig.tavilyApiKey){
    await tavilyProviderAccountState.refreshUsage({source:'STARTUP_PROBE'})
      .catch(error=>audit('TAVILY_USAGE_STARTUP_PROBE_FAILED',{code:error?.code||'PROVIDER_STATE_ERROR'}));
  }
  if (httpListenEnabled) {
    const liveCount = await pool.query(`SELECT count(*)::int AS count FROM leadgen.companies WHERE data_origin IN (${publicDataOriginSql})`);
    if (liveCount.rows[0].count === 0) {
      try { await collectLive(50); } catch (error) { console.warn(`Initial live collection failed: ${error.message}`); }
    }
  }
  await phase5Queue.start();
  let researchOutboxTimer=null;
  if(httpListenEnabled){
    await researchDirectDispatchService.reconcile({limit:25});
    researchOutboxTimer=setInterval(()=>researchDirectDispatchService.reconcile({limit:25})
      .catch(error=>audit('RESEARCH_DIRECT_OUTBOX_RECONCILE_FAILED',{code:error?.code||'QUEUE_UNAVAILABLE'})),30000);
    researchOutboxTimer.unref?.();
  }
  const server = httpListenEnabled
    ? app.listen(port, '0.0.0.0', () => console.log(`DPV workspace listening on ${port}`))
    : null;
  if (!httpListenEnabled) console.log('DPV worker started without an HTTP listener');
  const shutdown = async signal => {
    audit('application_shutdown', { signal });
    server?.close();
    if(researchOutboxTimer)clearInterval(researchOutboxTimer);
    await phase5Queue.stop();
    await telemetry.shutdown();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

start().catch(error => { console.error(error); process.exit(1); });
