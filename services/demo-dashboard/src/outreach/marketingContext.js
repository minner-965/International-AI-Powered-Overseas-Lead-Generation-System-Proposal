import { createHash } from 'node:crypto';
import { OUTREACH_POLICY_VERSION, unique, upper } from './constants.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/i;
const RESTRICTED_KEY = /(supplier.?cost|internal.?margin|profit|raw.?order|customer.?note|staging|unc.?path|local.?path|api.?key|password|secret|token|raw.?payload)/i;
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'allowed_ctas',
  'approved_claim_ids',
  'buyer_business_model_result_id',
  'buyer_persona',
  'category_procurement_match_result_id',
  'company',
  'company_display_name',
  'company_id',
  'decision_maker_contact_id',
  'decision_maker_id',
  'evidence',
  'evidence_ids',
  'generation_policy_version',
  'marketing_context_version',
  'market_code',
  'product_opportunity_result_id',
  'product_profile',
  'products',
  'recommended_product_ids',
  'target_language'
]);
const ALLOWED_COMPANY_KEYS = new Set(['company_id', 'company_name', 'display_name', 'id', 'market_code']);
const ALLOWED_EVIDENCE_KEYS = new Set(['evidence_id', 'id', 'source_type', 'summary', 'verified_summary']);
const ALLOWED_PRODUCT_KEYS = new Set(['display_name', 'id', 'product_id', 'product_name', 'product_profile']);

function text(value, maximum = 500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, maximum);
}

function cleanText(value, maximum = 500) {
  return text(String(value ?? '').replace(/<[^>]+>/g, ' '), maximum).replace(/\s+/g, ' ').trim();
}

function safeId(value) {
  const normalized = text(value, 128);
  return UUID.test(normalized) || SAFE_ID.test(normalized) ? normalized : null;
}

function ids(values, limit = 100) {
  return unique((Array.isArray(values) ? values : []).map(safeId).filter(Boolean)).slice(0, limit);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function digestCanonical(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function findRestrictedInputKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const findings = [];
  for (const [key, nested] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (RESTRICTED_KEY.test(key)) findings.push(next);
    if (nested && typeof nested === 'object') findings.push(...findRestrictedInputKeys(nested, next));
  }
  return findings;
}

function findUnexpectedProjectionKeys(value, allowedKeys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value)
    .filter(key => !allowedKeys.has(key) && !RESTRICTED_KEY.test(key))
    .map(key => `${path}.${key}`);
}

export function validateApprovedClaims(claims = [], {
  marketCode,
  productProfile,
  now = new Date()
} = {}) {
  const seen = new Set();
  const valid = [];
  const errors = [];
  const market = upper(marketCode);
  const profile = upper(productProfile);
  const nowDate = now instanceof Date ? now : new Date(now);

  for (const claim of Array.isArray(claims) ? claims : []) {
    const id = safeId(claim?.approved_claim_id);
    if (!id) { errors.push('CLAIM_ID_INVALID'); continue; }
    if (seen.has(id)) { errors.push('CLAIM_ID_DUPLICATE'); continue; }
    seen.add(id);
    const claimText = text(claim.claim_text, 800);
    const markets = (claim.allowed_markets || []).map(upper);
    const profiles = (claim.allowed_product_profiles || []).map(upper);
    const approvedAt = claim.approved_at ? new Date(claim.approved_at) : null;
    const expiresAt = claim.expires_at ? new Date(claim.expires_at) : null;
    const proofIds = ids(claim.proof_ids);
    if (!claimText || !safeId(claim.approved_by) || !approvedAt || Number.isNaN(approvedAt.getTime())) { errors.push(`CLAIM_NOT_APPROVED:${id}`); continue; }
    if (!proofIds.length) { errors.push(`CLAIM_PROOF_REQUIRED:${id}`); continue; }
    if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= nowDate) { errors.push(`CLAIM_EXPIRED:${id}`); continue; }
    if (market && !markets.includes('*') && !markets.includes(market)) { errors.push(`CLAIM_MARKET_NOT_ALLOWED:${id}`); continue; }
    if (profile && !profiles.includes('*') && !profiles.includes(profile)) { errors.push(`CLAIM_PROFILE_NOT_ALLOWED:${id}`); continue; }
    valid.push({
      approved_claim_id: id,
      claim_text: claimText,
      allowed_markets: markets,
      allowed_product_profiles: profiles,
      proof_ids: proofIds,
      approved_by: safeId(claim.approved_by),
      approved_at: approvedAt.toISOString(),
      expires_at: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null
    });
  }
  return { valid, errors: unique(errors) };
}

