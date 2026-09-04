import crypto from 'node:crypto';
import { BuyerBusinessModelEngine,buildBuyerBusinessModelFacts,BUYER_BUSINESS_MODEL_VERSION } from './buyerBusinessModel.js';
import { CategoryProcurementMatchEngine,buildCategoryProcurementDimensions,CATEGORY_PROCUREMENT_MATCH_VERSION } from './categoryProcurementMatch.js';
import { CatalogSnapshotService } from './catalogSnapshot.js';
import { calculateProductOpportunity,publicProductOpportunityProjection,PRODUCT_OPPORTUNITY_VERSION } from './productOpportunity.js';
import { CooperationFeasibilityV3Engine,COOPERATION_V3_VERSION } from './cooperationV3.js';
import { calculateCommercialProductFit,publicCommercialProductFitProjection,COMMERCIAL_PRODUCT_FIT_VERSION } from './commercialProductFit.js';
export { buildCategoryBuyerDiscoveryQueries } from './CategoryEvidenceService.js';

const upper=value=>String(value||'').trim().toUpperCase();
const unique=values=>[...new Set((values||[]).filter(Boolean))];
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dimensionNames={target_category_procurement_evidence:'TARGET_CATEGORY_PROCUREMENT_EVIDENCE',buyer_business_model_fit:'BUYER_BUSINESS_MODEL_FIT',assortment_depth:'ASSORTMENT_DEPTH',external_sourcing_import:'EXTERNAL_SOURCING_IMPORT',recent_category_activity:'RECENT_CATEGORY_ACTIVITY'};
const commercialDimensionNames={assortment_relevance:'ASSORTMENT_RELEVANCE',commercial_positioning_price_band:'COMMERCIAL_POSITIONING_PRICE_BAND',
  attribute_specification_fit:'ATTRIBUTE_SPECIFICATION_FIT',moq_order_format_compatibility:'MOQ_ORDER_FORMAT_COMPATIBILITY',
  import_sourcing_model_fit:'IMPORT_SOURCING_MODEL_FIT',recent_product_buying_signal:'RECENT_PRODUCT_BUYING_SIGNAL'};
const currentProductOpportunityRecord=row=>{
  const {catalog_enrichment_required:_legacyCatalogTask,missing_catalog_evidence:_legacyCatalogMissing,
    sku_readiness_status:_legacySkuReadiness,candidate_count:_legacyCandidateCount,...current}=row||{};
  return {...current,recommendation_status:current.recommendation_status==='NOT_RUN_GATE_FAILED'
    ?'NOT_RUN_GATE_FAILED':'CATEGORY_SCOPE_QUALIFIED',candidate_count:0,candidates:[]};
};

