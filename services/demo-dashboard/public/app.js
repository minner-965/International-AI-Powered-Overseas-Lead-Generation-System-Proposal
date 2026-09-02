import {
  activeFilterCount,
  buildVerificationQuery,
  businessStatusLabel,
  confidencePercent,
  marketSelection,
  partitionVerifications,
  presetFilters,
  promotionStatusLabel,
  reasonCodeLabel,
  relevanceLabel,
  researchStatusLabel,
  sizeLabel,
  socialEnrichmentLabel,
  verificationStatusLabel
} from './verification-ui.js';
import { activateView } from './crm-shell.js';
import { applyMarketVisibility, filterVisibleMarkets, isMarketVisible } from './market-visibility.js';
import {
  activeOpportunityFilterCount,
  barrierSignalLabel,
  buildOpportunityQuery,
  contactTypeLabel,
  contactVerificationLabel as opportunityContactVerificationLabel,
  cooperationMatrixLabel,
  enrichmentStatusLabel,
  feasibilityBandLabel,
  feasibilityDimensionLabel,
  feasibilityDimensionStateLabel,
  feasibilityReasonLabel,
  normalizedRoleLabel,
  opportunityReadinessLabel,
  relationshipStatusLabel,
  sourceTypeLabel,
  systemReasonLabel,
  systemRouteLabel
} from './opportunity-ui.js';
import {
  buyerBusinessModelItems,
  buyerBusinessModelLabel,
  buyerBusinessModelTone,
  buyerSubtypeLabel,
  categoryProcurementItems,
  categoryProcurementScore,
  categoryProcurementStatusLabel,
  categoryProcurementStatusTone,
  productAccessMatrixLabel,
  productCatalogStatusLabel,
  productMatchBandLabel,
  productMatchBandTone,
  productMatchDimensionLabel,
  productMatchProfile,
  productMatchReasonLabel,
  productMatchResultId,
  productOpportunityItems,
  productOpportunityStatusLabel,
  productOpportunityStatusTone,
  supplierAccessBandLabel,
  supplierAccessBandTone,
  productSourceClassificationLabel,
  productTaxonomyLabel
} from './product-match-ui.js';
import { attachPhase7CompanyDetail, initPhase7Ui, managementRequest, phase7ReasonLabel, phase7SessionHeaders, phase7StateLabel, phase7StatusTone } from './phase7-ui.js';
import { renderOpportunityWorkspace, setOpportunityResultSummary } from './ui/opportunity-workspace.js';

const $ = selector => document.querySelector(selector);
const state = {
  selected: null,
  researchPollTimer: null,
  enrichmentPollTimer: null,
  enrichmentPollFailures: 0,
  enrichmentJobId: null,
  verificationJobId: null,
  verificationTrigger: null,
  detailTrigger: null,
  detailTriggerKind: null,
  verificationFilters: {},
  leads: [],
  opportunities: [],
  overviewOpportunities: [],
  opportunitiesFromApi: false,
  opportunitiesError: false,
  importBatches: [],
  crmHistory: [],
  crmHistorySelected: null,
  crmHistoryPage: 1,
  crmHistoryPageSize: 15,
  companyPage: 1,
  companyPageSize: 15,
  productMatchRequestId: 0
};
applyMarketVisibility();
const opportunityStates = ['RECOMMENDED','MANAGEMENT_APPROVED','EVIDENCE_REQUIRED','HOLD','NOT_SUITABLE'];

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const displayValue = value => {
  const normalized = String(value ?? '').trim();
  return normalized.toLowerCase() === 'null' ? '' : normalized;
};
const displayQuery = value => displayValue(value).replace(/\s+null(?=\s|$)/gi, '').replace(/\s+/g, ' ').trim();
const normalizeLegacyResearchEvidence = payload => ({
  queries: valueList(payload?.queries).map(item=>displayQuery(item.query)).filter(Boolean),
  evidence: valueList(payload?.evidence).map(displayValue).filter(Boolean)
});
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;
const tierClass = value => `tier-${String(value || 'C').toLowerCase()}`;
const tierScore = lead => {
  const tier = lead.tier || lead.current_tier || '-';
  const rawScore = lead.dpv_score ?? lead.current_score ?? lead.lead_score ?? lead.score;
  const score = Number.isFinite(Number(rawScore)) ? Math.round(Number(rawScore)) : '-';
  return `<span class="tier-score ${tierClass(tier)}"><b>${esc(tier)}</b><span>${esc(score)}</span></span>`;
};
const safeUrl = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };
const socialHost = value => { try { return new URL(value).hostname.replace(/^www\./,''); } catch { return 'Business profile'; } };
const approvalLabel = value => ({
  pending:['待审核','Pending review'], approved:['已批准','Approved'], rejected:['已拒绝','Rejected'], needs_changes:['需补充','Needs more evidence']
}[value] || [value || '待审核', value || 'Pending review']);
const companyTypeEn = value => {
  if (/进口商|批发商|importer|wholesaler/i.test(value)) return 'Women’s apparel importer / wholesaler candidate';
  if (/经销商|distributor/i.test(value)) return 'Women’s apparel distributor candidate';
  if (/综合贸易|general trading/i.test(value)) return 'Women’s apparel trading candidate';
  if (/B2B/.test(value)) return 'Women’s apparel B2B trading candidate';
  if (/排除/.test(value)) return 'Excluded: non-target or OEM / sourcing model';
  return 'Women’s apparel retail candidate';
};
const companyTypeZh = value => {
  if (/进口商|批发商|Importer|wholesaler/i.test(value)) return '女装进口商/批发商候选';
  if (/B2B/i.test(value)) return '女装 B2B 贸易候选';
  if (/排除|Excluded/i.test(value)) return '排除：非女装或 OEM/采购代理模式';
  return '女装零售候选';
};
const verificationLabel = lead => {
  if (!lead.business_email && lead.business_phone) return ['联系电话已登记','Business phone available'];
  if (lead.email_verification_status === 'valid') return ['官网邮箱域名有效','Official website email domain valid'];
  if (lead.email_verification_status === 'risky') return ['邮箱域名异常','Email domain issue'];
  if (lead.email_verification_status === 'unknown') return ['邮箱归属待确认','Email ownership to confirm'];
  return lead.business_email ? ['邮箱状态待确认','Email status to confirm'] : ['联系方式待补充','Contact details required'];
};
const companyVerificationCode = lead => {
  const value = String(lead.company_verification_status || lead.verification_state || lead.verification_status || '').toUpperCase();
  return value === 'VERIFIED_BUSINESS' ? 'VERIFIED' : value;
};
const lifecycleCode = lead => String(lead.lifecycle_status || lead.data_status || '').toUpperCase();
const verificationStateLabels = {
  VERIFIED:['已核验','Verified'], REVIEW:['待审核','Review'], REJECTED:['已排除','Rejected']
};
const lifecycleStateLabels = {
  ACTIVE:['当前有效','Active'], STALE:['资料陈旧','Stale'], SUPERSEDED:['已有替代记录','Superseded'],
  DUPLICATE:['重复记录','Duplicate'], INVALID:['无效记录','Invalid'], ARCHIVED:['已归档','Archived']
};
const freshnessLabels = {
  CURRENT:['当前','Current'], AGING:['需更新','Aging'], STALE:['已陈旧','Stale'], UNKNOWN:['待确认','Unknown']
};
const stateBadge = (code, labels) => {
  const value = String(code || 'UNKNOWN').toUpperCase();
  const label = labels[value] || ['待确认','To confirm'];
  return `<span class="data-state-badge state-${esc(value.toLowerCase())}">${bi(label[0],label[1])}</span>`;
};
const verificationBadge = lead => stateBadge(companyVerificationCode(lead),verificationStateLabels);
const lifecycleBadge = lead => stateBadge(lifecycleCode(lead),lifecycleStateLabels);
const shortDate = value => value ? new Date(value).toLocaleDateString() : '-';
const sourceCountValue = lead => Number(lead.verification_source_count ?? lead.source_count ?? lead.source_record_count ?? (Array.isArray(lead.sources) ? lead.sources.length : 0)) || 0;
const productProfileValues = lead => {
  const values = [
    ...(Array.isArray(lead.product_profiles) ? lead.product_profiles : []),
    lead.product_profile,
    lead.product_scope
  ].filter(Boolean);
  return [...new Set(values.map(value=>{
    const original = String(value || '');
    const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
    if (normalized === 'WOMENSWEAR' || /WOMEN|DRESS|SKIRT|TOP|TROUSER|KNITWEAR|APPAREL/.test(normalized) || /女装|连衣裙|上衣|半身裙|裤装|套装|外套|针织衫|内搭/.test(original)) return 'WOMENSWEAR';
    if (normalized === 'GENERAL_MERCHANDISE' || /HOUSEHOLD|HOMEWARE|DAILY_USE|NON_FOOD|GENERAL_MERCHANDISE/.test(normalized) || /日用|百货|家居|家用/.test(original)) return 'GENERAL_MERCHANDISE';
    return '';
  }).filter(Boolean))];
};
const productProfileCode = lead => productProfileValues(lead).length === 1 ? productProfileValues(lead)[0] : '';
const productProfileLabel = lead => productProfileValues(lead).length > 1
  ? bi(
      productProfileValues(lead).map(value=>value === 'GENERAL_MERCHANDISE' ? '日用百货' : '全品类女装').join(' / '),
      productProfileValues(lead).map(value=>value === 'GENERAL_MERCHANDISE' ? 'General Merchandise' : "Full-category Women's Apparel").join(' / ')
    )
  : productProfileCode(lead) === 'GENERAL_MERCHANDISE'
  ? bi('日用百货','General Merchandise')
  : productProfileCode(lead) === 'WOMENSWEAR'
    ? bi('全品类女装',"Full-category Women's Apparel")
    : esc(displayValue(lead.product_category || (Array.isArray(lead.product_categories) ? lead.product_categories.join(', ') : lead.product_categories)) || '-');
const pairHtml = value => bi(value?.[0] || '待确认',value?.[1] || 'To confirm');
const enumBadge = (value,tone='unknown') => `<span class="data-state-badge state-${esc(tone)}">${pairHtml(value)}</span>`;
const phase7OpportunityStatus = item => displayValue(item?.display_opportunity_status || item?.displayOpportunityStatus || item?.opportunity_status || item?.opportunityStatus || item?.system_recommendation_status || item?.systemRecommendationStatus).toUpperCase();
const phase7OpportunityBadge = value => value ? `<span class="data-state-badge state-${esc(phase7StatusTone(value))}">${pairHtml(phase7StateLabel(value))}</span>` : '';
const valueList = value => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(Boolean) : []; } catch {}
  }
  return [value].filter(Boolean);
};
const productProfilesCell = lead => {
  const profiles = productProfileValues(lead);
  if (!profiles.length) return bi('产品待确认','Product to confirm');
  return profiles.map(value=>value === 'GENERAL_MERCHANDISE'
    ? bi('日用百货','General Merchandise')
    : bi('全品类女装',"Full-category Women's Apparel")).join('');
};
const readinessTone = value => ({ SALES_READY:'active',SUPPRESSED:'rejected',EXISTING_CUSTOMER:'superseded',STRATEGIC_LONG_SHOT:'review',INELIGIBLE_BUYER_MODEL:'rejected',PRODUCT_MISMATCH:'rejected',WEAK_CATEGORY_MATCH:'aging',WEAK_PRODUCT_MATCH:'aging',CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE:'review',NEEDS_INTERNAL_CATALOG_EVIDENCE:'review',NEEDS_PRODUCT_RECOMMENDATION:'review',NEEDS_PRODUCT_EVIDENCE:'review',NEEDS_DECISION_MAKER:'aging',NEEDS_CONTACT_ROUTE:'aging',NEEDS_VERIFICATION:'review',HISTORICAL_REVIEW:'review',REVIEW:'review' }[String(value || '').toUpperCase()] || 'unknown');
const feasibilityTone = value => ({ HIGH:'active',MEDIUM:'review',LOW_MEDIUM:'aging',LOW:'rejected' }[String(value || '').toUpperCase()] || 'unknown');
const verificationTone = value => ({ VERIFIED:'active',VALID:'active',PUBLICLY_OBSERVED:'current',BUSINESS_WHATSAPP_OBSERVED:'current',FORMAT_VALID:'review',ACCEPT_ALL:'review',NOT_VERIFIED:'aging',UNKNOWN:'unknown',INVALID:'rejected',INVALID_FORMAT:'rejected',REJECTED:'rejected' }[String(value || '').toUpperCase()] || 'unknown');
const relationshipTone = value => ({ NEW_PROSPECT:'active',HISTORICAL_CRM_LEAD:'review',HISTORICAL_CONTACTED_LEAD:'review',INTERNAL_EXISTING_CUSTOMER:'superseded',SUPPRESSED:'rejected',REVIEW:'review' }[String(value || '').toUpperCase()] || 'unknown');
const contactValueHtml = route => {
  const value = displayValue(route?.value ?? route?.contact_value_raw ?? route?.best_contact);
  if (!value) return bi('联系路径待补充','Contact route required');
  const type = String(route?.contact_type || route?.best_contact_type || '').toUpperCase();
  const label = pairHtml(contactTypeLabel(type));
  const url = ['CONTACT_FORM','SUPPLIER_PORTAL','VENDOR_REGISTRATION','PUBLIC_PROFILE_URL','OTHER_BUSINESS_ROUTE'].includes(type) ? safeUrl(value) : '#';
  return `<span class="crm-contact-route-type">${label}</span>${url !== '#' ? `<a class="crm-contact-route-value" href="${esc(url)}" target="_blank" rel="noreferrer">${bi('打开商务页面','Open business page')}</a>` : `<span class="crm-contact-route-value">${esc(value)}</span>`}`;
};

async function json(url, options) {
  const method=String(options?.method||'GET').toUpperCase();
  if (!['GET','HEAD'].includes(method)) return managementRequest(url,options);
  const response = await fetch(url, { cache: 'no-store', ...options,
    headers:{...phase7SessionHeaders(),...(options?.headers||{})} });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || data.detail || response.statusText);
    error.payload = data;
    throw error;
  }
  return data;
}

const candidateTypeLabel = value => ({
  POSSIBLE_COMPANY_SITE:['企业网站候选','Possible company site'],
  OFFICIAL_SITE_CANDIDATE:['企业网站候选','Company website candidate'],
  DIRECTORY_PROFILE:['企业目录页面','Business directory profile'],
  TRADE_SHOW_PROFILE:['展会企业页面','Trade-show profile'],
  SOCIAL_PROFILE:['企业社交页面','Business social profile'],
  ARTICLE:['文章页面','Article'], MARKETPLACE:['平台页面','Marketplace page'], OTHER:['其他页面','Other page']
}[value] || [value || '其他页面',value || 'Other page']);
const queryStatusLabel = value => ({
  PENDING:['待执行','Pending'], RUNNING:['执行中','Running'], COMPLETED:['已完成','Completed'], FAILED:['未完成','Failed']
}[value] || [value || '待确认',value || 'To confirm']);
const contactabilityLabel = value => ({
  NOT_CHECKED:['待核验','To verify'], CONTACTABLE:['可联系','Contactable'],
  REACHABLE_NO_PUBLIC_CONTACT:['页面未发现联系方式','No contact found on checked pages'],
  UNREACHABLE:['页面不可访问','Page unreachable'], CHECK_FAILED:['检查未完成','Check incomplete']
}[value] || [value || '待确认',value || 'To confirm']);
const reachabilityLabel = value => value === true ? ['可访问','Reachable'] : value === false ? ['不可访问','Unreachable'] : ['未检查','Not checked'];
const contactVerificationLabel = contact => {
  if (contact.contact_type === 'EMAIL' && contact.verification_status === 'DOMAIN_MX_VERIFIED') return ['页面记录 · 域名支持收件','Listed on page · MX-enabled domain'];
  if (contact.contact_type === 'EMAIL') return ['页面记录 · 邮件域待确认','Listed on page · Mail domain to confirm'];
  if (contact.contact_type === 'WHATSAPP') return ['页面明确标注 WhatsApp','Explicit WhatsApp link on page'];
  if (contact.contact_type === 'CONTACT_FORM') return ['页面含联系表单','Contact form present'];
  return ['页面记录','Listed on page'];
};

function candidateContactCell(candidate, type) {
  const items = (candidate.contacts || []).filter(contact => contact.contact_type === type);
  if (!items.length) return `<span class="cell-empty">-</span>`;
  return `<div class="contact-stack">${items.map(contact => {
    const evidence = contactVerificationLabel(contact);
    const valueHref = type === 'EMAIL' ? `mailto:${contact.normalized_value}`
      : type === 'PHONE' ? `tel:${contact.normalized_value}`
        : type === 'WHATSAPP' ? safeUrl(contact.contact_value) : safeUrl(contact.source_url);
    const valueLabel = type === 'CONTACT_FORM' ? bi('打开表单','Open form') : esc(contact.contact_value);
    return `<div class="contact-item"><a href="${esc(valueHref)}" ${type === 'CONTACT_FORM' || type === 'WHATSAPP' ? 'target="_blank" rel="noreferrer"' : ''}>${valueLabel}</a><small>${bi(evidence[0],evidence[1])}</small><a class="evidence-link" href="${esc(safeUrl(contact.source_url))}" target="_blank" rel="noreferrer">${bi('查看记录页面','Open source page')}</a></div>`;
  }).join('')}</div>`;
}

function candidateEvidence(candidate) {
  const fetches = Array.isArray(candidate.fetches) ? candidate.fetches : [];
  const primary = fetches[0] || {};
  const captured = candidate.checked_at || primary.captured_at;
  return `<details class="candidate-evidence"><summary>${bi('查看依据','View evidence')}</summary><dl>
    <dt>${bi('搜索相关度','Search relevance')}</dt><dd>${candidate.provider_score == null ? '-' : esc(Number(candidate.provider_score).toFixed(3))}</dd>
    <dt>${bi('请求网址','Fetch URL')}</dt><dd><a href="${esc(safeUrl(primary.requested_url || candidate.url))}" target="_blank" rel="noreferrer">${esc(primary.requested_url || candidate.url)}</a></dd>
    <dt>${bi('最终网址','Final URL')}</dt><dd>${candidate.final_url ? `<a href="${esc(safeUrl(candidate.final_url))}" target="_blank" rel="noreferrer">${esc(candidate.final_url)}</a>` : '-'}</dd>
    <dt>${bi('HTTP 状态','HTTP status')}</dt><dd>${esc(candidate.http_status ?? '-')}</dd>
    <dt>${bi('页面标题','Page title')}</dt><dd>${esc(primary.page_title || '-')}</dd>
    <dt>${bi('检查结果','Check result')}</dt><dd>${esc(primary.fetch_status || '-')}</dd>
    <dt>${bi('记录时间','Captured at')}</dt><dd>${captured ? esc(new Date(captured).toLocaleString()) : '-'}</dd>
  </dl></details>`;
}

const statusClass = value => String(value || 'unknown').toLowerCase().replaceAll('_', '-');
const labelHtml = pair => bi(pair[0], pair[1]);
const selected = (actual, expected) => actual === expected ? ' selected' : '';
const businessTypes = [
  ['importer_status','进口商','Importer'],
  ['wholesaler_status','批发商','Wholesaler'],
  ['distributor_status','经销商','Distributor'],
  ['general_trading_status','综合贸易','General trading']
];
const evidenceTypeLabels = {
  COMPANY_IDENTITY:['企业身份','Company identity'], LOCATION:['经营地点','Location'], IMPORTER:['进口业务','Importer activity'],
  WHOLESALER:['批发业务','Wholesale activity'], DISTRIBUTOR:['经销业务','Distribution activity'], GENERAL_TRADING:['综合贸易','General trading'],
  PRODUCT_CATEGORY:['产品品类','Product category'], BRANDS:['品牌组合','Brand portfolio'], RETAIL_CHANNEL:['零售渠道','Retail channel'],
  REGIONAL_COVERAGE:['区域覆盖','Regional coverage'], WAREHOUSE:['仓储设施','Warehouse'], LOCATIONS:['经营网点','Locations'],
  EMPLOYEE_SIZE:['员工规模','Employee size'], COMPANY_SCALE:['企业规模','Company scale'], RECENT_ACTIVITY:['近期经营动态','Recent activity'],
  PUBLIC_CONTACT:['商务联系方式','Business contact'], SOCIAL_ACCOUNT:['企业社交账号','Business social account']
  ,COMPANY_CLAIM:['企业公开资料','Company information'], COMPANY_VERIFICATION:['企业核验资料','Company verification evidence']
};
const scoreEligibilityLabels = {
  ELIGIBLE:['资料满足评分条件','Evidence sufficient for scoring'],
  PARTIAL_EVIDENCE:['部分资料待补充','Partial evidence'],
  INELIGIBLE:['暂不满足评分条件','Not currently eligible for scoring'],
  REVIEW:['待业务复核','Business review']
};
const scoreEligibilityLabel = value => scoreEligibilityLabels[String(value || '').toUpperCase()] || ['待业务复核','Business review'];
const contactTypeLabels = {
  EMAIL:['商务邮箱','Business email'], PHONE:['联系电话','Business phone'], WHATSAPP:['WhatsApp','WhatsApp'],
  CONTACT_FORM:['咨询表单','Enquiry form']
};

function reasonList(codes) {
  const items = Array.isArray(codes) ? codes : [];
  if (!items.length) return `<p class="verification-empty-inline">${bi('暂无已记录理由','No recorded reasons')}</p>`;
  return `<ul class="reason-list">${items.map(code => `<li>${labelHtml(reasonCodeLabel(code))}</li>`).join('')}</ul>`;
}

function verificationCard(item) {
  const verification = verificationStatusLabel(item.verification_status);
  const size = sizeLabel(item.company_size);
  const accessibility = relevanceLabel(item.partnership_accessibility);
  const sme = relevanceLabel(item.sme_relevance);
  const promotion = promotionStatusLabel(item.promotion_status);
  const companyUrl = safeUrl(item.official_website || item.candidate_url);
  const companyName = item.resolved_company_name || item.candidate_title || '-';
  const socialCount = Array.isArray(item.social_accounts) ? item.social_accounts.length : 0;
  return `<article class="verification-card" data-candidate-id="${esc(item.research_candidate_id)}">
    <header class="verification-card-head"><div class="verification-card-title"><p class="kicker">${bi('企业核验','Company verification')}</p><h5>${companyUrl === '#' ? esc(companyName) : `<a href="${esc(companyUrl)}" target="_blank" rel="noreferrer">${esc(companyName)}</a>`}</h5></div><span class="result-status verification-${esc(statusClass(item.verification_status))}">${labelHtml(verification)}</span></header>
    <div class="verification-business-grid">${businessTypes.map(([key,zh,en]) => `<div><span>${bi(zh,en)}</span><b class="business-${esc(statusClass(item[key]))}">${labelHtml(businessStatusLabel(item[key]))}</b></div>`).join('')}</div>
    <dl class="verification-facts">
      <div><dt>${bi('企业规模','Company size')}</dt><dd><span class="size-tag ${esc(statusClass(item.company_size))}">${labelHtml(size)}</span><small>${bi(`置信度 ${confidencePercent(item.company_size_confidence)}`,`Confidence ${confidencePercent(item.company_size_confidence)}`)}</small></dd></div>
      <div><dt>${bi('中小企业相关性','SME relevance')}</dt><dd><span class="result-status level-${esc(statusClass(item.sme_relevance))}">${labelHtml(sme)}</span></dd></div>
      <div><dt>${bi('合作可达性','Partnership accessibility')}</dt><dd><span class="result-status level-${esc(statusClass(item.partnership_accessibility))}">${labelHtml(accessibility)}</span></dd></div>
      <div><dt>${bi('商务联系方式','Business contacts')}</dt><dd><b>${esc(item.contact_count ?? 0)}</b></dd></div>
      <div><dt>${bi('企业社交账号','Business social accounts')}</dt><dd><b>${esc(socialCount)}</b></dd></div>
      <div><dt>${bi('名录状态','Directory status')}</dt><dd>${labelHtml(promotion)}</dd></div>
    </dl>
    <div class="verification-card-flags">${item.strategic_account ? `<span class="strategic-flag">${bi('战略客户','Strategic account')}</span>` : ''}<span>${bi(`依据 ${item.evidence_count ?? 0} 条`,`Evidence: ${item.evidence_count ?? 0}`)}</span></div>
    <button type="button" class="verification-open" data-verification-id="${esc(item.research_candidate_id)}">${bi('查看企业核验详情','View company verification')}</button>
  </article>`;
}

function verificationBucket(id, titleZh, titleEn, items, emptyZh, emptyEn) {
  return `<section class="verification-bucket" aria-labelledby="${esc(id)}-title"><div class="bucket-heading"><h5 id="${esc(id)}-title">${bi(titleZh,titleEn)}</h5><span>${esc(items.length)}</span></div>${items.length ? `<div class="verification-card-grid">${items.map(verificationCard).join('')}</div>` : `<p class="verification-empty">${bi(emptyZh,emptyEn)}</p>`}</section>`;
}

