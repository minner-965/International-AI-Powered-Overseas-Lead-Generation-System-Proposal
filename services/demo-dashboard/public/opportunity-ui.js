const pair = (zh, en) => [zh, en];
const normalized = value => String(value || '').trim().toUpperCase();

const readinessLabels = Object.freeze({
  SALES_READY: pair('可安排销售跟进', 'Sales ready'),
  NEEDS_DECISION_MAKER: pair('需补充采购负责人', 'Needs buying contact'),
  NEEDS_CONTACT_ROUTE: pair('需补充联系路径', 'Needs contact route'),
  NEEDS_VERIFICATION: pair('需补充核验', 'Needs verification'),
  HISTORICAL_REVIEW: pair('需复核历史记录', 'Historical review'),
  EXISTING_CUSTOMER: pair('现有客户', 'Existing customer'),
  SUPPRESSED: pair('暂停跟进', 'Suppressed'),
  STRATEGIC_LONG_SHOT: pair('战略长期机会', 'Strategic long shot'),
  INELIGIBLE_BUYER_MODEL: pair('客户模式不符合', 'Ineligible buyer model'),
  NEEDS_INTERNAL_CATALOG_EVIDENCE: pair('历史状态（现按批准类目）', 'Legacy state (approved category now applies)'),
  CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE: pair('品类匹配，采购模式待确认', 'Category match; buying evidence required'),
  WEAK_CATEGORY_MATCH: pair('品类匹配较弱', 'Weak category match'),
  NEEDS_PRODUCT_RECOMMENDATION: pair('历史状态（现按商品类目评估）', 'Legacy state (category-level assessment now applies)'),
  PRODUCT_MISMATCH: pair('商品类目不匹配', 'Product category mismatch'),
  WEAK_PRODUCT_MATCH: pair('商品类目适配较弱', 'Weak product category fit'),
  NEEDS_PRODUCT_EVIDENCE: pair('需补充客户类目资料', 'Customer category evidence required'),
  REVIEW: pair('待业务审核', 'Business review')
});

const feasibilityBandLabels = Object.freeze({
  HIGH: pair('高可行性', 'High feasibility'),
  MEDIUM: pair('中等可行性', 'Medium feasibility'),
  LOW_MEDIUM: pair('中低可行性', 'Low-medium feasibility'),
  LOW: pair('低可行性', 'Low feasibility')
});

const matrixLabels = Object.freeze({
  HIGH_FIT_HIGH_ACCESS: pair('高匹配且易进入', 'High fit, high access'),
  HIGH_FIT_MEDIUM_ACCESS: pair('高匹配且进入条件一般', 'High fit, medium access'),
  HIGH_FIT_LOW_ACCESS: pair('高匹配但较难进入', 'High fit, low access'),
  MEDIUM_FIT_HIGH_ACCESS: pair('中等匹配且易进入', 'Medium fit, high access'),
  MEDIUM_FIT_MEDIUM_ACCESS: pair('中等匹配且进入条件一般', 'Medium fit, medium access'),
  LOW_PRIORITY: pair('较低优先级', 'Lower priority')
});

const roleLabels = Object.freeze({
  BUYER: pair('采购专员', 'Buyer'),
  SENIOR_BUYER: pair('高级采购', 'Senior Buyer'),
  HEAD_OF_BUYING: pair('采购负责人', 'Head of Buying'),
  PURCHASING: pair('采购管理', 'Purchasing'),
  PROCUREMENT: pair('采购管理', 'Procurement'),
  CATEGORY_MANAGEMENT: pair('品类管理', 'Category Management'),
  MERCHANDISING: pair('商品企划', 'Merchandising'),
  SOURCING: pair('供应商开发', 'Sourcing'),
  IMPORT: pair('进口管理', 'Import'),
  COMMERCIAL: pair('商务管理', 'Commercial'),
  BUYING_DEPARTMENT: pair('采购部门', 'Buying Department'),
  PROCUREMENT_DEPARTMENT: pair('采购部门', 'Procurement Department'),
  OTHER_RELEVANT: pair('其他相关岗位', 'Other relevant role'),
  UNKNOWN: pair('角色待确认', 'Role to confirm')
});

