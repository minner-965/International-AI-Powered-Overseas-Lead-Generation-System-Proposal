const BUYER_ROLES = Object.freeze([
  'BUYER', 'SENIOR_BUYER', 'HEAD_OF_BUYING', 'PURCHASING', 'PROCUREMENT',
  'CATEGORY_MANAGEMENT', 'MERCHANDISING', 'SOURCING', 'BUYING_DEPARTMENT', 'PROCUREMENT_DEPARTMENT'
]);

const upper = value => String(value ?? '').trim().toUpperCase();

async function setCategoryJobStatus(pool, jobId, status, { complete = false, error = null } = {}) {
  await pool.query(`UPDATE leadgen.research_jobs SET status=$2,
    started_at=coalesce(started_at,now()),completed_at=CASE WHEN $3 THEN now() ELSE NULL END,
    last_error=CASE WHEN $4::text IS NULL THEN last_error ELSE left($4,500) END
    WHERE id=$1 AND job_type='CATEGORY_PROCUREMENT_ENRICHMENT'`, [jobId, status, complete, error]);
}

async function markContactJobRetryable(pool, jobId, blocker) {
  await pool.query(`UPDATE leadgen.research_jobs SET status='FAILED',completed_at=now(),
    last_error=left($2,500),stop_reason_code=$2
    WHERE id=$1 AND job_type IN ('DECISION_MAKER_ENRICHMENT','REAL_OPPORTUNITY_RESEARCH')`, [jobId, blocker]);
}

async function latestContactEvidence(pool, task) {
  const result = await pool.query(`SELECT dm.id decision_maker_id,dc.id decision_maker_contact_id,
    dc.verification_status,cv.id contact_verification_event_id,cv.provider_usage_event_id
    FROM leadgen.decision_makers dm
    JOIN leadgen.decision_maker_product_relevance pr
      ON pr.decision_maker_id=dm.id AND pr.product_profile=$2 AND pr.relevance IN ('HIGH','MEDIUM')
    LEFT JOIN LATERAL (
      SELECT x.* FROM leadgen.decision_maker_contacts x
      WHERE x.decision_maker_id=dm.id
        AND x.contact_type IN ('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL')
      ORDER BY x.last_verified_at DESC NULLS LAST,x.updated_at DESC,x.id DESC LIMIT 1
    ) dc ON true
    LEFT JOIN LATERAL (
      SELECT x.* FROM leadgen.contact_verification_events x
      WHERE x.decision_maker_contact_id=dc.id
      ORDER BY x.verified_at DESC,x.id DESC LIMIT 1
    ) cv ON true
    WHERE dm.company_id=$1 AND dm.person_name IS NOT NULL
      AND dm.verification_status='VERIFIED' AND dm.lifecycle_status='ACTIVE'
      AND dm.normalized_role=ANY($3::text[])
    ORDER BY CASE dc.verification_status WHEN 'VALID' THEN 0 WHEN 'ACCEPT_ALL' THEN 1
      WHEN 'UNKNOWN' THEN 2 WHEN 'TEMPORARY_ERROR' THEN 3 WHEN 'INVALID' THEN 4 ELSE 5 END,
      dm.last_verified_at DESC NULLS LAST,dm.id DESC LIMIT 1`, [task.company_id, task.product_profile, BUYER_ROLES]);
  return result.rows[0] || null;
}