function renderVerificationShell(jobId) {
  const host = $('#research-verification-results');
  if (!host) return;
  state.verificationJobId = jobId;
  const compact = window.matchMedia('(max-width: 560px)').matches;
  host.innerHTML = `<section class="verification-results" aria-labelledby="verification-results-title">
    <div class="candidate-head verification-heading"><div><p class="kicker">${bi('企业核验','Company Verification')}</p><h4 id="verification-results-title">${bi('企业身份与合作可达性','Business Identity & Partnership Accessibility')}</h4></div></div>
    <div id="verification-summary" class="verification-summary" aria-label="企业核验概览 Company verification overview"></div>
    <details class="verification-filter-disclosure"${compact ? '' : ' open'}><summary>${bi('筛选企业核验结果','Filter company verifications')} <span id="verification-filter-count">0</span></summary>
      <div class="verification-presets" aria-label="常用核验视图 Common verification views">
        <button type="button" data-preset="all" aria-pressed="true">${bi('全部','All')}</button>
        <button type="button" data-preset="small_medium" aria-pressed="false">${bi('小型与中型','Small + Medium')}</button>
        <button type="button" data-preset="high_access" aria-pressed="false">${bi('高合作可达性','High accessibility')}</button>
        <button type="button" data-preset="strategic" aria-pressed="false">${bi('战略客户','Strategic accounts')}</button>
        <button type="button" data-preset="verified_distributor" aria-pressed="false">${bi('已核验经销商','Verified distributors')}</button>
        <button type="button" data-preset="contactable" aria-pressed="false">${bi('可联系','Contactable')}</button>
      </div>
      <div class="verification-filter-grid">
        <label class="filter-control">${bi('业务类型','Business type')}<select data-verification-filter="business_type"><option value="">全部 / All</option><option value="importer">进口商 / Importer</option><option value="wholesaler">批发商 / Wholesaler</option><option value="distributor">经销商 / Distributor</option><option value="general_trading">综合贸易 / General trading</option></select></label>
        <label class="filter-control">${bi('业务依据','Business evidence')}<select data-verification-filter="business_type_status"><option value="">全部 / All</option><option value="VERIFIED">已核验 / Verified</option><option value="SUPPORTED">有依据支持 / Supported</option><option value="UNKNOWN">待核验 / To verify</option><option value="CONTRADICTED">依据不支持 / Not supported</option></select></label>
        <label class="filter-control">${bi('企业规模','Company size')}<select data-verification-filter="company_size"><option value="">全部 / All</option><option value="SMALL,MEDIUM">小型与中型 / Small + Medium</option><option value="MICRO">微型 / Micro</option><option value="SMALL">小型 / Small</option><option value="MEDIUM">中型 / Medium</option><option value="LARGE">大型 / Large</option><option value="ENTERPRISE">企业集团 / Enterprise</option><option value="UNKNOWN">待核验 / To verify</option></select></label>
        <label class="filter-control">${bi('中小企业相关性','SME relevance')}<select data-verification-filter="sme_relevance"><option value="">全部 / All</option><option value="HIGH">高 / High</option><option value="MEDIUM">中 / Medium</option><option value="LOW">低 / Low</option><option value="UNKNOWN">待核验 / To verify</option></select></label>
        <label class="filter-control">${bi('合作可达性','Partnership accessibility')}<select data-verification-filter="partnership_accessibility"><option value="">全部 / All</option><option value="HIGH">高 / High</option><option value="MEDIUM">中 / Medium</option><option value="LOW">低 / Low</option><option value="UNKNOWN">待核验 / To verify</option></select></label>
        <label class="filter-control">${bi('战略客户','Strategic account')}<select data-verification-filter="strategic_account"><option value="">全部 / All</option><option value="true">是 / Yes</option><option value="false">否 / No</option></select></label>
        <label class="filter-control">${bi('可联系','Contactable')}<select data-verification-filter="contactable"><option value="">全部 / All</option><option value="true">是 / Yes</option><option value="false">否 / No</option></select></label>
        <label class="filter-control">${bi('核验状态','Verification status')}<select data-verification-filter="verification_status"><option value="">全部 / All</option><option value="VERIFIED_BUSINESS">企业已核验 / Verified business</option><option value="REVIEW">待业务审核 / Business review</option><option value="REJECTED">不符合目标 / Not a target</option></select></label>
      </div>
    </details>
    <div id="verification-result-status" class="verification-result-status" role="status" aria-live="polite"></div>
    <div id="verification-buckets" aria-busy="true"><p class="candidate-note">${bi('正在读取企业核验结果…','Loading company verifications…')}</p></div>
  </section>`;
  host.querySelectorAll('[data-verification-filter]').forEach(control => control.addEventListener('change', () => {
    const key = control.dataset.verificationFilter;
    if (control.value) state.verificationFilters[key] = control.value;
    else delete state.verificationFilters[key];
    syncVerificationControls();
    refreshVerifications(jobId);
  }));
  host.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    state.verificationFilters = presetFilters(button.dataset.preset);
    syncVerificationControls();
    refreshVerifications(jobId);
  }));
  syncVerificationControls();
  renderVerificationPayload({ summary:{}, total:0, items:[] });
}

function syncVerificationControls() {
  document.querySelectorAll('[data-verification-filter]').forEach(control => {
    control.value = state.verificationFilters[control.dataset.verificationFilter] || '';
  });
  const filterCount = activeFilterCount(state.verificationFilters);
  const count = $('#verification-filter-count');
  if (count) count.textContent = String(filterCount);
  document.querySelectorAll('[data-preset]').forEach(button => {
    const preset = presetFilters(button.dataset.preset);
    button.setAttribute('aria-pressed', String(JSON.stringify(preset) === JSON.stringify(state.verificationFilters)));
  });
}

function renderVerificationPayload(payload) {
  const summary = payload.summary || {};
  const summaryBox = $('#verification-summary');
  if (summaryBox) summaryBox.innerHTML = [
    ['verified','企业已核验','Verified'], ['review','待业务审核','Review'], ['rejected','不符合目标','Not a target'],
    ['sme_regional','中小/区域机会','SME / Regional'], ['strategic','战略客户','Strategic'],
    ['promoted_new','新增至名录','Added'], ['enriched_existing','更新现有企业','Updated']
  ].map(([key,zh,en]) => `<div><strong>${esc(summary[key] ?? 0)}</strong>${bi(zh,en)}</div>`).join('');
  const items = Array.isArray(payload.items) ? payload.items : [];
  const buckets = partitionVerifications(items);
  const bucketsBox = $('#verification-buckets');
  if (bucketsBox) {
    bucketsBox.setAttribute('aria-busy', 'false');
    bucketsBox.innerHTML = `<div class="management-buckets">
      ${verificationBucket('sme-regional','中小企业 / 区域机会','SME / Regional Opportunities',buckets.smeRegional,'当前筛选下没有中小企业或区域机会。','No SME or regional opportunities match the current filters.')}
      ${verificationBucket('strategic-accounts','战略客户','Strategic Accounts',buckets.strategic,'当前筛选下没有战略客户。','No strategic accounts match the current filters.')}
    </div>${buckets.other.length ? verificationBucket('other-verifications','其他核验结果','Other Verification Results',buckets.other,'','') : ''}`;
    bucketsBox.querySelectorAll('[data-verification-id]').forEach(button => button.addEventListener('click', () => openVerificationDetail(button.dataset.verificationId, button)));
  }
  const status = $('#verification-result-status');
  const total = Number(payload.total ?? items.length);
  if (status) status.innerHTML = bi(`当前筛选显示 ${total} 家企业。`,`Current filters show ${total} ${total === 1 ? 'company' : 'companies'}.`);
}

async function refreshVerifications(jobId) {
  const buckets = $('#verification-buckets');
  if (buckets) buckets.setAttribute('aria-busy', 'true');
  try {
    const query = buildVerificationQuery(state.verificationFilters);
    const payload = await json(`/api/research/jobs/${encodeURIComponent(jobId)}/verifications?${query}`);
    renderVerificationPayload(payload);
  } catch (error) {
    if (buckets) {
      buckets.setAttribute('aria-busy', 'false');
      buckets.innerHTML = `<div class="verification-error"><p>${bi('企业核验结果读取失败。','Company verification results could not be loaded.')}</p><button type="button" id="verification-retry">${bi('重新读取','Retry')}</button></div><div class="management-buckets">
        ${verificationBucket('sme-regional','中小企业 / 区域机会','SME / Regional Opportunities',[],'核验结果恢复后将在此显示。','Results will appear here when verification data is available.')}
        ${verificationBucket('strategic-accounts','战略客户','Strategic Accounts',[],'核验结果恢复后将在此显示。','Results will appear here when verification data is available.')}
      </div>`;
      $('#verification-retry')?.addEventListener('click', () => refreshVerifications(jobId));
    }
  }
}

function sourceLink(url) {
  const href = safeUrl(url);
  return href === '#' ? `<span>${esc(url || '-')}</span>` : `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(url)}</a>`;
}

function renderVerificationDetail(item) {
  const content = $('#verification-detail-content');
  if (!content) return;
  const companyName = item.resolved_company_name || item.candidate_title || '-';
  const verification = verificationStatusLabel(item.verification_status);
  const size = sizeLabel(item.company_size);
  const accessibility = relevanceLabel(item.partnership_accessibility);
  const sme = relevanceLabel(item.sme_relevance);
  const promotion = promotionStatusLabel(item.promotion_status);
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const contacts = Array.isArray(item.contacts) ? item.contacts : [];
  const socials = Array.isArray(item.social_accounts) ? item.social_accounts : [];
  content.setAttribute('aria-busy', 'false');
  content.innerHTML = `<div class="verification-detail-head"><div><p class="kicker">${bi('企业核验详情','Company verification')}</p><h3 id="verification-detail-title">${esc(companyName)}</h3><span class="result-status verification-${esc(statusClass(item.verification_status))}">${labelHtml(verification)}</span></div>${item.strategic_account ? `<span class="strategic-flag">${bi('战略客户','Strategic account')}</span>` : ''}</div>
    <div class="verification-detail-grid">
      <div><b>${bi('企业官网','Official website')}</b>${sourceLink(item.official_website)}</div>
      <div><b>${bi('国家 / 城市 / 地区','Country / City / Region')}</b><span>${esc([item.country_name || item.country,item.city,item.region].map(displayValue).filter(Boolean).join(' / ') || '-')}</span></div>
      <div><b>${bi('企业规模','Company size')}</b><span>${labelHtml(size)} · ${bi(`置信度 ${confidencePercent(item.company_size_confidence)}`,`Confidence ${confidencePercent(item.company_size_confidence)}`)}</span></div>
      <div><b>${bi('中小企业相关性','SME relevance')}</b><span>${labelHtml(sme)}</span></div>
      <div><b>${bi('合作可达性','Partnership accessibility')}</b><span>${labelHtml(accessibility)} · ${bi(`置信度 ${confidencePercent(item.partnership_accessibility_confidence)}`,`Confidence ${confidencePercent(item.partnership_accessibility_confidence)}`)}</span></div>
      <div><b>${bi('名录状态','Directory status')}</b><span>${labelHtml(promotion)}</span></div>
    </div>
    <section class="verification-detail-section"><h4>${bi('目标业务活动','Target business activity')}</h4><div class="verification-business-grid verification-business-detail">${businessTypes.map(([key,zh,en]) => `<div><span>${bi(zh,en)}</span><b class="business-${esc(statusClass(item[key]))}">${labelHtml(businessStatusLabel(item[key]))}</b></div>`).join('')}</div></section>
    <section class="verification-detail-section"><h4>${bi('合作可达性理由','Partnership accessibility reasons')}</h4>${reasonList(item.accessibility_reason_codes)}</section>
    <section class="verification-detail-section"><h4>${bi('中小企业相关性理由','SME relevance reasons')}</h4>${reasonList(item.sme_reason_codes)}</section>
    ${item.strategic_account ? `<section class="verification-detail-section"><h4>${bi('战略客户理由','Strategic account reasons')}</h4>${reasonList(item.strategic_reason_codes)}</section>` : ''}
    <section class="verification-detail-section"><h4>${bi('商务联系方式','Business contacts')}</h4>${contacts.length ? `<div class="verification-contact-list">${contacts.map(contact => `<div><b>${labelHtml(contactTypeLabels[contact.contact_type] || ['其他商务联系路径','Other business contact route'])}</b><span>${esc(contact.contact_value)}</span>${sourceLink(contact.source_url)}</div>`).join('')}</div>` : `<p class="verification-empty-inline">${bi('未发现商务联系方式。','No business contact found.')}</p>`}</section>
    <section class="verification-detail-section"><h4>${bi('企业社交账号','Business social accounts')}</h4><p class="detail-section-note">${labelHtml(socialEnrichmentLabel(item.social_enrichment_status))}</p>${socials.length ? `<div class="verification-social-list">${socials.map(account => `<a href="${esc(safeUrl(account.profile_url))}" target="_blank" rel="noreferrer">${esc(account.platform)}</a>`).join('')}</div>` : `<p class="verification-empty-inline">${bi('未发现已确认的企业账号。','No confirmed business account found.')}</p>`}</section>
    <section class="verification-detail-section"><h4>${bi('核验依据','Verification evidence')}</h4>${evidence.length ? `<div class="verification-evidence-list">${evidence.map((record,index) => { const type = evidenceTypeLabels[record.evidence_type] || ['企业资料','Company source']; return `<details${index === 0 ? ' open' : ''}><summary><span>${labelHtml(type)}</span><b>${confidencePercent(record.confidence)}</b></summary><blockquote>${esc(record.evidence_text)}</blockquote><dl><dt>${bi('资料来源','Source')}</dt><dd>${sourceLink(record.source_url)}</dd><dt>${bi('页面标题','Page title')}</dt><dd>${esc(record.source_page_title || '-')}</dd><dt>${bi('记录时间','Captured at')}</dt><dd>${record.captured_at ? esc(new Date(record.captured_at).toLocaleString()) : '-'}</dd></dl></details>`; }).join('')}</div>` : `<p class="verification-empty-inline">${bi('暂无核验依据。','No verification evidence available.')}</p>`}</section>`;
}

async function openVerificationDetail(candidateId, trigger) {
  const dialog = $('#verification-detail');
  const content = $('#verification-detail-content');
  if (!dialog || !content) return;
  state.verificationTrigger = trigger;
  content.setAttribute('aria-busy', 'true');
  content.innerHTML = `<p class="candidate-note">${bi('正在读取企业核验详情…','Loading company verification…')}</p>`;
  if (!dialog.open) dialog.showModal();
  $('#verification-detail-close')?.focus({ preventScroll:true });
  try {
    renderVerificationDetail(await json(`/api/research/candidates/${encodeURIComponent(candidateId)}/verification`));
  } catch (error) {
    content.setAttribute('aria-busy', 'false');
    content.innerHTML = `<div class="verification-error"><p>${bi('企业核验详情读取失败。','Company verification details could not be loaded.')}</p><button type="button" id="verification-detail-retry">${bi('重新读取','Retry')}</button></div>`;
    $('#verification-detail-retry')?.addEventListener('click', () => openVerificationDetail(candidateId, trigger));
  }
}

function renderResearchJob(job) {
  const jobMarketCode = String(job.country_code || marketSelection(job.country_name || job.country).country_code || '').toUpperCase();
  if (!isMarketVisible(jobMarketCode)) {
    $('#research-job').hidden = true;
    return false;
  }
  const status = researchStatusLabel(job.status);
  const market = [job.country_name || job.country, job.region, job.city].map(displayValue).filter(Boolean).join(' / ');
  const taskErrors = Math.max(Number(job.search_failed_requests || 0), Number(job.error_count || 0));
  const compactCompleted = window.matchMedia('(max-width: 560px)').matches && job.status === 'COMPLETED';
  $('#research-job').hidden = false;
  const terminalStatuses = ['COMPLETED','FAILED','FAILED_RETRYABLE','FAILED_FINAL','WAITING_EVIDENCE','CANCELLED'];
  $('#research-job').setAttribute('aria-busy', String(!terminalStatuses.includes(String(job.status || '').toUpperCase())));
  $('#research-job').innerHTML = `<div class="research-job-head"><div><p class="kicker">${bi('研究任务','Research job')}</p><h4>${esc(job.job_id || job.id || '-')}</h4></div><span class="job-status status-${esc(String(job.status || '').toLowerCase())}" role="status" aria-live="polite" aria-atomic="true">${bi(status[0],status[1])}</span></div>
    <details class="job-disclosure"${compactCompleted ? '' : ' open'}>
      <summary>${bi('查看任务详情与结果','View job details and results')}</summary>
      <div class="research-job-grid"><div>${bi('市场','Market')}<b>${esc(market || '-')}</b></div><div>${bi('品类','Category')}<b>${esc(job.product_category || '-')}</b></div><div>${bi('搜索查询','Search queries')}<b id="research-query-count">${esc(job.search_api_requests ?? 0)}</b></div><div>${bi('搜索候选企业/页面','Research candidates')}<b>${esc(job.candidates_found ?? 0)}</b></div><div>${bi('任务错误','Task errors')}<b>${esc(taskErrors)}</b></div></div>
      ${job.status === 'FAILED' ? `<p class="job-error">${bi('研究任务未完成。','Research job failed.')}</p>` : ''}
      <div id="research-query-summary"></div><div id="research-candidate-results"></div><div id="research-verification-results"></div>
    </details>`;
  return true;
}

async function loadResearchResults(jobId) {
  document.dispatchEvent(new CustomEvent('phase9:research-job-terminal',{ detail:{ jobId } }));
}

async function pollResearchJob(jobId) {
  clearTimeout(state.researchPollTimer);
  try {
    const job = await json(`/api/research/jobs/${encodeURIComponent(jobId)}`);
    if (!renderResearchJob(job)) return;
    const terminalStatuses = ['COMPLETED','FAILED','FAILED_RETRYABLE','FAILED_FINAL','WAITING_EVIDENCE','CANCELLED'];
    if (!terminalStatuses.includes(String(job.status || '').toUpperCase())) {
      state.researchPollTimer = setTimeout(() => pollResearchJob(jobId), 1200);
    } else await loadResearchResults(jobId);
  } catch (error) {
    $('#research-job').hidden = false;
    $('#research-job').innerHTML = `<p class="job-error">${bi('任务状态读取失败，请稍后重试。','Unable to load job status. Please retry shortly.')}</p>`;
  }
}

async function loadMetrics() {
  const [data,opportunityPayload] = await Promise.all([
    json('/api/metrics'),
    json('/api/opportunities?status=ALL&limit=500')
  ]);
  const allOpportunities = (Array.isArray(opportunityPayload) ? opportunityPayload : opportunityPayload?.items || opportunityPayload?.opportunities || []).filter(companyMarketIsVisible);
  state.overviewOpportunities = allOpportunities;
  const statusCounts = Object.fromEntries(opportunityStates.map(status => [status,allOpportunities.filter(item => phase7OpportunityStatus(item) === status).length]));
  const activeCompanies = data.verified_active ?? data.verified_active_companies ?? data.unique_companies ?? 0;
  $('#metrics').innerHTML = [
    [statusCounts.RECOMMENDED,'建议联系','Recommended'],
    [statusCounts.MANAGEMENT_APPROVED,'已确认待联系','Management Approved / Contact Queue'],
    [statusCounts.EVIDENCE_REQUIRED,'待补资料','Evidence Required'],
    [activeCompanies,'当前有效企业','Active Companies']
  ].map(([value,zh,en]) => `<div class="metric"><strong>${esc(value)}</strong>${bi(zh,en)}</div>`).join('');
  $('#metrics').setAttribute('aria-busy', 'false');
  document.querySelectorAll('[data-status-count]').forEach(node => {
    const code = node.dataset.statusCount;
    node.textContent = String(code === 'ALL' ? allOpportunities.length : statusCounts[code] ?? 0);
  });
  renderOpportunityWorkspace({
    items: allOpportunities,
    counts: statusCounts,
    getStatus: phase7OpportunityStatus,
    getBlocker: phase9BlockerGroup,
    getBlockerLabel: phase9BlockerLabel,
    getBlockerAction: phase9BlockerAction,
    onTask: phase9RouteEvidenceTask
  });
  const facts = $('#overview-facts');
  if (facts) {
    facts.setAttribute('aria-busy','false');
    const reasons = new Map();
    allOpportunities.filter(item => phase7OpportunityStatus(item) === 'EVIDENCE_REQUIRED').forEach(item => {
      const reason = (item.reason_codes || item.reasonCodes || ['BUSINESS_EVIDENCE_REQUIRED'])[0] || 'BUSINESS_EVIDENCE_REQUIRED';
      reasons.set(reason,(reasons.get(reason) || 0) + 1);
    });
    facts.innerHTML = reasons.size ? `<ul class="p8-overview-reason-list">${[...reasons.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>{const label=phase7ReasonLabel(reason);return `<li>${bi(label[0],label[1])}<b>${esc(count)}</b></li>`}).join('')}</ul>` : `<div class="p8-empty-state"><span>${bi('当前没有待补资料机会。','No opportunities currently require evidence.')}</span></div>`;
  }
  renderOverviewCompanies();
  const run = data.last_run;
  const lastRefresh = $('#overview-last-refresh');
  if (lastRefresh) lastRefresh.innerHTML = data.last_collected_at
    ? bi(`数据更新时间：${new Date(data.last_collected_at).toLocaleString()}`,`Data updated: ${new Date(data.last_collected_at).toLocaleString()}`)
    : bi('数据更新时间待确认','Data refresh time to confirm');
  $('#run-status').innerHTML = data.last_collected_at
    ? bi(`数据更新：${new Date(data.last_collected_at).toLocaleString()}，新增 ${run?.new_companies ?? 0} 家，更新 ${run?.updated_companies ?? 0} 家`,
      `Data updated: ${new Date(data.last_collected_at).toLocaleString()}, ${run?.new_companies ?? 0} new, ${run?.updated_companies ?? 0} updated`)
    : bi('尚无企业记录。','No company records available.');
}

const numericValue = value => value === null || value === undefined || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const companyIdFor = lead => lead.company_id || lead.companyId || lead.id;
const leadIdFor = lead => lead.lead_review_id || lead.lead_id || lead.id;
const leadScoreValue = lead => numericValue(lead.dpv_score ?? lead.current_score ?? lead.lead_score ?? lead.score);
const matchRecord = (payload, key) => payload?.[key]
  ?? payload?.customer_matches?.[key]
  ?? payload?.match_comparison?.[key]
  ?? null;
const matchRecordScore = record => numericValue(record?.match_score ?? record?.score ?? record);
const managementMatchRecord = payload => matchRecord(payload, 'management_baseline')
  ?? (/^MANAGEMENT_BASELINE$/i.test(String(payload?.reference_profile_type || '')) ? payload : null);
const historicalMatchRecord = payload => matchRecord(payload, 'mx_historical_reference')
  ?? (/^HISTORICAL_CUSTOMER_ICP$/i.test(String(payload?.reference_profile_type || '')) ? payload : null);
const managementMatchScoreValue = lead => matchRecordScore(managementMatchRecord(lead))
  ?? numericValue(lead?.management_baseline_match_score ?? lead?.management_baseline_match
    ?? lead?.customer_match_score ?? lead?.customer_match ?? lead?.match_score);
const historicalMatchScoreValue = lead => matchRecordScore(historicalMatchRecord(lead))
  ?? numericValue(lead?.mx_historical_reference_match_score ?? lead?.mx_historical_reference_match
    ?? lead?.historical_reference_match_score ?? lead?.historical_match_score ?? lead?.historical_customer_match);
const matchScoreValue = managementMatchScoreValue;
const marketValue = lead => displayValue(lead.country_code || lead.market || lead.country || lead.city) || '-';
const companyMarketIsVisible = lead => isMarketVisible(
  lead.country_code || marketSelection(lead.country_name || lead.country || '').country_code
);
const businessTypeValue = lead => {
  const supported = [
    ['importer_status','Importer'],['wholesaler_status','Wholesaler'],['distributor_status','Distributor'],['general_trading_status','General trading']
  ].filter(([key])=>['VERIFIED','SUPPORTED'].includes(String(lead[key] || '').toUpperCase())).map(([,label])=>label);
  if (supported.length) return supported.join(' / ');
  return displayValue(lead.business_type || lead.company_type) || '-';
};
const matchCell = lead => {
  const score = matchScoreValue(lead);
  return score == null ? `<span class="crm-match is-empty">${bi('待计算','Not calculated')}</span>` : `<span class="crm-match">${esc(Math.round(score))}/100</span>`;
};
const historicalMatchCell = lead => {
  const score = historicalMatchScoreValue(lead);
  return score == null ? `<span class="crm-match is-empty">${bi('待计算','Not calculated')}</span>` : `<span class="crm-match">${esc(Math.round(score))}/100</span>`;
};
const scoreCell = lead => {
  const score = leadScoreValue(lead);
  return score == null ? `<span class="crm-score">-</span>` : `<span class="crm-score">${esc(Math.round(score))}/100</span>`;
};
const compareName = (a,b) => String(a.company_name || a.resolved_company_name || '').localeCompare(String(b.company_name || b.resolved_company_name || ''),['zh-CN','en']);
function sortedLeads(items, mode) {
  const copy = [...items];
  if (mode === 'name_asc') return copy.sort(compareName);
  if (mode === 'tier_asc') return copy.sort((a,b)=>String(a.tier || 'Z').localeCompare(String(b.tier || 'Z')) || (leadScoreValue(b) ?? -1) - (leadScoreValue(a) ?? -1));
  if (mode === 'match_desc') return copy.sort((a,b)=>(matchScoreValue(b) ?? -1) - (matchScoreValue(a) ?? -1) || (leadScoreValue(b) ?? -1) - (leadScoreValue(a) ?? -1));
  if (mode === 'category_procurement_desc') return copy.sort((a,b)=>(categoryProcurementScore(b) ?? -1) - (categoryProcurementScore(a) ?? -1) || (leadScoreValue(b) ?? -1) - (leadScoreValue(a) ?? -1));
  return copy.sort((a,b)=>(leadScoreValue(b) ?? -1) - (leadScoreValue(a) ?? -1) || compareName(a,b));
}

