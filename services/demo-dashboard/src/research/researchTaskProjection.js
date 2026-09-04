const upper = value => String(value ?? '').trim().toUpperCase();
const list = value => Array.isArray(value) ? value.map(upper).filter(Boolean) : [];

export const RESEARCH_TASK_TYPES = Object.freeze([
  'VERIFY_COMPANY_IDENTITY',
  'COLLECT_CATEGORY_EVIDENCE',
  'VERIFY_BUYER_MODEL',
  'CONFIRM_DISTRIBUTION_RESALE',
  'CONFIRM_SUPPLIER_ACCESS',
  'FIND_PROFILE_BUYER',
  'VERIFY_BUYER_ROLE',
  'FIND_BUSINESS_EMAIL',
  'VERIFY_EMAIL',
  'REVIEW_HISTORY_CONFLICT',
  'REVIEW_SUPPRESSION',
  'RETRY_TEMPORARY_PROVIDER_ERROR'
]);

const TASK_META = Object.freeze({
  VERIFY_COMPANY_IDENTITY:{ blocker:'IDENTITY',owner_role:'DATA_ADMIN',next_action:'OPEN_COMPANY_REVIEW' },
  COLLECT_CATEGORY_EVIDENCE:{ blocker:'PRODUCT',owner_role:'DATA_ADMIN',next_action:'COLLECT_CATEGORY_EVIDENCE' },
  VERIFY_BUYER_MODEL:{ blocker:'BUYER_MODEL',owner_role:'DATA_ADMIN',next_action:'VERIFY_BUYER_MODEL' },
  CONFIRM_DISTRIBUTION_RESALE:{ blocker:'BUYER_MODEL',owner_role:'DATA_ADMIN',next_action:'CONFIRM_DISTRIBUTION_RESALE' },
  CONFIRM_SUPPLIER_ACCESS:{ blocker:'SUPPLIER_ACCESS',owner_role:'DATA_ADMIN',next_action:'REVIEW_SUPPLIER_ACCESS' },
  FIND_PROFILE_BUYER:{ blocker:'CONTACT',owner_role:'SALES',next_action:'FIND_PROFILE_BUYER' },
  VERIFY_BUYER_ROLE:{ blocker:'BUYER_ROLE',owner_role:'DATA_ADMIN',next_action:'VERIFY_PROCUREMENT_RESPONSIBILITY' },
  FIND_BUSINESS_EMAIL:{ blocker:'EMAIL',owner_role:'SALES',next_action:'FIND_BUSINESS_EMAIL' },
  VERIFY_EMAIL:{ blocker:'EMAIL',owner_role:'DATA_ADMIN',next_action:'VERIFY_BUSINESS_EMAIL' },
  REVIEW_HISTORY_CONFLICT:{ blocker:'HISTORY',owner_role:'MANAGEMENT',next_action:'OPEN_COMPANY_REVIEW' },
  REVIEW_SUPPRESSION:{ blocker:'SUPPRESSION',owner_role:'MANAGEMENT',next_action:'OPEN_COMPANY_REVIEW' },
  RETRY_TEMPORARY_PROVIDER_ERROR:{ blocker:'TEMPORARY_ERROR',owner_role:'DATA_ADMIN',next_action:'RETRY_PROVIDER_TASK' }
});

function hasAny(values, accepted) {
  const current = new Set(list(values));
  return accepted.some(value => current.has(value));
}

