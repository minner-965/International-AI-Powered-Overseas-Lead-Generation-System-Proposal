const pair = (zh, en) => [zh, en];

export function marketSelection(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'BD' || normalized === 'BANGLADESH') {
    return { country_code: 'BD', country_name: 'Bangladesh' };
  }
  if (normalized === 'MX' || normalized === 'MEXICO') {
    return { country_code: 'MX', country_name: 'Mexico' };
  }
  return { country_code: 'AE', country_name: 'United Arab Emirates' };
}

export function researchStatusLabel(value) {
  return ({
    QUEUED: pair('排队中', 'Queued'),
    DISCOVERING: pair('正在发现企业', 'Discovering companies'),
    CRAWLING: pair('正在核验企业页面', 'Verifying company pages'),
    QUALIFYING: pair('正在评估企业', 'Assessing companies'),
    COMPLETED: pair('已完成', 'Completed'),
    FAILED: pair('未完成', 'Failed')
  })[value] || pair(value || '待确认', value || 'To confirm');
}

export function researchProgress(job = {}) {
  const status = String(job.status || '').trim().toUpperCase();
  if (status === 'COMPLETED' || status === 'COMPLETE') return 100;
  if (status === 'QUEUED') return 0;
  const supplied = Number(job.progress_percent);
  if (Number.isFinite(supplied)) return Math.max(0, Math.min(100, Math.round(supplied)));
  const target = Math.max(1, Number(job.candidates_found || job.max_results || job.companies_selected || 1));
  const checked = Math.max(0, Number(job.candidate_verifications_completed || job.candidates_checked || job.companies_attempted || 0));
  if (status === 'DISCOVERING') return Math.max(8, Math.min(25, Math.round((Number(job.candidates_found || 0) / target) * 25)));
  if (status === 'CRAWLING') return Math.max(30, Math.min(68, 30 + Math.round((checked / target) * 38)));
  if (status === 'QUALIFYING') return 76;
  if (status === 'SCORING') return 90;
  if (['FAILED','FAILED_RETRYABLE','FAILED_FINAL','WAITING_EVIDENCE','CANCELLED'].includes(status)) {
    return Math.max(0, Math.min(99, Math.round(Number(job.progress_percent || 0))));
  }
  return 0;
}

export function sizeLabel(value) {
  const key = String(value || 'UNKNOWN').toUpperCase();
  return ({
    MICRO: pair('微型企业', 'Micro business'),
    SMALL: pair('小型企业', 'Small business'),
    MEDIUM: pair('中型企业', 'Medium business'),
    LARGE: pair('大型企业', 'Large company'),
    ENTERPRISE: pair('企业集团', 'Enterprise group'),
    UNKNOWN: pair('规模待核验', 'Size to verify')
  })[key] || pair('规模待核验', 'Size to verify');
}

export function verificationStatusLabel(value) {
  return ({
    VERIFIED: pair('已核验', 'Verified'),
    VERIFIED_BUSINESS: pair('企业已核验', 'Verified business'),
    REVIEW: pair('待业务审核', 'Business review'),
    REJECTED: pair('不符合目标', 'Not a target')
  })[value] || pair('待核验', 'To verify');
}

export function businessStatusLabel(value) {
  return ({
    VERIFIED: pair('已核验', 'Verified'),
    SUPPORTED: pair('有依据支持', 'Supported'),
    UNKNOWN: pair('待核验', 'To verify'),
    CONTRADICTED: pair('依据不支持', 'Not supported')
  })[value] || pair('待核验', 'To verify');
}

export function relevanceLabel(value) {
  return ({
    HIGH: pair('高', 'High'), MEDIUM: pair('中', 'Medium'), LOW: pair('低', 'Low'), UNKNOWN: pair('待核验', 'To verify')
  })[value] || pair('待核验', 'To verify');
}

export function promotionStatusLabel(value) {
  return ({
    NOT_READY: pair('尚未具备条件', 'Not ready'),
    READY_TO_PROMOTE: pair('可加入客户名录', 'Ready for directory'),
    PROMOTED_NEW: pair('已加入客户名录', 'Added to directory'),
    ENRICHED_EXISTING: pair('已更新现有企业', 'Existing company updated'),
    REJECTED: pair('不加入客户名录', 'Not added')
  })[value] || pair('待确认', 'To confirm');
}

export function socialEnrichmentLabel(value) {
  return ({
    NOT_STARTED: pair('尚未查找', 'Not started'),
    COMPLETED: pair('已完成', 'Completed'),
    PARTIAL: pair('部分完成', 'Partially completed'),
    NO_PUBLIC_ACCOUNT: pair('未发现企业账号', 'No business account found'),
    FAILED: pair('查找未完成', 'Lookup incomplete')
  })[value] || pair('待确认', 'To confirm');
}