function companyRow(lead) {
  const size = sizeLabel(lead.company_size || lead.company_size_band);
  const id = leadIdFor(lead);
  const selectedRow = String(state.selected) === String(id);
  const relationship = lead.relationship_status || lead.historical_crm_status;
  const opportunity = phase7OpportunityStatus(lead);
  return `<tr data-id="${esc(id)}" data-company-id="${esc(companyIdFor(lead))}" class="${selectedRow?'active':''}" aria-selected="${selectedRow?'true':'false'}">
    <td class="company-col-company" data-label="公司 / Company"><strong class="company">${esc(lead.company_name || lead.resolved_company_name || '-')}</strong>${lead.website_url ? `<div class="sub"><a href="${esc(safeUrl(lead.website_url))}" target="_blank" rel="noreferrer">${bi('企业网站','Company website')}</a></div>` : ''}</td>
    <td class="company-col-market" data-label="市场 / Market">${esc(marketValue(lead))}</td>
    <td class="company-col-type" data-label="业务类型 / Business type">${bi(companyTypeZh(businessTypeValue(lead)),companyTypeEn(businessTypeValue(lead)))}</td>
    <td class="company-col-verification" data-label="核验 / Verification">${verificationBadge(lead)}</td>
    <td class="company-col-relationship" data-label="关系 / Relationship">${relationship ? pairHtml(relationshipStatusLabel(relationship)) : bi('待确认','To confirm')}</td>
    <td class="company-col-evidence" data-label="最近资料 / Latest evidence">${esc(shortDate(lead.last_verified_at))}<span class="crm-row-secondary">${bi(`来源 ${sourceCountValue(lead)}`,`Sources ${sourceCountValue(lead)}`)}</span></td>
    <td class="company-col-opportunity" data-label="相关机会 / Related opportunity">${opportunity ? phase7OpportunityBadge(opportunity) : bi('尚无当前机会','No current opportunity')}</td>
    <td class="company-col-action" data-label="操作 / Action"><button type="button" class="btn btn-outline-primary lead-select" data-lead-id="${esc(id)}" aria-pressed="${selectedRow?'true':'false'}">${opportunity ? bi('查看业务机会','View Opportunity') : bi('查看客户主档','View Company')}</button></td></tr>`;
}

function bindLeadRows(root = document) {
  root.querySelectorAll('#leads tr[data-id]').forEach(row => {
    row.addEventListener('click', event => { if (!event.target.closest('a,button')) showLead(row.dataset.id); });
    row.querySelector('.lead-select')?.addEventListener('click',()=>showLead(row.dataset.id));
  });
}

function renderCompanyTable() {
  const sort = $('#company-sort')?.value || 'score_desc';
  const ordered = sortedLeads(state.leads,sort);
  const pageSize = document.documentElement.dataset.density === 'compact' ? 20 : state.companyPageSize;
  const pageCount = Math.max(1,Math.ceil(ordered.length/pageSize));
  state.companyPage = Math.min(Math.max(1,state.companyPage),pageCount);
  const pageItems = ordered.slice((state.companyPage-1)*pageSize,state.companyPage*pageSize);
  $('#leads').innerHTML = pageItems.length ? pageItems.map(companyRow).join('') : `<tr><td colspan="8" class="crm-loading-cell">${bi('当前筛选没有企业。','No companies match the current filters.')}</td></tr>`;
  const pagination = $('#company-pagination');
  if (pagination) pagination.innerHTML = `<span>${bi(`第 ${state.companyPage} / ${pageCount} 页，共 ${ordered.length} 家`,`Page ${state.companyPage} of ${pageCount}, ${ordered.length} companies`)}</span><div class="crm-pagination-actions"><button class="btn btn-outline-secondary" type="button" data-page="prev" ${state.companyPage<=1?'disabled':''}>${bi('上一页','Previous')}</button><button class="btn btn-outline-secondary" type="button" data-page="next" ${state.companyPage>=pageCount?'disabled':''}>${bi('下一页','Next')}</button></div>`;
  pagination?.querySelector('[data-page="prev"]')?.addEventListener('click',()=>{state.companyPage-=1;renderCompanyTable()});
  pagination?.querySelector('[data-page="next"]')?.addEventListener('click',()=>{state.companyPage+=1;renderCompanyTable()});
  bindLeadRows();
}

function renderOverviewCompanies() {
  const host = $('#overview-opportunities');
  if (!host) return;
  const items = state.overviewOpportunities.filter(item => phase7OpportunityStatus(item) === 'RECOMMENDED').slice(0,5);
  host.innerHTML = items.length ? `<div class="crm-evidence-required-list">${items.map(lead=>`<article class="crm-evidence-row"><div><button class="crm-company-link" type="button" data-overview-id="${esc(leadIdFor(lead))}">${esc(lead.company_name || '-')}</button><span class="crm-row-secondary">${esc(marketValue(lead))}</span></div><div>${productProfilesCell(lead)}</div><div>${phase7OpportunityBadge('RECOMMENDED')}</div><button class="btn btn-outline-primary" type="button" data-overview-id="${esc(leadIdFor(lead))}">${bi('查看机会','View Opportunity')}</button></article>`).join('')}</div>` : `<div class="p8-empty-state"><i class="ti ti-target-off" aria-hidden="true"></i><h3>${bi('暂无建议联系机会','No Recommended Opportunities')}</h3><button class="btn btn-outline-primary" type="button" data-open-view="opportunities" data-opportunity-view="EVIDENCE_REQUIRED">${bi('查看待补资料','View Evidence Required')}</button></div>`;
  host.querySelectorAll('[data-overview-id]').forEach(button=>button.addEventListener('click',()=>showLead(button.dataset.overviewId)));
  host.querySelector('[data-opportunity-view]')?.addEventListener('click',event=>{
    const select=$('#opportunity-status');
    if(select){select.value=event.currentTarget.dataset.opportunityView;select.dispatchEvent(new Event('change',{bubbles:true}));}
    activateView('opportunities');
  });
}

function collectOpportunityFilters() {
  const form = $('#opportunity-filters');
  return form ? Object.fromEntries(new FormData(form).entries()) : { sort:$('#opportunity-sort')?.value || 'category_procurement_desc' };
}

function syncOpportunityFilters() {
  const count = activeOpportunityFilterCount(collectOpportunityFilters());
  const host = $('#opportunity-filter-count');
  if (host) {
    host.textContent = String(count);
    host.setAttribute('aria-label',count ? `已启用 ${count} 项筛选 ${count} active filters` : '未启用筛选 No active filters');
  }
}

function opportunityBuyerCell(item) {
  const buyer = displayValue(item.buyer_name || item.buyer_department);
  if (!buyer) return `<span class="crm-cell-empty">${bi('采购人员或部门待补充','Buyer or department required')}</span>`;
  const buyerPair = systemRouteLabel(buyer);
  const rawTitle = displayValue(item.buyer_raw_title);
  const titlePair = systemRouteLabel(rawTitle);
  const repeated = rawTitle && rawTitle.toLowerCase() === buyer.toLowerCase();
  return `<strong class="crm-buyer-name">${buyerPair ? pairHtml(buyerPair) : esc(buyer)}</strong>${rawTitle && !repeated ? `<small>${titlePair ? pairHtml(titlePair) : esc(rawTitle)}</small>` : ''}`;
}

function opportunityRoleCell(item) {
  if (!item.normalized_role) return `<span class="crm-cell-empty">${bi('角色待确认','Role to confirm')}</span>`;
  const relevance = relevanceLabel(String(item.role_relevance || 'UNKNOWN').toUpperCase());
  return `<span class="crm-op-cell-details"><span><span class="crm-op-cell-label">${bi('采购职责','Buyer role')}</span><strong>${pairHtml(normalizedRoleLabel(item.normalized_role))}</strong></span><span><span class="crm-op-cell-label">${bi('相关度','Relevance')}</span><strong>${bi(relevance[0],relevance[1])}</strong></span></span>`;
}

function opportunityFeasibilityCell(item) {
  const score = numericValue(item.cooperation_feasibility_score);
  if (score == null) return `<span class="crm-cell-empty">${bi('待评估','Not assessed')}</span>`;
  return `<span class="crm-feasibility-cell"><b>${esc(Math.round(score))}/100</b>${enumBadge(feasibilityBandLabel(item.feasibility_band),feasibilityTone(item.feasibility_band))}</span>`;
}

function productMatchBusinessValue(value) {
  const text = displayValue(typeof value === 'object' ? value?.canonical_name || value?.name || value?.label || value?.category || value?.subcategory : value);
  if (!text) return '';
  const mapped = productTaxonomyLabel(text);
  if (mapped[0] !== '待确认' || mapped[1] !== 'To confirm') return pairHtml(mapped);
  return (/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(text) || /^[A-Z][A-Z0-9]*$/.test(text)) ? pairHtml(['待确认','To confirm']) : esc(text);
}

function firstProductMatchValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function opportunityProductMatchCell(item) {
  const score = categoryProcurementScore(item);
  const band = String(item.category_procurement_match_band || item.band || '').toUpperCase();
  const status = String(item.category_procurement_match_status || item.match_status || '').toUpperCase();
  const hasResult = Boolean(productMatchResultId(item) || band || status || item.category_procurement_match_calculated_at || item.created_at);
  if (score == null && !hasResult) return `<span class="crm-cell-empty">${bi('商品类目评分待评估','Product Category Score not assessed')}</span>`;
  const coverage = numericValue(item.category_procurement_coverage ?? item.coverage_percent ?? item.coverage);
  const unknown = score == null || !band || band === 'UNKNOWN';
  const boundedCoverage = coverage == null ? null : Math.min(100,Math.max(0,coverage));
  return `<span class="crm-product-match-cell ${unknown ? 'is-unknown' : ''}"><span class="crm-product-match-heading">${unknown ? enumBadge(productMatchBandLabel('UNKNOWN'),'unknown') : `<b>${esc(Math.round(score))}/100</b>${enumBadge(productMatchBandLabel(band),productMatchBandTone(band))}`}</span>${status ? `<span class="crm-op-cell-details"><span><span class="crm-op-cell-label">${bi('类目供货机会','Category supply opportunity')}</span><strong>${pairHtml(categoryProcurementStatusLabel(status))}</strong></span></span>` : ''}${boundedCoverage == null ? '' : `<span class="crm-op-coverage"><span><span class="crm-op-cell-label">${bi('资料覆盖','Evidence coverage')}</span><strong>${esc(boundedCoverage)}%</strong></span><span class="crm-op-coverage-track" aria-hidden="true"><i style="--coverage:${esc(boundedCoverage)}%"></i></span></span>`}</span>`;
}

function opportunityBuyerModelCell(item) {
  const model = String(item.buyer_business_model || 'UNKNOWN').toUpperCase();
  const subtype = String(item.buyer_subtype || '').toUpperCase();
  return `<span class="crm-buyer-model-cell">${enumBadge(buyerBusinessModelLabel(model),buyerBusinessModelTone(model))}${subtype ? `<span class="crm-op-cell-details"><span><span class="crm-op-cell-label">${bi('客户类型','Buyer type')}</span><strong>${pairHtml(buyerSubtypeLabel(subtype))}</strong></span></span>` : ''}</span>`;
}

function opportunityProductSummaryCell(item) {
  const observed = valueList(item.observed_customer_categories || item.observed_categories || item.matched_categories);
  const matched = valueList(item.matched_scopes || item.dpv_category_scopes);
  const basis = String(item.match_basis || '').toUpperCase();
  if (!observed.length && !matched.length && !basis) return `<span class="crm-cell-empty">${bi('类目机会待评估','Category opportunity not assessed')}</span>`;
  const basisLabel=({EXACT_CATEGORY:['相同类目','Exact category'],SIMILAR_CATEGORY:['相似类目','Similar category'],PROFILE_SCOPE:['同一批准画像','Approved profile scope'],OUT_OF_SCOPE:['超出批准类目','Out of scope']})[basis]||['匹配依据待确认','Match basis to confirm'];
  return `<span class="crm-product-opportunity-cell">${observed.length ? `<span>${bi('客户采购/经营类目','Customer procurement/category')}<strong>${observed.slice(0,2).map(productMatchBusinessValue).join(' · ')}</strong></span>` : ''}${matched.length ? `<span>${bi('DPV 可供货类目','DPV supply categories')}<strong>${matched.slice(0,2).map(productMatchBusinessValue).join(' · ')}</strong></span>` : ''}${basis ? `<span>${bi('类目机会依据','Category opportunity basis')}<strong>${pairHtml(basisLabel)}</strong></span>` : ''}</span>`;
}

function opportunitySupplierAccessCell(item) {
  const band = String(item.supplier_access_band || 'UNKNOWN').toUpperCase();
  const score = numericValue(item.supplier_access_score);
  const coverage = numericValue(item.supplier_access_coverage);
  const boundedCoverage = coverage == null ? null : Math.min(100,Math.max(0,coverage));
  return `<span class="crm-supplier-access-cell"><span class="crm-product-match-heading">${score == null ? '' : `<b>${esc(Math.round(score))}/100</b>`}${enumBadge(supplierAccessBandLabel(band),supplierAccessBandTone(band))}</span>${boundedCoverage == null ? '' : `<span class="crm-op-coverage"><span><span class="crm-op-cell-label">${bi('资料覆盖','Evidence coverage')}</span><strong>${esc(boundedCoverage)}%</strong></span><span class="crm-op-coverage-track" aria-hidden="true"><i style="--coverage:${esc(boundedCoverage)}%"></i></span></span>`}</span>`;
}

function opportunitySecondaryScores(item) {
  const management = managementMatchScoreValue(item);
  const historical = historicalMatchScoreValue(item);
  const dpv = leadScoreValue(item);
  const tier = displayValue(item.tier || item.current_tier) || '-';
  const scoreValue = value => value == null ? bi('待计算','Not calculated') : `<b>${esc(Math.round(value))}/100</b>`;
  return `<span class="crm-secondary-scores"><span>${bi('管理基准','Management')}${scoreValue(management)}</span><span>${bi('墨西哥历史参考','MX Historical')}${scoreValue(historical)}</span><span>${bi('DPV 评分 / 等级','DPV Score / Tier')}<b>${dpv == null ? '-' : `${esc(Math.round(dpv))}/100`} · ${esc(tier)}</b></span></span>`;
}

function opportunitySupplierCell(item) {
  const count = Number(item.supplier_route_count || 0);
  const portal = safeUrl(item.supplier_portal_url);
  const countLabel = count ? bi(`${count} 条商务路径`,`${count} business ${count === 1 ? 'route' : 'routes'}`) : bi('供应商路径待补充','Supplier route required');
  return `<span class="crm-supplier-route">${countLabel}${portal !== '#' ? `<a href="${esc(portal)}" target="_blank" rel="noreferrer">${bi('打开供应商入口','Open supplier route')}</a>` : ''}</span>`;
}

function opportunityBarrierCell(item) {
  const barriers = valueList(item.barrier_signals);
  if (!barriers.length) return `<span class="crm-cell-empty">${bi('障碍待确认','Barriers to confirm')}</span>`;
  const extra = barriers.length > 1 ? `<small>${bi(`另有 ${barriers.length - 1} 项`,`Plus ${barriers.length - 1} more`)}</small>` : '';
  return `${pairHtml(barrierSignalLabel(barriers[0]))}${extra}`;
}

function phase9BlockerGroup(item,reasons = []) {
  const explicit = displayValue(item.blocker_group || item.task_type || item.latest_blocker).toUpperCase();
  if (['PRODUCT','BUYER_MODEL','SUPPLIER_ACCESS','CONTACT','BUYER_ROLE','EMAIL','TEMPORARY_ERROR','HISTORY','IDENTITY'].includes(explicit)) return explicit;
  const codes = reasons.map(value=>String(value || '').toUpperCase()).join(' ');
  if (/TEMPORARY|PROVIDER|NETWORK|TIMEOUT/.test(codes)) return 'TEMPORARY_ERROR';
  if (/HISTORY|HISTORICAL|CRM/.test(codes)) return 'HISTORY';
  if (/IDENTITY|COMPANY_VERIFICATION|PUBLIC_WEBSITE/.test(codes)) return 'IDENTITY';
  if (/EMAIL|MAILBOX/.test(codes)) return 'EMAIL';
  if (/SUPPLIER|ACCESS/.test(codes)) return 'SUPPLIER_ACCESS';
  if (/BUYER_MODEL|DISTRIBUTION|RESALE/.test(codes)) return 'BUYER_MODEL';
  if (/BUYER_ROLE|DECISION_MAKER|PROCUREMENT_RESPONSIBILITY/.test(codes)) return 'BUYER_ROLE';
  if (/CONTACT|BUYER_REQUIRED/.test(codes)) return 'CONTACT';
  return 'PRODUCT';
}

function phase9BlockerLabel(code) {
  return ({
    PRODUCT:['客户类目资料','Customer Category Evidence'], BUYER_MODEL:['采购模式','Buyer Model'],
    SUPPLIER_ACCESS:['供应商准入','Supplier Access'], CONTACT:['采购联系人','Buyer Contact'],
    BUYER_ROLE:['采购职责','Buyer Role'], EMAIL:['邮箱核验','Email verification'],
    TEMPORARY_ERROR:['暂时错误','Temporary Error'], HISTORY:['历史记录','History'],
    IDENTITY:['企业身份','Identity']
  })[code] || ['待补资料','Evidence Required'];
}

function phase9BlockerAction(code) {
  return ({
    PRODUCT:['收集品类资料','Collect category evidence'],
    BUYER_MODEL:['核验采购与转售模式','Verify buyer model and resale'],
    SUPPLIER_ACCESS:['复核供应商准入','Review supplier access'],
    CONTACT:['查找采购联系人','Find profile buyer'],
    BUYER_ROLE:['核验采购职责','Verify procurement responsibility'],
    EMAIL:['核验商务邮箱','Verify business email'],
    TEMPORARY_ERROR:['复核并重试任务','Review and retry task'],
    HISTORY:['打开客户记录复核','Open company record review'],
    IDENTITY:['打开企业身份复核','Open company identity review']
  })[code] || ['打开研究任务','Open research job'];
}

function phase10EvidenceWorkstream(item,blocker='') {
  const explicit=displayValue(item.task_class || item.workstream || item.evidence_workstream).toUpperCase();
  const autoStatus=displayValue(item.auto_evidence_status || item.automation_status).toUpperCase();
  if(explicit==='HUMAN_REVIEW'||item.human_review_required===true||autoStatus==='HUMAN_REVIEW_REQUIRED') return 'HUMAN_REVIEW';
  return 'AUTO_ENRICHMENT';
}

function phase10EvidenceAction(item,blocker) {
  return ({
    AUTO_ENRICHMENT:['查看补证进度','View enrichment progress'],
    HUMAN_REVIEW:['处理例外','Review exception']
  })[phase10EvidenceWorkstream(item,blocker)];
}

function phase9RouteEvidenceTask(item,blocker,trigger) {
  const jobId = displayValue(item.auto_evidence_job_id || item.research_job_id || item.job_id);
  document.dispatchEvent(new CustomEvent('phase9:jobs-route',{ detail:{ blocker,jobId,companyId:companyIdFor(item),opportunityId:item.opportunity_id,trigger } }));
}

