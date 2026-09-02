import pg from 'pg';
import {calculateCategoryProcurementMatch} from './categoryProcurementMatch.js';
import {calculateProductOpportunity} from './productOpportunity.js';
import {resolveReadinessV3} from './cooperationV3.js';
import {buildPhase10RuleDryRun,deriveOpportunityDecision} from '../phase7/opportunityDecision.js';

const upper=value=>String(value??'').trim().toUpperCase();
const dimensionKey=value=>String(value||'').toLowerCase();

async function relationExists(client,name){return Boolean((await client.query('SELECT to_regclass($1) relation',[`leadgen.${name}`])).rows[0]?.relation);}
async function scopeFacts(client){
  if(!await relationExists(client,'dpv_product_category_scope_current'))return {revision:null,scopes:[],aliases:[]};
  const scopes=(await client.query('SELECT * FROM leadgen.dpv_product_category_scope_current ORDER BY product_profile,normalized_category,id')).rows;
  if(!scopes.length)return {revision:null,scopes:[],aliases:[]};
  const revision={id:scopes[0].scope_revision_id,revision:scopes[0].revision,
    approval_status:scopes[0].approval_status,effective_from:scopes[0].effective_from,
    effective_to:scopes[0].effective_to,source_digest:scopes[0].source_digest};
  const aliases=(await client.query(`SELECT * FROM leadgen.dpv_product_category_scope_aliases
    WHERE scope_revision_id=$1 AND status='ACTIVE' ORDER BY normalized_alias,id`,[revision.id])).rows;
  return {revision,scopes,aliases};
}

