import { productScopeForCategory } from '../market/productProfiles.js';

const PROFILE_CATEGORIES = Object.freeze({
  WOMENSWEAR: "Women's Apparel",
  GENERAL_MERCHANDISE: 'General Merchandise'
});

const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();

export function normalizeTargetCategoryCode(value = '') {
  return upper(value)
    .replace(/['’]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function targetCategoryRequiredError() {
  return Object.assign(new Error('A target category or approved category scope is required'), {
    code: 'TARGET_CATEGORY_REQUIRED',
    status: 422,
    retryable: false,
    classification: 'NON_RETRYABLE_INPUT_ERROR'
  });
}

function normalizeScopeKey(value) {
  const normalized = text(value).slice(0, 240);
  return normalized && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,239}$/.test(normalized) ? normalized : null;
}

function fromCategory(category, source, explicitProfile = null) {
  const targetCategory = text(category);
  const targetCategoryCode = normalizeTargetCategoryCode(targetCategory);
  if (!targetCategoryCode) return null;
  const mappedProfile = productScopeForCategory(targetCategory);
  const requestedProfile = upper(explicitProfile);
  if (requestedProfile && !['WOMENSWEAR', 'GENERAL_MERCHANDISE'].includes(requestedProfile)) {
    throw Object.assign(new Error('Unsupported legacy product profile'), {
      code: 'TARGET_CATEGORY_PROFILE_INVALID', status: 422, retryable: false,
      classification: 'NON_RETRYABLE_INPUT_ERROR'
    });
  }
  if (requestedProfile && mappedProfile && requestedProfile !== mappedProfile) {
    throw Object.assign(new Error('Legacy product profile conflicts with the target category'), {
      code: 'TARGET_CATEGORY_PROFILE_CONFLICT', status: 422, retryable: false,
      classification: 'NON_RETRYABLE_INPUT_ERROR'
    });
  }
  return Object.freeze({
    targetCategory,
    targetCategoryCode,
    targetCategoryScopeKey: `CATEGORY:${targetCategoryCode}`,
    approvedScopeRevisionId: null,
    approvedCategoryScopeId: null,
    source,
    productProfile: requestedProfile || mappedProfile || null,
    isProductProfileRequired: false
  });
}

export function resolveTargetCategoryContext(input = {}) {
  const explicitCategory = input.target_category ?? input.targetCategory ?? input.product_category ?? input.productCategory;
  if (text(explicitCategory)) return fromCategory(explicitCategory, 'EXPLICIT_CATEGORY', input.product_profile ?? input.productProfile);

  const scope = input.approved_category_scope ?? input.approvedCategoryScope ?? null;
  const scopeId = text(input.approved_category_scope_id ?? input.approvedCategoryScopeId ?? scope?.id);
  const revisionId = text(input.approved_scope_revision_id ?? input.approvedScopeRevisionId
    ?? input.category_scope_revision_id ?? scope?.scope_revision_id);
  const scopeCategory = scope?.normalized_category ?? scope?.category_code ?? scope?.category;
  if (scopeId && revisionId && text(scopeCategory)) {
    const targetCategoryCode = normalizeTargetCategoryCode(scopeCategory);
    return Object.freeze({
      targetCategory: text(scopeCategory), targetCategoryCode,
      targetCategoryScopeKey: `APPROVED:${revisionId}:${scopeId}`,
      approvedScopeRevisionId: revisionId, approvedCategoryScopeId: scopeId,
      source: 'APPROVED_SCOPE', productProfile: upper(scope.product_profile) || null,
      isProductProfileRequired: false
    });
  }

  const existingScopeKey = normalizeScopeKey(input.target_category_scope_key ?? input.targetCategoryScopeKey
    ?? input.task_category_scope_key ?? input.opportunity_category_scope_key);
  const contextualCategory = input.task_category ?? input.opportunity_category ?? input.current_target_category;
  if (existingScopeKey && text(contextualCategory)) {
    const resolved = fromCategory(contextualCategory, 'OPPORTUNITY_CONTEXT', input.product_profile ?? input.productProfile);
    return Object.freeze({ ...resolved, targetCategoryScopeKey: existingScopeKey });
  }

  const legacyProfile = upper(input.product_profile ?? input.productProfile);
  if (existingScopeKey && PROFILE_CATEGORIES[legacyProfile]) {
    const resolved = fromCategory(PROFILE_CATEGORIES[legacyProfile], 'OPPORTUNITY_CONTEXT', legacyProfile);
    return Object.freeze({ ...resolved, targetCategoryCode: legacyProfile, targetCategoryScopeKey: existingScopeKey });
  }
  if (PROFILE_CATEGORIES[legacyProfile]) {
    const resolved = fromCategory(PROFILE_CATEGORIES[legacyProfile], 'LEGACY_PROFILE_MAP', legacyProfile);
    return Object.freeze({ ...resolved, targetCategoryCode: legacyProfile, targetCategoryScopeKey: `PROFILE:${legacyProfile}` });
  }

  const legacyCategory = input.category ?? input.category_code ?? input.categoryCode
    ?? input.request_payload?.target_category ?? input.request_payload?.product_category
    ?? input.request_payload?.category ?? input.request_payload?.category_code;
  if (text(legacyCategory)) return fromCategory(legacyCategory, 'LEGACY_REQUEST_CATEGORY', input.product_profile ?? input.productProfile);

  throw targetCategoryRequiredError();
}

export async function resolveTargetCategoryContextFromDatabase(pool, input = {}) {
  const scopeId = text(input.approved_category_scope_id ?? input.approvedCategoryScopeId);
  const revisionId = text(input.approved_scope_revision_id ?? input.approvedScopeRevisionId ?? input.category_scope_revision_id);
  if (scopeId || revisionId) {
    if (!pool) throw new TypeError('A PostgreSQL pool is required to resolve an approved category scope');
    const values = [];
    const clauses = ["s.scope_status='ACTIVE'", "r.approval_status='APPROVED'", 'r.effective_from<=now()', '(r.effective_to IS NULL OR r.effective_to>now())'];
    if (scopeId) { values.push(scopeId); clauses.push(`s.id=$${values.length}::uuid`); }
    if (revisionId) { values.push(revisionId); clauses.push(`s.scope_revision_id=$${values.length}::uuid`); }
    const result = await pool.query(`SELECT s.id,s.scope_revision_id,s.product_profile,s.normalized_category
      FROM leadgen.dpv_product_category_scopes s
      JOIN leadgen.dpv_product_category_scope_revisions r ON r.id=s.scope_revision_id
      WHERE ${clauses.join(' AND ')} ORDER BY r.revision DESC,s.created_at DESC LIMIT 1`, values);
    if (!result.rowCount) throw targetCategoryRequiredError();
    return resolveTargetCategoryContext({ ...input, approved_category_scope: result.rows[0] });
  }
  return resolveTargetCategoryContext(input);
}