const reasonLabels = Object.freeze({
  TARGET_BUSINESS_ACTIVITY: pair('目标业务活动有资料依据', 'Target business activity supported'),
  DIRECT_PUBLIC_CONTACT: pair('有直接商务联系方式', 'Direct business contact available'),
  PUBLIC_BUSINESS_EMAIL: pair('有商务邮箱', 'Business email available'),
  EXPLICIT_WHATSAPP: pair('有明确的 WhatsApp 商务入口', 'Explicit WhatsApp business channel'),
  PUBLIC_ENQUIRY_FORM: pair('有咨询表单', 'Enquiry form available'),
  REGIONAL_OPERATION: pair('有区域经营依据', 'Regional operation supported'),
  SME_OR_MEDIUM_SCALE: pair('中小型企业规模', 'Small or medium company scale'),
  SME_SCALE: pair('中小企业规模', 'SME scale'),
  LARGE_OR_ENTERPRISE_SCALE: pair('大型或集团企业规模', 'Large or enterprise scale'),
  CONSUMER_ONLY_RETAIL: pair('仅面向消费者的零售业务', 'Consumer-only retail activity'),
  WEAK_TARGET_ACTIVITY: pair('目标业务依据较弱', 'Limited target-business evidence'),
  INSUFFICIENT_PUBLIC_EVIDENCE: pair('资料依据不足', 'Insufficient source evidence'),
  LARGE_REGIONAL_DISTRIBUTOR: pair('大型区域经销商', 'Large regional distributor'),
  ENTERPRISE_RETAIL_GROUP: pair('大型零售集团', 'Enterprise retail group'),
  MAJOR_CHANNEL_NETWORK: pair('主要渠道网络', 'Major channel network'),
  HIGH_PURCHASING_CAPACITY_SIGNAL: pair('有较强采购能力依据', 'Strong purchasing-capacity signal'),
  BUSINESS_IDENTITY_NOT_RESOLVED: pair('企业身份尚未确认', 'Business identity not resolved'),
  OFFICIAL_WEBSITE_NOT_RESOLVED: pair('企业官网尚未确认', 'Official website not resolved'),
  TARGET_MARKET_EVIDENCE_MISSING: pair('目标市场依据不足', 'Target-market evidence missing'),
  TARGET_BUSINESS_ACTIVITY_NOT_SUPPORTED: pair('目标业务活动依据不足', 'Target-business evidence missing'),
  NON_BUSINESS_RESULT_TYPE: pair('不是企业结果页面', 'Not a business result'),
  CANDIDATE_VERIFICATION_FAILED: pair('企业核验未完成', 'Company verification incomplete')
});

export function reasonCodeLabel(value) {
  return reasonLabels[value] || pair(String(value || '').replaceAll('_', ' ').toLowerCase(), String(value || '').replaceAll('_', ' ').toLowerCase());
}

export function buildVerificationQuery(filters = {}) {
  const query = new URLSearchParams();
  const allowed = [
    'business_type', 'business_type_status', 'company_size', 'sme_relevance',
    'partnership_accessibility', 'strategic_account', 'contactable', 'verification_status', 'promotion_status'
  ];
  for (const key of allowed) {
    const value = filters[key];
    if (value !== '' && value != null) query.set(key, String(value));
  }
  query.set('limit', '100');
  return query;
}

export function partitionVerifications(items = []) {
  const source = Array.isArray(items) ? items : [];
  const isSmeRegional = item => ['HIGH', 'MEDIUM'].includes(item.sme_relevance)
    && ['HIGH', 'MEDIUM'].includes(item.partnership_accessibility);
  return {
    smeRegional: source.filter(isSmeRegional),
    strategic: source.filter(item => item.strategic_account === true),
    other: source.filter(item => !isSmeRegional(item) && item.strategic_account !== true)
  };
}

export function activeFilterCount(filters = {}) {
  return Object.values(filters).filter(value => value !== '' && value != null).length;
}

export function presetFilters(name) {
  if (name === 'small_medium') return { company_size: 'SMALL,MEDIUM' };
  if (name === 'high_access') return { partnership_accessibility: 'HIGH' };
  if (name === 'strategic') return { strategic_account: 'true' };
  if (name === 'verified_distributor') return { business_type: 'distributor', business_type_status: 'VERIFIED' };
  if (name === 'contactable') return { contactable: 'true' };
  return {};
}

export function confidencePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${Math.round(Math.max(0, Math.min(1, number)) * 100)}%`;
}