export async function buildPhase10CurrentOpportunityDryRun({pool,ttlDays=7}={}){
  if(!pool)throw new Error('Phase 10 dry-run requires a PostgreSQL pool');
  const client=await pool.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const scope=await scopeFacts(client);
    const base=(await client.query(`WITH current_match AS (
      SELECT DISTINCT ON (company_id,product_profile) * FROM leadgen.category_procurement_match_results
      ORDER BY company_id,product_profile,created_at DESC,id DESC
    ) SELECT c.id company_id,c.company_name,c.verification_status,c.lifecycle_status,c.replaced_by_company_id,
      c.explicit_exclusion_reason,cpm.*,bbm.buyer_model,bbm.eligibility_status,
      po.id old_product_opportunity_result_id,po.recommendation_status old_product_opportunity_status,
      po.candidate_count old_product_opportunity_count,
      f.id cooperation_feasibility_result_id,f.opportunity_readiness,f.relationship_status,
      f.supplier_access_band,f.barrier_signals,
      bod.business_fit_status old_business_fit,bod.contact_readiness old_contact_readiness,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL) company_suppressed,
      EXISTS(SELECT 1 FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers hc
        ON hc.id=l.historical_customer_id WHERE l.company_id=c.id AND l.link_status='CONFIRMED'
        AND hc.customer_role='INTERNAL_EXISTING_CUSTOMER') confirmed_existing_customer,
      EXISTS(SELECT 1 FROM leadgen.category_procurement_match_dimensions md
        WHERE md.category_procurement_match_result_id=cpm.id AND md.dimension='EXTERNAL_SOURCING_IMPORT' AND md.state='OBSERVED') procurement_resale_evidence,
      (SELECT count(DISTINCT dm.id)::int FROM leadgen.decision_makers dm
        JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=dm.id AND pr.product_profile=cpm.product_profile
        WHERE dm.company_id=c.id AND dm.person_name IS NOT NULL AND dm.lifecycle_status='ACTIVE'
          AND dm.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM')) profile_relevant_buyer_count,
      (SELECT count(DISTINCT dm.id)::int FROM leadgen.decision_makers dm
        JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=dm.id AND pr.product_profile=cpm.product_profile
        WHERE dm.company_id=c.id AND dm.person_name IS NOT NULL AND dm.lifecycle_status='ACTIVE'
          AND dm.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM') AND dm.normalized_role IN(
            'BUYER','SENIOR_BUYER','HEAD_OF_BUYING','PURCHASING','PROCUREMENT','CATEGORY_MANAGEMENT',
            'MERCHANDISING','SOURCING','BUYING_DEPARTMENT','PROCUREMENT_DEPARTMENT')) verified_buyer_role_count,
      (SELECT count(*)::int FROM leadgen.decision_maker_contacts dc JOIN leadgen.decision_makers dm ON dm.id=dc.decision_maker_id
        JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=dm.id AND pr.product_profile=cpm.product_profile
        WHERE dm.company_id=c.id AND dm.person_name IS NOT NULL AND dm.lifecycle_status='ACTIVE'
          AND dm.verification_status='VERIFIED' AND pr.relevance IN('HIGH','MEDIUM')
          AND dc.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
          AND dc.verification_status='VALID' AND dc.last_verified_at>=now()-($1::int*interval '1 day')
          AND NOT EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id
            AND sx.lifted_at IS NULL AND sx.decision_maker_contact_id=dc.id)) active_valid_email_route_count,
      EXISTS(SELECT 1 FROM leadgen.contact_suppressions sx WHERE sx.company_id=c.id AND sx.lifted_at IS NULL) contact_suppressed
    FROM current_match cpm JOIN leadgen.companies c ON c.id=cpm.company_id
    JOIN leadgen.buyer_business_model_results bbm ON bbm.id=cpm.buyer_business_model_result_id
    LEFT JOIN leadgen.product_opportunity_results po ON po.category_procurement_match_result_id=cpm.id
    JOIN leadgen.cooperation_feasibility_results f ON f.category_procurement_match_result_id=cpm.id
    LEFT JOIN leadgen.business_opportunity_current bod ON bod.company_id=cpm.company_id AND bod.product_profile=cpm.product_profile
    ORDER BY c.company_name,cpm.product_profile`,[Math.max(1,Number(ttlDays)||7)])).rows;
    const ids=base.map(row=>row.id),companies=[...new Set(base.map(row=>row.company_id))];
    const dimensions=ids.length?(await client.query(`SELECT d.*,
      coalesce(array_agg(e.prospect_category_observation_id) FILTER(WHERE e.prospect_category_observation_id IS NOT NULL),'{}'::uuid[]) evidence_ids
      FROM leadgen.category_procurement_match_dimensions d
      LEFT JOIN leadgen.category_procurement_match_evidence e ON e.category_procurement_match_dimension_id=d.id
      WHERE d.category_procurement_match_result_id=ANY($1::uuid[]) GROUP BY d.id`,[ids])).rows:[];
    const observations=companies.length?(await client.query(`SELECT * FROM leadgen.prospect_category_observations
      WHERE company_id=ANY($1::uuid[]) AND verification_status='VERIFIED' AND source_authority<>'SEARCH_DISCOVERY'
      ORDER BY company_id,captured_at DESC,id`,[companies])).rows:[];
    const report=[];
    for(const row of base){
      const rowDimensions=Object.fromEntries(dimensions.filter(item=>item.category_procurement_match_result_id===row.id)
        .map(item=>[dimensionKey(item.dimension),{state:item.state,points:item.points,maximum:item.maximum,
          evidence_ids:item.evidence_ids,reason_codes:item.reason_codes}]));
      const rowObservations=observations.filter(item=>item.company_id===row.company_id);
      const profileScopes=scope.scopes.filter(item=>item.product_profile===row.product_profile);
      const newCategory=calculateCategoryProcurementMatch({product_profile:row.product_profile,buyer_model:row.buyer_model,
        dimensions:rowDimensions,scope_revision:scope.revision,approved_category_scopes:profileScopes,
        category_scope_aliases:scope.aliases,observed_customer_categories:rowObservations,observations:rowObservations});
      const productOpportunity=calculateProductOpportunity({category_procurement_match:{...newCategory,id:row.id,product_profile:row.product_profile}});
      const supplierRouteClosed=(row.barrier_signals||[]).map(upper).some(code=>
        ['SUPPLIER_ROUTE_CLOSED','SUPPLIER_APPLICATION_CLOSED','DOES_NOT_ACCEPT_NEW_SUPPLIERS'].includes(code));
      const cooperation=resolveReadinessV3({relationship_status:row.relationship_status,buyer_model:row.buyer_model,
        category_procurement_match_status:newCategory.match_status,category_procurement_match_score:newCategory.score,
        category_procurement_coverage:newCategory.coverage_percent,has_verified_decision_route:row.verified_buyer_role_count>0,
        has_current_valid_contact_route:row.active_valid_email_route_count>0,company_verified_active:row.verification_status==='VERIFIED'&&row.lifecycle_status==='ACTIVE',
        eligible_target_organization:!row.explicit_exclusion_reason,has_traceable_evidence:rowObservations.length>0,
        supplier_access_band:row.supplier_access_band,
        supplier_route_closed:supplierRouteClosed,supplier_route_status:supplierRouteClosed?'CLOSED':'UNKNOWN'});
      const newDecision=deriveOpportunityDecision({company:{verification_status:row.verification_status,lifecycle_status:row.lifecycle_status,
        replaced_by_company_id:row.replaced_by_company_id},buyer:{buyer_model:row.buyer_model,eligibility_status:row.eligibility_status},
        category:newCategory,cooperation:{...cooperation,relationship_status:row.relationship_status},relationship_status:row.relationship_status,
        company_suppressed:row.company_suppressed,confirmed_existing_customer:row.confirmed_existing_customer,
        procurement_resale_evidence:row.procurement_resale_evidence,profile_relevant_buyer_count:row.profile_relevant_buyer_count,
        verified_buyer_role_count:row.verified_buyer_role_count,active_valid_email_route_count:row.active_valid_email_route_count,
        contact_suppressed:row.contact_suppressed,identity_conflict:Boolean(row.explicit_exclusion_reason)});
      report.push(buildPhase10RuleDryRun({company_id:row.company_id,product_profile:row.product_profile,
        old_category_result:{match_status:row.match_status},new_category_result:newCategory,
        old_decision:{business_fit_status:row.old_business_fit,contact_readiness:row.old_contact_readiness},
        new_decision:newDecision,product_opportunity:productOpportunity}));
    }
    await client.query('COMMIT');
    return report;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

if(process.argv.includes('--run')){
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD});
  try{console.log(JSON.stringify(await buildPhase10CurrentOpportunityDryRun({pool}),null,2));}finally{await pool.end();}
}
