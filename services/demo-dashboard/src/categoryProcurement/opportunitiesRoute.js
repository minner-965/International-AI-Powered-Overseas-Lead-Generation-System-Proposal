import {confirmedCategoryStatusSql} from './categoryAdmission.js';

const upper=value=>String(value||'').trim().toUpperCase();

function matchBandClause(column,value){
  const band=upper(value);
  if(band==='HIGH')return `${column}>=60`;
  if(band==='MEDIUM')return `${column}>=35 AND ${column}<60`;
  if(band==='LOW')return `${column}<35`;
  if(band==='UNKNOWN')return `${column} IS NULL`;
  return '';
}

export async function queryCategoryProcurementOpportunities({
  pool,query={},publicDataOriginSql,companyMarketVisibleSql,excludesConfirmedExistingCustomerSql
}={}){
  const params=[];
  const clauses=[`c.data_origin IN (${publicDataOriginSql})`,companyMarketVisibleSql('c'),
    "c.verification_status='VERIFIED'","c.lifecycle_status='ACTIVE'",'c.explicit_exclusion_reason IS NULL',
    excludesConfirmedExistingCustomerSql('c'),'bod.id IS NOT NULL',
    confirmedCategoryStatusSql('cpm.match_status'),
    "coalesce(routes.route_types,'{}'::text[])&&ARRAY['BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL','BUSINESS_PHONE','BUSINESS_WHATSAPP','CONTACT_FORM']::text[]",
    "bod.display_opportunity_status IN('RECOMMENDED','MANAGEMENT_APPROVED','HOLD')"];
  const add=(value,clause)=>{params.push(value);clauses.push(clause(params.length));};
  if(query.country)add(upper(query.country),index=>`c.country_code=$${index}`);
  if(query.tier)add(upper(query.tier),index=>`coalesce(sr.tier,lr.tier)=$${index}`);
  if(query.size)add(upper(query.size),index=>`upper(coalesce(v.company_size,c.company_size_band,'UNKNOWN'))=$${index}`);
  if(query.score_eligibility)add(upper(query.score_eligibility),index=>`sr.score_eligibility=$${index}`);
  if(query.opportunity_matrix)add(upper(query.opportunity_matrix),index=>`mr.opportunity_matrix=$${index}`);
  if(query.product_profile)add(upper(query.product_profile),index=>`cpm.product_profile=$${index}`);
  if(query.buyer_business_model)add(upper(query.buyer_business_model),index=>`bbm.buyer_model=$${index}`);
  if(query.buyer_subtype)add(upper(query.buyer_subtype),index=>`bbm.buyer_subtype=$${index}`);
  if(query.category_procurement_match_band)add(upper(query.category_procurement_match_band),index=>`cpm.band=$${index}`);
  if(query.category_procurement_match_status){
    const requested=upper(query.category_procurement_match_status);
    if(requested==='CATEGORY_MATCH_CONFIRMED')clauses.push("cpm.match_status IN('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE')");
    else if(requested==='CATEGORY_CONFIRMATION_REQUIRED')clauses.push("cpm.match_status IN('CATEGORY_CONFIRMATION_REQUIRED','NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE')");
    else add(requested,index=>`cpm.match_status=$${index}`);
  }
  if(query.product_access_matrix)add(upper(query.product_access_matrix),index=>`f.product_access_matrix=$${index}`);
  if(query.readiness)add(upper(query.readiness),index=>`f.opportunity_readiness=$${index}`);
  if(query.historical_crm_status)add(upper(query.historical_crm_status),index=>`f.relationship_status=$${index}`);
  if(query.cooperation_matrix)add(upper(query.cooperation_matrix),index=>`f.access_opportunity_matrix=$${index}`);
  if(query.feasibility_band)add(upper(query.feasibility_band),index=>`f.feasibility_band=$${index}`);
  if(query.decision_maker_status)add(upper(query.decision_maker_status),index=>`dm.verification_status=$${index}`);
  if(query.normalized_role)add(upper(query.normalized_role),index=>`dm.normalized_role=$${index}`);
  if(query.contact_type)add(upper(query.contact_type),index=>`bc.contact_type=$${index}`);
  if(query.contact_verification)add(upper(query.contact_verification),index=>`bc.verification_status=$${index}`);
  const opportunityStatus=upper(query.status);
  if (opportunityStatus && opportunityStatus !== 'ALL') {
    if (!['RECOMMENDED','MANAGEMENT_APPROVED','EVIDENCE_REQUIRED','HOLD','NOT_SUITABLE'].includes(opportunityStatus)) {
      const error=new Error('Invalid opportunity status');error.code='OPPORTUNITY_STATUS_INVALID';error.status=400;throw error;
    }
    add(opportunityStatus,index=>`bod.display_opportunity_status=$${index}`);
  }
  const managementBand=matchBandClause('mr.match_score',query.management_match_band);
  const historicalBand=matchBandClause('hmr.match_score',query.historical_match_band);
  if(managementBand)clauses.push(managementBand);
  if(historicalBand)clauses.push(historicalBand);

  const defaultOrder=`CASE WHEN cpm.match_status IN('CATEGORY_MATCH_CONFIRMED','CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE') THEN 1 ELSE 2 END,
    CASE bbm.buyer_model WHEN 'DIRECT_END_BUYER' THEN 1 WHEN 'DISTRIBUTION_BUYER' THEN 2 WHEN 'UNCLEAR_INTERMEDIARY' THEN 3 WHEN 'UNKNOWN' THEN 4 ELSE 5 END,
    CASE cpm.band WHEN 'VERY_HIGH' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 WHEN 'VERY_LOW' THEN 5 ELSE 6 END,
    cpm.score DESC NULLS LAST,cpm.coverage_percent DESC,
    CASE dm.role_relevance WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
    CASE bc.verification_status WHEN 'VALID' THEN 1 WHEN 'PUBLICLY_OBSERVED' THEN 2 WHEN 'FORMAT_VALID' THEN 3 WHEN 'NOT_VERIFIED' THEN 4 ELSE 5 END,
    CASE f.supplier_access_band WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW_MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
    CASE f.product_access_matrix
      WHEN 'DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS' THEN 1 WHEN 'DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS' THEN 2
      WHEN 'DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS' THEN 3 WHEN 'DISTRIBUTION_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS' THEN 4
      WHEN 'DIRECT_BUYER_HIGH_PRODUCT_LOW_ACCESS' THEN 5 WHEN 'DISTRIBUTION_BUYER_HIGH_PRODUCT_LOW_ACCESS' THEN 6
      WHEN 'MEDIUM_PRODUCT_HIGH_ACCESS' THEN 7 WHEN 'MEDIUM_PRODUCT_MEDIUM_ACCESS' THEN 8 WHEN 'LOW_PRODUCT' THEN 9 ELSE 10 END,
    mr.match_score DESC NULLS LAST,hmr.match_score DESC NULLS LAST,sr.final_score DESC NULLS LAST,
    coalesce(cpm.created_at,f.calculated_at) DESC NULLS LAST,c.company_name,cpm.product_profile`;
  const sort=String(query.sort||'category_procurement_desc');
  const orderBy=sort==='score_desc'?`sr.final_score DESC NULLS LAST,${defaultOrder}`
    :sort==='match_desc'?`mr.match_score DESC NULLS LAST,hmr.match_score DESC NULLS LAST,${defaultOrder}`
      :sort==='feasibility_desc'?`f.cooperation_feasibility_score DESC NULLS LAST,${defaultOrder}`
        :sort==='name_asc'?'c.company_name,cpm.product_profile':defaultOrder;
  const limit=Math.max(1,Math.min(500,Number(query.limit||200)));params.push(limit);

  const result=await pool.query(`SELECT
    concat(cpm.company_id::text,':',cpm.product_profile) opportunity_key,
    c.id,c.id company_id,c.company_name,c.country_code,c.city,c.website_url,c.data_origin,c.research_job_id,
    c.verification_status,c.lifecycle_status,c.last_verified_at,c.verification_source_count,c.verification_freshness,
    c.explicit_exclusion_reason,ARRAY[cpm.product_profile] product_profiles,
    coalesce(v.company_size,upper(c.company_size_band),'UNKNOWN') company_size,
    v.sme_relevance,v.partnership_accessibility,v.verification_status phase4_verification_status,
    v.importer_status,v.wholesaler_status,v.distributor_status,v.general_trading_status,
    coalesce(sr.final_score,lr.lead_score) dpv_score,coalesce(sr.tier,lr.tier) tier,
    sr.qualification_status,sr.score_eligibility,sr.evidence_coverage score_coverage,sr.rule_version,sr.calculated_at scored_at,
    mr.match_score customer_match,mr.coverage_percent customer_match_coverage,mr.display_status customer_match_status,
    mr.opportunity_matrix,mr.profile_version,mr.calculated_at matched_at,
    hmr.match_score historical_customer_match,hmr.coverage_percent historical_match_coverage,
    hmr.display_status historical_match_status,hmr.profile_version historical_profile_version,hmr.calculated_at historical_matched_at,
    cpm.id category_procurement_match_result_id,cpm.product_profile,
    bod.id opportunity_decision_id,bod.display_opportunity_status,bod.system_recommendation_status,bod.business_fit_status,
    bod.contact_readiness,bod.policy_contact_status,bod.reason_codes opportunity_decision_reason_codes,
    bod.latest_management_event_id,bod.management_contact_status,bod.created_at opportunity_decision_assessed_at,
    cpm.score category_procurement_match_score,cpm.band category_procurement_match_band,
    CASE
      WHEN cpm.match_status IN('CATEGORY_PROCUREMENT_MATCH','CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE') THEN 'CATEGORY_MATCH_CONFIRMED'
      WHEN cpm.match_status IN('NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE') THEN 'CATEGORY_CONFIRMATION_REQUIRED'
      WHEN cpm.match_status='PRODUCT_MISMATCH' THEN 'CATEGORY_MISMATCH'
      ELSE cpm.match_status
    END category_procurement_match_status,cpm.coverage_percent category_procurement_coverage,
    cpm.scope_revision_id,cpm.match_basis,cpm.similarity_rule,cpm.matched_scope_ids,
    cpm.observed_customer_category_ids,cpm.catalog_completeness_non_blocking,
    scope_revision.revision scope_revision,
    coalesce(matched_scope.scopes,'{}'::text[]) matched_scopes,
    coalesce(observed_scope.categories,cpm.observed_categories,'{}'::text[]) observed_customer_categories,
    bbm.buyer_model buyer_business_model,bbm.buyer_subtype,bbm.eligibility_status buyer_eligibility_status,
    bbm.confidence_band buyer_confidence_band,cpm.observed_categories,
    f.cooperation_feasibility_score,f.feasibility_band,f.access_opportunity_matrix cooperation_matrix,
    coalesce(f.supplier_access_band,'UNKNOWN') supplier_access_band,coalesce(f.supplier_access_coverage,0) supplier_access_coverage,
    coalesce(f.product_access_matrix,'UNKNOWN_PRODUCT') product_access_matrix,
    coalesce(f.opportunity_readiness,cpm.match_status) readiness,coalesce(f.readiness_blockers,'{}') readiness_blockers,
    f.relationship_status historical_crm_status,f.barrier_signals,f.missing_evidence,
    f.supplier_route_count,f.calculated_at feasibility_calculated_at,
    dm.id decision_maker_id,dm.person_name buyer_name,dm.department_name buyer_department,
    dm.raw_title buyer_raw_title,dm.normalized_role,dm.role_relevance,dm.verification_status decision_maker_status,
    dm.last_verified_at decision_maker_last_verified_at,
    bc.contact_type best_contact_type,bc.contact_value_raw best_contact,bc.verification_status contact_verification,
    bc.source_url contact_source_url,portal.contact_type supplier_route_type,portal.contact_value_raw supplier_portal_url,
    coalesce(routes.route_types,'{}'::text[]) official_route_types,
    routes.official_email_route,routes.official_phone_route,routes.official_whatsapp_route,
    routes.official_form_route,routes.supplier_vendor_route,routes.latest_route_verified_at,
    category_evidence.evidence_url category_evidence_url,category_evidence.latest_evidence_time,
    auto_task.id auto_evidence_task_id,auto_task.task_status auto_evidence_status,
    auto_task.current_stage auto_evidence_stage,auto_task.category_research_job_id auto_category_research_job_id,
    auto_task.contact_research_job_id auto_contact_research_job_id,
    (auto_task.task_status='HUMAN_REVIEW_REQUIRED') human_review_required,
    CASE WHEN auto_task.task_status='HUMAN_REVIEW_REQUIRED' THEN 'HUMAN_REVIEW' ELSE 'AUTO_ENRICHMENT' END task_class,
    EXISTS(SELECT 1 FROM leadgen.contacts ct WHERE ct.company_id=c.id AND ct.lifecycle_status='ACTIVE'
      AND(ct.business_email IS NOT NULL OR ct.business_phone IS NOT NULL)) contactable
    FROM leadgen.companies c
    JOIN LATERAL(SELECT x.* FROM leadgen.category_procurement_match_results x WHERE x.company_id=c.id
      AND NOT EXISTS(SELECT 1 FROM leadgen.category_procurement_match_results newer WHERE newer.company_id=x.company_id
        AND newer.product_profile=x.product_profile AND(newer.created_at,newer.id)>(x.created_at,x.id))
      ORDER BY x.product_profile)cpm ON true
    JOIN leadgen.buyer_business_model_results bbm ON bbm.id=cpm.buyer_business_model_result_id
    LEFT JOIN leadgen.business_opportunity_current bod ON bod.company_id=c.id AND bod.product_profile=cpm.product_profile
    LEFT JOIN leadgen.dpv_product_category_scope_revisions scope_revision ON scope_revision.id=cpm.scope_revision_id
    LEFT JOIN LATERAL(SELECT array_agg(s.normalized_category ORDER BY s.normalized_category) scopes
      FROM leadgen.dpv_product_category_scopes s WHERE s.id=ANY(cpm.matched_scope_ids))matched_scope ON true
    LEFT JOIN LATERAL(SELECT array_agg(o.normalized_category ORDER BY o.normalized_category) categories
      FROM leadgen.prospect_category_observations o WHERE o.id=ANY(cpm.observed_customer_category_ids))observed_scope ON true
    LEFT JOIN leadgen.cooperation_feasibility_results f ON f.category_procurement_match_result_id=cpm.id
    LEFT JOIN leadgen.lead_reviews lr ON lr.company_id=c.id
    LEFT JOIN LATERAL(SELECT * FROM leadgen.research_candidate_verifications vx WHERE vx.company_id=c.id
      ORDER BY vx.verified_at DESC NULLS LAST,vx.updated_at DESC LIMIT 1)v ON true
    LEFT JOIN LATERAL(SELECT * FROM leadgen.company_score_runs sx WHERE sx.company_id=c.id
      ORDER BY sx.calculated_at DESC,sx.id DESC LIMIT 1)sr ON true
    LEFT JOIN LATERAL(SELECT mx.* FROM leadgen.customer_match_results mx JOIN leadgen.icp_profiles ip ON ip.id=mx.reference_profile_id
      WHERE mx.company_id=c.id AND mx.reference_profile_type='MANAGEMENT_BASELINE'
        AND(cardinality(ip.product_scope)=0 OR cpm.product_profile=ANY(ip.product_scope))
      ORDER BY mx.calculated_at DESC,mx.id DESC LIMIT 1)mr ON true
    LEFT JOIN LATERAL(SELECT hx.* FROM leadgen.customer_match_results hx JOIN leadgen.icp_profiles ip ON ip.id=hx.reference_profile_id
      WHERE hx.company_id=c.id AND hx.reference_profile_type='HISTORICAL_CUSTOMER_ICP'
        AND(cardinality(ip.product_scope)=0 OR cpm.product_profile=ANY(ip.product_scope))
      ORDER BY hx.calculated_at DESC,hx.id DESC LIMIT 1)hmr ON true
    LEFT JOIN LATERAL(SELECT dx.* FROM leadgen.decision_makers dx
      LEFT JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=dx.id AND pr.product_profile=cpm.product_profile
      WHERE dx.company_id=c.id AND dx.lifecycle_status='ACTIVE'
      ORDER BY(dx.verification_status='VERIFIED')DESC,CASE pr.relevance WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
        (dx.person_name IS NOT NULL)DESC,dx.updated_at DESC LIMIT 1)dm ON true
    LEFT JOIN LATERAL(SELECT cx.* FROM leadgen.decision_maker_contacts cx
      JOIN leadgen.decision_makers contact_owner ON contact_owner.id=cx.decision_maker_id
      WHERE contact_owner.company_id=c.id AND contact_owner.lifecycle_status='ACTIVE'
      ORDER BY CASE cx.verification_status WHEN 'VALID' THEN 1 WHEN 'BUSINESS_WHATSAPP_OBSERVED' THEN 2
        WHEN 'FORMAT_VALID' THEN 3 WHEN 'PUBLICLY_OBSERVED' THEN 4 WHEN 'NOT_VERIFIED' THEN 5 ELSE 6 END,
        CASE cx.contact_type WHEN 'DEPARTMENT_EMAIL' THEN 1 WHEN 'BUSINESS_EMAIL' THEN 2
        WHEN 'GENERIC_BUSINESS_EMAIL' THEN 3 WHEN 'BUSINESS_WHATSAPP' THEN 4 WHEN 'BUSINESS_PHONE' THEN 5
        WHEN 'SUPPLIER_PORTAL' THEN 6 WHEN 'VENDOR_REGISTRATION' THEN 7 ELSE 8 END,
        cx.updated_at DESC LIMIT 1)bc ON true
    LEFT JOIN LATERAL(SELECT px.* FROM leadgen.decision_maker_contacts px JOIN leadgen.decision_makers pd ON pd.id=px.decision_maker_id
      WHERE pd.company_id=c.id AND px.contact_type IN('SUPPLIER_PORTAL','VENDOR_REGISTRATION')
      ORDER BY px.updated_at DESC LIMIT 1)portal ON true
    LEFT JOIN LATERAL(SELECT
      array_agg(DISTINCT cx.contact_type) route_types,
      max(cx.contact_value_raw) FILTER(WHERE cx.contact_type IN('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')) official_email_route,
      max(cx.contact_value_raw) FILTER(WHERE cx.contact_type='BUSINESS_PHONE') official_phone_route,
      max(cx.contact_value_raw) FILTER(WHERE cx.contact_type='BUSINESS_WHATSAPP') official_whatsapp_route,
      max(cx.contact_value_raw) FILTER(WHERE cx.contact_type='CONTACT_FORM') official_form_route,
      max(cx.contact_value_raw) FILTER(WHERE cx.contact_type IN('SUPPLIER_PORTAL','VENDOR_REGISTRATION')) supplier_vendor_route,
      max(cx.last_verified_at) latest_route_verified_at
      FROM leadgen.decision_maker_contacts cx JOIN leadgen.decision_makers owner ON owner.id=cx.decision_maker_id
      WHERE owner.company_id=c.id AND owner.lifecycle_status='ACTIVE' AND cx.source_url IS NOT NULL
        AND cx.verification_status IN('VALID','PUBLICLY_OBSERVED','NOT_VERIFIED','FORMAT_VALID','BUSINESS_WHATSAPP_OBSERVED')
        AND (cx.contact_type<>'CONTACT_FORM' OR cx.contact_value_normalized~*'/(contact([-_]?us)?|support|enquiry|inquiry|supplier|vendor|procurement|register|apply)(/|[?#]|$)'))routes ON true
    LEFT JOIN LATERAL(SELECT max(s.source_url) evidence_url,max(o.captured_at) latest_evidence_time
      FROM leadgen.prospect_category_observations o JOIN leadgen.prospect_category_sources s ON s.id=o.source_id
      WHERE o.id=ANY(cpm.observed_customer_category_ids))category_evidence ON true
    LEFT JOIN LATERAL(SELECT t.* FROM leadgen.auto_evidence_tasks t
      WHERE t.company_id=c.id AND t.product_profile=cpm.product_profile
      ORDER BY t.created_at DESC,t.id DESC LIMIT 1)auto_task ON true
    WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy} LIMIT $${params.length}`,params);
  return result.rows;
}