async function latestCategoryMatch(pool, task) {
  const result = await pool.query(`SELECT id,match_status,match_basis FROM leadgen.category_procurement_match_results
    WHERE company_id=$1 AND product_profile=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [
    task.company_id, task.product_profile
  ]);
  return result.rows[0] || null;
}

async function latestCategoryEvidence(pool, task, researchJobId) {
  const result=await pool.query(`SELECT
    (SELECT s.id FROM leadgen.prospect_category_sources s
      WHERE s.research_job_id=$1 AND s.company_id=$2 ORDER BY s.captured_at DESC,s.id DESC LIMIT 1) prospect_category_source_id,
    (SELECT o.id FROM leadgen.prospect_category_observations o
      WHERE o.research_job_id=$1 AND o.company_id=$2 AND o.normalized_profile=$3
      ORDER BY o.captured_at DESC,o.id DESC LIMIT 1) prospect_category_observation_id,
    (SELECT p.id FROM leadgen.provider_usage_events p
      WHERE p.research_job_id=$1 AND p.company_id=$2 ORDER BY p.created_at DESC,p.id DESC LIMIT 1) provider_usage_event_id`,[
    researchJobId,task.company_id,task.product_profile
  ]);
  return result.rows[0]||{};
}

async function latestDecision(pool, task) {
  const result = await pool.query(`SELECT id,business_fit_status,system_recommendation_status,contact_readiness,
    display_opportunity_status,reason_codes FROM leadgen.business_opportunity_current
    WHERE company_id=$1 AND product_profile=$2`, [task.company_id, task.product_profile]);
  return result.rows[0] || null;
}

async function evidenceCounts(pool,task){
  const result=await pool.query(`SELECT
    (SELECT count(DISTINCT source_url)::int FROM leadgen.prospect_category_sources WHERE company_id=$1) url_count,
    (SELECT count(*)::int FROM leadgen.prospect_category_observations
      WHERE company_id=$1 AND normalized_profile=$2 AND verification_status='VERIFIED') usable_evidence_count,
    (SELECT count(DISTINCT d.id)::int FROM leadgen.decision_makers d
      WHERE d.company_id=$1 AND d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE') named_buyer_candidate_count,
    (SELECT count(DISTINCT dc.id)::int FROM leadgen.decision_makers d
      JOIN leadgen.decision_maker_product_relevance pr ON pr.decision_maker_id=d.id
        AND pr.product_profile=$2 AND pr.relevance IN ('HIGH','MEDIUM')
      JOIN leadgen.decision_maker_contacts dc ON dc.decision_maker_id=d.id AND dc.verification_status='VALID'
      WHERE d.company_id=$1 AND d.person_name IS NOT NULL AND d.lifecycle_status='ACTIVE') valid_contact_count`,
    [task.company_id,task.product_profile]);
  return result.rows[0]||{url_count:0,usable_evidence_count:0,named_buyer_candidate_count:0,valid_contact_count:0};
}

const metricDelta=(before,after)=>({
  new_url_count:Math.max(0,Number(after.url_count||0)-Number(before.url_count||0)),
  usable_evidence_count:Math.max(0,Number(after.usable_evidence_count||0)-Number(before.usable_evidence_count||0)),
  named_buyer_candidate_count:Math.max(0,Number(after.named_buyer_candidate_count||0)-Number(before.named_buyer_candidate_count||0)),
  valid_contact_count:Math.max(0,Number(after.valid_contact_count||0)-Number(before.valid_contact_count||0))
});

export function createAutoEvidenceExecutors({
  pool,
  categoryEvidenceService,
  categoryProcurementService,
  enrichmentService,
  phase7Repository,
  tavilyEnabled = true,
  hunterEnabled = true,
  sourceTtlDays = 90,
  contactVerificationTtlDays = 30
} = {}) {
  if (!pool || !categoryEvidenceService || !categoryProcurementService || !enrichmentService || !phase7Repository) {
    throw new TypeError('Auto-evidence executors require the existing evidence, enrichment and decision services');
  }
  return Object.freeze({
    async discover_opportunity_evidence({ task, research_job_id,strategy }) {
      await setCategoryJobStatus(pool, research_job_id, 'CRAWLING');
      try {
        const before=await evidenceCounts(pool,task);
        const result = await categoryEvidenceService.collect({
          researchJobId: research_job_id,
          companyId: task.company_id,
          productProfile: task.product_profile,
          tavilyEnabled,
          reuseFreshEvidence:!strategy,
          sourceTtlDays,
          strategy
        });
        const metrics=metricDelta(before,await evidenceCounts(pool,task));
        const references=result.reused_fresh_evidence?{
          prospect_category_source_id:result.prospect_category_source_id||null,
          prospect_category_observation_id:result.prospect_category_observation_id||null,
          provider_usage_event_id:null
        }:await latestCategoryEvidence(pool,task,research_job_id);
        await setCategoryJobStatus(pool, research_job_id, 'QUALIFYING');
        if (Number(result.search_failures || 0) > 0
          && Number(result.sources ?? result.source_count ?? result.sources_found ?? 0) === 0) {
          return { outcome_status: 'TEMPORARY_ERROR', research_job_id, ...references,...metrics,
            technical_blocker: 'SOURCE_PROVIDER_TEMPORARY_ERROR' };
        }
        const found=Object.values(metrics).some(value=>Number(value)>0);
        return { outcome_status: strategy?(found?'NEW_EVIDENCE_FOUND':'NO_NEW_EVIDENCE'):'COMPLETED', research_job_id, ...references,...metrics,
          reused_fresh_evidence:result.reused_fresh_evidence===true };
      } catch (error) {
        if(['TAVILY_CREDIT_CAP','PROVIDER_CREDIT_EXHAUSTED'].includes(error?.code)) {
          await setCategoryJobStatus(pool,research_job_id,'PARTIAL',{error:error.code});
          return {outcome_status:'PROVIDER_CAPACITY_WAIT',research_job_id,technical_blocker:error.code};
        }
        await setCategoryJobStatus(pool, research_job_id, 'FAILED', { complete: true, error: error?.code || error?.message });
        throw error;
      }
    },

    async normalize_opportunity_category({ task, research_job_id }) {
      const result = await categoryProcurementService.classifyBuyerAndPersist({
        researchJobId: research_job_id,
        companyId: task.company_id,
        productProfile: task.product_profile,
        executionKey: `${task.execution_key}:${task.current_strategy_code||'legacy'}`
      });
      await setCategoryJobStatus(pool, research_job_id, 'SCORING');
      return {
        outcome_status: 'COMPLETED',
        research_job_id,
        buyer_business_model_result_id: result.id
      };
    },

    async refresh_category_scope_match({ task, research_job_id }) {
      const result = await categoryProcurementService.calculateAndPersist({
        researchJobId: research_job_id,
        companyId: task.company_id,
        productProfile: task.product_profile,
        executionKey: `${task.execution_key}:${task.current_strategy_code||'legacy'}`
      });
      const commercialFit = await categoryProcurementService.calculateCommercialFitAndPersist({
        researchJobId: research_job_id,
        companyId: task.company_id,
        productProfile: task.product_profile,
        executionKey: `${task.execution_key}:${task.current_strategy_code||'legacy'}`,
        categoryProcurementMatchResultId: result.category_procurement_match_result_id
      });
      await setCategoryJobStatus(pool, research_job_id, 'COMPLETED', { complete: true });
      return {
        outcome_status: 'COMPLETED',
        research_job_id,
        buyer_business_model_result_id: result.buyer_business_model_result_id,
        category_procurement_match_result_id: result.category_procurement_match_result_id,
        product_opportunity_result_id: result.product_opportunity_result_id,
        cooperation_feasibility_result_id: result.cooperation_result_id,
        commercial_product_fit_result_id: commercialFit.commercial_product_fit_result_id
      };
    },

    async find_profile_buyer({ task, research_job_id,strategy }) {
      const category = await latestCategoryMatch(pool, task);
      if (category?.match_status !== 'CATEGORY_PROCUREMENT_MATCH') {
        return { outcome_status: 'COMPLETED', research_job_id,
          category_procurement_match_result_id: category?.id || null, buyer_search_skipped: true };
      }
      const before=await evidenceCounts(pool,task);
      if(strategy)await markContactJobRetryable(pool,research_job_id,`STRATEGY_${strategy.code}`);
      const result = await enrichmentService.runJob(research_job_id,{tavilyEnabled,hunterEnabled,...(strategy?{strategy}:{})});
      if (['HUNTER_BUDGET_CAP','TAVILY_CREDIT_CAP','PROVIDER_CREDIT_EXHAUSTED'].includes(result.stop_reason)) {
        return { outcome_status: 'PROVIDER_CAPACITY_WAIT', research_job_id, technical_blocker: result.stop_reason };
      }
      if (['PROVIDER_TEMPORARY_ERROR_THRESHOLD','HUNTER_BUSINESS_RESULT_LOOKUP_REQUIRED'].includes(result.stop_reason) || result.status === 'FAILED') {
        if (['PROVIDER_TEMPORARY_ERROR_THRESHOLD','HUNTER_BUSINESS_RESULT_LOOKUP_REQUIRED'].includes(result.stop_reason)) {
          await markContactJobRetryable(pool,research_job_id,result.stop_reason);
        }
        return { outcome_status: 'TEMPORARY_ERROR', research_job_id, technical_blocker: 'CONTACT_PROVIDER_TEMPORARY_ERROR' };
      }
      const contact=await latestContactEvidence(pool,task);
      const metrics=metricDelta(before,await evidenceCounts(pool,task));
      const found=Object.values(metrics).some(value=>Number(value)>0);
      return { outcome_status: strategy?(found?'NEW_EVIDENCE_FOUND':'NO_NEW_EVIDENCE'):'COMPLETED', research_job_id,...metrics,
        decision_maker_id:contact?.decision_maker_id||null,
        decision_maker_contact_id:contact?.decision_maker_contact_id||null,
        contact_verification_event_id:contact?.contact_verification_event_id||null,
        provider_usage_event_id:contact?.provider_usage_event_id||null };
    },

    async verify_profile_buyer_email({ task, research_job_id }) {
      const contact = await latestContactEvidence(pool, task);
      if (!contact) return { outcome_status: 'COMPLETED', research_job_id };
      const status = upper(contact.verification_status);
      if (status === 'TEMPORARY_ERROR') {
        return { outcome_status: 'TEMPORARY_ERROR', research_job_id,
          decision_maker_id: contact.decision_maker_id,
          decision_maker_contact_id: contact.decision_maker_contact_id,
          contact_verification_event_id: contact.contact_verification_event_id,
          provider_usage_event_id: contact.provider_usage_event_id,
          technical_blocker: 'EMAIL_VERIFICATION_TEMPORARY_ERROR' };
      }
      if (['ACCEPT_ALL', 'UNKNOWN'].includes(status)) {
        await phase7Repository.refreshOpportunityDecisions({ ttlDays: Number(contactVerificationTtlDays) || 30 });
        return { outcome_status: 'HUMAN_REVIEW_REQUIRED', research_job_id,
          decision_maker_id: contact.decision_maker_id,
          decision_maker_contact_id: contact.decision_maker_contact_id,
          contact_verification_event_id: contact.contact_verification_event_id,
          provider_usage_event_id: contact.provider_usage_event_id,
          technical_blocker: `EMAIL_${status}` };
      }
      return { outcome_status: 'COMPLETED', research_job_id,
        decision_maker_id: contact.decision_maker_id,
        decision_maker_contact_id: contact.decision_maker_contact_id,
        contact_verification_event_id: contact.contact_verification_event_id,
        provider_usage_event_id: contact.provider_usage_event_id };
    },

    async refresh_business_opportunity_v3({ task, research_job_id }) {
      await phase7Repository.refreshOpportunityDecisions({ ttlDays: Number(contactVerificationTtlDays) || 30 });
      const [decision, contact] = await Promise.all([latestDecision(pool, task), latestContactEvidence(pool, task)]);
      const result = {
        research_job_id,
        business_opportunity_decision_snapshot_id: decision?.id || null,
        decision_maker_id: contact?.decision_maker_id || null,
        decision_maker_contact_id: contact?.decision_maker_contact_id || null,
        contact_verification_event_id: contact?.contact_verification_event_id || null,
        provider_usage_event_id: contact?.provider_usage_event_id || null
      };
      if (decision?.system_recommendation_status === 'RECOMMENDED'
        && decision?.business_fit_status === 'FIT' && decision?.contact_readiness === 'READY') {
        return { ...result, outcome_status: 'COMPLETED' };
      }
      return { ...result, outcome_status: 'NO_NEW_EVIDENCE' };
    }
  });
}

export {
  latestContactEvidence,
  latestCategoryMatch,
  latestCategoryEvidence,
  latestDecision,
  markContactJobRetryable
};