function renderOpportunityTable() {
  const host = $('#opportunity-table');
  if (!host) return;
  const table = host.closest('table');
  const tableRegion = table?.closest('.table-responsive');
  let stateHost = $('#opportunity-result-state');
  if (!stateHost && tableRegion) {
    stateHost = document.createElement('div');
    stateHost.id = 'opportunity-result-state';
    stateHost.className = 'p8-opportunity-result-state';
    stateHost.hidden = true;
    tableRegion.after(stateHost);
  }
  const evidenceHost = $('#evidence-required-list');
  const filters = collectOpportunityFilters();
  const selectedStatus = String(filters.status || 'RECOMMENDED').toUpperCase();
  const search = String($('#opportunity-search')?.value || '').trim().toLowerCase();
  const items = (state.opportunitiesFromApi ? state.opportunities : []).filter(item=>!search || String(item.company_name || item.resolved_company_name || '').toLowerCase().includes(search));
  setOpportunityResultSummary(items.length,selectedStatus);

  if (state.opportunitiesError) {
    if (table) table.hidden = true;
    if (evidenceHost) evidenceHost.hidden = true;
    if (stateHost) {
      stateHost.hidden = false;
      stateHost.innerHTML = `<div class="opw-empty-state is-error" role="alert"><span class="opw-empty-icon"><i class="ti ti-cloud-off" aria-hidden="true"></i></span><div><h3>${bi('业务机会读取失败','Opportunity data could not be loaded')}</h3><p>${bi('请检查连接后重新读取；公司名录不会代替业务机会。','Check the connection and retry. Company records are never substituted.')}</p></div><button class="btn btn-primary" type="button" data-opportunity-retry>${bi('重新读取','Retry')}</button></div>`;
      stateHost.querySelector('[data-opportunity-retry]')?.addEventListener('click',loadOpportunities);
    }
    return;
  }

  if (!items.length) {
    if (table) table.hidden = true;
    if (evidenceHost) evidenceHost.hidden = true;
    if (stateHost) {
      stateHost.hidden = false;
      stateHost.innerHTML = selectedStatus === 'RECOMMENDED' && !activeOpportunityFilterCount(filters)
        ? `<div class="opw-empty-state"><span class="opw-empty-icon"><i class="ti ti-user-search" aria-hidden="true"></i></span><div><h3>${bi('尚无联系就绪机会','No contact-ready opportunities yet')}</h3></div><button class="btn btn-outline-primary" type="button" data-opportunity-evidence-view>${bi('查看待补资料','View Evidence Required')}</button></div>`
        : `<div class="opw-empty-state"><span class="opw-empty-icon"><i class="ti ti-filter-search" aria-hidden="true"></i></span><div><h3>${bi('当前筛选没有业务机会','No opportunities match the current view')}</h3></div></div>`;
      stateHost.querySelector('[data-opportunity-evidence-view]')?.addEventListener('click',()=>{
        const select = $('#opportunity-status');
        if (select) { select.value = 'EVIDENCE_REQUIRED'; select.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }
    return;
  }

  if (stateHost) stateHost.hidden = true;
  if (selectedStatus === 'EVIDENCE_REQUIRED' && evidenceHost) {
    if (table) table.hidden = true;
    evidenceHost.hidden = false;
    const grouped = new Map();
    items.forEach(item=>{
      const reasons = valueList(item.reason_codes || item.evidence_required_reasons || item.blocker_reasons);
      const blocker = phase9BlockerGroup(item,reasons);
      if (!grouped.has(blocker)) grouped.set(blocker,[]);
      grouped.get(blocker).push({ item,reasons });
    });
    evidenceHost.innerHTML = [...grouped.entries()].map(([blocker,records])=>{
      const label = phase9BlockerLabel(blocker);
      return `<section class="p9-blocker-group" data-blocker-group="${esc(blocker)}"><header><div><i class="ti ti-file-search" aria-hidden="true"></i><h3>${bi(label[0],label[1])}</h3></div><span class="p9-blocker-count" aria-label="${esc(`${records.length} 条记录 ${records.length} records`)}">${records.length}</span></header>${records.map(({item,reasons})=>{
        const reason = reasons[0] ? phase7ReasonLabel(reasons[0]) : ['待补资料项待确认','Evidence requirement to confirm'];
        const action=phase10EvidenceAction(item,blocker);
        return `<article class="p8-evidence-row"><div class="p8-evidence-company"><strong>${esc(item.company_name || item.resolved_company_name || '-')}</strong><span>${productProfilesCell(item)}</span></div><div class="p8-evidence-blocker"><span class="p8-evidence-label">${bi('待补项目','Evidence gap')}</span><strong>${pairHtml(reason)}</strong></div><div class="p8-evidence-score"><span class="p8-evidence-label">${bi('商品类目评分','Product Category Score')}</span>${opportunityProductMatchCell(item)}</div><div class="p8-evidence-date"><span class="p8-evidence-label">${bi('最近评估','Last assessed')}</span><time>${esc(shortDate(item.calculated_at || item.updated_at || item.created_at))}</time></div><div class="p9-evidence-actions"><button class="btn btn-primary" type="button" data-evidence-task="${esc(leadIdFor(item))}" data-evidence-blocker="${esc(blocker)}">${bi(action[0],action[1])}</button><button class="btn btn-outline-primary" type="button" data-opportunity-id="${esc(leadIdFor(item))}">${bi('查看详情','View details')}</button></div></article>`;
      }).join('')}</section>`;
    }).join('');
    evidenceHost.querySelectorAll('[data-opportunity-id]').forEach(button=>button.addEventListener('click',()=>showLead(button.dataset.opportunityId)));
    evidenceHost.querySelectorAll('[data-evidence-task]').forEach(button=>button.addEventListener('click',()=>{
      const item = items.find(record=>String(leadIdFor(record)) === button.dataset.evidenceTask);
      if (item) phase9RouteEvidenceTask(item,button.dataset.evidenceBlocker,button);
    }));
    return;
  }
  if (evidenceHost) evidenceHost.hidden = true;
  if (table) table.hidden = false;
  host.innerHTML = items.map(item=>{
    const opportunityKey = displayValue(item.opportunity_key) || `${companyIdFor(item)}:${productProfileCode(item) || 'UNSPECIFIED'}`;
    const contact = { contact_type:item.best_contact_type,value:item.best_contact };
    const displayOpportunity = phase7OpportunityStatus(item);
    return `<tr data-opportunity-key="${esc(opportunityKey)}">
      <td class="op-col-company" data-label="公司 / Company"><div class="crm-op-cell"><button class="crm-company-link crm-opportunity-company" type="button" data-opportunity-id="${esc(leadIdFor(item))}"><span>${esc(item.company_name || item.resolved_company_name || '-')}</span><span class="lead-select-action">${bi('查看机会','View opportunity')}</span></button></div></td>
      <td class="op-col-market-product" data-label="市场与产品画像 / Market and product profile"><div class="crm-op-cell"><strong>${esc(marketValue(item))}</strong>${productProfilesCell(item)}</div></td>
      <td class="op-col-status" data-label="机会状态 / Opportunity Status"><div class="crm-op-cell is-status">${displayOpportunity ? phase7OpportunityBadge(displayOpportunity) : `<span class="crm-cell-empty">${bi('待确认','To confirm')}</span>`}</div></td>
      <td class="op-col-buyer-model" data-label="采购模式与职责 / Buyer Model and Role"><div class="crm-op-cell">${opportunityBuyerModelCell(item)}${opportunityRoleCell(item)}</div></td>
      <td class="op-col-product-match" data-label="商品类目评分 / Product Category Score"><div class="crm-op-cell">${opportunityProductMatchCell(item)}</div></td>
      <td class="op-col-contact" data-label="采购联系人 / Buyer and valid contact"><div class="crm-op-cell">${opportunityBuyerCell(item)}${contactValueHtml(contact)}</div></td>
      <td class="op-col-supplier-action" data-label="供应商准入与操作 / Supplier Access and Action"><div class="crm-op-cell crm-op-action-cell">${opportunitySupplierAccessCell(item)}${opportunitySupplierCell(item)}<button class="btn btn-outline-primary" type="button" data-opportunity-id="${esc(leadIdFor(item))}">${bi('查看详情','View details')}</button></div></td></tr>`;
  }).join('');
  host.querySelectorAll('[data-opportunity-id]').forEach(button=>button.addEventListener('click',()=>showLead(button.dataset.opportunityId)));
}

async function loadOpportunities() {
  const host = $('#opportunity-table');
  const query = buildOpportunityQuery(collectOpportunityFilters(),100);
  host?.closest('.table-responsive')?.setAttribute('aria-busy','true');
  try {
    const payload = await json(`/api/opportunities?${query}`);
    const opportunities = Array.isArray(payload) ? payload : payload.items || payload.opportunities || [];
    state.opportunities = opportunities.filter(companyMarketIsVisible);
    state.opportunitiesFromApi = true;
    state.opportunitiesError = false;
  } catch {
    state.opportunities = [];
    state.opportunitiesFromApi = true;
    state.opportunitiesError = true;
    host?.setAttribute('data-load-message','重新读取 Retry');
  }
  if (!$('#tier')?.value && !$('#size')?.value && !$('#verification-filter')?.value && !$('#lifecycle-filter')?.value) {
    const opportunityById = new Map(state.opportunities.map(item=>[String(companyIdFor(item)),item]));
    const leadIds = new Set(state.leads.map(item=>String(companyIdFor(item))));
    state.leads = state.leads.map(lead=>({ ...lead, ...(opportunityById.get(String(companyIdFor(lead))) || {}), approval_status:lead.approval_status, company_type:lead.company_type }));
    state.leads.push(...state.opportunities.filter(item=>!leadIds.has(String(companyIdFor(item)))));
    renderCompanyTable();
    renderOverviewCompanies();
  }
  renderOpportunityTable();
  host?.closest('.table-responsive')?.setAttribute('aria-busy','false');
  syncOpportunityFilters();
}

const importStatusLabels = {
  DISCOVERED:['已发现','Discovered'], STAGED:['已暂存','Staged'], PARSED:['已读取','Parsed'],
  VALIDATED:['已验证','Validated'], DRY_RUN_PASSED:['预检通过','Dry run passed'], IMPORTED:['已导入','Imported'],
  PARTIAL:['部分完成','Partial'], FAILED:['失败','Failed']
};
const importStatusTone = {
  DISCOVERED:'review', STAGED:'review', PARSED:'review', VALIDATED:'current', DRY_RUN_PASSED:'current',
  IMPORTED:'active', PARTIAL:'aging', FAILED:'rejected'
};
const importStatusBadge = value => {
  const code = String(value || 'DISCOVERED').toUpperCase();
  const label = importStatusLabels[code] || [humanizeCode(code),humanizeCode(code)];
  return `<span class="data-state-badge state-${esc(importStatusTone[code] || 'review')}">${bi(label[0],label[1])}</span>`;
};
const batchCount = (batch, ...keys) => {
  for (const key of keys) {
    const value = batch?.[key];
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Math.max(0,Number(value));
  }
  return 0;
};
const importBatchItems = payload => Array.isArray(payload) ? payload : payload?.items || payload?.batches || [];

function renderImportBatches(items, loadError = false) {
  const host = $('#import-batches');
  const status = $('#import-batches-status');
  if (!host || !status) return;
  const safeItems = Array.isArray(items) ? items : [];
  if (loadError) {
    status.innerHTML = bi('导入批次读取失败','Import batches could not be loaded');
    host.innerHTML = `<tr><td colspan="10" class="crm-loading-cell">${bi('暂时无法读取导入批次。','Import batches are temporarily unavailable.')} <button id="import-batches-retry" class="btn btn-sm btn-outline-secondary" type="button">${bi('重新读取','Retry')}</button></td></tr>`;
    $('#import-batches-retry')?.addEventListener('click',loadImportBatches);
    return;
  }
  status.innerHTML = bi(`共 ${safeItems.length} 个批次`,`${safeItems.length} ${safeItems.length === 1 ? 'batch' : 'batches'}`);
  host.innerHTML = safeItems.length ? safeItems.map(batch=>{
    const batchName = displayValue(batch.import_batch || batch.import_batch_key || batch.batch_id || batch.batch_key || batch.id) || '-';
    const importedAt = batch.imported_at || batch.committed_at || batch.updated_at || batch.created_at || null;
    return `<tr><td><strong>${esc(batchName)}</strong></td><td>${importStatusBadge(batch.status)}</td><td class="crm-number-cell">${esc(batchCount(batch,'source_files','source_file_count','files_count'))}</td><td class="crm-number-cell">${esc(batchCount(batch,'customers','customer_count'))}</td><td class="crm-number-cell">${esc(batchCount(batch,'orders','order_count'))}</td><td class="crm-number-cell">${esc(batchCount(batch,'products','product_count'))}</td><td class="crm-number-cell">${esc(batchCount(batch,'follow_up_rows','followup_rows','follow_up_count','followup_count'))}</td><td class="crm-number-cell">${esc(batchCount(batch,'errors','error_count'))}</td><td class="crm-number-cell">${esc(batchCount(batch,'warnings','warning_count'))}</td><td>${esc(importedAt ? new Date(importedAt).toLocaleString() : '-')}</td></tr>`;
  }).join('') : `<tr><td colspan="10" class="crm-loading-cell">${bi('尚无导入批次。','No import batches are available.')}</td></tr>`;
}

async function loadImportBatches() {
  const status = $('#import-batches-status');
  if (status) status.innerHTML = bi('正在读取导入批次','Loading import batches');
  try {
    state.importBatches = importBatchItems(await json('/api/import-batches'));
    renderImportBatches(state.importBatches,false);
  } catch {
    state.importBatches = [];
    renderImportBatches([],true);
  }
}

const crmHistoryItems = payload => Array.isArray(payload) ? payload
  : payload?.items || payload?.records || payload?.companies || payload?.customers || [];
const crmHistoryId = item => item?.id || item?.crm_history_id || item?.historical_customer_id || item?.source_customer_id_key || '';
const crmHistoryCompany = item => displayValue(item?.company_name || item?.company_name_raw || item?.customer_name) || '-';
const crmHistoryCountry = item => displayValue(item?.country_name || item?.country_region || item?.country_code || item?.country) || '-';
const crmHistoryOwner = item => displayValue(item?.owner_raw || item?.crm_owner_raw || item?.crm_owner || item?.owner) || '-';
const crmHistoryDate = item => item?.latest_activity_at || item?.latest_crm_activity_at || item?.last_activity_at || item?.last_contact_at || item?.latest_known_activity_at || null;
const crmHistoryCount = (item, ...keys) => {
  for (const key of keys) {
    const value = item?.[key];
    if (Array.isArray(value)) return value.length;
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Math.max(0,Number(value));
  }
  return null;
};
const crmCountDisplay = value => value === null || value === undefined ? '-' : String(value);
const crmStatusPair = item => {
  const code = String(item?.crm_status_normalized || item?.prior_status || item?.crm_status_raw || item?.customer_status || '').trim();
  const key = code.toUpperCase();
  const labels = {
    '在跟进':['跟进中','In progress'], IN_PROGRESS:['跟进中','In progress'], OPEN:['跟进中','In progress'],
    '待跟进':['待跟进','Pending follow-up'], PENDING:['待跟进','Pending follow-up'], PENDING_FOLLOW_UP:['待跟进','Pending follow-up'],
    '无':['无状态','No status'], NO_STATUS:['无状态','No status'], UNKNOWN:['待确认','To confirm']
  };
  return labels[code] || labels[key] || (code ? [code,code] : ['待确认','To confirm']);
};
const crmClassificationPair = value => ({
  INTERNAL_EXISTING_CUSTOMER:['已确认既有客户','Confirmed existing customer'],
  HISTORICAL_CRM_LEAD:['历史客户线索','Historical CRM lead'],
  HISTORICAL_CONTACTED_LEAD:['曾联系客户线索','Previously contacted lead'],
  HISTORICAL_OPEN_LEAD:['历史跟进中线索','Historical open lead'],
  REVIEW:['待确认关联','Link to review']
}[String(value || '').toUpperCase()] || ['待确认关联','Link to review']);
const crmClassificationTone = value => ({
  INTERNAL_EXISTING_CUSTOMER:'active', HISTORICAL_CRM_LEAD:'current',
  HISTORICAL_CONTACTED_LEAD:'current', HISTORICAL_OPEN_LEAD:'current', REVIEW:'review'
}[String(value || '').toUpperCase()] || 'review');
const crmHistoryClassification = item => item?.customer_classification || item?.customer_role || item?.classification || item?.reconciliation_status || item?.account_classification || 'REVIEW';
const crmHistoryStatusBadge = item => {
  const pair = crmStatusPair(item);
  return `<span class="data-state-badge state-current">${bi(pair[0],pair[1])}</span>`;
};
const crmHistoryClassificationBadge = item => {
  const value = crmHistoryClassification(item);
  const pair = crmClassificationPair(value);
  return `<span class="data-state-badge state-${esc(crmClassificationTone(value))}">${bi(pair[0],pair[1])}</span>`;
};

function ensureCrmHistoryPanel() {
  if ($('#crm-history-panel')) return;
  const jobsView = $('#jobs-legacy-records') || $('#view-jobs');
  if (!jobsView) return;
  const panel = document.createElement('section');
  panel.id = 'crm-history-panel';
  panel.className = 'card crm-panel crm-history-panel';
  panel.setAttribute('aria-labelledby','crm-history-title');
  panel.innerHTML = `<header class="card-header crm-panel-header"><div><h3 id="crm-history-title" class="card-title">${bi('历史客户记录','Historical CRM Records')}</h3></div><div id="crm-history-status" class="crm-import-status" role="status" aria-live="polite" aria-atomic="true">${bi('正在读取历史客户记录','Loading historical CRM records')}</div></header>
    <div id="crm-history-import-summary" class="crm-history-summary" aria-busy="true"><div class="crm-state-placeholder">${bi('正在读取历史资料汇总','Loading historical record summary')}</div></div>
    <div class="table-responsive crm-history-table-region" role="region" aria-label="历史客户记录表 Historical CRM records table" tabindex="0"><table class="table table-vcenter card-table crm-table crm-history-directory-table"><thead><tr><th>${bi('公司','Company')}</th><th>${bi('国家地区','Country or region')}</th><th>${bi('历史状态','Prior CRM status')}</th><th>${bi('记录分类','Historical classification')}</th><th>${bi('联系人','Contacts')}</th><th>${bi('最近活动','Latest activity')}</th><th>${bi('营销邮件','Marketing emails')}</th><th>${bi('跟进记录','Follow-ups')}</th><th>${bi('负责人','CRM owner')}</th><th>${bi('操作','Action')}</th></tr></thead><tbody id="crm-history-records"><tr><td colspan="10" class="crm-loading-cell">${bi('正在读取历史客户记录','Loading historical CRM records')}</td></tr></tbody></table></div>
    <footer id="crm-history-pagination" class="card-footer crm-pagination" aria-label="历史客户记录分页 Historical CRM pagination"></footer>`;
  jobsView.append(panel);
}

function renderCrmHistoryImportSummary(summary, loadError = false) {
  const host = $('#crm-history-import-summary');
  if (!host) return;
  host.setAttribute('aria-busy','false');
  if (loadError || !summary) {
    host.innerHTML = `<div class="crm-state-placeholder">${bi('历史资料汇总暂时不可用','Historical record summary is temporarily unavailable')}</div>`;
    return;
  }
  const outcomeCoverage = String(summary.win_loss_coverage || '').toUpperCase() === 'NONE'
    ? bi('暂无明确结果','No explicit outcomes')
    : esc(displayValue(summary.win_loss_coverage) || crmCountDisplay(crmHistoryCount(summary,'outcome_count')));
  const summaryItems = [
    ['导入状态','Import status',importStatusBadge(summary.status)],
    ['客户','Customers',esc(crmCountDisplay(crmHistoryCount(summary,'customer_count','customers')))],
    ['联系人','Contacts',esc(crmCountDisplay(crmHistoryCount(summary,'contact_count','contacts')))],
    ['历史活动','Activities',esc(crmCountDisplay(crmHistoryCount(summary,'activity_count','activities')))],
    ['业务结果','Business outcomes',outcomeCoverage]
  ];
  host.innerHTML = summaryItems.map(([zh,en,value])=>`<div><span>${bi(zh,en)}</span><b>${value}</b></div>`).join('');
}

function renderCrmHistoryList(items, loadError = false) {
  const host = $('#crm-history-records');
  const status = $('#crm-history-status');
  const pagination = $('#crm-history-pagination');
  if (!host || !status || !pagination) return;
  const safeItems = Array.isArray(items) ? items : [];
  if (loadError) {
    status.innerHTML = bi('历史客户记录读取失败','Historical CRM records could not be loaded');
    host.innerHTML = `<tr><td colspan="10" class="crm-loading-cell">${bi('暂时无法读取历史客户记录。','Historical CRM records are temporarily unavailable.')} <button id="crm-history-retry" class="btn btn-sm btn-outline-secondary" type="button">${bi('重新读取','Retry')}</button></td></tr>`;
    pagination.innerHTML = '';
    $('#crm-history-retry')?.addEventListener('click',loadCrmHistory);
    return;
  }
  const pageCount = Math.max(1,Math.ceil(safeItems.length/state.crmHistoryPageSize));
  state.crmHistoryPage = Math.min(Math.max(1,state.crmHistoryPage),pageCount);
  const pageItems = safeItems.slice((state.crmHistoryPage-1)*state.crmHistoryPageSize,state.crmHistoryPage*state.crmHistoryPageSize);
  status.innerHTML = bi(`共 ${safeItems.length} 家历史客户`,` ${safeItems.length} historical CRM ${safeItems.length === 1 ? 'record' : 'records'}`.trim());
  host.innerHTML = pageItems.length ? pageItems.map(item=>{
    const id = crmHistoryId(item);
    const latest = crmHistoryDate(item);
    return `<tr data-crm-history-row="${esc(id)}"><td><strong>${esc(crmHistoryCompany(item))}</strong></td><td>${esc(crmHistoryCountry(item))}</td><td>${crmHistoryStatusBadge(item)}</td><td>${crmHistoryClassificationBadge(item)}</td><td class="crm-number-cell">${esc(crmCountDisplay(crmHistoryCount(item,'contact_count','contacts_count','contacts')))}</td><td>${esc(latest ? new Date(latest).toLocaleString() : '-')}</td><td class="crm-number-cell">${esc(crmCountDisplay(crmHistoryCount(item,'edm_count','marketing_email_count','outbound_marketing_email_count')))}</td><td class="crm-number-cell">${esc(crmCountDisplay(crmHistoryCount(item,'followup_count','follow_up_count','manual_follow_up_count')))}</td><td>${esc(crmHistoryOwner(item))}</td><td><button class="btn btn-sm btn-outline-primary crm-history-open" type="button" data-crm-history-id="${esc(id)}" ${id ? '' : 'disabled'}>${bi('查看','View')}</button></td></tr>`;
  }).join('') : `<tr><td colspan="10" class="crm-loading-cell">${bi('尚无历史客户记录。','No historical CRM records are available.')}</td></tr>`;
  pagination.innerHTML = safeItems.length ? `<span>${bi(`第 ${state.crmHistoryPage} / ${pageCount} 页，共 ${safeItems.length} 家`,`Page ${state.crmHistoryPage} of ${pageCount}, ${safeItems.length} records`)}</span><div class="crm-pagination-actions"><button class="btn btn-outline-secondary" type="button" data-crm-page="prev" ${state.crmHistoryPage<=1?'disabled':''}>${bi('上一页','Previous')}</button><button class="btn btn-outline-secondary" type="button" data-crm-page="next" ${state.crmHistoryPage>=pageCount?'disabled':''}>${bi('下一页','Next')}</button></div>` : '';
  host.querySelectorAll('[data-crm-history-id]').forEach(button=>button.addEventListener('click',()=>showCrmHistory(button.dataset.crmHistoryId,button)));
  pagination.querySelector('[data-crm-page="prev"]')?.addEventListener('click',()=>{ state.crmHistoryPage-=1; renderCrmHistoryList(state.crmHistory); });
  pagination.querySelector('[data-crm-page="next"]')?.addEventListener('click',()=>{ state.crmHistoryPage+=1; renderCrmHistoryList(state.crmHistory); });
}

async function loadCrmHistory() {
  ensureCrmHistoryPanel();
  const status = $('#crm-history-status');
  const host = $('#crm-history-records');
  if (status) status.innerHTML = bi('正在读取历史客户记录','Loading historical CRM records');
  if (host) host.innerHTML = `<tr><td colspan="10" class="crm-loading-cell">${bi('正在读取历史客户记录','Loading historical CRM records')}</td></tr>`;
  const [recordsResult,summaryResult] = await Promise.allSettled([
    json('/api/crm-history?limit=200'),
    json('/api/crm-history/import-summary')
  ]);
  if (recordsResult.status === 'fulfilled') {
    state.crmHistory = crmHistoryItems(recordsResult.value);
    renderCrmHistoryList(state.crmHistory,false);
  } else {
    state.crmHistory = [];
    renderCrmHistoryList([],true);
  }
  renderCrmHistoryImportSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null,summaryResult.status === 'rejected');
}

async function loadLeads() {
  const tier = $('#tier').value;
  const size = $('#size').value;
  const verification = $('#verification-filter')?.value || '';
  const lifecycle = $('#lifecycle-filter')?.value || '';
  const query = new URLSearchParams();
  if (tier) query.set('tier', tier);
  if (size) query.set('size', size);
  if (verification) query.set('verification_status', verification);
  if (lifecycle) query.set('lifecycle_status', lifecycle);
  state.leads = (await json(`/api/leads${query.size ? `?${query}` : ''}`)).filter(companyMarketIsVisible);
  renderCompanyTable();
  renderOverviewCompanies();
  await loadOpportunities();
}

const BUSINESS_CODE_LABELS = Object.freeze({
  AE:['阿联酋（AE）','United Arab Emirates (AE)'], MX:['墨西哥（MX）','Mexico (MX)'],
  MANAGEMENT_BASELINE:['管理基准','Management Baseline'], HISTORICAL_CUSTOMER_ICP:['历史客户画像','Historical Customer ICP'],
  CONVERTED_ORDER_HISTORY:['已成交客户与订单记录','Converted customer and order history'],
  AVAILABLE:['有资料','Available'], UNAVAILABLE:['暂无资料','Unavailable'], MISSING:['资料待补充','Missing'], UNKNOWN:['待确认','Unknown'],
  WOMENSWEAR:['全品类女装',"Full-category Women's Apparel"], GENERAL_MERCHANDISE:['日用百货','General Merchandise'],
  DRESSES:['连衣裙','Dresses'], TOPS:['上衣','Tops'], SKIRTS:['半身裙','Skirts'], TROUSERS:['女裤','Trousers'], OUTERWEAR:['外套','Outerwear'], KNITWEAR:['针织衫','Knitwear'],
  HOUSEHOLD_GOODS:['家居用品','Household Goods'], HOMEWARE:['家居百货','Homeware'], DAILY_USE_GOODS:['日用商品','Daily-use Goods'], HOME_AND_LIVING:['家居生活用品','Home and Living'], NON_FOOD:['非食品百货','Non-food'],
  BUYER:['采购商','Buyer'], SENIOR_BUYER:['高级采购','Senior Buyer'], CATEGORY_BUYER:['品类采购','Category Buyer'], FASHION_BUYER:['时装采购','Fashion Buyer'],
  WOMENSWEAR_BUYER:['女装采购','Womenswear Buyer'], APPAREL_BUYER:['服装采购','Apparel Buyer'], MERCHANDISE_BUYER:['商品采购','Merchandise Buyer'],
  GENERAL_MERCHANDISE_BUYER:['日用百货采购','General Merchandise Buyer'], HOUSEHOLD_BUYER:['家居用品采购','Household Buyer'], HOME_AND_LIVING_BUYER:['家居生活采购','Home and Living Buyer'], NON_FOOD_BUYER:['非食品采购','Non-food Buyer'],
  PURCHASING_MANAGER:['采购经理','Purchasing Manager'], PROCUREMENT_MANAGER:['采购管理经理','Procurement Manager'], HEAD_OF_BUYING:['采购负责人','Head of Buying'], SOURCING_MANAGER:['寻源经理','Sourcing Manager'], CATEGORY_MANAGER:['品类经理','Category Manager'],
  CHAIN_APPAREL_RETAILER:['连锁服装零售商','Chain Apparel Retailer'], DEPARTMENT_STORE:['百货商场','Department Store'], LARGE_RETAIL_GROUP:['大型零售集团','Large Retail Group'], REGIONAL_RETAIL_CHAIN:['区域零售连锁','Regional Retail Chain'],
  APPAREL_IMPORTER:['服装进口商','Apparel Importer'], APPAREL_WHOLESALER:['服装批发商','Apparel Wholesaler'], APPAREL_DISTRIBUTOR:['服装经销商','Apparel Distributor'],
  SUPERMARKET:['超市','Supermarket'], LIFESTYLE_DAILY_USE_GOODS_CHAIN:['生活日用品连锁','Lifestyle and Daily-use Goods Chain'],
  GENERAL_MERCHANDISE_IMPORTER:['日用百货进口商','General Merchandise Importer'], GENERAL_MERCHANDISE_WHOLESALER:['日用百货批发商','General Merchandise Wholesaler'], GENERAL_MERCHANDISE_DISTRIBUTOR:['日用百货经销商','General Merchandise Distributor'],
  MICRO:['微型企业','Micro business'], SMALL:['小型企业','Small business'], MEDIUM:['中型企业','Medium business'], LARGE:['大型企业','Large company'], ENTERPRISE:['企业集团','Enterprise group'],
  SMALL_SINGLE_STORE_RETAIL:['小型单店零售','Small single-store retail'], CONSUMER:['个人消费者','Consumer'], INDIVIDUAL_SELLER:['个人卖家','Individual seller'], SOURCING_AGENT:['寻源代理','Sourcing agent'], PROCUREMENT_AGENT:['采购代理','Procurement agent'], OEM_ONLY:['仅 OEM','OEM only'], ECOMMERCE_ONLY_SMALL_SELLER:['仅电商小卖家','E-commerce-only small seller'], UNVERIFIED_SOCIAL_ACCOUNT:['未核验社交账号','Unverified social account']
});

const profileCodeText = value => {
  const text = displayValue(value);
  if (!text) return '';
  if (/^[A-Z]{2,3}$/.test(text)) return text;
  return /^[A-Z0-9_ -]+$/.test(text)
    ? humanizeCode(text).replace(/\bOem\b/g,'OEM').replace(/\bIcp\b/g,'ICP').replace(/\bB2b\b/g,'B2B').replace(/\bEcommerce\b/g,'E-commerce').replace(/\bNon Food\b/g,'Non-food')
    : text;
};
const businessCodePair = value => {
  const text = displayValue(value);
  if (!text) return ['-','-'];
  const code = text.toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'');
  if (BUSINESS_CODE_LABELS[code]) return BUSINESS_CODE_LABELS[code];
  return /^[A-Z0-9_ -]+$/.test(text) ? ['待确认','To confirm'] : [text,text];
};
const profileTextPair = value => {
  if (Array.isArray(value)) {
    const pairs = value.map(businessCodePair).filter(([,en])=>en);
    return pairs.length ? [pairs.map(([zh])=>zh).join('、'),pairs.map(([,en])=>en).join(', ')] : ['-','-'];
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.distribution)) {
      const pairs = value.distribution.map(item=>{ const [zh,en] = businessCodePair(item.value); return [`${zh}（${item.count ?? 0}）`,`${en} (${item.count ?? 0})`]; });
      return pairs.length ? [pairs.map(([zh])=>zh).join('、'),pairs.map(([,en])=>en).join(', ')] : ['-','-'];
    }
    if (Array.isArray(value.values)) return value.values.length ? profileTextPair(value.values) : value.status ? businessCodePair(value.status) : ['-','-'];
    const pairs = Object.entries(value).map(([key,item])=>{
      const keyPair = businessCodePair(key);
      const itemPair = item && typeof item === 'object' ? profileTextPair(item) : businessCodePair(item);
      return [`${keyPair[0]}：${itemPair[0]}`,`${keyPair[1]}: ${itemPair[1]}`];
    }).filter(([,en])=>!en.endsWith(': '));
    return pairs.length ? [pairs.map(([zh])=>zh).join('；'),pairs.map(([,en])=>en).join('; ')] : ['-','-'];
  }
  const pair = businessCodePair(value);
  return pair[1] ? pair : ['-','-'];
};
const profileText = value => profileTextPair(value)[1];
const pairedValueHtml = pair => pair[0] === pair[1] ? esc(pair[0] || '-') : bi(pair[0] || '-',pair[1] || '-');
const profileValueHtml = value => pairedValueHtml(profileTextPair(value));
const businessCodeHtml = value => pairedValueHtml(businessCodePair(value));