const contactTypeLabels = Object.freeze({
  BUSINESS_EMAIL: pair('商务邮箱', 'Business email'),
  GENERIC_BUSINESS_EMAIL: pair('企业通用邮箱', 'Generic business email'),
  DEPARTMENT_EMAIL: pair('部门邮箱', 'Department email'),
  BUSINESS_PHONE: pair('商务电话', 'Business phone'),
  BUSINESS_WHATSAPP: pair('企业 WhatsApp', 'Business WhatsApp'),
  CONTACT_FORM: pair('企业联系表单', 'Contact form'),
  SUPPLIER_PORTAL: pair('供应商入口', 'Supplier portal'),
  VENDOR_REGISTRATION: pair('供应商注册', 'Vendor registration'),
  PUBLIC_PROFILE_URL: pair('职业资料链接', 'Professional profile URL'),
  OTHER_BUSINESS_ROUTE: pair('其他商务路径', 'Other business route')
});

const contactVerificationLabels = Object.freeze({
  VALID: pair('有效', 'Valid'),
  ACCEPT_ALL: pair('全域接收', 'Accept-all'),
  PUBLICLY_OBSERVED: pair('企业页面已登记', 'Published by business'),
  FORMAT_VALID: pair('格式有效', 'Format valid'),
  BUSINESS_WHATSAPP_OBSERVED: pair('企业页面已登记', 'Published by business'),
  NOT_VERIFIED: pair('尚未核验', 'Not verified'),
  UNKNOWN: pair('待确认', 'Unknown'),
  INVALID: pair('无效', 'Invalid'),
  INVALID_FORMAT: pair('格式无效', 'Invalid format'),
  TEMPORARY_ERROR: pair('暂时未完成', 'Temporary issue')
});

const relationshipLabels = Object.freeze({
  NEW_PROSPECT: pair('新客户候选', 'New prospect'),
  HISTORICAL_CRM_LEAD: pair('历史客户线索', 'Historical CRM lead'),
  HISTORICAL_CONTACTED_LEAD: pair('历史已联系线索', 'Previously contacted lead'),
  INTERNAL_EXISTING_CUSTOMER: pair('现有客户', 'Existing customer'),
  SUPPRESSED: pair('暂停跟进', 'Suppressed'),
  REVIEW: pair('待复核', 'Review')
});

const barrierLabels = Object.freeze({
  FIXED_SUPPLIER_NETWORK: pair('固定供应商体系', 'Fixed supplier network'),
  INVITATION_ONLY: pair('仅限邀请', 'Invitation only'),
  EXCLUSIVE_SUPPLY: pair('独家供应安排', 'Exclusive supply'),
  CENTRALIZED_GLOBAL_PROCUREMENT: pair('全球集中采购', 'Centralized global procurement'),
  LOCAL_SOURCE_ONLY: pair('仅限本地采购', 'Local sourcing only'),
  PREQUALIFICATION_REQUIRED: pair('需要供应商预审', 'Prequalification required'),
  LONG_TENDER_CYCLE: pair('招标周期较长', 'Long tender cycle'),
  HIGH_COMPLIANCE_GATE: pair('合规门槛较高', 'High compliance gate'),
  NO_EXTERNAL_SUPPLIER_ROUTE: pair('未开放外部供应路径', 'No external supplier route'),
  UNKNOWN_BARRIER: pair('供应障碍待确认', 'Supplier barriers to confirm')
});

const feasibilityDimensions = Object.freeze({
  external_supplier_openness: pair('外部供应商开放度', 'External supplier openness'),
  supplier_onboarding_accessibility: pair('供应商准入便利度', 'Supplier onboarding accessibility'),
  buying_procurement_accessibility: pair('采购部门可达性', 'Buying and procurement accessibility'),
  product_category_buying_fit: pair('商品类目供货适配', 'Product category supply fit'),
  commercial_operational_feasibility: pair('商务与运营可行性', 'Commercial and operational feasibility'),
  supplier_lock_in_barrier: pair('供应商锁定障碍', 'Supplier lock-in barrier')
});

const dimensionStateLabels = Object.freeze({
  OPEN: pair('开放', 'Open'), SUPPORTED: pair('有依据支持', 'Supported'), CLOSED: pair('较封闭', 'Closed'),
  CONTACT_ROUTE: pair('有联系路径', 'Contact route available'), INVITATION_ONLY: pair('仅限邀请', 'Invitation only'),
  NAMED_VERIFIED: pair('已核验采购人员', 'Verified named buyer'), DEPARTMENT_VERIFIED: pair('已核验采购部门', 'Verified department'),
  ROUTE_ONLY: pair('仅有采购路径', 'Route only'), HIGH: pair('高', 'High'), MEDIUM: pair('中', 'Medium'),
  LOW: pair('低', 'Low'), COMPATIBLE: pair('条件匹配', 'Compatible'), BARRIER: pair('存在障碍', 'Barrier found'),
  MODERATE: pair('中等', 'Moderate'), UNKNOWN: pair('待确认', 'To confirm')
});