export function deriveResearchTaskType(row = {}) {
  const reasons = list(row.reason_codes);
  const readiness = list(row.readiness_blockers);
  const emailStatuses = list(row.email_route_statuses);
  const profileBuyers = Number(row.profile_relevant_buyer_count || 0);
  const verifiedRoles = Number(row.verified_buyer_role_count || 0);
  const emailRoutes = Number(row.business_email_route_count || 0);
  const freshValid = Number(row.active_valid_email_route_count || 0);

  if (row.company_suppressed === true || row.contact_suppressed === true || reasons.includes('POLICY_CONTACT_HOLD')) {
    return 'REVIEW_SUPPRESSION';
  }
  if (hasAny(reasons,['COMPANY_IDENTITY_CONFLICT','COMPANY_VERIFICATION_REQUIRED','COMPANY_LIFECYCLE_REVIEW'])) {
    return 'VERIFY_COMPANY_IDENTITY';
  }
  if (hasAny(reasons,['RELATIONSHIP_REVIEW_REQUIRED','EXISTING_CUSTOMER_REVIEW'])) {
    return 'REVIEW_HISTORY_CONFLICT';
  }
  if (emailStatuses.includes('TEMPORARY_ERROR') || reasons.includes('TEMPORARY_PROVIDER_ERROR')) {
    return 'RETRY_TEMPORARY_PROVIDER_ERROR';
  }
  if (hasAny(reasons,['DISTRIBUTION_PROCUREMENT_RESALE_EVIDENCE_REQUIRED'])) return 'CONFIRM_DISTRIBUTION_RESALE';
  if (hasAny(readiness,['NEEDS_SUPPLIER_ACCESS','SUPPLIER_ACCESS_REQUIRED','SUPPLIER_ACCESS_UNKNOWN'])) return 'CONFIRM_SUPPLIER_ACCESS';
  if (hasAny(reasons,['CATEGORY_PROCUREMENT_EVIDENCE_REQUIRED'])) return 'COLLECT_CATEGORY_EVIDENCE';
  if (hasAny(reasons,['BUYER_MODEL_EVIDENCE_REQUIRED'])) return 'VERIFY_BUYER_MODEL';
  if (profileBuyers <= 0 && (reasons.includes('EVIDENCE_REQUIRED_CONTACT') || reasons.includes('EVIDENCE_REQUIRED_BUYER_ROLE'))) {
    return 'FIND_PROFILE_BUYER';
  }
  if (profileBuyers > 0 && verifiedRoles <= 0) return 'VERIFY_BUYER_ROLE';
  if (freshValid <= 0 && emailRoutes > 0 && verifiedRoles > 0) return 'VERIFY_EMAIL';
  if (freshValid <= 0 && profileBuyers > 0 && verifiedRoles > 0) return 'FIND_BUSINESS_EMAIL';
  if (hasAny(reasons,['EVIDENCE_REQUIRED_EMAIL','EVIDENCE_REQUIRED_CONTACT_ROUTE'])) return emailRoutes > 0 ? 'VERIFY_EMAIL' : 'FIND_BUSINESS_EMAIL';
  return 'COLLECT_CATEGORY_EVIDENCE';
}

export function researchTaskPriority(row = {}, taskType = deriveResearchTaskType(row)) {
  const profileBuyers = Number(row.profile_relevant_buyer_count || 0);
  const verifiedRoles = Number(row.verified_buyer_role_count || 0);
  const emailRoutes = Number(row.business_email_route_count || 0);
  const categoryReady = upper(row.category_match_status) === 'CATEGORY_PROCUREMENT_MATCH';
  if (['VERIFY_EMAIL','FIND_BUSINESS_EMAIL'].includes(taskType) && profileBuyers > 0 && verifiedRoles > 0) return 1;
  if (taskType === 'VERIFY_BUYER_ROLE' && emailRoutes > 0) return 2;
  if (taskType === 'FIND_PROFILE_BUYER' && categoryReady) return 3;
  if (['CONFIRM_DISTRIBUTION_RESALE','VERIFY_BUYER_MODEL','COLLECT_CATEGORY_EVIDENCE','CONFIRM_SUPPLIER_ACCESS'].includes(taskType)) return 4;
  return 5;
}

export function projectResearchTask(row = {}) {
  const taskType = deriveResearchTaskType(row);
  const meta = TASK_META[taskType];
  return Object.freeze({
    task_id:`${row.opportunity_id || row.company_id}:${row.product_profile}:${taskType}`,
    status:taskType === 'RETRY_TEMPORARY_PROVIDER_ERROR' ? 'RETRYABLE' : 'WAITING_EVIDENCE',
    task_type:taskType,
    priority:researchTaskPriority(row,taskType),
    company_id:row.company_id,
    company_name:row.company_name,
    market:upper(row.market),
    product_profile:upper(row.product_profile),
    opportunity_id:row.opportunity_id || null,
    job_id:row.job_id || null,
    blocker:meta.blocker,
    evidence_coverage:Number.isFinite(Number(row.evidence_coverage)) ? Number(row.evidence_coverage) : null,
    recommended_next_action:meta.next_action,
    owner_role:meta.owner_role,
    latest_activity:row.latest_activity || null,
    evidence_age_days:Number.isFinite(Number(row.evidence_age_days)) ? Number(row.evidence_age_days) : null,
    retry_state:taskType === 'RETRY_TEMPORARY_PROVIDER_ERROR' ? 'AVAILABLE' : 'NOT_REQUIRED',
    source_count:Math.max(0,Number(row.source_count || 0))
  });
}

export function rankCohortCandidate(row = {}) {
  const task = projectResearchTask(row);
  return Object.freeze({
    ...row,
    task_type:task.task_type,
    cohort_priority:task.priority,
    selection_reason:`${task.task_type}:${task.blocker}`
  });
}

export function compareResearchTasks(left, right) {
  return Number(left.priority)-Number(right.priority)
    || String(right.latest_activity || '').localeCompare(String(left.latest_activity || ''))
    || String(left.company_name || '').localeCompare(String(right.company_name || ''),'en',{ sensitivity:'base' })
    || String(left.product_profile || '').localeCompare(String(right.product_profile || ''));
}