function icpProfileCard(profile) {
  const isHistorical = String(profile?.profile_type || '').toUpperCase() === 'HISTORICAL_CUSTOMER_ICP';
  const isActive = profile?.active === true || profile?.is_active === true || String(profile?.status || '').toUpperCase() === 'ACTIVE';
  const productScope = Array.isArray(profile?.product_scope) ? profile.product_scope[0] : profile?.product_scope;
  const productName = isHistorical ? bi('墨西哥历史业务参考','Mexico historical business reference')
    : String(productScope || '').toUpperCase() === 'GENERAL_MERCHANDISE'
    ? bi('日用百货','General Merchandise') : bi('全品类女装',"Full-category Women's Apparel");
  const titleZh = isHistorical ? '墨西哥历史客户画像' : '管理基准客户画像';
  const titleEn = isHistorical ? 'Mexico Historical Customer ICP' : 'Management Baseline ICP';
  const features = profile?.features || profile?.profile_features || {};
  const featureValue = key => features?.[key]?.feature_value ?? features?.[key];
  const visibleMarketFeature = value => {
    if (Array.isArray(value)) return filterVisibleMarkets(value);
    if (value && typeof value === 'object' && Array.isArray(value.values)) {
      return { ...value, values:filterVisibleMarkets(value.values) };
    }
    return value;
  };
  const groups = [
    ['优先市场','Priority markets',visibleMarketFeature(featureValue('priority_markets'))],
    ['拓展市场','Expansion markets',visibleMarketFeature(featureValue('expansion_markets'))],
    ['目标客户组织','Target organizations',featureValue('organization_types') ?? featureValue('buyer_types')],
    ['目标采购岗位','Preferred buyer roles',featureValue('buyer_roles')],
    ['企业规模','Company size',featureValue('company_sizes') ?? featureValue('company_size')],
    ['业务渠道','Channels',featureValue('channels')],
    ['产品范围','Products',featureValue('product_categories') ?? featureValue('products') ?? profile?.product_scope],
    ['排除类型','Exclusions',featureValue('exclusions')]
  ].filter(([, , value])=>profileText(value) !== '-');
  const featureSample = key => numericValue(features?.[key]?.sample_size);
  const featureCoverage = key => numericValue(features?.[key]?.coverage);
  const coverageStatusLabels = {
    FULL:['完整','Full'], LIMITED:['有限','Limited'], NONE:['无','None'], UNKNOWN:['待确认','Unknown'],
    NOT_AVAILABLE:['暂无','Not available'], UNAVAILABLE:['暂无','Unavailable'], COMPLETE:['完整','Complete']
  };
  const coverageDisplay = (value, status = '') => {
    const numeric = numericValue(value);
    if (numeric != null) return `${esc(numeric)}%`;
    const label = coverageStatusLabels[String(status || '').toUpperCase()];
    return label ? bi(label[0],label[1]) : '-';
  };
  const coverageFrom = (value, status, featureKey) => {
    const display = coverageDisplay(value,status);
    return display === '-' ? coverageDisplay(featureCoverage(featureKey)) : display;
  };
  const managementFacts = [
    ['产品画像','Product profile',productName],['画像类型','Profile type',businessCodeHtml(profile?.profile_type || 'MANAGEMENT_BASELINE')],['市场范围','Market scope',profileValueHtml(filterVisibleMarkets(profile?.market_scope || featureValue('markets')?.values || []))],['成功样本','Win sample',esc(profile?.sample_size_wins ?? 0)],['未转化样本','Loss sample',esc(profile?.sample_size_losses ?? 0)],['订单样本','Order sample',esc(profile?.sample_size_orders ?? 0)],['特征覆盖率','Feature coverage',profile?.feature_coverage == null ? '-' : `${esc(profile.feature_coverage)}%`],['启用时间','Activated',esc(profile?.activated_at ? new Date(profile.activated_at).toLocaleString() : '-')],['历史业务资料','Historical data',bi('未载入','Not loaded')]
  ];
  const historicalFacts = [
    ['参考市场','Reference market',businessCodeHtml(profile?.reference_market || 'MX')],
    ['应用市场','Application markets',profileValueHtml(filterVisibleMarkets(profile?.application_markets || []))],
    ['画像依据','Profile basis',businessCodeHtml(profile?.profile_basis || '')],
    ['客户样本','Sample customers',esc(profile?.sample_size_customers ?? profile?.sample_customer_count ?? profile?.customer_count ?? featureSample('customer_sample') ?? featureSample('buyer_types') ?? 0)],
    ['订单数量','Orders',esc(profile?.order_count ?? profile?.sample_size_orders ?? 0)],
    ['产品画像覆盖率','Product-profile coverage',coverageFrom(profile?.product_profile_coverage,profile?.product_profile_coverage_status,'product_categories')],
    ['复购覆盖率','Repeat-order coverage',coverageFrom(profile?.repeat_order_coverage,profile?.repeat_order_coverage_status,'repeat_orders')],
    ['渠道覆盖率','Channel coverage',coverageFrom(profile?.channel_coverage,profile?.channel_coverage_status,'channels')],
    ['跟进与转化覆盖率','Follow-up / win-loss coverage',coverageFrom(profile?.follow_up_coverage ?? profile?.win_loss_coverage,profile?.follow_up_coverage_status ?? profile?.win_loss_coverage_status,'historical_win_similarity')],
    ['最近重建','Last rebuilt',esc(profile?.last_rebuilt_at || profile?.rebuilt_at || profile?.created_at ? new Date(profile.last_rebuilt_at || profile.rebuilt_at || profile.created_at).toLocaleString() : '-')],
    ['资料来源','Source',bi('内部历史业务资料','Internal historical business data')]
  ];
  return `<article class="card crm-panel crm-icp-profile-card"><header class="card-header crm-panel-header"><div><h3 class="card-title">${bi(titleZh,titleEn)}</h3><p class="crm-helper">${productName}</p></div>${isActive ? `<span class="badge bg-green-lt">${bi('使用中','Active')}</span>` : ''}</header><div class="card-body">${factRows(isHistorical ? historicalFacts : managementFacts)}<div class="crm-profile-groups">${groups.map(([zh,en,value])=>`<section class="crm-profile-group"><h4>${bi(zh,en)}</h4><p>${profileValueHtml(value)}</p></section>`).join('')}</div></div></article>`;
}

function renderIcpProfiles(profiles, loadError = false) {
  const host = $('#icp-profile-content');
  if (!host) return;
  host.setAttribute('aria-busy','false');
  host.innerHTML = profiles.length
    ? `${profiles.map(icpProfileCard).join('')}${loadError ? `<div class="alert alert-warning" role="alert"><p>${bi('部分客户画像暂时未返回。','Some customer profiles could not be loaded.')}</p><button id="icp-retry" class="btn btn-outline-warning" type="button">${bi('重新读取','Retry')}</button></div>` : ''}`
    : `<section class="card crm-panel"><div class="card-body crm-empty-state"><h3>${bi('尚无使用中的管理画像','No active management profile')}</h3>${loadError ? `<button id="icp-retry" class="btn btn-outline-warning" type="button">${bi('重新读取','Retry')}</button>` : ''}</div></section>`;
  $('#icp-retry')?.addEventListener('click',loadIcpProfiles);
}

async function loadIcpProfiles() {
  const host = $('#icp-profile-content');
  if (host) host.setAttribute('aria-busy','true');
  try {
    const payload = await json('/api/icp/profiles');
    const profiles = Array.isArray(payload) ? payload : payload.items || payload.profiles || [];
    const active = profiles.filter(profile=>profile.active || profile.is_active || String(profile.status || '').toUpperCase() === 'ACTIVE');
    const selected = active.length ? active : profiles.slice(0,2);
    const details = await Promise.all(selected.map(async profile=>profile?.id ? await optionalJson(`/api/icp/profiles/${encodeURIComponent(profile.id)}`) || profile : profile));
    renderIcpProfiles(details.filter(Boolean),false);
  } catch {
    renderIcpProfiles([],true);
  }
}

const yesNo = value => value ? bi('有','Yes') : bi('暂未发现','Not found');
const arrayPayload = value => Array.isArray(value) ? value : value?.items || value?.history || value?.results || [];
async function optionalJson(url) { try { return await json(url); } catch { return null; } }

function factRows(rows) {
  return `<dl class="crm-detail-facts">${rows.map(([zh,en,value])=>`<div><dt>${bi(zh,en)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

const humanizeCode = value => String(value || '').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
const DIMENSION_LABELS = Object.freeze({
  buyer_business_model_fit:['采购业务模式匹配','Buyer business model fit'], product_category_fit:['产品品类匹配','Product category fit'],
  market_channel_fit:['市场与渠道匹配','Market and channel fit'], commercial_moq_fit:['商业起订量匹配','Commercial MOQ fit'],
  company_scale_fit:['企业规模匹配','Company scale fit'], distribution_pattern_fit:['分销模式匹配','Distribution pattern fit'], historical_win_similarity:['历史成交相似度','Historical win similarity'],
  product_fit:['女装类目适配',"Womenswear category fit"], market_fit:['目标市场匹配','Target market fit'], importer_wholesaler_fit:['进口与批发属性','Importer / wholesaler fit'],
  chain_supply_evidence:['采购渠道依据','Channel evidence'], distribution_scale:['规模与合作可达性','Company size and access'], recent_buying_signal:['采购信号','Buying signals'],
  decision_maker_quality:['采购负责人','Buying contact'], contact_validity:['联系方式','Contact validity']
});
const REASON_DIMENSIONS = Object.freeze({
  BUYER_MODEL:['采购业务模式','Buyer business model'], PRODUCT_CATEGORY:['产品品类','Product category'], MARKET_CHANNEL:['市场与渠道','Market and channel'],
  COMMERCIAL_MOQ:['商业起订量','Commercial MOQ'], COMPANY_SCALE:['企业规模','Company scale'], DISTRIBUTION_PATTERN:['分销模式','Distribution pattern'], HISTORICAL_WIN:['历史成交相似度','Historical win similarity'],
  PRODUCT_FIT:['女装类目适配',"Womenswear category fit"], MARKET_FIT:['目标市场匹配','Target market fit'], IMPORTER_WHOLESALER_FIT:['进口与批发属性','Importer / wholesaler fit'],
  CHAIN_SUPPLY_EVIDENCE:['采购渠道依据','Channel evidence'], DISTRIBUTION_SCALE:['规模与合作可达性','Company size and access'], RECENT_BUYING_SIGNAL:['采购信号','Buying signals'],
  DECISION_MAKER_QUALITY:['采购负责人','Buying contact'], CONTACT_VALIDITY:['联系方式','Contact validity']
});
const REASON_STATES = Object.freeze({
  MATCH:['匹配','Match'], MISMATCH:['不匹配','Mismatch'], NO_MATCH:['不匹配','No match'], DATA_MISSING:['资料待补充','Data missing'], EVIDENCE_MISSING:['资料依据待补充','Evidence missing'], UNKNOWN:['待确认','To confirm'],
  VERIFIED:['已核验','Verified'], TARGET:['符合目标','Target fit'], SUPPORTED:['有资料支持','Supported'], RELATED:['相关','Related'], ADJACENT:['相邻市场','Adjacent market'], BUSINESS_TRADING:['贸易企业','Business trading'],
  STRONG:['较强','Strong'], LARGE:['大型','Large'], MEDIUM:['中型','Medium'], LIMITED:['有限','Limited'], SMALL:['小型','Small'], VERIFIED_RECENT:['近期已核验','Verified recent'], SUPPORTED_RECENT:['近期有资料支持','Supported recent'],
  DOMAIN_MX_VERIFIED:['邮件域名有效','MX-enabled domain'], PUBLICLY_OBSERVED:['页面已记录','Publicly observed'], FORM_OR_PHONE:['有表单或电话','Form or phone'], WEBSITE_ONLY:['仅有网站','Website only']
});
const SPECIAL_REASON_LABELS = Object.freeze({
  HISTORICAL_WIN_SIMILARITY_CALCULATED:['历史成交相似度已计算','Historical win similarity calculated'],
  HISTORICAL_PROFILE_COVERAGE_BELOW_60:['历史画像覆盖率低于 60%','Historical profile coverage below 60%'],
  DECISION_MAKER_NOT_YET_ENRICHED:['采购负责人待补充','Buying contact missing'], RECENT_SIGNAL_DATE_MISSING:['采购信号日期待补充','Buying-signal date missing'],
  BUSINESS_VERIFICATION_NOT_COMPLETE:['企业核验尚未完成','Business verification incomplete'], SCORE_EVIDENCE_ELIGIBLE:['评分资料充分','Scoring evidence sufficient'],
  SCORE_EVIDENCE_PARTIAL:['评分资料部分具备','Scoring evidence partial'], SCORE_EVIDENCE_INSUFFICIENT:['评分资料不足','Scoring evidence insufficient']
});
const dimensionPair = value => DIMENSION_LABELS[String(value || '').toLowerCase()] || businessCodePair(value);
const reasonCodePair = value => {
  const code = String(value || '').trim().toUpperCase();
  if (SPECIAL_REASON_LABELS[code]) return SPECIAL_REASON_LABELS[code];
  const prefix = Object.keys(REASON_DIMENSIONS).sort((a,b)=>b.length-a.length).find(candidate=>code.startsWith(`${candidate}_`));
  if (!prefix) return businessCodePair(code);
  const stateCode = code.slice(prefix.length + 1);
  const state = REASON_STATES[stateCode] || businessCodePair(stateCode);
  const dimension = REASON_DIMENSIONS[prefix];
  return [`${dimension[0]}：${state[0]}`,`${dimension[1]}: ${state[1]}`];
};
function dimensionRows(dimensions, fallback = []) {
  const entries = dimensions && typeof dimensions === 'object' && !Array.isArray(dimensions)
    ? Object.entries(dimensions).map(([name,value])=>[...dimensionPair(name),value?.points ?? value?.score ?? value,value?.maximum ?? value?.max_points ?? value?.max ?? 0,value?.reason_codes || [],value?.evidence_ids || []])
    : fallback;
  if (!entries.length) return `<div class="crm-empty-inline">${bi('暂无维度明细。','No dimension details are available.')}</div>`;
  return `<div class="crm-dimension-list">${entries.map(([zh,en,points,max,reasons=[],evidenceIds=[]])=>`<div class="crm-dimension-row"><div><span>${bi(zh,en)}</span>${reasons.length ? `<small>${reasons.map(reason=>pairedValueHtml(reasonCodePair(reason))).join('<br>')}</small>` : ''}${evidenceIds.length ? `<button type="button" class="crm-evidence-jump" data-open-evidence-tab>${bi(`查看 ${evidenceIds.length} 条依据`,`View ${evidenceIds.length} evidence references`)}</button>` : ''}</div><b>${esc(points ?? '-')}${max ? `/${esc(max)}` : ''}</b></div>`).join('')}</div>`;
}

function historyTable(items, type) {
  if (!items.length) return `<div class="crm-empty-inline">${bi(type === 'match' ? '暂无客户匹配历史。' : '暂无评分历史。',type === 'match' ? 'No Customer Match history is available.' : 'No score history is available.')}</div>`;
  return `<div class="table-responsive" role="region" aria-label="${esc(type === 'match' ? '客户匹配历史 Customer Match history' : '评分历史 Score history')}" tabindex="0"><table class="table crm-table crm-history-table"><thead><tr><th>${bi('时间','Date')}</th><th>${bi(type === 'match' ? '客户匹配' : 'DPV 评分',type === 'match' ? 'Customer Match' : 'DPV Score')}</th><th>${bi('资料覆盖率','Evidence coverage')}</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.calculated_at || item.created_at ? new Date(item.calculated_at || item.created_at).toLocaleString() : '-')}</td><td>${esc(item.match_score ?? item.final_score ?? item.score ?? item.total_score ?? '-')}</td><td>${esc(item.coverage_percent ?? item.evidence_coverage ?? '-')}</td></tr>`).join('')}</tbody></table></div>`;
}

const LIFECYCLE_ACTION_LABELS = Object.freeze({
  STATUS_CHANGED:['状态已更新','Status updated'], VERIFICATION_UPDATED:['核验状态已更新','Verification updated'],
  SUPERSEDED:['已有替代记录','Superseded'], DUPLICATE:['标记为重复记录','Marked as duplicate'],
  INVALID:['标记为无效记录','Marked as invalid'], ARCHIVED:['已归档','Archived'],
  APPROVED:['已批准','Approved'], REJECTED:['已拒绝','Rejected'], REPLACED:['记录已替换','Record replaced']
});
const lifecycleActionPair = value => LIFECYCLE_ACTION_LABELS[String(value || '').trim().toUpperCase()] || ['状态已更新','Status updated'];
const lifecycleReasonHtml = value => {
  const text = displayValue(value);
  if (!text) return '-';
  return /^[A-Z0-9_:-]+$/.test(text) ? pairHtml(reasonCodePair(text)) : esc(text);
};

function lifecycleHistoryView(payload) {
  const lifecycleEvents = arrayPayload(payload?.lifecycle_events);
  const cleanupEvents = arrayPayload(payload?.cleanup_audit);
  const replacedRecords = arrayPayload(payload?.replaced_records);
  const rows = [
    ...lifecycleEvents.map(item=>({ date:item.created_at || item.occurred_at || item.changed_at, action:item.event_type || item.action || 'STATUS_CHANGED', reason:item.reason_code || item.reason_text || (item.from_status && item.to_status ? 'STATUS_CHANGED' : ''), related:item.canonical_company_name || '' })),
    ...cleanupEvents.map(item=>({ date:item.performed_at, action:item.action, reason:item.reason_code || item.reason_text, related:item.canonical_company_name || '' })),
    ...replacedRecords.map(item=>({ date:item.updated_at || item.last_verified_at, action:item.lifecycle_status || 'SUPERSEDED', reason:item.company_name || item.reason_code, related:item.replaced_by_company_name || '' }))
  ].sort((a,b)=>String(b.date || '').localeCompare(String(a.date || '')));
  if (!rows.length) return `<div class="crm-empty-inline">${bi('暂无企业状态变更记录。','No company status history is available.')}</div>`;
  return `<div class="table-responsive" role="region" aria-label="企业状态历史 Company status history" tabindex="0"><table class="table crm-table crm-history-table"><thead><tr><th>${bi('时间','Date')}</th><th>${bi('变更','Change')}</th><th>${bi('原因','Reason')}</th><th>${bi('关联记录','Related record')}</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${esc(item.date ? new Date(item.date).toLocaleString() : '-')}</td><td>${pairHtml(lifecycleActionPair(item.action))}</td><td>${lifecycleReasonHtml(item.reason)}</td><td>${esc(item.related || '-')}</td></tr>`).join('')}</tbody></table></div>`;
}

function wireDetailTabs(detail) {
  const tabs = [...detail.querySelectorAll('[data-detail-tab]')];
  const selectTab = button => {
    tabs.forEach(tab=>{const active=tab===button;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;detail.querySelector(`#${tab.getAttribute('aria-controls')}`)?.toggleAttribute('hidden',!active)});
    button.focus({preventScroll:true});
  };
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectTab(tab));
    tab.addEventListener('keydown',event=>{
      const targetIndex = event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowLeft' ? (index-1+tabs.length)%tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : -1;
      if (targetIndex >= 0) { event.preventDefault(); selectTab(tabs[targetIndex]); }
    });
  });
  detail.querySelectorAll('[data-open-evidence-tab]').forEach(button=>button.addEventListener('click',()=>selectTab(detail.querySelector('[data-detail-tab="evidence"]'))));
}

function wireDetailSections(detail) {
  const tabs = [...detail.querySelectorAll('[data-detail-section-tab]')];
  const sections = [...detail.querySelectorAll('[data-detail-section]')];
  const selectSection = button => {
    const key = button?.dataset.detailSectionTab;
    tabs.forEach(tab=>{const active=tab===button;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
    sections.forEach(section=>section.toggleAttribute('hidden',section.dataset.detailSection!==key));
    const section = sections.find(item=>item.dataset.detailSection===key);
    const selectedSubtab = section?.querySelector('[data-detail-tab][aria-selected="true"]') || section?.querySelector('[data-detail-tab]');
    selectedSubtab?.click();
    button?.focus({preventScroll:true});
  };
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectSection(tab));
    tab.addEventListener('keydown',event=>{
      const targetIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index-1+tabs.length)%tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : -1;
      if (targetIndex >= 0) { event.preventDefault(); selectSection(tabs[targetIndex]); }
    });
  });
}

const detailToolbar = ({
  backZh='返回客户列表', backEn='Back to customer list',
  titleZh='客户详情', titleEn='Company detail',
  closeLabel='关闭客户详情 Close company detail'
} = {}) => `<header class="crm-detail-toolbar"><button type="button" class="btn btn-ghost-secondary crm-detail-back" data-detail-close><i class="ti ti-arrow-left" aria-hidden="true"></i>${bi(backZh,backEn)}</button><strong>${bi(titleZh,titleEn)}</strong><button type="button" class="btn btn-icon btn-ghost-secondary detail-close" data-detail-close aria-label="${esc(closeLabel)}"><i class="ti ti-x" aria-hidden="true"></i></button></header>`;

function detailMetric(zh,en,value) {
  if (value == null || value === '' || value === '-') return '';
  return `<div class="crm-detail-score"><span>${bi(zh,en)}</span><b>${value}</b></div>`;
}

function detailCanDismiss(detail) {
  return detail.dataset.unsaved !== 'true';
}

function closeDetail(detail) {
  if (detail.open && detailCanDismiss(detail)) detail.close();
}

function wireDetailCloseButtons(detail) {
  detail.querySelectorAll('[data-detail-close]').forEach(button=>button.addEventListener('click',()=>closeDetail(detail)));
}