/** Projects only explicitly allowlisted, verified facts into the LLM-facing context. */
export function buildMarketingContext(input = {}, {
  approvedClaims = [],
  localePolicy = {},
  messagePolicy = {},
  now = new Date()
} = {}) {
  const restricted_input_keys = findRestrictedInputKeys(input);
  const unexpected_input_keys = Object.keys(input || {}).filter(key => !ALLOWED_TOP_LEVEL_KEYS.has(key) && !RESTRICTED_KEY.test(key));
  const unexpected_projection_keys = unique([
    ...findUnexpectedProjectionKeys(input.company, ALLOWED_COMPANY_KEYS, 'company'),
    ...(Array.isArray(input.evidence) ? input.evidence.flatMap((item, index) => findUnexpectedProjectionKeys(item, ALLOWED_EVIDENCE_KEYS, `evidence[${index}]`)) : []),
    ...(Array.isArray(input.products) ? input.products.flatMap((item, index) => findUnexpectedProjectionKeys(item, ALLOWED_PRODUCT_KEYS, `products[${index}]`)) : [])
  ]);
  const marketCode = upper(input.market_code || input.company?.market_code);
  const productProfile = upper(input.product_profile);
  const claimResult = validateApprovedClaims(approvedClaims, { marketCode, productProfile, now });
  const requestedClaims = new Set(ids(input.approved_claim_ids));
  const claims = claimResult.valid.filter(claim => requestedClaims.has(claim.approved_claim_id));
  const marketPolicy = localePolicy?.markets?.[marketCode] || null;
  const evidence = (Array.isArray(input.evidence) ? input.evidence : [])
    .map(item => ({
      evidence_id: safeId(item?.evidence_id || item?.id),
      summary: cleanText(item?.verified_summary || item?.summary, 600),
      source_type: text(item?.source_type, 80)
    }))
    .filter(item => item.evidence_id && item.summary)
    .slice(0, 40);
  const products = (Array.isArray(input.products) ? input.products : [])
    .map(item => ({
      product_id: safeId(item?.product_id || item?.id),
      display_name: text(item?.display_name || item?.product_name, 180),
      product_profile: upper(item?.product_profile || productProfile)
    }))
    .filter(item => item.product_id && item.display_name && item.product_profile === productProfile)
    .slice(0, 20);
  const requestedEvidence = new Set(ids(input.evidence_ids));
  const requestedProducts = new Set(ids(input.recommended_product_ids));
  const targetLanguage = text(input.target_language || marketPolicy?.default_language, 12).toLowerCase();
  const allowedLanguages = (marketPolicy?.allowed_languages || []).map(value => text(value, 12).toLowerCase());
  const requestedCtas = unique((input.allowed_ctas || []).map(value => text(value, 160)).filter(Boolean)).slice(0, 10);
  const allowedCtas = unique((messagePolicy.allowed_ctas || []).map(value => text(value, 160)).filter(Boolean));
  const maxCtas = Math.max(0, Number(messagePolicy.maximum_ctas_per_message) || 0);

  const context = {
    schema_version: 'outreach-marketing-context-v1',
    policy_version: OUTREACH_POLICY_VERSION,
    marketing_context_version: text(input.marketing_context_version, 80),
    company: {
      company_id: safeId(input.company_id || input.company?.company_id || input.company?.id),
      display_name: text(input.company_display_name || input.company?.display_name || input.company?.company_name, 200),
      market_code: marketCode
    },
    product_profile: productProfile,
    buyer_persona: cleanText(input.buyer_persona, 180),
    target_language: targetLanguage,
    allowed_ctas: requestedCtas.filter(value => allowedCtas.includes(value)).slice(0, maxCtas || requestedCtas.length),
    evidence: evidence.filter(item => requestedEvidence.has(item.evidence_id)),
    products: products.filter(item => requestedProducts.has(item.product_id)),
    approved_claims: claims,
    generation_policy_version: text(input.generation_policy_version || OUTREACH_POLICY_VERSION, 80)
  };
  return {
    context,
    input_digest: digestCanonical(context),
    valid: restricted_input_keys.length === 0
      && unexpected_input_keys.length === 0
      && unexpected_projection_keys.length === 0
      && claimResult.errors.length === 0
      && Boolean(marketPolicy)
      && Boolean(targetLanguage)
      && (!allowedLanguages.length || allowedLanguages.includes(targetLanguage))
      && (!maxCtas || context.allowed_ctas.length <= maxCtas)
      && requestedCtas.length === context.allowed_ctas.length
      && requestedClaims.size === claims.length
      && requestedEvidence.size === context.evidence.length
      && requestedProducts.size === context.products.length,
    errors: unique([
      ...restricted_input_keys.map(key => `RESTRICTED_INPUT_FIELD:${key}`),
      ...unexpected_input_keys.map(key => `UNALLOWLISTED_INPUT_FIELD:${key}`),
      ...unexpected_projection_keys.map(key => `UNALLOWLISTED_PROJECTION_FIELD:${key}`),
      ...claimResult.errors,
      ...(marketPolicy ? [] : ['MARKET_NOT_ALLOWED']),
      ...(targetLanguage ? [] : ['TARGET_LANGUAGE_REQUIRED']),
      ...(!allowedLanguages.length || allowedLanguages.includes(targetLanguage) ? [] : ['LANGUAGE_NOT_ALLOWED']),
      ...(!maxCtas || context.allowed_ctas.length <= maxCtas ? [] : ['CTA_LIMIT_EXCEEDED']),
      ...(requestedCtas.length === context.allowed_ctas.length ? [] : ['CTA_RESOLUTION_FAILED']),
      ...(requestedClaims.size === claims.length ? [] : ['APPROVED_CLAIM_RESOLUTION_FAILED']),
      ...(requestedEvidence.size === context.evidence.length ? [] : ['EVIDENCE_RESOLUTION_FAILED']),
      ...(requestedProducts.size === context.products.length ? [] : ['PRODUCT_RESOLUTION_FAILED'])
    ])
  };
}