export function buildCategoryProcurementWorkItems({company_ids=[],product_profiles=['WOMENSWEAR','GENERAL_MERCHANDISE'],job_id=null,research_job_id=null}={}){
  const effectiveJobId=research_job_id||job_id;const rows=[];const seen=new Set();for(const companyId of unique(company_ids.map(String)))for(const productProfile of unique(product_profiles.map(upper))){if(!['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(productProfile))continue;const work_key=`${companyId}:${productProfile}`;if(seen.has(work_key))continue;seen.add(work_key);rows.push({job_id:effectiveJobId,research_job_id:effectiveJobId,company_id:companyId,product_profile:productProfile,work_key});}return rows;
}

export function publicCategoryProcurementProjection(result={}){
  return {category_procurement_match_result_id:result.id||result.category_procurement_match_result_id||null,product_profile:result.product_profile,
    category_procurement_match_score:result.score??null,category_procurement_match_band:result.band||'UNKNOWN',category_procurement_match_status:result.match_status||'NEEDS_PRODUCT_EVIDENCE',
    category_procurement_coverage:Number(result.coverage_percent||0),buyer_business_model:result.buyer_model||'UNKNOWN',buyer_subtype:result.buyer_subtype||'OTHER',
    scope_revision_id:result.scope_revision_id||null,match_basis:result.match_basis||null,
    scope_revision:result.scope_revision??null,matched_scopes:result.matched_scopes||[],
    observed_customer_categories:result.observed_customer_categories||result.observed_categories||[],
    matched_scope_ids:result.matched_scope_ids||[],observed_customer_category_ids:result.observed_customer_category_ids||[],
    similarity_rule:result.similarity_rule||null,catalog_completeness_non_blocking:result.catalog_completeness_non_blocking===true,
    observed_categories:result.observed_categories||[],reason_codes:result.reason_codes||[],missing_evidence:result.missing_evidence||[],
    dimensions:result.dimensions||[],product_opportunity:result.product_opportunity?publicProductOpportunityProjection(result.product_opportunity):null,
    supplier_access_score:result.supplier_access_score??null,supplier_access_band:result.supplier_access_band||'UNKNOWN',supplier_access_coverage:Number(result.supplier_access_coverage||0),
    product_access_matrix:result.product_access_matrix||'UNKNOWN_PRODUCT',readiness:result.opportunity_readiness||'NEEDS_PRODUCT_EVIDENCE',readiness_blockers:result.readiness_blockers||[],created_at:result.created_at||null};
}

function accessDimensions(previous={}){const breakdown=previous.dimension_breakdown||{};return Object.fromEntries(['external_supplier_openness','supplier_onboarding_accessibility','buying_procurement_accessibility','commercial_operational_feasibility','supplier_lock_in_barrier'].map(key=>[key,breakdown[key]||{state:'UNKNOWN',points:null,evidence_ids:[]} ]));}

export class CategoryProcurementService{
  constructor({pool,buyerEngine=new BuyerBusinessModelEngine(),matchEngine=new CategoryProcurementMatchEngine(),cooperationEngine=new CooperationFeasibilityV3Engine(),catalogService=null}={}){
    if(!pool)throw new Error('CategoryProcurementService requires a PostgreSQL pool');this.pool=pool;this.buyerEngine=buyerEngine;this.matchEngine=matchEngine;this.cooperationEngine=cooperationEngine;this.catalogService=catalogService||new CatalogSnapshotService({pool});
  }
  async loadObservations(companyId){const result=await this.pool.query(`SELECT o.*,s.source_url,s.content_fetched,s.fetch_status,s.page_title FROM leadgen.prospect_category_observations o JOIN leadgen.prospect_category_sources s ON s.id=o.source_id WHERE o.company_id=$1 ORDER BY o.captured_at DESC,o.id`,[companyId]);return result.rows;}
  async loadProducts(profile){const result=await this.pool.query(`SELECT pm.id product_master_id,
    coalesce(rev.product_profile,pm.product_profile) product_profile,
    a.normalized_category,a.normalized_subcategory,a.assignment_status,
    CASE WHEN rev.catalog_status='INACTIVE' THEN 'EXCLUDED' ELSE a.catalog_status END catalog_status,
    a.input_digest
    FROM leadgen.product_master pm
    LEFT JOIN leadgen.product_master_current_revisions rev ON rev.product_master_id=pm.id
    JOIN LATERAL(SELECT x.* FROM leadgen.product_master_taxonomy_assignments x WHERE x.product_master_id=pm.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)a ON true
    WHERE coalesce(rev.product_profile,pm.product_profile)=$1 ORDER BY pm.id`,[upper(profile)]);return result.rows;}
  async loadApprovedCategoryScopes(profile){
    const scopes=await this.pool.query(`SELECT * FROM leadgen.dpv_product_category_scope_current
      WHERE product_profile=$1 ORDER BY normalized_category,id`,[upper(profile)]);
    if(!scopes.rowCount)return {scope_revision:null,category_scopes:[],scope_aliases:[]};
    const revision={id:scopes.rows[0].scope_revision_id,revision:scopes.rows[0].revision,
      approval_status:scopes.rows[0].approval_status,effective_from:scopes.rows[0].effective_from,
      effective_to:scopes.rows[0].effective_to,source_digest:scopes.rows[0].source_digest};
    const aliases=await this.pool.query(`SELECT a.* FROM leadgen.dpv_product_category_scope_aliases a
      JOIN leadgen.dpv_product_category_scopes s ON s.id=a.scope_id AND s.scope_revision_id=a.scope_revision_id
      WHERE a.scope_revision_id=$1 AND s.product_profile=$2 AND a.status='ACTIVE'
      ORDER BY a.normalized_alias,a.id`,[revision.id,upper(profile)]);
    return {scope_revision:revision,category_scopes:scopes.rows,scope_aliases:aliases.rows};
  }
  async persistScopeLinks(client,resultId,match){
    if(!['EXACT_CATEGORY','SIMILAR_CATEGORY','PROFILE_SCOPE'].includes(match.match_basis))return;
    for(const scopeId of unique(match.matched_scope_ids))for(const observationId of unique(match.observed_customer_category_ids)){
      await client.query(`INSERT INTO leadgen.category_procurement_match_scope_links
        (category_procurement_match_result_id,scope_revision_id,scope_id,prospect_category_observation_id,match_basis,similarity_rule)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[resultId,match.scope_revision_id,scopeId,
        observationId,match.match_basis,match.similarity_rule]);
    }
  }
  async loadContext(companyId,profile){
    const result=await this.pool.query(`SELECT c.id,c.company_name,c.company_type AS organization_type,
      c.verification_status,c.lifecycle_status,c.explicit_exclusion_reason,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=c.id AND s.lifted_at IS NULL) suppressed,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers h
        ON h.id=l.historical_customer_id WHERE l.company_id=c.id AND l.link_status='CONFIRMED'
        AND h.customer_role='INTERNAL_EXISTING_CUSTOMER') existing_customer,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l
        WHERE l.company_id=c.id AND l.link_status='CONFIRMED') historical_customer,
      EXISTS(SELECT 1 FROM leadgen.decision_makers dm JOIN leadgen.decision_maker_product_relevance pr
        ON pr.decision_maker_id=dm.id AND pr.product_profile=$2 AND pr.relevance IN('HIGH','MEDIUM')
        WHERE dm.company_id=c.id AND dm.person_name IS NOT NULL AND dm.verification_status='VERIFIED'
          AND dm.lifecycle_status='ACTIVE' AND dm.normalized_role IN('BUYER','SENIOR_BUYER','HEAD_OF_BUYING',
            'PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT','MERCHANDISING','SOURCING','BUYING_DEPARTMENT',
            'PROCUREMENT_DEPARTMENT')) has_verified_decision_route,
      EXISTS(SELECT 1 FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm
        ON dm.id=dc.decision_maker_id WHERE dm.company_id=c.id AND dm.lifecycle_status='ACTIVE'
          AND dc.source_url IS NOT NULL AND dc.last_verified_at>=now()-interval '30 days'
          AND ((dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
                AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED'))
            OR (dc.contact_type='BUSINESS_PHONE' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','FORMAT_VALID'))
            OR (dc.contact_type='BUSINESS_WHATSAPP' AND dc.verification_status IN('VALID','PUBLICLY_OBSERVED','BUSINESS_WHATSAPP_OBSERVED')))
          AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id
            AND sx.lifted_at IS NULL AND sx.decision_maker_contact_id=dc.id)) has_usable_contact_route,
      previous.* FROM leadgen.companies c LEFT JOIN LATERAL(
        SELECT f.id previous_feasibility_result_id,f.cooperation_feasibility_score previous_score,
          f.feasibility_band previous_band,f.access_opportunity_matrix previous_access_matrix,f.relationship_status,
          f.management_match,f.mexico_historical_match,f.dpv_score,f.dimension_breakdown,
          f.reason_codes previous_reason_codes,f.barrier_signals,f.missing_evidence previous_missing_evidence,
          f.supplier_route_count,f.verified_decision_maker_count,f.usable_contact_route_count,f.evidence_source_count
        FROM leadgen.cooperation_feasibility_results f WHERE f.company_id=c.id AND f.product_profile=$2
          AND f.category_procurement_match_result_id IS NULL ORDER BY f.calculated_at DESC,f.id DESC LIMIT 1
      )previous ON true WHERE c.id=$1`,[companyId,upper(profile)]);
    if(!result.rowCount)throw new Error('Company not found');return result.rows[0];
  }
  async classifyBuyerAndPersist({researchJobId,companyId,productProfile,executionKey}={}){
    const profile=upper(productProfile);const base=executionKey||`category-procurement:${researchJobId}:${companyId}:${profile}`;const key=`${base}:buyer`;const [observations,context]=await Promise.all([this.loadObservations(companyId),this.loadContext(companyId,profile)]);const facts=buildBuyerBusinessModelFacts({observations,product_profile:profile,company:context});const buyer=await this.buyerEngine.evaluate({facts});const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);let saved=await client.query('SELECT * FROM leadgen.buyer_business_model_results WHERE company_id=$1 AND execution_key=$2',[companyId,key]);let replay=true;if(!saved.rowCount){saved=await client.query(`INSERT INTO leadgen.buyer_business_model_results(research_job_id,company_id,buyer_model,buyer_subtype,eligibility_status,priority_tier,confidence_band,reason_codes,evidence_count,calculation_version,input_digest,execution_key)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)RETURNING *`,[researchJobId,companyId,buyer.buyer_model,buyer.buyer_subtype,buyer.eligibility_status,buyer.priority_tier,buyer.confidence_band,buyer.reason_codes,buyer.evidence_count,BUYER_BUSINESS_MODEL_VERSION,buyer.input_digest,key]);replay=false;for(const id of unique(buyer.evidence_ids))await client.query(`INSERT INTO leadgen.buyer_business_model_evidence(buyer_business_model_result_id,company_id,prospect_category_observation_id)VALUES($1,$2,$3)ON CONFLICT DO NOTHING`,[saved.rows[0].id,companyId,id]);}await client.query('COMMIT');return{...saved.rows[0],evidence_ids:buyer.evidence_ids,idempotent_replay:replay};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async calculateCategoryMatchAndPersist({researchJobId,companyId,productProfile,executionKey,buyerBusinessModelResultId=null}={}){
    const profile=upper(productProfile);const key=executionKey||`category-procurement:${researchJobId}:${companyId}:${profile}`;const existing=await this.pool.query('SELECT * FROM leadgen.category_procurement_match_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);if(existing.rowCount)return{...existing.rows[0],idempotent_replay:true};
    const [snapshot,observations,scopeFacts]=await Promise.all([this.catalogService.ensure(profile),this.loadObservations(companyId),this.loadApprovedCategoryScopes(profile)]);let buyerResult;if(buyerBusinessModelResultId){buyerResult=await this.pool.query(`SELECT b.*,coalesce(array_agg(e.prospect_category_observation_id)FILTER(WHERE e.prospect_category_observation_id IS NOT NULL),'{}'::uuid[])evidence_ids FROM leadgen.buyer_business_model_results b LEFT JOIN leadgen.buyer_business_model_evidence e ON e.buyer_business_model_result_id=b.id WHERE b.id=$1 AND b.company_id=$2 GROUP BY b.id`,[buyerBusinessModelResultId,companyId]);}else{const buyer=await this.classifyBuyerAndPersist({researchJobId,companyId,productProfile:profile,executionKey:key});buyerResult={rows:[buyer],rowCount:1};}if(!buyerResult.rowCount)throw new Error('Buyer Business Model result not found');const buyer=buyerResult.rows[0];const built=buildCategoryProcurementDimensions({observations,product_profile:profile,buyer_business_model:buyer});const match=await this.matchEngine.evaluate({...built,...scopeFacts,observations,observed_customer_categories:observations,buyer_model:buyer.buyer_model,product_profile:profile,catalog_snapshot:snapshot});const digest=sha([scopeFacts.scope_revision?.source_digest||null,snapshot.source_digest,buyer.input_digest,observations.map(item=>[item.id,item.evidence_hash,item.verification_status])]);const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);let saved=await client.query('SELECT * FROM leadgen.category_procurement_match_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);let replay=true;if(!saved.rowCount){saved=await client.query(`INSERT INTO leadgen.category_procurement_match_results(research_job_id,company_id,product_profile,buyer_business_model_result_id,product_profile_catalog_snapshot_id,score,band,match_status,coverage_percent,calculation_version,taxonomy_version,input_digest,execution_key,reason_codes,missing_evidence,observed_categories,scope_revision_id,match_basis,matched_scope_ids,observed_customer_category_ids,similarity_rule,catalog_completeness_non_blocking)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::uuid[],$20::uuid[],$21,$22)RETURNING *`,[researchJobId,companyId,profile,buyer.id,snapshot.id,match.score,match.band,match.match_status,match.coverage_percent,CATEGORY_PROCUREMENT_MATCH_VERSION,snapshot.taxonomy_version,digest,key,match.reason_codes,match.missing_evidence,match.observed_categories,match.scope_revision_id,match.match_basis,match.matched_scope_ids,match.observed_customer_category_ids,match.similarity_rule,match.catalog_completeness_non_blocking]);replay=false;for(const[name,item]of Object.entries(match.dimensions)){const dim=await client.query(`INSERT INTO leadgen.category_procurement_match_dimensions(category_procurement_match_result_id,company_id,dimension,state,points,maximum,reason_codes)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING id`,[saved.rows[0].id,companyId,dimensionNames[name],item.state,item.points,item.maximum,item.reason_codes]);for(const id of unique(item.evidence_ids))await client.query(`INSERT INTO leadgen.category_procurement_match_evidence(category_procurement_match_dimension_id,company_id,prospect_category_observation_id)VALUES($1,$2,$3)ON CONFLICT DO NOTHING`,[dim.rows[0].id,companyId,id]);}await this.persistScopeLinks(client,saved.rows[0].id,match);}await client.query('COMMIT');return{...saved.rows[0],buyer_business_model_result_id:buyer.id,idempotent_replay:replay};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async calculateProductOpportunityAndPersist({researchJobId,companyId,productProfile,executionKey,categoryProcurementMatchResultId}={}){
    const profile=upper(productProfile);const base=executionKey||`category-procurement:${researchJobId}:${companyId}:${profile}`;const key=`${base}:opportunity`;let existing=await this.pool.query('SELECT * FROM leadgen.product_opportunity_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);if(existing.rowCount)return{...currentProductOpportunityRecord(existing.rows[0]),idempotent_replay:true};const matchResult=await this.pool.query(`SELECT r.* FROM leadgen.category_procurement_match_results r WHERE r.id=$1 AND r.company_id=$2 AND r.research_job_id=$3 AND r.product_profile=$4`,[categoryProcurementMatchResultId,companyId,researchJobId,profile]);if(!matchResult.rowCount)throw new Error('Category Procurement Match result not found');const row=matchResult.rows[0];const opportunity=calculateProductOpportunity({category_procurement_match_result:row});const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);existing=await client.query('SELECT * FROM leadgen.product_opportunity_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);let replay=true;if(!existing.rowCount){existing=await client.query(`INSERT INTO leadgen.product_opportunity_results(research_job_id,company_id,product_profile,category_procurement_match_result_id,recommendation_status,candidate_count,reason_codes,missing_catalog_evidence,calculation_version,input_digest,execution_key,sku_readiness_status,catalog_enrichment_required,category_scope_match_result_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13)RETURNING *`,[researchJobId,companyId,profile,row.id,opportunity.recommendation_status,0,opportunity.reason_codes,[],PRODUCT_OPPORTUNITY_VERSION,opportunity.input_digest,key,opportunity.sku_readiness_status,row.id]);replay=false;}await client.query('COMMIT');return{...currentProductOpportunityRecord(existing.rows[0]),idempotent_replay:replay};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async persistCommercialFit(client,{researchJobId,companyId,productProfile,executionKey,categoryMatch,observations}={}){
    const profile=upper(productProfile);const key=`${executionKey}:commercial-fit:${COMMERCIAL_PRODUCT_FIT_VERSION}`;
    const fit=calculateCommercialProductFit({observations,product_profile:profile,category_match:categoryMatch,
      category_procurement_match_result_id:categoryMatch.id});
    let saved=await client.query('SELECT * FROM leadgen.commercial_product_fit_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);
    if(saved.rowCount)return{...publicCommercialProductFitProjection({...saved.rows[0],dimensions:fit.dimensions}),idempotent_replay:true};
    saved=await client.query(`INSERT INTO leadgen.commercial_product_fit_results
      (research_job_id,company_id,product_profile,category_procurement_match_result_id,commercial_fit_score,
       commercial_fit_band,coverage_percent,calculation_version,input_digest,execution_key,reason_codes,unknown_dimensions)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[researchJobId,companyId,profile,categoryMatch.id,
      fit.commercial_fit_score,fit.commercial_fit_band,fit.coverage_percent,fit.calculation_version,fit.input_digest,key,
      fit.reason_codes,fit.unknown_dimensions]);
    for(const[name,item]of Object.entries(fit.dimensions)){
      const dimension=await client.query(`INSERT INTO leadgen.commercial_product_fit_dimensions
        (commercial_product_fit_result_id,company_id,dimension,state,points,maximum,reason_codes)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[saved.rows[0].id,companyId,commercialDimensionNames[name],
        item.state,item.points,item.maximum,item.reason_codes]);
      for(const observationId of unique(item.evidence_ids))await client.query(`INSERT INTO leadgen.commercial_product_fit_evidence
        (commercial_product_fit_dimension_id,company_id,prospect_category_observation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [dimension.rows[0].id,companyId,observationId]);
    }
    return{...publicCommercialProductFitProjection({...saved.rows[0],dimensions:fit.dimensions}),idempotent_replay:false};
  }
  async calculateCommercialFitAndPersist({researchJobId,companyId,productProfile,executionKey,categoryProcurementMatchResultId}={}){
    const profile=upper(productProfile);const base=executionKey||`category-procurement:${researchJobId}:${companyId}:${profile}`;
    const [matchResult,observations]=await Promise.all([
      this.pool.query(`SELECT * FROM leadgen.category_procurement_match_results
        WHERE id=$1 AND company_id=$2 AND research_job_id=$3 AND product_profile=$4`,
      [categoryProcurementMatchResultId,companyId,researchJobId,profile]),this.loadObservations(companyId)]);
    if(!matchResult.rowCount)throw new Error('Category Procurement Match result not found');
    const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${base}:commercial-fit`]);
      const result=await this.persistCommercialFit(client,{researchJobId,companyId,productProfile:profile,executionKey:base,
        categoryMatch:matchResult.rows[0],observations});await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async calculateCooperationAndPersist({researchJobId,companyId,productProfile,executionKey,categoryProcurementMatchResultId,productOpportunityResultId=null}={}){
    const profile=upper(productProfile);const base=executionKey||`category-procurement:${researchJobId}:${companyId}:${profile}`;const key=`${base}:cooperation`;let existing=await this.pool.query('SELECT * FROM leadgen.cooperation_feasibility_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);if(existing.rowCount)return{...existing.rows[0],idempotent_replay:true};
    void productOpportunityResultId;const [matchResult,context,observationCount]=await Promise.all([this.pool.query(`SELECT r.*,b.buyer_model,b.buyer_subtype FROM leadgen.category_procurement_match_results r JOIN leadgen.buyer_business_model_results b ON b.id=r.buyer_business_model_result_id WHERE r.id=$1 AND r.company_id=$2 AND r.research_job_id=$3 AND r.product_profile=$4`,[categoryProcurementMatchResultId,companyId,researchJobId,profile]),this.loadContext(companyId,profile),this.pool.query('SELECT count(*)::int count FROM leadgen.prospect_category_observations WHERE company_id=$1 AND verification_status IN(\'VERIFIED\',\'REVIEW\')',[companyId])]);if(!matchResult.rowCount)throw new Error('Category Procurement Match result not found');const match=matchResult.rows[0];const relationship=context.suppressed?'SUPPRESSED':context.existing_customer?'INTERNAL_EXISTING_CUSTOMER':context.historical_customer?'HISTORICAL_CRM_LEAD':'NEW_PROSPECT';const supplierRouteClosed=(context.barrier_signals||[]).map(upper).some(code=>['SUPPLIER_ROUTE_CLOSED','SUPPLIER_APPLICATION_CLOSED','DOES_NOT_ACCEPT_NEW_SUPPLIERS'].includes(code));const cooperation=await this.cooperationEngine.evaluate({supplier_access_dimensions:accessDimensions(context),buyer_model:match.buyer_model,category_procurement_match_band:match.band,category_procurement_match_status:match.match_status,category_procurement_match_score:match.score,category_procurement_coverage:match.coverage_percent,relationship_status:relationship,suppressed:context.suppressed,existing_customer:context.existing_customer,company_verified_active:upper(context.verification_status)==='VERIFIED'&&upper(context.lifecycle_status)==='ACTIVE',eligible_target_organization:!context.explicit_exclusion_reason,has_verified_decision_route:context.has_verified_decision_route,has_current_valid_contact_route:context.has_usable_contact_route,has_current_valid_company_route:context.has_usable_contact_route,has_traceable_evidence:Number(observationCount.rows[0].count)>0,cooperation_feasibility_band:context.previous_band,supplier_route_closed:supplierRouteClosed,supplier_route_status:supplierRouteClosed?'CLOSED':'UNKNOWN'});const legacyScore=context.previous_score!=null&&Number.isFinite(Number(context.previous_score))?Number(context.previous_score):cooperation.supplier_access_score??0;const legacyBand=['HIGH','MEDIUM','LOW_MEDIUM','LOW'].includes(upper(context.previous_band))?upper(context.previous_band):cooperation.supplier_access_band==='UNKNOWN'?'LOW':cooperation.supplier_access_band;const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);existing=await client.query('SELECT * FROM leadgen.cooperation_feasibility_results WHERE company_id=$1 AND product_profile=$2 AND execution_key=$3',[companyId,profile,key]);let replay=true;if(!existing.rowCount){existing=await client.query(`INSERT INTO leadgen.cooperation_feasibility_results(research_job_id,company_id,product_profile,cooperation_feasibility_score,feasibility_band,access_opportunity_matrix,opportunity_readiness,relationship_status,management_match,mexico_historical_match,dpv_score,dimension_breakdown,reason_codes,barrier_signals,missing_evidence,supplier_route_count,verified_decision_maker_count,usable_contact_route_count,evidence_source_count,rule_version,category_procurement_match_result_id,cooperation_calculation_version,supplier_access_score,supplier_access_band,supplier_access_coverage,product_access_matrix,readiness_blockers,supplier_route_status,execution_key)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)RETURNING *`,[researchJobId,companyId,profile,legacyScore,legacyBand,context.previous_access_matrix||'LOW_PRIORITY',cooperation.opportunity_readiness,relationship,context.management_match,context.mexico_historical_match,context.dpv_score,JSON.stringify(cooperation.dimension_breakdown),unique([...(context.previous_reason_codes||[]),'CATEGORY_PROCUREMENT_V4']),context.barrier_signals||[],unique([...(context.previous_missing_evidence||[]),...(cooperation.missing_evidence||[])]),Number(context.supplier_route_count||0),Number(context.verified_decision_maker_count||0),Number(context.usable_contact_route_count||0),Number(observationCount.rows[0].count),COOPERATION_V3_VERSION,match.id,COOPERATION_V3_VERSION,cooperation.supplier_access_score,cooperation.supplier_access_band,cooperation.supplier_access_coverage,cooperation.product_access_matrix,cooperation.readiness_blockers,cooperation.supplier_route_status,key]);replay=false;}await client.query('COMMIT');return{...existing.rows[0],idempotent_replay:replay};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async calculateAndPersist({researchJobId,companyId,productProfile,executionKey}={}){
    const profile=upper(productProfile);if(!researchJobId||!companyId||!['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(profile))throw new Error('researchJobId, companyId and a supported productProfile are required');
    const [snapshot,observations,context,scopeFacts]=await Promise.all([this.catalogService.ensure(profile),this.loadObservations(companyId),this.loadContext(companyId,profile),this.loadApprovedCategoryScopes(profile)]);
    if(!snapshot)throw new Error('Catalog snapshot unavailable');const key=executionKey||`category-procurement:${researchJobId}:${companyId}:${profile}`;
    const buyerFacts=buildBuyerBusinessModelFacts({observations,product_profile:profile,company:context});const buyer=await this.buyerEngine.evaluate({facts:buyerFacts});
    const built=buildCategoryProcurementDimensions({observations,product_profile:profile,buyer_business_model:buyer});const match=await this.matchEngine.evaluate({...built,...scopeFacts,observations,observed_customer_categories:observations,product_profile:profile,buyer_model:buyer.buyer_model,buyer_business_model:buyer,catalog_snapshot:snapshot});
    const inputDigest=sha([scopeFacts.scope_revision?.source_digest||null,snapshot.source_digest,buyer.input_digest,observations.map(item=>[item.id,item.evidence_hash,item.verification_status])]);
    const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
      const replay=await client.query(`SELECT r.*,b.buyer_model,b.buyer_subtype,o.id product_opportunity_result_id,f.id cooperation_result_id,f.supplier_access_score,f.supplier_access_band,f.supplier_access_coverage,f.product_access_matrix,f.opportunity_readiness,f.readiness_blockers FROM leadgen.category_procurement_match_results r JOIN leadgen.buyer_business_model_results b ON b.id=r.buyer_business_model_result_id LEFT JOIN leadgen.product_opportunity_results o ON o.category_procurement_match_result_id=r.id LEFT JOIN leadgen.cooperation_feasibility_results f ON f.category_procurement_match_result_id=r.id WHERE r.company_id=$1 AND r.product_profile=$2 AND r.execution_key=$3`,[companyId,profile,key]);
      if(replay.rowCount){await client.query('COMMIT');return {...publicCategoryProcurementProjection(replay.rows[0]),buyer_business_model_result_id:replay.rows[0].buyer_business_model_result_id,product_opportunity_result_id:replay.rows[0].product_opportunity_result_id,cooperation_result_id:replay.rows[0].cooperation_result_id,idempotent_replay:true};}
      const buyerKey=`${key}:buyer`;let buyerSaved=await client.query(`INSERT INTO leadgen.buyer_business_model_results(research_job_id,company_id,buyer_model,buyer_subtype,eligibility_status,priority_tier,confidence_band,reason_codes,evidence_count,calculation_version,input_digest,execution_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(company_id,execution_key) DO NOTHING RETURNING *`,[researchJobId,companyId,buyer.buyer_model,buyer.buyer_subtype,buyer.eligibility_status,buyer.priority_tier,buyer.confidence_band,buyer.reason_codes,buyer.evidence_count,BUYER_BUSINESS_MODEL_VERSION,buyer.input_digest,buyerKey]);if(!buyerSaved.rowCount)buyerSaved=await client.query('SELECT * FROM leadgen.buyer_business_model_results WHERE company_id=$1 AND execution_key=$2',[companyId,buyerKey]);const buyerRow=buyerSaved.rows[0];
      for(const observationId of unique(buyer.evidence_ids))await client.query(`INSERT INTO leadgen.buyer_business_model_evidence(buyer_business_model_result_id,company_id,prospect_category_observation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[buyerRow.id,companyId,observationId]);
      const matchSaved=await client.query(`INSERT INTO leadgen.category_procurement_match_results(research_job_id,company_id,product_profile,buyer_business_model_result_id,product_profile_catalog_snapshot_id,score,band,match_status,coverage_percent,calculation_version,taxonomy_version,input_digest,execution_key,reason_codes,missing_evidence,observed_categories,scope_revision_id,match_basis,matched_scope_ids,observed_customer_category_ids,similarity_rule,catalog_completeness_non_blocking) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::uuid[],$20::uuid[],$21,$22) RETURNING *`,[researchJobId,companyId,profile,buyerRow.id,snapshot.id,match.score,match.band,match.match_status,match.coverage_percent,CATEGORY_PROCUREMENT_MATCH_VERSION,snapshot.taxonomy_version,inputDigest,key,match.reason_codes,match.missing_evidence,match.observed_categories,match.scope_revision_id,match.match_basis,match.matched_scope_ids,match.observed_customer_category_ids,match.similarity_rule,match.catalog_completeness_non_blocking]);const matchRow=matchSaved.rows[0];
      const dimensionNames={target_category_procurement_evidence:'TARGET_CATEGORY_PROCUREMENT_EVIDENCE',buyer_business_model_fit:'BUYER_BUSINESS_MODEL_FIT',assortment_depth:'ASSORTMENT_DEPTH',external_sourcing_import:'EXTERNAL_SOURCING_IMPORT',recent_category_activity:'RECENT_CATEGORY_ACTIVITY'};
      for(const[name,item]of Object.entries(match.dimensions)){const dim=await client.query(`INSERT INTO leadgen.category_procurement_match_dimensions(category_procurement_match_result_id,company_id,dimension,state,points,maximum,reason_codes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[matchRow.id,companyId,dimensionNames[name],item.state,item.points,item.maximum,item.reason_codes]);for(const observationId of unique(item.evidence_ids))await client.query(`INSERT INTO leadgen.category_procurement_match_evidence(category_procurement_match_dimension_id,company_id,prospect_category_observation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[dim.rows[0].id,companyId,observationId]);}
      await this.persistScopeLinks(client,matchRow.id,match);
      const opportunity=calculateProductOpportunity({category_procurement_match:matchRow});const oppKey=`${key}:opportunity`;
      const oppSaved=await client.query(`INSERT INTO leadgen.product_opportunity_results(research_job_id,company_id,product_profile,category_procurement_match_result_id,recommendation_status,candidate_count,reason_codes,missing_catalog_evidence,calculation_version,input_digest,execution_key,sku_readiness_status,catalog_enrichment_required,category_scope_match_result_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13) RETURNING *`,[researchJobId,companyId,profile,matchRow.id,opportunity.recommendation_status,opportunity.candidate_count,opportunity.reason_codes,opportunity.missing_catalog_evidence,PRODUCT_OPPORTUNITY_VERSION,opportunity.input_digest,oppKey,opportunity.sku_readiness_status,matchRow.id]);
      const relationship=context.suppressed?'SUPPRESSED':context.existing_customer?'INTERNAL_EXISTING_CUSTOMER':context.historical_customer?'HISTORICAL_CRM_LEAD':'NEW_PROSPECT';
      const supplierRouteClosed=(context.barrier_signals||[]).map(upper).some(code=>['SUPPLIER_ROUTE_CLOSED','SUPPLIER_APPLICATION_CLOSED','DOES_NOT_ACCEPT_NEW_SUPPLIERS'].includes(code));
      const cooperation=await this.cooperationEngine.evaluate({supplier_access_dimensions:accessDimensions(context),buyer_model:buyer.buyer_model,category_procurement_match_band:match.band,category_procurement_match_status:match.match_status,category_procurement_match_score:match.score,category_procurement_coverage:match.coverage_percent,relationship_status:relationship,suppressed:context.suppressed,existing_customer:context.existing_customer,company_verified_active:upper(context.verification_status)==='VERIFIED'&&upper(context.lifecycle_status)==='ACTIVE',eligible_target_organization:!context.explicit_exclusion_reason,has_verified_decision_route:context.has_verified_decision_route,has_current_valid_contact_route:context.has_usable_contact_route,has_current_valid_company_route:context.has_usable_contact_route,has_traceable_evidence:observations.length>0,cooperation_feasibility_band:context.previous_band,supplier_route_closed:supplierRouteClosed,supplier_route_status:supplierRouteClosed?'CLOSED':'UNKNOWN'});
      const legacyScore=context.previous_score!=null&&Number.isFinite(Number(context.previous_score))?Number(context.previous_score):cooperation.supplier_access_score??0;const legacyBand=['HIGH','MEDIUM','LOW_MEDIUM','LOW'].includes(upper(context.previous_band))?upper(context.previous_band):cooperation.supplier_access_band==='UNKNOWN'?'LOW':cooperation.supplier_access_band;
      const cooperationSaved=await client.query(`INSERT INTO leadgen.cooperation_feasibility_results(research_job_id,company_id,product_profile,cooperation_feasibility_score,feasibility_band,access_opportunity_matrix,opportunity_readiness,relationship_status,management_match,mexico_historical_match,dpv_score,dimension_breakdown,reason_codes,barrier_signals,missing_evidence,supplier_route_count,verified_decision_maker_count,usable_contact_route_count,evidence_source_count,rule_version,category_procurement_match_result_id,cooperation_calculation_version,supplier_access_score,supplier_access_band,supplier_access_coverage,product_access_matrix,readiness_blockers,supplier_route_status,execution_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,[researchJobId,companyId,profile,legacyScore,legacyBand,context.previous_access_matrix||'LOW_PRIORITY',cooperation.opportunity_readiness,relationship,context.management_match,context.mexico_historical_match,context.dpv_score,JSON.stringify(cooperation.dimension_breakdown),unique([...(context.previous_reason_codes||[]),...(cooperation.reason_codes||[]),'CATEGORY_PROCUREMENT_V4']),context.barrier_signals||[],unique([...(context.previous_missing_evidence||[]),...(cooperation.missing_evidence||[])]),Number(context.supplier_route_count||0),Number(context.verified_decision_maker_count||0),Number(context.usable_contact_route_count||0),observations.length,COOPERATION_V3_VERSION,matchRow.id,COOPERATION_V3_VERSION,cooperation.supplier_access_score,cooperation.supplier_access_band,cooperation.supplier_access_coverage,cooperation.product_access_matrix,cooperation.readiness_blockers,cooperation.supplier_route_status,`${key}:cooperation`]);
      await client.query('COMMIT');return {...publicCategoryProcurementProjection({...matchRow,...buyerRow,...cooperation,product_opportunity:{...oppSaved.rows[0],...opportunity}}),category_procurement_match_result_id:matchRow.id,buyer_business_model_result_id:buyerRow.id,product_opportunity_result_id:oppSaved.rows[0].id,cooperation_result_id:cooperationSaved.rows[0].id,idempotent_replay:false};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async getCompanyResults(companyId,{resultId=null}={}){const params=[companyId];const clause=resultId?(params.push(resultId),`AND r.id=$${params.length}`):'';const [result,commercialFits]=await Promise.all([this.pool.query(`SELECT r.*,b.buyer_model,b.buyer_subtype,f.supplier_access_score,f.supplier_access_band,f.supplier_access_coverage,f.product_access_matrix,f.opportunity_readiness,f.readiness_blockers,
      rev.revision scope_revision,
      coalesce((SELECT array_agg(s.normalized_category ORDER BY s.normalized_category) FROM leadgen.dpv_product_category_scopes s WHERE s.id=ANY(r.matched_scope_ids)),'{}'::text[]) matched_scopes,
      coalesce((SELECT array_agg(obs.normalized_category ORDER BY obs.normalized_category) FROM leadgen.prospect_category_observations obs WHERE obs.id=ANY(r.observed_customer_category_ids)),'{}'::text[]) observed_customer_categories,
      CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'product_profile',o.product_profile,
        'recommendation_status',CASE WHEN o.recommendation_status='NOT_RUN_GATE_FAILED' THEN 'NOT_RUN_GATE_FAILED' ELSE 'CATEGORY_SCOPE_QUALIFIED' END,
        'reason_codes',o.reason_codes,'created_at',o.created_at)END product_opportunity
      FROM leadgen.category_procurement_match_results r JOIN leadgen.buyer_business_model_results b ON b.id=r.buyer_business_model_result_id
      LEFT JOIN leadgen.dpv_product_category_scope_revisions rev ON rev.id=r.scope_revision_id
      LEFT JOIN leadgen.product_opportunity_results o ON o.category_procurement_match_result_id=r.id
      LEFT JOIN leadgen.cooperation_feasibility_results f ON f.category_procurement_match_result_id=r.id
      WHERE r.company_id=$1 ${clause} ORDER BY r.product_profile,r.created_at DESC,r.id DESC`,params),this.getCompanyCommercialFitResults(companyId)]);
    const fitByCategory=new Map(commercialFits.map(item=>[String(item.category_procurement_match_result_id),item]));
    return result.rows.map(row=>({...publicCategoryProcurementProjection(row),commercial_product_fit:fitByCategory.get(String(row.id))||null}));}
  async getCompanyCommercialFitResults(companyId){
    const result=await this.pool.query(`SELECT f.*,
      coalesce((SELECT jsonb_agg(jsonb_build_object('dimension',d.dimension,'state',d.state,'points',d.points,
        'maximum',d.maximum,'reason_codes',d.reason_codes,'evidence',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'observation_id',o.id,'source_url',s.source_url,'captured_at',o.captured_at,'evidence_text',o.evidence_text)
          ORDER BY o.captured_at DESC,o.id) FROM leadgen.commercial_product_fit_evidence e
          JOIN leadgen.prospect_category_observations o ON o.id=e.prospect_category_observation_id
          JOIN leadgen.prospect_category_sources s ON s.id=o.source_id
          WHERE e.commercial_product_fit_dimension_id=d.id),'[]'::jsonb)) ORDER BY d.id)
        FROM leadgen.commercial_product_fit_dimensions d WHERE d.commercial_product_fit_result_id=f.id),'[]'::jsonb) dimensions
      FROM leadgen.commercial_product_fit_current f WHERE f.company_id=$1 ORDER BY f.product_profile`,[companyId]);
    return result.rows.map(publicCommercialProductFitProjection);
  }
  dispose(){this.buyerEngine.dispose?.();this.matchEngine.dispose?.();this.cooperationEngine.dispose?.();}
}