function openDetail(detail) {
  if (!detail.open) detail.showModal();
  detail.querySelector('.crm-detail-back')?.focus({ preventScroll:true });
}

const PRODUCT_MATCH_PROFILES = Object.freeze(['WOMENSWEAR','GENERAL_MERCHANDISE']);
const productMatchProfileHtml = profile => pairHtml(productTaxonomyLabel(profile));
const productMatchDate = result => {
  const value = result?.last_assessed_at || result?.calculated_at || result?.created_at || result?.category_procurement_match_calculated_at || result?.product_match_calculated_at;
  return value ? esc(new Date(value).toLocaleString()) : '-';
};
const productMatchCollection = (result, ...keys) => {
  for (const key of keys) if (Array.isArray(result?.[key])) return result[key];
  return [];
};
const productMatchCategoryValue = item => displayValue(typeof item === 'object'
  ? item?.canonical_name || item?.category || item?.normalized_category || item?.raw_category || item?.subcategory || item?.normalized_subcategory || item?.raw_product_name
  : item);

function productMatchTags(items, emptyZh, emptyEn, { taxonomy = false } = {}) {
  const values = items.map(productMatchCategoryValue).filter(Boolean);
  if (!values.length) return `<div class="crm-empty-inline">${bi(emptyZh,emptyEn)}</div>`;
  return `<div class="crm-product-match-tags">${values.map(value=>`<span>${taxonomy ? productMatchBusinessValue(value) : esc(value)}</span>`).join('')}</div>`;
}

function productMatchDimensionRows(result) {
  const dimensions = result?.dimension_breakdown || result?.dimensions || result?.dimension_scores;
  const entries = Array.isArray(dimensions)
    ? dimensions.map(item=>[item.dimension || item.dimension_code || item.name,item.score ?? item.points,item.max_score ?? item.maximum ?? item.max_points,item.reason_codes || []])
    : dimensions && typeof dimensions === 'object'
      ? Object.entries(dimensions).map(([name,value])=>[name,value?.score ?? value?.points ?? value,value?.max_score ?? value?.maximum ?? value?.max_points,value?.reason_codes || []])
      : [];
  if (!entries.length) return `<div class="crm-empty-inline">${bi('暂无商品类目评分维度明细。','No Product Category Score dimension details are available.')}</div>`;
  return `<div class="crm-dimension-list">${entries.map(([name,score,maxScore,reasons])=>`<div class="crm-dimension-row"><div><span>${pairHtml(productMatchDimensionLabel(name))}</span>${Array.isArray(reasons) && reasons.length ? `<small>${reasons.map(reason=>pairHtml(productMatchReasonLabel(typeof reason === 'object' ? reason.code || reason.reason_code : reason))).join('<br>')}</small>` : ''}</div><b>${score == null ? '-' : esc(score)}${maxScore == null ? '' : `/${esc(maxScore)}`}</b></div>`).join('')}</div>`;
}

function productMatchEvidence(result) {
  const evidence = productMatchCollection(result,'source_references','evidence_sources','public_evidence','sources','evidence');
  const links = evidence.map(item=>({ url:safeUrl(typeof item === 'string' ? item : item?.source_url || item?.url), captured:item?.captured_at })).filter(item=>item.url !== '#');
  if (!links.length) return `<div class="crm-empty-inline">${bi('暂无客户类目资料链接。','No customer category source is available.')}</div>`;
  return `<div class="sources crm-product-match-evidence">${links.map(item=>`<a href="${esc(item.url)}" target="_blank" rel="noreferrer">${bi('查看客户类目资料','Open customer category source')}${item.captured ? `<small>${esc(new Date(item.captured).toLocaleString())}</small>` : ''}</a>`).join('')}</div>`;
}

function productMatchStateCard(profile, stateName, companyId = '') {
  const profileName = productMatchProfileHtml(profile);
  const attrs = `class="crm-product-match-card crm-product-profile-card is-${esc(stateName)}" data-product-profile="${esc(profile)}" data-product-match-profile="${esc(profile)}" data-product-match-state="${esc(stateName)}"`;
  if (stateName === 'loading') return `<article ${attrs} role="status" aria-busy="true"><header><h4>${profileName}</h4></header><div class="crm-product-match-state">${bi('正在读取商品类目评分','Loading Product Category Score')}</div></article>`;
  if (stateName === 'error') return `<article ${attrs} role="alert"><header><h4>${profileName}</h4></header><div class="crm-product-match-state">${bi('商品类目评分资料读取未完成。','Product Category Score data could not be loaded.')}</div><button class="btn btn-outline-secondary crm-product-match-retry" type="button" data-product-match-retry data-company-id="${esc(companyId)}">${bi('重新读取','Retry')}</button></article>`;
  return `<article ${attrs}><header><h4>${profileName}</h4></header><div class="crm-product-match-state">${bi('该产品画像的商品类目评分待评估。','Product Category Score is not assessed for this profile.')}</div></article>`;
}

function productMatchBusinessEvidence(result) {
  const values = productMatchCollection(result,'buyer_model_evidence','business_model_evidence','retail_store_distribution_evidence','procurement_evidence','observations');
  if (!values.length) return `<div class="crm-empty-inline">${bi('零售、门店或分销依据待补充。','Retail, store or distribution evidence is required.')}</div>`;
  return `<ul class="reason-list">${values.slice(0,8).map(item=>{ const value = typeof item === 'object' ? item.evidence_text || item.summary || item.reason || item.reason_code || item.observation_type : item; return `<li>${/^[A-Z0-9_:-]+$/.test(String(value || '')) ? pairHtml(productMatchReasonLabel(value)) : esc(displayValue(value) || '-')}</li>`; }).join('')}</ul>`;
}

function categoryScopeRelationshipView(result, observed, matched) {
  const basis=String(result?.match_basis || result?.category_match_basis || '').toUpperCase();
  const basisLabel=({
    EXACT_CATEGORY:['相同类目','Exact category'], SIMILAR_CATEGORY:['相似类目','Similar category'],
    PROFILE_SCOPE:['同一产品画像','Profile scope'], AMBIGUOUS_SCOPE:['类目范围待复核','Scope review required'],
    OUT_OF_SCOPE:['不在公司类目范围','Out of scope']
  })[basis] || ['匹配依据待确认','Match basis to confirm'];
  const automation=String(result?.auto_evidence_stage || result?.auto_evidence_status || result?.automation_stage || '').toUpperCase();
  const automationLabel=({
    QUEUED:['等待自动处理','Queued'], DISCOVERING_SOURCES:['正在查找资料','Finding sources'], CRAWLING:['正在读取资料','Reading sources'],
    EXTRACTING:['正在整理资料','Extracting'], NORMALIZING_CATEGORY:['正在归一类目','Normalizing category'],
    VALIDATING_EVIDENCE:['正在核验资料','Validating evidence'], FINDING_BUYER:['正在查找采购负责人','Finding buyer'],
    VERIFYING_EMAIL:['正在核验商务邮箱','Verifying email'], REFRESHING_DECISION:['正在刷新机会状态','Refreshing status'],
    RETRY_SCHEDULED:['等待重试','Retry scheduled'], HUMAN_REVIEW_REQUIRED:['需人工复核','Human review required'],
    BUDGET_PAUSED:['预算暂停','Budget paused'], COMPLETED:['已完成','Completed']
  })[automation] || ['状态待同步','Status pending'];
  return `<div class="p10-category-relationship">
    <section class="p10-category-card"><h5 class="bi"><span lang="zh-CN">客户采购类目</span><span lang="en">Customer Procurement Categories</span></h5>${productMatchTags(observed,'客户采购类目待补充。','Customer procurement categories required.',{taxonomy:true})}</section>
    <section class="p10-category-card"><h5 class="bi"><span lang="zh-CN">DPV 可供货批准类目</span><span lang="en">DPV Approved Supply Categories</span></h5>${productMatchTags(matched,'公司批准类目范围待确认。','Approved company category scope to confirm.',{taxonomy:true})}<div class="p10-category-basis"><small class="bi"><span lang="zh-CN">类目机会依据</span><span lang="en">Category opportunity basis</span></small>${pairHtml(basisLabel)}</div><div class="p10-category-basis"><small class="bi"><span lang="zh-CN">自动补证</span><span lang="en">Auto enrichment</span></small>${pairHtml(automationLabel)}</div></section>
  </div>`;
}

function productMatchMissingEvidence(result) {
  const missing = productMatchCollection(result,'missing_evidence','missing_information');
  if (!missing.length) return `<div class="crm-empty-inline">${bi('当前没有已记录的待补资料项。','No missing evidence is recorded.')}</div>`;
  return `<ul class="reason-list">${missing.map(item=>`<li>${pairHtml(productMatchReasonLabel(typeof item === 'object' ? item.code || item.reason_code || item.dimension : item))}</li>`).join('')}</ul>`;
}

function productMatchResultCard(profile, result, { apiError = false, companyId = '' } = {}) {
  const score = categoryProcurementScore(result);
  const band = String(result?.category_procurement_match_band || result?.band || '').toUpperCase();
  const matchStatus = String(result?.category_procurement_match_status || result?.match_status || 'NEEDS_PRODUCT_EVIDENCE').toUpperCase();
  const buyerModel = String(result?.buyer_business_model || result?.buyer_model || 'UNKNOWN').toUpperCase();
  const buyerSubtype = String(result?.buyer_subtype || 'UNKNOWN').toUpperCase();
  const unknown = score == null || !band || band === 'UNKNOWN' || ['CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE','NEEDS_PRODUCT_EVIDENCE'].includes(matchStatus);
  const cardState = apiError ? 'error' : buyerModel === 'EXCLUDED_INTERMEDIARY' || matchStatus === 'INELIGIBLE_BUYER_MODEL' ? 'excluded' : matchStatus === 'PRODUCT_MISMATCH' ? 'mismatch' : matchStatus === 'WEAK_CATEGORY_MATCH' ? 'weak' : unknown ? 'unknown' : 'ready';
  const matched = productMatchCollection(result,'matched_categories','matched_dpv_categories','matched_scopes','dpv_category_scopes','matched_subcategories');
  const observed = productMatchCollection(result,'observed_categories','observed_customer_categories','customer_procurement_categories','prospect_observed_categories','product_observations');
  const coverage = numericValue(result?.category_procurement_coverage ?? result?.coverage_percent ?? result?.coverage);
  const supplierBand = String(result?.supplier_access_band || 'UNKNOWN').toUpperCase();
  const supplierScore = numericValue(result?.supplier_access_score);
  const supplierCoverage = numericValue(result?.supplier_access_coverage);
  return `<article class="crm-product-match-card crm-product-profile-card is-${esc(cardState)}" data-product-profile="${esc(profile)}" data-product-match-profile="${esc(profile)}" data-product-match-state="${esc(cardState)}">
    <header><div><h4>${productMatchProfileHtml(profile)}</h4><div class="crm-product-match-type">${enumBadge(categoryProcurementStatusLabel(matchStatus),categoryProcurementStatusTone(matchStatus))}</div></div><div class="crm-product-match-score">${unknown ? enumBadge(productMatchBandLabel('UNKNOWN'),'unknown') : `<b>${esc(Math.round(score))}/100</b>${enumBadge(productMatchBandLabel(band),productMatchBandTone(band))}`}</div></header>
    ${apiError ? `<div class="alert alert-warning crm-product-match-api-error" role="alert">${bi('部分商品类目评分资料读取未完成。','Some Product Category Score data could not be loaded.')}<button class="btn btn-outline-secondary crm-product-match-retry" type="button" data-product-match-retry data-company-id="${esc(companyId)}">${bi('重新读取','Retry')}</button></div>` : ''}
    ${factRows([
      ['客户采购模式','Buyer Business Model',enumBadge(buyerBusinessModelLabel(buyerModel),buyerBusinessModelTone(buyerModel))],
      ['客户类型','Buyer subtype',pairHtml(buyerSubtypeLabel(buyerSubtype))],
      ['客户资格','Eligibility',pairHtml(({ELIGIBLE:['符合','Eligible'],NEEDS_EVIDENCE:['依据待补充','Evidence required'],INELIGIBLE:['不符合','Ineligible']})[String(result?.eligibility_status || '').toUpperCase()] || ['待确认','To confirm'])],
      ['判断把握度','Confidence',pairHtml(({HIGH:['高','High'],MEDIUM:['中','Medium'],LOW:['低','Low'],UNKNOWN:['待确认','To confirm']})[String(result?.confidence_band || 'UNKNOWN').toUpperCase()] || ['待确认','To confirm'])],
      ['品类采购状态','Category Procurement Match',enumBadge(categoryProcurementStatusLabel(matchStatus),categoryProcurementStatusTone(matchStatus))],
      ['资料覆盖率','Evidence coverage',coverage == null ? '-' : `${esc(coverage)}%`],
      ['供应商准入','Supplier Access',`${supplierScore == null ? '' : `<b>${esc(Math.round(supplierScore))}/100</b>`}${enumBadge(supplierAccessBandLabel(supplierBand),supplierAccessBandTone(supplierBand))}${supplierCoverage == null ? '' : `<small>${bi(`资料覆盖率 ${supplierCoverage}%`,`Evidence coverage ${supplierCoverage}%`)}</small>`}`],
      ['最近评估','Last assessed',productMatchDate(result)]
    ])}
    ${categoryScopeRelationshipView(result,observed,matched)}
    <section class="crm-detail-section"><h5>${bi('零售、门店或分销依据','Retail, store or distribution evidence')}</h5>${productMatchBusinessEvidence(result)}</section>
    <section class="crm-detail-section"><h5>${bi('品类采购匹配维度','Category Procurement Match dimensions')}</h5>${productMatchDimensionRows(result)}</section>
    <section class="crm-detail-section"><h5>${bi('待补资料','Missing evidence')}</h5>${productMatchMissingEvidence(result)}</section>
    <section class="crm-detail-section"><h5>${bi('资料来源','Source references')}</h5>${productMatchEvidence(result)}</section>
  </article>`;
}

function wireProductMatchRetry(host, companyId) {
  host.querySelectorAll('[data-product-match-retry]').forEach(button=>button.addEventListener('click',()=>{
    const requestId = ++state.productMatchRequestId;
    loadProductMatchesPanel(companyId,requestId);
  }));
}

const productMatchApiRecord = item => item && typeof item === 'object'
  ? { ...(item.summary && typeof item.summary === 'object' ? item.summary : {}), ...(item.result && typeof item.result === 'object' && !Array.isArray(item.result) ? item.result : {}), ...item }
  : {};

async function loadProductMatchesPanel(companyId, requestId) {
  const host = $('#product-match-panel');
  if (!host || requestId !== state.productMatchRequestId) return;
  host.setAttribute('aria-busy','true');
  host.innerHTML = `<div class="crm-product-match-grid">${PRODUCT_MATCH_PROFILES.map(profile=>productMatchStateCard(profile,'loading',companyId)).join('')}</div>`;
  const encodedCompanyId = encodeURIComponent(companyId);
  const [categoryResponse,buyerResponse,opportunityResponse] = await Promise.allSettled([
    json(`/api/companies/${encodedCompanyId}/category-procurement-matches`),
    json(`/api/companies/${encodedCompanyId}/buyer-business-model`),
    json(`/api/companies/${encodedCompanyId}/product-opportunities`)
  ]);
  if (requestId !== state.productMatchRequestId) return;
  if (categoryResponse.status === 'rejected') {
    host.innerHTML = `<div class="crm-product-match-grid">${PRODUCT_MATCH_PROFILES.map(profile=>productMatchStateCard(profile,'error',companyId)).join('')}</div>`;
  } else {
    const categories = categoryProcurementItems(categoryResponse.value).map(productMatchApiRecord);
    const buyers = buyerResponse.status === 'fulfilled' ? buyerBusinessModelItems(buyerResponse.value).map(productMatchApiRecord) : [];
    const opportunities = opportunityResponse.status === 'fulfilled' ? productOpportunityItems(opportunityResponse.value).map(productMatchApiRecord) : [];
    const apiError = buyerResponse.status === 'rejected' || opportunityResponse.status === 'rejected';
    const cards = PRODUCT_MATCH_PROFILES.map(profile=>{
      const category = categories.find(item=>productMatchProfile(item) === profile);
      if (!category) return productMatchStateCard(profile,'empty',companyId);
      const buyer = buyers.find(item=>productMatchProfile(item) === profile) || buyers[0] || {};
      const opportunity = opportunities.find(item=>productMatchProfile(item) === profile) || {};
      const opportunityRow = state.opportunities.find(item=>String(companyIdFor(item)) === String(companyId) && productProfileCode(item) === profile) || {};
      const result = {
        ...opportunityRow,
        ...category,
        ...opportunity,
        buyer_business_model:buyer.buyer_business_model || buyer.buyer_model || category.buyer_business_model || opportunityRow.buyer_business_model,
        buyer_subtype:buyer.buyer_subtype || category.buyer_subtype || opportunityRow.buyer_subtype,
        eligibility_status:buyer.eligibility_status || category.eligibility_status,
        confidence_band:buyer.confidence_band || category.confidence_band
      };
      return productMatchResultCard(profile,result,{ apiError, companyId });
    });
    host.innerHTML = `<div class="crm-product-match-grid">${cards.join('')}</div>`;
  }
  host.setAttribute('aria-busy','false');
  wireProductMatchRetry(host,companyId);
}