const sourceTypeLabels = Object.freeze({
  OFFICIAL_COMPANY_PAGE: pair('企业官网页面', 'Official company page'),
  PUBLIC_WEB_PAGE: pair('企业资料页面', 'Business reference page')
});

const enrichmentStatusLabels = Object.freeze({
  QUEUED: pair('任务排队中', 'Job queued'),
  DISCOVERING: pair('正在查找采购资料', 'Finding buying information'),
  RESOLVING: pair('正在整理采购角色', 'Resolving buying roles'),
  VERIFYING: pair('正在核验联系方式', 'Verifying contact routes'),
  PERSISTING: pair('正在保存结果', 'Saving results'),
  COMPLETE: pair('采购资料更新完成', 'Buying information updated'),
  COMPLETED: pair('采购资料更新完成', 'Buying information updated'),
  PARTIAL: pair('部分企业已更新', 'Partially updated'),
  FAILED: pair('更新未完成', 'Update incomplete')
});

const systemRouteLabels = Object.freeze({
  'CORPORATE CONTACT ROUTE': pair('企业商务联系路径', 'Corporate contact route'),
  'CORPORATE PROCUREMENT CONTACT': pair('企业采购联系路径', 'Corporate procurement contact'),
  'BUYING DEPARTMENT': pair('采购部门', 'Buying department'),
  'PROCUREMENT DEPARTMENT': pair('采购部门', 'Procurement department'),
  'PURCHASING DEPARTMENT': pair('采购部门', 'Purchasing department'),
  'MERCHANDISING DEPARTMENT': pair('商品企划部门', 'Merchandising department'),
  'SOURCING DEPARTMENT': pair('供应商开发部门', 'Sourcing department')
});

const systemReasonLabels = Object.freeze({
  'Explicit womenswear/apparel buying scope': pair('明确属于女装或服装采购范围', 'Explicit womenswear or apparel buying scope'),
  'Explicit home/general-merchandise scope': pair('明确属于家居或日用百货范围', 'Explicit home or general-merchandise scope'),
  'Explicit home/general-merchandise buying scope': pair('明确属于家居或日用百货采购范围', 'Explicit home or general-merchandise buying scope'),
  'Explicit fashion/apparel scope': pair('明确属于时尚或服装范围', 'Explicit fashion or apparel scope'),
  'Relevant buying role; product scope requires confirmation': pair('采购角色相关，具体产品范围仍需确认', 'Relevant buying role; product scope requires confirmation'),
  'Commercial/import role is a fallback route': pair('商务或进口岗位仅作为补充联系路径', 'Commercial or import role is a fallback route'),
  'Buying responsibility is not established': pair('采购职责尚未确认', 'Buying responsibility is not established'),
  'Corporate business contact route': pair('企业官网公开的商务联系路径', 'Business contact route published on the official site'),
  'Supplier registration route': pair('企业公开的供应商注册路径', 'Supplier registration route published by the business'),
  'Explicit supplier restriction evidence found': pair('发现明确的供应商限制依据', 'Explicit supplier restriction evidence found'),
  'External supplier openness is published': pair('企业公开了外部供应商合作信息', 'External supplier openness is published'),
  'Supplier openness requires confirmation': pair('外部供应商开放度仍需确认', 'Supplier openness requires confirmation'),
  'A supplier or vendor route is published': pair('企业公开了供应商准入路径', 'A supplier or vendor route is published'),
  'A business contact route is available': pair('已有企业商务联系路径', 'A business contact route is available'),
  'Supplier onboarding route requires confirmation': pair('供应商准入路径仍需确认', 'Supplier onboarding route requires confirmation'),
  'A named buying role is verified': pair('已核验具名采购人员', 'A named buying role is verified'),
  'A buying/procurement department is verified': pair('已核验采购部门', 'A buying or procurement department is verified'),
  'A corporate route is available': pair('已有企业联系路径', 'A corporate route is available'),
  'Buying responsibility requires confirmation': pair('采购职责仍需确认', 'Buying responsibility requires confirmation'),
  'Published requirements indicate an operational gate': pair('公开要求显示存在运营准入门槛', 'Published requirements indicate an operational gate'),
  'Published operational/supplier requirements are available': pair('已找到公开的运营或供应商要求', 'Published operational or supplier requirements are available'),
  'Commercial and operational compatibility requires confirmation': pair('商务与运营条件仍需确认', 'Commercial and operational compatibility requires confirmation'),
  'Explicit supplier lock-in evidence found': pair('发现明确的固定供应商约束', 'Explicit supplier lock-in evidence found'),
  'A documented supplier-entry gate exists': pair('存在公开的供应商准入门槛', 'A documented supplier-entry gate exists'),
  'Published supplier access reduces lock-in concern': pair('公开供应商路径降低了锁定风险', 'Published supplier access reduces lock-in concern'),
  'Supplier lock-in requires confirmation': pair('供应商锁定情况仍需确认', 'Supplier lock-in requires confirmation')
});