const crmBusinessText = value => displayValue(value).replace(/^'(?=[+＋\d])/,'').replace(/＋/g,'+')
  .replace(/https?:\/\/\S+/gi,'').replace(/\s+/g,' ').trim();
const crmDetailPayload = payload => {
  const root = Array.isArray(payload) ? payload[0] : payload?.item || payload?.record || payload?.items?.[0] || payload;
  const summary = root?.summary || root?.company || root?.customer || root;
  return {
    summary: summary && typeof summary === 'object' ? summary : null,
    contacts: arrayPayload(root?.contacts || payload?.contacts),
    activities: arrayPayload(root?.activities || root?.events || payload?.activities || payload?.events)
  };
};
const crmActivityPair = value => ({
  OUTBOUND_MARKETING_EMAIL_SENT:['营销邮件已发送','Marketing email sent'], EDM:['营销邮件已发送','Marketing email sent'],
  MANUAL_FOLLOW_UP:['人工跟进','Manual follow-up'], '跟进':['人工跟进','Manual follow-up']
}[String(value || '').toUpperCase()] || ['其他历史活动','Other historical activity']);
const crmChannelPair = value => ({
  WECHAT:['微信','WeChat'], EMAIL:['邮件','Email'], WHATSAPP:['WhatsApp','WhatsApp'], PHONE:['电话','Phone']
}[String(value || '').toUpperCase()] || (displayValue(value) ? [displayValue(value),displayValue(value)] : ['待确认','To confirm']));
const crmRelationshipPair = summary => {
  const classification = String(crmHistoryClassification(summary) || '').toUpperCase();
  const linked = String(summary?.converted_customer_link_status || summary?.public_company_link_status || '').toUpperCase();
  if (classification === 'INTERNAL_EXISTING_CUSTOMER' || ['CONFIRMED','LINKED'].includes(linked)) return ['已确认既有客户','Confirmed existing customer'];
  if (classification === 'REVIEW' || ['REVIEW','AMBIGUOUS'].includes(linked)) return ['关联待确认','Relationship to review'];
  return ['历史客户线索','Historical CRM lead'];
};
const crmTagList = value => {
  const values = Array.isArray(value) ? value : displayValue(value) ? String(value).split(/[,，;；|]/) : [];
  const tags = values.map(crmBusinessText).filter(Boolean).slice(0,20);
  return tags.length ? `<div class="crm-history-tags">${tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>` : '-';
};

function crmActivityList(activities, { limit = 50 } = {}) {
  const safeItems = Array.isArray(activities) ? activities.slice(0,limit) : [];
  if (!safeItems.length) return `<div class="crm-empty-inline">${bi('暂无历史活动。','No historical activities are available.')}</div>`;
  const list = safeItems.map(activity=>{
    const typeValue = activity.activity_type || activity.activity_type_normalized || activity.activity_type_raw;
    const type = crmActivityPair(typeValue);
    const channel = crmChannelPair(activity.channel);
    const dateValue = activity.activity_at || activity.follow_up_at || activity.created_at;
    const title = crmBusinessText(activity.title_raw || activity.activity_title_raw || activity.title || '') || type[0];
    const content = crmBusinessText(activity.content_raw || activity.activity_content_raw || activity.content || activity.details || '');
    const contact = crmBusinessText(activity.contact_name || activity.source_contact_name || activity.contact_name_raw || '');
    const owner = crmBusinessText(activity.owner_raw || activity.owner || '');
    return `<li class="crm-activity-item"><header><span class="data-state-badge state-current">${bi(type[0],type[1])}</span><time datetime="${esc(dateValue || '')}">${esc(dateValue ? new Date(dateValue).toLocaleString() : '-')}</time></header><strong>${esc(title)}</strong><div class="crm-activity-meta">${contact ? `<span>${bi('联系人','Contact')}<b>${esc(contact)}</b></span>` : ''}${owner ? `<span>${bi('负责人','Owner')}<b>${esc(owner)}</b></span>` : ''}<span>${bi('渠道','Channel')}<b>${bi(channel[0],channel[1])}</b></span></div>${content ? `<details><summary>${bi('查看活动内容','Show activity details')}</summary><p>${esc(content)}</p></details>` : ''}</li>`;
  }).join('');
  const remaining = Math.max(0,(Array.isArray(activities) ? activities.length : 0)-safeItems.length);
  return `<ol class="crm-activity-list">${list}</ol>${remaining ? `<p class="crm-helper">${bi(`另有 ${remaining} 条活动未在当前窗口展开`,` ${remaining} more activities are not expanded in this view`.trim())}</p>` : ''}`;
}

function crmContactSummary(contacts, summary) {
  const safeContacts = Array.isArray(contacts) ? contacts.slice(0,20) : [];
  const total = crmHistoryCount(summary,'contact_count','contacts_count') ?? (Array.isArray(contacts) ? contacts.length : null);
  if (!safeContacts.length) return `${factRows([['历史联系人','Historical contacts',esc(crmCountDisplay(total))]])}<div class="crm-empty-inline">${bi('暂无可显示的历史联系人明细。','No historical contact details are available.')}</div>`;
  const cards = safeContacts.map(contact=>{
    const name = crmBusinessText(contact.full_name || contact.contact_name || contact.name) || '-';
    const role = crmBusinessText(contact.job_title || contact.seniority_raw || contact.role) || '-';
    const email = crmBusinessText(contact.business_email || contact.email) || '-';
    const phone = crmBusinessText(contact.business_phone || contact.phone || contact.landline || contact.landline_phone) || '-';
    return `<article class="crm-history-contact"><header><strong>${esc(name)}</strong>${contact.is_generic_mailbox ? `<span class="data-state-badge state-review">${bi('通用邮箱','Generic mailbox')}</span>` : ''}</header><dl><div><dt>${bi('职位','Job title')}</dt><dd>${esc(role)}</dd></div><div><dt>${bi('商务邮箱','Business email')}</dt><dd>${esc(email)}</dd></div><div><dt>${bi('联系电话','Business phone')}</dt><dd>${esc(phone)}</dd></div></dl></article>`;
  }).join('');
  const remaining = Math.max(0,(Number(total) || safeContacts.length)-safeContacts.length);
  return `${factRows([['历史联系人','Historical contacts',esc(crmCountDisplay(total))]])}<div class="crm-history-contacts">${cards}</div>${remaining ? `<p class="crm-helper">${bi(`另有 ${remaining} 位联系人未在当前窗口展开`,` ${remaining} more contacts are not expanded in this view`.trim())}</p>` : ''}`;
}

function crmHistoryOverview(summary) {
  const status = crmStatusPair(summary);
  const classification = crmClassificationPair(crmHistoryClassification(summary));
  const relationship = crmRelationshipPair(summary);
  const latest = crmHistoryDate(summary);
  return `${factRows([
    ['资料来源','Source',esc(displayValue(summary?.source_system) || 'OKKI')],
    ['历史客户状态','Prior CRM status',bi(status[0],status[1])],
    ['记录分类','Historical classification',bi(classification[0],classification[1])],
    ['国家地区','Country or region',esc(crmHistoryCountry(summary))],
    ['客户关系','Account relationship',bi(relationship[0],relationship[1])],
    ['历史联系人','Historical contacts',esc(crmCountDisplay(crmHistoryCount(summary,'contact_count','contacts_count')))],
    ['最近活动','Latest activity',esc(latest ? new Date(latest).toLocaleString() : '-')],
    ['营销邮件','Marketing emails',esc(crmCountDisplay(crmHistoryCount(summary,'edm_count','marketing_email_count','outbound_marketing_email_count')))],
    ['跟进记录','Follow-ups',esc(crmCountDisplay(crmHistoryCount(summary,'followup_count','follow_up_count','manual_follow_up_count')))],
    ['负责人','CRM owner',esc(crmHistoryOwner(summary))],
    ['历史来源','Historical source',esc(crmBusinessText(summary?.customer_source_raw || summary?.crm_source_raw || summary?.historical_source || '-') || '-')],
    ['客户标签','Customer tags',crmTagList(summary?.tags_raw || summary?.customer_tags || summary?.tags)]
  ])}`;
}

function linkedCrmHistoryView(payload) {
  const crm = crmDetailPayload(payload);
  if (!crm.summary || !crmHistoryId(crm.summary)) return `<div class="crm-empty-inline">${bi('暂无关联历史客户记录。','No linked historical CRM record is available.')}</div>`;
  return `<div class="crm-linked-history">${crmHistoryOverview(crm.summary)}<section class="crm-detail-section"><h5>${bi('最近历史活动','Recent historical activities')}</h5>${crmActivityList(crm.activities,{limit:5})}</section></div>`;
}

function productRelevanceView(items) {
  const values = arrayPayload(items);
  if (!values.length) return bi('产品相关度待确认','Product relevance to confirm');
  return `<div class="crm-product-relevance">${values.map(item=>{
    const profile = String(item.product_profile || '').toUpperCase() === 'GENERAL_MERCHANDISE'
      ? bi('日用百货','General Merchandise') : bi('全品类女装',"Full-category Women's Apparel");
    const relevance = relevanceLabel(String(item.relevance || 'UNKNOWN').toUpperCase());
    const tone = String(item.relevance || '').toUpperCase() === 'HIGH' ? 'active' : String(item.relevance || '').toUpperCase() === 'LOW' ? 'rejected' : 'review';
    const reason = systemReasonLabel(item.reason);
    return `<span>${profile}${enumBadge(relevance,tone)}${item.reason ? `<small>${reason ? pairHtml(reason) : esc(item.reason)}</small>` : ''}</span>`;
  }).join('')}</div>`;
}

function routeList(routes, { supplierOnly = false } = {}) {
  const allowedSupplierTypes = new Set(['SUPPLIER_PORTAL','VENDOR_REGISTRATION','CONTACT_FORM']);
  const items = arrayPayload(routes).filter(item=>!supplierOnly || allowedSupplierTypes.has(String(item.contact_type || '').toUpperCase()));
  if (!items.length) return `<div class="crm-empty-inline">${bi(supplierOnly ? '供应商准入路径待补充。' : '商务联系路径待补充。',supplierOnly ? 'Supplier onboarding route required.' : 'Business contact route required.')}</div>`;
  return `<div class="crm-contact-route-list">${items.map(item=>{
    const verification = opportunityContactVerificationLabel(item.verification_status);
    return `<article><div>${contactValueHtml(item)}</div><div class="crm-contact-route-meta">${enumBadge(verification,verificationTone(item.verification_status))}${item.last_verified_at ? `<time datetime="${esc(item.last_verified_at)}">${esc(shortDate(item.last_verified_at))}</time>` : ''}${safeUrl(item.source_url) !== '#' ? `<a href="${esc(safeUrl(item.source_url))}" target="_blank" rel="noreferrer">${bi('查看资料来源','Open source reference')}</a>` : ''}</div></article>`;
  }).join('')}</div>`;
}

function decisionMakerSources(items) {
  const sources = arrayPayload(items).filter(item=>safeUrl(item.url || item.source_url) !== '#');
  if (!sources.length) return `<div class="crm-empty-inline">${bi('采购角色资料来源待补充。','Buying-role source reference required.')}</div>`;
  return `<div class="sources crm-decision-source-list">${sources.map(source=>{ const reason = systemReasonLabel(source.evidence_text); return `<a href="${esc(safeUrl(source.url || source.source_url))}" target="_blank" rel="noreferrer"><strong>${pairHtml(sourceTypeLabel(source.source_type))}</strong>${source.evidence_text ? `<span>${reason ? pairHtml(reason) : esc(source.evidence_text)}</span>` : ''}${source.captured_at ? `<time datetime="${esc(source.captured_at)}">${esc(shortDate(source.captured_at))}</time>` : ''}</a>`; }).join('')}</div>`;
}

function decisionMakerView(payload, contactRoutes) {
  const items = arrayPayload(payload);
  if (!items.length) return `<div class="crm-empty-state crm-detail-empty"><i class="ti ti-user-question" aria-hidden="true"></i><h4>${bi('采购人员或部门待补充','Buyer or department required')}</h4></div>`;
  return `<div class="crm-decision-maker-list">${items.map(item=>{
    const name = displayValue(item.person_name || item.department_name) || '-';
    const namePair = systemRouteLabel(name);
    const rawTitle = displayValue(item.raw_title);
    const titlePair = systemRouteLabel(rawTitle);
    const repeatedTitle = rawTitle && rawTitle.toLowerCase() === name.toLowerCase();
    const roleVerification = verificationStatusLabel(String(item.verification_status || '').toUpperCase());
    const relevance = relevanceLabel(String(item.role_relevance || 'UNKNOWN').toUpperCase());
    return `<article class="crm-decision-maker-card"><header><div><h4>${namePair ? pairHtml(namePair) : esc(name)}</h4>${repeatedTitle ? '' : `<p>${titlePair ? pairHtml(titlePair) : esc(rawTitle || '-')}</p>`}</div><div>${enumBadge(roleVerification,verificationTone(item.verification_status))}${enumBadge(relevance,verificationTone(item.role_relevance))}</div></header>${factRows([
      ['规范化角色','Normalized role',pairHtml(normalizedRoleLabel(item.normalized_role))],
      ['角色相关度','Role relevance',pairHtml(relevance)],
      ['市场','Market',esc(displayValue(item.market_code) || '-')],
      ['数据状态','Data status',stateBadge(item.lifecycle_status,lifecycleStateLabels)],
      ['最近核验','Last verified',esc(item.last_verified_at ? new Date(item.last_verified_at).toLocaleString() : '-')],
      ['产品相关度','Product relevance',productRelevanceView(item.product_relevance)]
    ])}<section class="crm-detail-section"><h5>${bi('商务联系路径','Business contact routes')}</h5>${routeList(item.contacts)}</section><section class="crm-detail-section"><h5>${bi('资料来源','Source references')}</h5>${decisionMakerSources(item.sources)}</section></article>`;
  }).join('')}<section class="crm-detail-section"><h4>${bi('企业联系路径汇总','Company contact route summary')}</h4>${routeList(contactRoutes)}</section></div>`;
}

function feasibilityDimensionView(dimensions) {
  const entries = dimensions && typeof dimensions === 'object' && !Array.isArray(dimensions) ? Object.entries(dimensions) : [];
  if (!entries.length) return `<div class="crm-empty-inline">${bi('合作可行性维度待评估。','Cooperation feasibility dimensions are not assessed.')}</div>`;
  return `<div class="crm-dimension-list">${entries.map(([name,item])=>{
    const label = feasibilityDimensionLabel(name);
    const state = feasibilityDimensionStateLabel(item?.state);
    const reason = systemReasonLabel(item?.reason);
    return `<div class="crm-dimension-row"><div><span>${pairHtml(label)}</span><small>${pairHtml(state)}</small>${item?.reason ? `<small>${reason ? pairHtml(reason) : esc(item.reason)}</small>` : ''}</div><b>${esc(item?.points ?? '-')}/${esc(item?.maximum ?? '-')}</b></div>`;
  }).join('')}</div>`;
}

function barrierList(items) {
  const values = valueList(items);
  if (!values.length) return `<div class="crm-empty-inline">${bi('供应障碍待确认。','Supplier barriers to confirm.')}</div>`;
  return `<ul class="reason-list">${values.map(value=>`<li>${pairHtml(barrierSignalLabel(value))}</li>`).join('')}</ul>`;
}

function missingEvidenceList(items) {
  const values = valueList(items);
  if (!values.length) return `<div class="crm-empty-inline">${bi('当前没有待补资料项。','No missing evidence is recorded.')}</div>`;
  return `<ul class="reason-list">${values.map(value=>`<li>${pairHtml(feasibilityDimensionLabel(value))}</li>`).join('')}</ul>`;
}

function feasibilityEvidenceList(items) {
  const values = arrayPayload(items).filter(item=>safeUrl(item.url || item.source_url) !== '#');
  if (!values.length) return `<div class="crm-empty-inline">${bi('合作可行性资料来源待补充。','Cooperation feasibility source reference required.')}</div>`;
  return `<div class="sources">${values.map(source=>`<a href="${esc(safeUrl(source.url || source.source_url))}" target="_blank" rel="noreferrer">${pairHtml(sourceTypeLabel(source.source_type))}${source.captured_at ? `<time datetime="${esc(source.captured_at)}">${esc(shortDate(source.captured_at))}</time>` : ''}</a>`).join('')}</div>`;
}

function cooperationFeasibilityView(payload, contactRoutes) {
  const items = arrayPayload(payload);
  if (!items.length) return `<div class="crm-empty-state crm-detail-empty"><i class="ti ti-building-store" aria-hidden="true"></i><h4>${bi('合作可行性待评估','Cooperation feasibility not assessed')}</h4></div>`;
  return `<div class="crm-feasibility-list">${items.map(item=>{
    return `<article class="crm-feasibility-card"><header><div><p class="crm-context">${productProfilesCell({product_profile:item.product_profile})}</p><h4>${bi('合作可行性','Cooperation Feasibility')}</h4></div><div class="crm-feasibility-score"><b>${esc(item.cooperation_feasibility_score ?? '-')}/100</b>${enumBadge(feasibilityBandLabel(item.feasibility_band),feasibilityTone(item.feasibility_band))}</div></header>${factRows([
      ['合作机会矩阵','Cooperation matrix',pairHtml(cooperationMatrixLabel(item.access_opportunity_matrix))],
      ['跟进准备状态','Opportunity readiness',enumBadge(opportunityReadinessLabel(item.opportunity_readiness),readinessTone(item.opportunity_readiness))],
      ['历史客户关系','Historical CRM status',enumBadge(relationshipStatusLabel(item.relationship_status),relationshipTone(item.relationship_status))],
      ['供应商路径','Supplier routes',esc(item.supplier_route_count ?? 0)],
      ['已核验采购角色','Verified buying roles',esc(item.verified_decision_maker_count ?? 0)],
      ['可用联系路径','Usable contact routes',esc(item.usable_contact_route_count ?? 0)],
      ['最近评估','Last assessed',esc(item.calculated_at ? new Date(item.calculated_at).toLocaleString() : '-')]
    ])}<section class="crm-detail-section"><h5>${bi('供应商准入路径','Supplier onboarding route')}</h5>${routeList(contactRoutes,{supplierOnly:true})}</section><section class="crm-detail-section"><h5>${bi('已知供应障碍','Known supplier barriers')}</h5>${barrierList(item.barrier_signals)}</section><section class="crm-detail-section"><h5>${bi('待补资料','Missing evidence')}</h5>${missingEvidenceList(item.missing_evidence)}</section><section class="crm-detail-section"><h5>${bi('可行性维度','Feasibility dimensions')}</h5>${feasibilityDimensionView(item.dimension_breakdown)}</section><section class="crm-detail-section"><h5>${bi('资料来源','Source references')}</h5>${feasibilityEvidenceList(item.evidence_sources)}</section></article>`;
  }).join('')}</div>`;
}

async function showCrmHistory(id, trigger = null) {
  const detail = $('#detail');
  state.crmHistorySelected = id;
  state.detailTrigger = trigger || document.activeElement;
  state.detailTriggerKind = 'crm-history';
  const toolbarOptions = {
    backZh:'返回历史客户记录', backEn:'Back to historical records',
    titleZh:'历史客户详情', titleEn:'Historical CRM detail',
    closeLabel:'关闭历史客户详情 Close historical CRM detail'
  };
  detail.classList.add('has-detail');
  detail.innerHTML = `${detailToolbar(toolbarOptions)}<div class="crm-detail-body"><div class="crm-detail-loading" role="status">${bi('正在读取历史客户资料','Loading historical CRM details')}</div></div>`;
  wireDetailCloseButtons(detail);
  openDetail(detail);
  const payload = await optionalJson(`/api/crm-history/${encodeURIComponent(id)}`);
  const crm = crmDetailPayload(payload);
  if (!crm.summary) {
    detail.innerHTML = `${detailToolbar(toolbarOptions)}<div class="crm-detail-body"><div class="crm-empty-state"><i class="ti ti-alert-circle" aria-hidden="true"></i><h3>${bi('历史客户详情读取失败','Historical CRM detail could not be loaded')}</h3><button type="button" class="btn btn-outline-secondary crm-history-detail-retry">${bi('重新读取','Retry')}</button></div></div>`;
    wireDetailCloseButtons(detail);
    detail.querySelector('.crm-history-detail-retry')?.addEventListener('click',()=>showCrmHistory(id,trigger));
    openDetail(detail);
    return;
  }
  detail.innerHTML = `${detailToolbar(toolbarOptions)}<div class="crm-detail-body crm-history-detail-body"><header class="crm-detail-header"><div><p class="crm-context">${bi('历史客户记录','Historical CRM record')}</p><h3>${esc(crmHistoryCompany(crm.summary))}</h3><div class="crm-detail-meta">${crmHistoryStatusBadge(crm.summary)}${crmHistoryClassificationBadge(crm.summary)}<span>${esc(displayValue(crm.summary.source_system) || 'OKKI')}</span></div></div></header>
    <div class="crm-detail-tabs" role="tablist" aria-label="历史客户详情页签 Historical CRM detail tabs">
      ${[['crm-overview','概览','Overview'],['crm-contacts','联系概况','Contact summary'],['crm-activities','历史活动','Activity history']].map(([key,zh,en],index)=>`<button type="button" role="tab" data-detail-tab="${key}" id="detail-tab-${key}" aria-controls="detail-panel-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${bi(zh,en)}</button>`).join('')}
    </div>
    <section id="detail-panel-crm-overview" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-crm-overview">${crmHistoryOverview(crm.summary)}</section>
    <section id="detail-panel-crm-contacts" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-crm-contacts" hidden>${crmContactSummary(crm.contacts,crm.summary)}</section>
    <section id="detail-panel-crm-activities" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-crm-activities" hidden>${crmActivityList(crm.activities)}</section>
  </div>`;
  wireDetailTabs(detail);
  wireDetailCloseButtons(detail);
  openDetail(detail);
}

async function showLead(id) {
  state.selected = id;
  const productMatchRequestId = ++state.productMatchRequestId;
  const detail = $('#detail');
  const shouldShowLoading = !detail.open;
  if (!detail.open || !detail.contains(document.activeElement)) {
    const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    state.detailTrigger = active;
    state.detailTriggerKind = active?.matches('[data-overview-id]') ? 'overview'
      : active?.matches('[data-opportunity-id]') ? 'opportunity'
      : active?.matches('.lead-select[data-lead-id]') ? 'lead'
      : null;
  }
  if (shouldShowLoading) {
    detail.classList.add('has-detail');
    detail.innerHTML = `${detailToolbar()}<div class="crm-detail-body"><div class="crm-detail-loading" role="status">${bi('正在读取客户资料','Loading company details')}</div></div>`;
    wireDetailCloseButtons(detail);
    openDetail(detail);
  }
  let lead = await optionalJson(`/api/leads/${encodeURIComponent(id)}`);
  const hasLegacyReview = Boolean(lead);
  const currentOpportunity = state.opportunities.find(item=>
    String(companyIdFor(item)) === String(id)
    || String(leadIdFor(item)) === String(id)
    || (lead && String(companyIdFor(item)) === String(companyIdFor(lead))));
  if (lead && currentOpportunity) {
    lead = { ...lead, ...currentOpportunity, approval_status: lead.approval_status,
      lead_review_id: lead.lead_review_id || id };
  } else if (!lead) lead = currentOpportunity;
  if (!lead) {
    detail.innerHTML = `${detailToolbar()}<div class="crm-detail-body"><div class="crm-empty-state"><i class="ti ti-alert-circle" aria-hidden="true"></i><h3>${bi('客户详情读取失败','Company detail could not be loaded')}</h3><button type="button" class="btn btn-outline-secondary detail-retry">${bi('重新读取','Retry')}</button></div></div>`;
    wireDetailCloseButtons(detail);
    detail.querySelector('.detail-retry')?.addEventListener('click',()=>showLead(id));
    openDetail(detail);
    return;
  }
  const companyId = companyIdFor(lead);
  const matchScope = productProfileCode(lead);
  const matchQuery = matchScope ? `?product_scope=${encodeURIComponent(matchScope)}` : '';
  const [score,scoreHistoryPayload,match,matchHistoryPayload,lifecycleHistory,linkedCrmHistory,decisionMakersPayload,contactRoutesPayload,feasibilityPayload] = await Promise.all([
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/score`),
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/score-history`),
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/customer-match${matchQuery}`),
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/customer-match-history${matchQuery}`),
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/lifecycle-history`),
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/crm-history`),
    optionalJson(`/api/leads/${encodeURIComponent(companyId)}/decision-makers`),
    optionalJson(`/api/leads/${encodeURIComponent(companyId)}/contact-routes`),
    optionalJson(`/api/companies/${encodeURIComponent(companyId)}/cooperation-feasibility${matchScope ? `?product_profile=${encodeURIComponent(matchScope)}` : ''}`)
  ]);
  const status = approvalLabel(lead.approval_status);
  const verify = verificationLabel(lead);
  const scores = [
    ['女装类目适配','Womenswear category fit',lead.product_fit_score,20],['目标市场匹配','Target market fit',lead.market_fit_score,15],
    ['进口/批发属性','Importer / wholesaler fit',lead.importer_fit_score,15],['采购渠道证据','Channel evidence',lead.evidence_score,15],
    ['规模与合作可达性','Company size & access',lead.scale_score,10],['采购信号','Buying signals',lead.buying_signal_score,10],
    ['采购负责人','Buying contact',lead.decision_maker_score,10],['联系方式','Contact validity',lead.contact_validity_score,5]
  ];
  const email = lead.business_email || '-';
  const phone = lead.business_phone || '-';
  const sources = Array.isArray(lead.sources) ? lead.sources : Array.isArray(lead.source_references) ? lead.source_references : [];
  const socialProfiles = Array.isArray(lead.social_profiles) ? lead.social_profiles : [];
  const size = sizeLabel(lead.company_size || lead.company_size_band);
  const supportedBusinessTypes = [
    ['importer_status','进口商','Importer'],['wholesaler_status','批发商','Wholesaler'],
    ['distributor_status','经销商','Distributor'],['general_trading_status','综合贸易','General trading']
  ].filter(([key])=>['VERIFIED','SUPPORTED'].includes(String(lead[key] || '').toUpperCase()));
  const importerWholesalerFit = lead.importer_wholesaler_fit
    || supportedBusinessTypes.some(([key])=>key === 'importer_status' || key === 'wholesaler_status');
  const importerWholesalerEvidence = lead.importer_wholesaler_evidence
    || (supportedBusinessTypes.length
      ? bi(supportedBusinessTypes.map(([,zh])=>zh).join('、'), supportedBusinessTypes.map(([, ,en])=>en).join(' / '))
      : bi('进口或批发属性待确认','Importer or wholesaler status to confirm'));
  const sizeEvidence = String(lead.size_evidence || '');
  const currentSize = String(lead.company_size || lead.company_size_band || '').toUpperCase();
  const sizeEvidenceDisplay = currentSize && currentSize !== 'UNKNOWN' && /待|confirm|insufficient/i.test(sizeEvidence)
    ? bi('资料支持当前规模分类','Source references support the current size classification')
    : esc(sizeEvidence || '企业规模待确认 / Company size to confirm');
  const currentScore = score?.final_score ?? score?.score ?? score?.total_score ?? lead.lead_score;
  const currentTier = score?.tier ?? lead.tier;
  const managementMatch = managementMatchRecord(match)
    ?? (historicalMatchRecord(match) ? null : match);
  const mexicoHistoricalMatch = historicalMatchRecord(match);
  const currentMatch = matchRecordScore(managementMatch);
  const currentHistoricalMatch = matchRecordScore(mexicoHistoricalMatch);
  const decisionMakers = arrayPayload(decisionMakersPayload);
  const contactRoutes = arrayPayload(contactRoutesPayload);
  const feasibilityItems = arrayPayload(feasibilityPayload);
  const currentFeasibility = feasibilityItems.find(item=>!matchScope || String(item.product_profile || '').toUpperCase() === matchScope) || feasibilityItems[0] || null;
  const scoreHistory = arrayPayload(scoreHistoryPayload);
  const matchHistory = Array.isArray(matchHistoryPayload) || matchHistoryPayload?.items || matchHistoryPayload?.history || matchHistoryPayload?.results
    ? arrayPayload(matchHistoryPayload)
    : [...arrayPayload(matchHistoryPayload?.management_baseline),...arrayPayload(matchHistoryPayload?.mx_historical_reference)];
  const displayOpportunity = phase7OpportunityStatus(lead);
  const detailMetrics = [
    detailMetric('合作可行性','Cooperation feasibility',numericValue(currentFeasibility?.cooperation_feasibility_score) == null ? null : esc(Math.round(numericValue(currentFeasibility?.cooperation_feasibility_score)))),
    detailMetric('管理基准匹配','Management baseline',numericValue(currentMatch) == null ? null : esc(Math.round(numericValue(currentMatch)))),
    detailMetric('墨西哥历史参考','Mexico historical',numericValue(currentHistoricalMatch) == null ? null : esc(Math.round(numericValue(currentHistoricalMatch)))),
    detailMetric('DPV 评分','DPV score',numericValue(currentScore) == null ? null : esc(Math.round(numericValue(currentScore)))),
    detailMetric('等级','Tier',currentTier && currentTier !== '-' ? esc(currentTier) : null)
  ].filter(Boolean).join('');
  const reasonBlock = (titleZh,titleEn,items) => `<section class="crm-detail-section"><h4>${bi(titleZh,titleEn)}</h4>${items.length ? `<ul class="reason-list">${items.map(item=>`<li>${pairedValueHtml(reasonCodePair(typeof item === 'string' ? item : item.code || item.reason || ''))}</li>`).join('')}</ul>` : `<div class="crm-empty-inline">${bi('暂无记录。','No records available.')}</div>`}</section>`;
  const matchReferencePanel = (record, kind) => {
    const isHistorical = kind === 'mx_historical_reference';
    const scoreValue = matchRecordScore(record);
    const coverageValue = record?.coverage_percent;
    const matchReasons = arrayPayload(record?.reason_codes || record?.why_it_matches);
    const mismatchReasons = arrayPayload(record?.mismatch_reason_codes || record?.why_it_does_not_match);
    const missingReasons = arrayPayload(record?.missing_information || record?.missing_reason_codes);
    const title = isHistorical ? bi('墨西哥历史参考匹配','Mexico Historical Reference Match') : bi('管理基准匹配','Management Baseline Match');
    const profileName = isHistorical ? 'Mexico Historical Customer ICP' : 'Management Baseline ICP';
    return `<article class="crm-match-reference"><header><h4>${title}</h4><span class="crm-match-reference-score">${scoreValue == null ? bi('待计算','Not calculated') : `${esc(Math.round(scoreValue))}/100`}</span></header>${factRows([
      ['资料覆盖率','Coverage',coverageValue == null ? '-' : `${esc(coverageValue)}%`],
      ['参考画像','Reference profile',esc(record?.reference_profile_name || record?.profile_name || profileName)]
    ])}<section class="crm-detail-section"><h4>${bi('匹配维度','Match dimensions')}</h4>${dimensionRows(record?.dimension_scores)}</section>${reasonBlock('匹配依据','Match evidence',matchReasons)}${reasonBlock('不匹配依据','Mismatch evidence',mismatchReasons)}${reasonBlock('待补充信息','Missing information',missingReasons)}</article>`;
  };
  detail.classList.add('has-detail');
  detail.innerHTML = `${detailToolbar()}<div class="crm-detail-body">
    <header class="crm-detail-header"><div class="crm-detail-identity"><p class="crm-context">${bi('客户主档','Company record')}<span class="crm-detail-context-value">${esc([lead.country_code,lead.city].filter(Boolean).join(' / ') || '-')}</span></p><h3>${esc(lead.company_name)}</h3><div class="crm-detail-meta">${verificationBadge(lead)}${displayOpportunity ? phase7OpportunityBadge(displayOpportunity) : ''}</div>${lead.website_url ? `<a class="crm-detail-website" href="${esc(safeUrl(lead.website_url))}" target="_blank" rel="noreferrer"><i class="ti ti-world" aria-hidden="true"></i>${bi('企业网站','Official website')}</a>` : ''}</div>${detailMetrics ? `<div class="crm-detail-score-set" aria-label="企业评分 Company metrics">${detailMetrics}</div>` : ''}</header>
    <div id="detail-section-nav" class="crm-detail-tabs p8-detail-section-nav" role="tablist" aria-label="客户详情主要区域 Company detail sections">
      ${[['snapshot','摘要','Snapshot'],['business-fit','业务匹配','Business Fit'],['buyer-contact','采购与联系','Buyer & Contact'],['activity-records','活动与记录','Activity & Records']].map(([key,zh,en],index)=>`<button type="button" role="tab" data-detail-section-tab="${key}" id="detail-section-tab-${key}" aria-controls="detail-section-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${bi(zh,en)}</button>`).join('')}
    </div><div class="crm-detail-workspace">
    <section id="detail-section-snapshot" data-detail-section="snapshot" role="tabpanel" aria-labelledby="detail-section-tab-snapshot">
    <section id="detail-panel-overview" class="crm-tab-panel crm-detail-snapshot" role="region" aria-labelledby="detail-section-tab-snapshot">${factRows([
      ['产品画像','Product profile',productProfileLabel(lead)],['市场','Market',esc([lead.country_code,lead.city].filter(Boolean).join(' / ') || '-')],['核验状态','Verification',verificationBadge(lead)],['数据状态','Data status',lifecycleBadge(lead)],['机会状态','Opportunity status',displayOpportunity ? phase7OpportunityBadge(displayOpportunity) : bi('待确认','To confirm')],['跟进准备状态','Opportunity readiness',currentFeasibility?.opportunity_readiness ? enumBadge(opportunityReadinessLabel(currentFeasibility.opportunity_readiness),readinessTone(currentFeasibility.opportunity_readiness)) : bi('待评估','Not assessed')],['合作机会矩阵','Cooperation matrix',currentFeasibility?.access_opportunity_matrix ? pairHtml(cooperationMatrixLabel(currentFeasibility.access_opportunity_matrix)) : bi('待评估','Not assessed')],['最近核验','Last verified',esc(lead.last_verified_at ? new Date(lead.last_verified_at).toLocaleString() : '-')],['核验来源','Verification sources',esc(sourceCountValue(lead))],['资料时效','Verification freshness',stateBadge(lead.verification_freshness,freshnessLabels)],['企业规模','Company size',`${bi(size[0],size[1])}<br>${sizeEvidenceDisplay}`],['进口/批发','Importer / wholesaler',`${yesNo(importerWholesalerFit)}<br>${importerWholesalerEvidence}`],['连锁供货','Chain supply',`${yesNo(lead.chain_supply_fit)}<br>${esc(lead.chain_store_supply_evidence || '连锁供货属性待确认 / Chain-supply status to confirm')}`]
    ])}</section></section>
    <section id="detail-section-business-fit" data-detail-section="business-fit" role="tabpanel" aria-labelledby="detail-section-tab-business-fit" hidden>
      <div class="p8-detail-subnav" role="tablist" aria-label="业务匹配内容 Business fit records">${[['product-match','商品类目评分','Product Category Score'],['feasibility','合作可行性','Cooperation Feasibility'],['matching','客户匹配','Matching'],['scoring','评分','Scoring']].map(([key,zh,en],index)=>`<button type="button" role="tab" data-detail-tab="${key}" id="detail-tab-${key}" aria-controls="detail-panel-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${bi(zh,en)}</button>`).join('')}</div>
    <section id="detail-panel-product-match" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-product-match" hidden><div id="product-match-panel" aria-busy="true"><div class="crm-product-match-grid">${PRODUCT_MATCH_PROFILES.map(profile=>productMatchStateCard(profile,'loading')).join('')}</div></div></section>
    <section id="detail-panel-feasibility" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-feasibility" hidden>${cooperationFeasibilityView(feasibilityItems,contactRoutes)}</section>
    <section id="detail-panel-matching" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-matching" hidden><div class="crm-match-reference-grid">${matchReferencePanel(managementMatch,'management_baseline')}${matchReferencePanel(mexicoHistoricalMatch,'mx_historical_reference')}</div></section>
    <section id="detail-panel-scoring" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-scoring" hidden>${factRows([['DPV 评分','DPV Score',`<b>${esc(currentScore ?? '-')}/100</b>`],['等级','Tier',esc(currentTier || '-')],['评分资格','Score eligibility',pairHtml(scoreEligibilityLabel(score?.score_eligibility || score?.eligibility))],['资料覆盖率','Evidence coverage',score?.evidence_coverage == null ? '-' : `${esc(score.evidence_coverage)}%`]])}<section class="crm-detail-section"><h4>${bi('评分维度','Score dimensions')}</h4>${dimensionRows(score?.dimension_scores,scores)}</section></section>
    </section>
    <section id="detail-section-buyer-contact" data-detail-section="buyer-contact" role="tabpanel" aria-labelledby="detail-section-tab-buyer-contact" hidden>
      <div class="p8-detail-subnav" role="tablist" aria-label="采购与联系内容 Buyer and contact records">${[['buying','采购联系人','Buying Contacts'],['contacts','联系方式','Contacts'],['social','社交账号','Social']].map(([key,zh,en],index)=>`<button type="button" role="tab" data-detail-tab="${key}" id="detail-tab-${key}" aria-controls="detail-panel-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${bi(zh,en)}</button>`).join('')}</div>
    <section id="detail-panel-buying" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-buying" hidden>${decisionMakerView(decisionMakers,contactRoutes)}</section>
    <section id="detail-panel-contacts" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-contacts" hidden>${factRows([['商务邮箱','Business email',esc(email)],['联系电话','Business phone',esc(phone)],['联系方式状态','Contact status',bi(verify[0],verify[1])]])}</section>
    <section id="detail-panel-social" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-social" hidden>${socialProfiles.length ? `<div class="social-links">${socialProfiles.map(url=>`<a href="${esc(safeUrl(url))}" target="_blank" rel="noreferrer">${esc(socialHost(url))}</a>`).join('')}</div>` : `<div class="crm-empty-inline">${bi('暂无企业社交账号。','No business social account is available.')}</div>`}</section>
    </section>
    <section id="detail-section-activity-records" data-detail-section="activity-records" role="tabpanel" aria-labelledby="detail-section-tab-activity-records" hidden>
      <div class="p8-detail-subnav" role="tablist" aria-label="活动与记录内容 Activity and records">${[['outreach-readiness','联系准备','Outreach Readiness'],['outreach-drafts','开发信草稿','Drafts'],['outreach-messages','联系消息','Messages'],['outreach-replies','回复与下一步','Replies'],['data-history','联系数据历史','Data History'],['evidence','资料依据','Evidence'],['history','历史','History']].map(([key,zh,en],index)=>`<button type="button" role="tab" data-detail-tab="${key}"${key.startsWith('outreach-') || key === 'data-history' ? ' data-phase7-detail-tab' : ''} id="detail-tab-${key}" aria-controls="detail-panel-${key}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${bi(zh,en)}</button>`).join('')}</div>
    <section id="detail-panel-outreach-readiness" class="crm-tab-panel crm-phase7-tab-panel" role="tabpanel" aria-labelledby="detail-tab-outreach-readiness" aria-busy="false" hidden></section>
    <section id="detail-panel-outreach-drafts" class="crm-tab-panel crm-phase7-tab-panel" role="tabpanel" aria-labelledby="detail-tab-outreach-drafts" aria-busy="false" hidden></section>
    <section id="detail-panel-outreach-messages" class="crm-tab-panel crm-phase7-tab-panel" role="tabpanel" aria-labelledby="detail-tab-outreach-messages" aria-busy="false" hidden></section>
    <section id="detail-panel-outreach-replies" class="crm-tab-panel crm-phase7-tab-panel" role="tabpanel" aria-labelledby="detail-tab-outreach-replies" aria-busy="false" hidden></section>
    <section id="detail-panel-data-history" class="crm-tab-panel crm-phase7-tab-panel" role="tabpanel" aria-labelledby="detail-tab-data-history" aria-busy="false" hidden></section>
    <section id="detail-panel-evidence" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-evidence" hidden><section class="crm-detail-section"><h4>${bi('资料来源','Source references')}</h4>${sources.length ? `<div class="sources">${sources.map(s=>{ const kind = evidenceTypeLabels[String(s.evidence_kind || s.evidence_type || '').toUpperCase()] || ['公开企业资料','Public business source']; return `<a href="${esc(safeUrl(s.url || s.source_url))}" target="_blank" rel="noreferrer">${pairHtml(kind)}${bi('查看来源页面','Open source page')}</a>`; }).join('')}</div>` : `<div class="crm-empty-inline">${bi('暂无来源链接。','No source URL is available.')}</div>`}</section></section>
    <section id="detail-panel-history" class="crm-tab-panel" role="tabpanel" aria-labelledby="detail-tab-history" hidden><section class="crm-detail-section"><h4>${bi('历史客户记录','Historical CRM record')}</h4>${linkedCrmHistoryView(linkedCrmHistory)}</section><section class="crm-detail-section"><h4>${bi('企业状态历史','Company status history')}</h4>${lifecycleHistoryView(lifecycleHistory)}</section><section class="crm-detail-section"><h4>${bi('评分历史','Score history')}</h4>${historyTable(scoreHistory,'score')}</section><section class="crm-detail-section"><h4>${bi('客户匹配历史','Customer Match history')}</h4>${historyTable(matchHistory,'match')}</section></section>
    </section></div>
  </div>${hasLegacyReview ? `<footer class="crm-detail-actions actions" aria-label="公司主档审核 Company record review"><div class="crm-detail-action-copy"><strong>${bi('公司主档审核','Company record review')}</strong><span class="crm-detail-action-status" role="status" aria-live="polite" aria-atomic="true"></span></div><div class="crm-detail-action-buttons"><button class="btn reject" type="button" data-status="rejected">${bi('排除公司记录','Exclude Company Record')}</button><button class="btn btn-primary approve" type="button" data-status="approved">${bi('确认公司记录','Confirm Company Record')}</button></div></footer>` : ''}`;
  wireDetailTabs(detail);
  wireDetailSections(detail);
  wireDetailCloseButtons(detail);
  attachPhase7CompanyDetail(detail,{
    companyId,
    opportunityId:lead.opportunity_id || lead.opportunityId || '',
    productProfile:lead.product_profile || lead.productProfile || productProfileCode(lead) || '',
    contactIds:contactRoutes.map(route=>route.contact_id || route.contactId).filter(Boolean)
  });
  detail.querySelectorAll('.actions button[data-status]').forEach(button=>button.addEventListener('click',()=>approve(id,button.dataset.status,button)));
  if (hasLegacyReview) await loadLeads();
  const selectedRow = [...document.querySelectorAll('#leads tr')].find(row => row.dataset.id === String(id));
  if (selectedRow) {
    selectedRow.setAttribute('aria-selected', 'true');
  }
  openDetail(detail);
  loadProductMatchesPanel(companyId,productMatchRequestId);
}

async function approve(id, status, button) {
  const detail = button.closest('dialog') || $('#detail');
  const actions = button.closest('.crm-detail-actions');
  const actionStatus = actions?.querySelector('.crm-detail-action-status');
  const buttons = [...(actions?.querySelectorAll('button[data-status]') || [])];
  const originalLabel = button.innerHTML;
  if (detail) detail.dataset.unsaved='true';
  actions?.setAttribute('aria-busy','true');
  buttons.forEach(action=>{ action.disabled=true; });
    button.innerHTML = status === 'approved' ? bi('正在确认公司记录','Confirming company record') : bi('正在排除公司记录','Excluding company record');
  if (actionStatus) actionStatus.innerHTML = bi('正在保存公司主档审核。','Saving the company record review.');
  try {
    await json(`/api/leads/${encodeURIComponent(id)}/approval`, { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({status}) });
    const [detailRefresh] = await Promise.allSettled([showLead(id), loadMetrics()]);
    if (detailRefresh.status === 'rejected') throw detailRefresh.reason;
    const refreshedStatus = $('#detail')?.querySelector('.crm-detail-action-status');
    if (refreshedStatus) refreshedStatus.innerHTML = status === 'approved'
      ? bi('已保存：公司记录已确认。','Saved: company record confirmed.')
      : bi('已保存：公司记录已排除。','Saved: company record excluded.');
  } catch {
    if (actionStatus?.isConnected) {
      actionStatus.classList.add('is-error');
      actionStatus.innerHTML = bi('公司主档审核保存失败，请重试。','The company record review could not be saved. Try again.');
    }
    button.focus({ preventScroll:true });
  } finally {
    if (detail) delete detail.dataset.unsaved;
    if (actions?.isConnected) actions.setAttribute('aria-busy','false');
    if (button.isConnected) button.innerHTML = originalLabel;
    buttons.forEach(action=>{ if (action.isConnected) action.disabled=false; });
  }
}

function renderEnrichmentStatus(job) {
  const host = $('#enrichment-job-status');
  if (!host || !job) return;
  const pair = enrichmentStatusLabel(job.status);
  const attempted = Number(job.companies_attempted || 0);
  const decisionMakers = Number(job.decision_makers_found || 0);
  const contactRoutes = Number(job.contact_routes_found || 0);
  host.innerHTML = `<span class="crm-enrichment-state">${enumBadge(pair,['COMPLETE','COMPLETED'].includes(String(job.status || '').toUpperCase()) ? 'active' : String(job.status || '').toUpperCase() === 'FAILED' ? 'rejected' : 'review')}<span>${bi(`已处理 ${attempted} 家，采购角色 ${decisionMakers} 条，联系路径 ${contactRoutes} 条`,`Processed ${attempted} companies, ${decisionMakers} buying roles and ${contactRoutes} contact routes`)}</span></span>`;
}

function setEnrichmentButtonBusy(isBusy) {
  const button = $('#start-enrichment');
  if (!button) return;
  button.disabled = isBusy;
  button.setAttribute('aria-busy',isBusy ? 'true' : 'false');
  button.innerHTML = isBusy
    ? `<i class="ti ti-loader" aria-hidden="true"></i>${bi('正在更新采购联系人','Updating Buying Contacts')}`
    : `<i class="ti ti-user-search" aria-hidden="true"></i>${bi('更新采购联系人','Update Buying Contacts')}`;
}

async function pollEnrichmentJob(jobId) {
  clearTimeout(state.enrichmentPollTimer);
  setEnrichmentButtonBusy(true);
  try {
    const job = await json(`/api/enrichment/jobs/${encodeURIComponent(jobId)}`);
    state.enrichmentPollFailures = 0;
    state.enrichmentJobId = jobId;
    renderEnrichmentStatus(job);
    const status = String(job.status || '').toUpperCase();
    if (['COMPLETE','COMPLETED','PARTIAL','FAILED'].includes(status)) {
      if (status !== 'FAILED') await loadOpportunities();
      setEnrichmentButtonBusy(false);
      return;
    }
    state.enrichmentPollTimer = setTimeout(()=>pollEnrichmentJob(jobId),1500);
  } catch {
    const host = $('#enrichment-job-status');
    state.enrichmentPollFailures = Number(state.enrichmentPollFailures || 0) + 1;
    if (host) host.innerHTML = `<span class="crm-enrichment-error">${bi('采购资料状态待确认，正在重新读取。','Buying-information status is being confirmed. Retrying now.')}</span>`;
    const retryMs = Math.min(10000,1500 * (2 ** Math.min(3,state.enrichmentPollFailures - 1)));
    state.enrichmentPollTimer = setTimeout(()=>pollEnrichmentJob(jobId),retryMs);
  }
}

async function loadLatestEnrichmentJob() {
  try {
    const payload = await json('/api/enrichment/jobs');
    const latest = arrayPayload(payload)[0];
    if (!latest) return;
    state.enrichmentJobId = latest.job_id || latest.id;
    renderEnrichmentStatus(latest);
    if (!['COMPLETE','COMPLETED','PARTIAL','FAILED'].includes(String(latest.status || '').toUpperCase())) pollEnrichmentJob(state.enrichmentJobId);
  } catch {}
}

async function startEnrichmentJob() {
  const button = $('#start-enrichment');
  const host = $('#enrichment-job-status');
  if (!button) return;
  const filters = collectOpportunityFilters();
  const request = {
    market_codes:filters.country ? [filters.country] : ['AE','MX'],
    product_profiles:filters.product_profile ? [filters.product_profile] : ['WOMENSWEAR','GENERAL_MERCHANDISE'],
    max_results:100
  };
  setEnrichmentButtonBusy(true);
  if (host) host.innerHTML = bi('正在建立采购资料更新任务。','Creating a buying-information update job.');
  try {
    const created = await json('/api/enrichment/jobs',{ method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request) });
    state.enrichmentJobId = created.job_id || created.id;
    renderEnrichmentStatus({ ...created,companies_attempted:0,decision_makers_found:0,contact_routes_found:0 });
    pollEnrichmentJob(state.enrichmentJobId);
  } catch {
    if (host) host.innerHTML = `<span class="crm-enrichment-error">${bi('采购资料更新任务未建立，请稍后重试。','The buying-information update job was not created. Try again shortly.')}</span>`;
    setEnrichmentButtonBusy(false);
  }
}

const detailDialog = $('#detail');
detailDialog?.addEventListener('click',event=>{
  if (event.target !== detailDialog || !detailCanDismiss(detailDialog)) return;
  const bounds = detailDialog.getBoundingClientRect();
  const onBackdrop = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (onBackdrop) detailDialog.close();
});
detailDialog?.addEventListener('cancel',event=>{
  if (!detailCanDismiss(detailDialog)) event.preventDefault();
});
document.addEventListener('keydown',event=>{
  if (event.key !== 'Escape') return;
  if (detailDialog?.open && detailCanDismiss(detailDialog)) {
    event.preventDefault();
    closeDetail(detailDialog);
    return;
  }
  const verificationDialog = $('#verification-detail');
  if (verificationDialog?.open) {
    event.preventDefault();
    verificationDialog.close();
  }
});
detailDialog?.addEventListener('close',()=>{
  const originalTrigger = state.detailTrigger;
  const originalTriggerKind = state.detailTriggerKind;
  state.detailTrigger = null;
  state.detailTriggerKind = null;
  requestAnimationFrame(()=>{
    const currentLead = [...document.querySelectorAll('#leads tr')].find(row=>row.dataset.id === String(state.selected))?.querySelector('.lead-select');
    const replacementTrigger = originalTriggerKind === 'overview'
      ? [...document.querySelectorAll('[data-overview-id]')].find(button=>button.dataset.overviewId === String(state.selected))
      : originalTriggerKind === 'opportunity'
        ? [...document.querySelectorAll('[data-opportunity-id]')].find(button=>button.dataset.opportunityId === String(state.selected))
        : originalTriggerKind === 'lead' ? currentLead
          : originalTriggerKind === 'crm-history'
            ? [...document.querySelectorAll('[data-crm-history-id]')].find(button=>button.dataset.crmHistoryId === String(state.crmHistorySelected))
            : null;
    const usableTrigger = originalTrigger?.isConnected && !originalTrigger.closest('[hidden],[aria-hidden="true"]') ? originalTrigger : null;
    const usableReplacement = replacementTrigger?.isConnected && !replacementTrigger.closest('[hidden],[aria-hidden="true"]') ? replacementTrigger : null;
    const usableCurrentLead = currentLead?.isConnected && !currentLead.closest('[hidden],[aria-hidden="true"]') ? currentLead : null;
    (usableTrigger || usableReplacement || usableCurrentLead)?.focus({ preventScroll:true });
  });
});

$('#tier').addEventListener('change', () => { state.companyPage=1; loadLeads(); });
$('#size').addEventListener('change', () => { state.companyPage=1; loadLeads(); });
$('#verification-filter')?.addEventListener('change', () => { state.companyPage=1; loadLeads(); });
$('#lifecycle-filter')?.addEventListener('change', () => { state.companyPage=1; loadLeads(); });
$('#company-sort')?.addEventListener('change',()=>{state.companyPage=1;renderCompanyTable()});
$('#opportunity-filters')?.addEventListener('change',()=>loadOpportunities());
document.addEventListener('p8:opportunity-search',()=>renderOpportunityTable());
$('#opportunity-clear-filters')?.addEventListener('click',()=>{
  $('#opportunity-filters')?.reset();
  if ($('#opportunity-sort')) $('#opportunity-sort').value='category_procurement_desc';
  loadOpportunities();
});
$('#start-enrichment')?.addEventListener('click',startEnrichmentJob);
document.addEventListener('phase9:research-job-open',()=>{
  clearTimeout(state.researchPollTimer);
  state.researchPollTimer = null;
});
document.addEventListener('crm:densitychange',renderCompanyTable);
$('#research-country').addEventListener('change', () => {
  $('#research-city').value = '';
  $('#research-region').value = '';
});
$('#research-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#start-research');
  const buyerTypes = [...document.querySelectorAll('input[name="buyer_type"]:checked')].map(input => input.value);
  const market = marketSelection($('#research-country').value);
  const request = {
    country: market.country_name,
    country_code: market.country_code,
    country_name: market.country_name,
    city: $('#research-city').value.trim(),
    region: $('#research-region').value.trim(),
    product_category: $('#research-category').value,
    product_profile: $('#research-category').selectedOptions[0]?.dataset.productProfile || 'WOMENSWEAR',
    buyer_types: buyerTypes,
    max_results: Number($('#research-limit').value)
  };
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = bi('正在创建任务…','Creating job…');
  try {
    const created = await json('/api/research/jobs', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(request)
    });
    const createdJobId = created.job_id || created.id;
    const jobUrl = new URL(location.href);
    jobUrl.searchParams.set('job',createdJobId);
    jobUrl.searchParams.set('jobs_tab','research');
    jobUrl.hash = 'jobs';
    history.pushState(null,'',jobUrl);
    activateView('jobs',{ updateHash:false });
    renderResearchJob({ ...request, ...created, candidates_found:0, websites_found:0, companies_qualified:0 });
    document.dispatchEvent(new CustomEvent('phase9:research-job-created',{ detail:{ jobId:createdJobId,job:{ ...request,...created } } }));
    pollResearchJob(createdJobId);
  } catch (error) {
    const failedJobId = error.payload?.job_id;
    document.dispatchEvent(new CustomEvent('phase9:research-job-create-failed',{ detail:{ jobId:failedJobId || '' } }));
  } finally {
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    button.innerHTML = bi('开始研究','Start Research');
  }
});
$('#verification-detail-close').addEventListener('click', () => $('#verification-detail').close());
$('#verification-detail').addEventListener('click', event => {
  const dialog = $('#verification-detail');
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
$('#verification-detail').addEventListener('close', () => {
  state.verificationTrigger?.focus({ preventScroll:true });
  state.verificationTrigger = null;
});
$('#reset').addEventListener('click', async () => {
  $('#reset').disabled = true;
  $('#reset').setAttribute('aria-busy', 'true');
  $('#reset').innerHTML = bi('正在更新名录…','Updating directory…');
  $('#run-status').innerHTML = bi('正在更新企业名录，请稍候。','Updating the company directory.');
  try {
    const result = await json('/api/live/collect', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({limit:50})});
    state.selected=null;
    $('#detail').innerHTML=`<div class="empty"><p>${bi(`客户名录更新完成，新增 ${result.newCompanies} 家，更新 ${result.updatedCompanies} 家。公开来源已更新。`,`Company directory updated, ${result.newCompanies} new, ${result.updatedCompanies} updated. Public sources were refreshed.`)}</p></div>`;
    await Promise.all([loadMetrics(),loadLeads()]);
  } catch (error) {
    $('#run-status').innerHTML = bi(`更新失败：${error.message}。当前名录不受影响。`,`Update failed: ${error.message}. The current directory is unchanged.`);
  } finally {
    $('#reset').disabled=false;
    $('#reset').setAttribute('aria-busy', 'false');
    $('#reset').innerHTML=bi('更新客户名录','Update Company Directory');
  }
});

ensureCrmHistoryPanel();
initPhase7Ui();
syncOpportunityFilters();
const initialLoads = await Promise.allSettled([loadMetrics(),loadLeads(),loadIcpProfiles(),loadImportBatches(),loadCrmHistory(),loadLatestEnrichmentJob()]);
if (initialLoads[0].status === 'rejected') {
  $('#metrics').setAttribute('aria-busy','false');
  $('#metrics').innerHTML = `<div class="crm-load-error">${bi('名录概览读取失败。','Directory overview could not be loaded.')}<button id="metrics-retry" class="btn btn-outline-secondary" type="button">${bi('重新读取','Retry')}</button></div>`;
  $('#metrics-retry')?.addEventListener('click',loadMetrics);
}
if (initialLoads[1].status === 'rejected') {
  $('#leads').innerHTML = `<tr><td colspan="11" class="crm-loading-cell">${bi('客户名录读取失败。','Company directory could not be loaded.')}<button id="leads-retry" class="btn btn-outline-secondary" type="button">${bi('重新读取','Retry')}</button></td></tr>`;
  $('#opportunity-table').innerHTML = `<tr><td colspan="7" class="crm-loading-cell">${bi('业务机会读取失败。','Opportunities could not be loaded.')}</td></tr>`;
  $('#leads-retry')?.addEventListener('click',loadLeads);
}
const requestedJobId = new URLSearchParams(location.search).get('job');
if (requestedJobId) {
  activateView('jobs',{ updateHash:false, focus:false });
  try {
    const job = await json(`/api/research/jobs/${encodeURIComponent(requestedJobId)}`);
    if (renderResearchJob(job)) {
      if (['COMPLETED','FAILED'].includes(job.status)) await loadResearchResults(requestedJobId);
      else pollResearchJob(requestedJobId);
    }
  } catch {}
}