const label = (map, value, fallback = pair('待确认', 'To confirm')) => map[normalized(value)] || fallback;

export const opportunityReadinessLabel = value => label(readinessLabels, value);
export const feasibilityBandLabel = value => label(feasibilityBandLabels, value);
export const cooperationMatrixLabel = value => label(matrixLabels, value);
export const normalizedRoleLabel = value => label(roleLabels, value, roleLabels.UNKNOWN);
export const contactTypeLabel = value => label(contactTypeLabels, value);
export const contactVerificationLabel = value => label(contactVerificationLabels, value);
export const relationshipStatusLabel = value => label(relationshipLabels, value);
export const barrierSignalLabel = value => label(barrierLabels, value);
export const feasibilityDimensionLabel = value => feasibilityDimensions[String(value || '').trim().toLowerCase()] || pair('其他评估项', 'Other assessment');
export const feasibilityDimensionStateLabel = value => label(dimensionStateLabels, value);
export const sourceTypeLabel = value => label(sourceTypeLabels, value, pair('资料来源', 'Source reference'));
export const enrichmentStatusLabel = value => label(enrichmentStatusLabels, value);
export const systemRouteLabel = value => systemRouteLabels[normalized(value)] || null;
export function systemReasonLabel(value) {
  const text = String(value || '').trim();
  if (systemReasonLabels[text]) return systemReasonLabels[text];
  const product = text.match(/^Company product scope evaluated for (WOMENSWEAR|GENERAL_MERCHANDISE)$/);
  if (product) return product[1] === 'WOMENSWEAR'
    ? pair('已按全品类女装范围评估企业类目适配', "Company category scope evaluated for Women's Apparel")
    : pair('已按日用百货范围评估企业类目适配', 'Company category scope evaluated for General Merchandise');
  return null;
}

export function feasibilityReasonLabel(value) {
  const code = normalized(value);
  const key = Object.keys(feasibilityDimensions).find(name => code.startsWith(`${name.toUpperCase()}_`));
  if (!key) return pair('评估依据待确认', 'Assessment reason to confirm');
  const state = feasibilityDimensionStateLabel(code.slice(key.length + 1));
  const dimension = feasibilityDimensionLabel(key);
  return [`${dimension[0]}：${state[0]}`, `${dimension[1]}: ${state[1]}`];
}

export function buildOpportunityQuery(filters = {}, limit = 100) {
  const query = new URLSearchParams();
  const allowed = [
    'status', 'country', 'product_profile', 'readiness', 'decision_maker_status', 'normalized_role',
    'contact_type', 'contact_verification', 'historical_crm_status', 'management_match_band',
    'historical_match_band', 'buyer_business_model', 'buyer_subtype',
    'category_procurement_match_band', 'category_procurement_match_status',
    'product_access_matrix', 'tier', 'feasibility_band', 'cooperation_matrix', 'sort'
  ];
  for (const key of allowed) {
    const value = String(filters[key] ?? '').trim();
    if (value) query.set(key, value);
  }
  if (!query.has('sort')) query.set('sort', 'category_procurement_desc');
  query.set('limit', String(Math.max(1, Math.min(500, Number(limit) || 100))));
  return query;
}

export function activeOpportunityFilterCount(filters = {}) {
  return Object.entries(filters).filter(([key, value]) => key !== 'sort'
    && !(key === 'status' && String(value ?? '').trim().toUpperCase() === 'RECOMMENDED')
    && String(value ?? '').trim()).length;
}
