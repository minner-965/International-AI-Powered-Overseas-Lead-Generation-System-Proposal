import { htmlService } from '../platform/HtmlService.js';
import { extractRootDomain, normalizeUrl } from '../search/resultNormalizer.js';
import { GENERIC_MARKET_PROFILE } from '../market/marketProfiles.js';
import { getProductCategoryProfile } from '../market/productProfiles.js';
import { normalizeWhatsApp } from '../contact/phoneUtils.js';

const PLATFORM_HOSTS = Object.freeze({
  'linkedin.com': 'LINKEDIN', 'instagram.com': 'INSTAGRAM', 'facebook.com': 'FACEBOOK',
  'tiktok.com': 'TIKTOK', 'youtube.com': 'YOUTUBE', 'youtu.be': 'YOUTUBE',
  'wa.me': 'WHATSAPP', 'whatsapp.com': 'WHATSAPP'
});

const GENERIC_NAME = /^(?:home|about(?: us)?|contact(?: us)?|welcome|official site|beauty|cosmetics|personal care|products?|services?|distribution|distributor|wholesale|supplier|company)$/i;
const DIRECT_CONTACT_TYPES = new Set(['EMAIL', 'PHONE', 'WHATSAPP', 'CONTACT_FORM']);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termsRegex(terms, fallback) {
  const values = [...new Set((terms || []).map(value => String(value).trim()).filter(Boolean))];
  return values.length ? new RegExp(`\\b(?:${values.map(escapeRegex).join('|')})\\b`, 'i') : fallback;
}

export function normalizeCompanyName(value = '', marketProfile = GENERIC_MARKET_PROFILE) {
  const normalized = String(value).toLowerCase()
    .replace(/&amp;/g, ' and ').replace(/&/g, ' and ')
    .normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const suffixes = [...new Set([...(GENERIC_MARKET_PROFILE.businessSuffixes || []), ...(marketProfile.businessSuffixes || [])]
    .map(term => String(term).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim())
    .filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!suffixes.length) return normalized;
  const suffixPattern = new RegExp(`(?:^|\\s)(?:${suffixes.map(escapeRegex).join('|')})$`, 'iu');
  let result = normalized;
  while (suffixPattern.test(result)) result = result.replace(suffixPattern, ' ').replace(/\s+/g, ' ').trim();
  return result;
}

export function normalizeSocialUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const root = extractRootDomain(normalized);
  if (PLATFORM_HOSTS[root]) {
    url.protocol = 'https:';
    url.hostname = root;
    url.port = '';
  }
  url.search = '';
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

const SOCIAL_NAME_STOPWORDS = new Set([
  'company','corporation','limited','ltd','llc','fze','fzco','plc','group','general','trading',
  'distribution','distributor','wholesale','wholesaler','store','official','international'
]);

export function socialResultMatchesCompany(companyName, result, marketProfile = GENERIC_MARKET_PROFILE) {
  const tokens = normalizeCompanyName(companyName, marketProfile).split(' ')
    .filter(token => token.length >= 3 && !SOCIAL_NAME_STOPWORDS.has(token));
  if (!tokens.length) return false;
  let path = '';
  try { path = new URL(result.url).pathname; } catch {}
  const identityText = normalizeCompanyName(`${result.title || ''} ${path}`, marketProfile);
  return tokens.every(token => identityText.includes(token));
}

export function classifySocialUrl(value) {
  let raw;
  try { raw = new URL(String(value)); } catch { return null; }
  const rawRoot = extractRootDomain(raw.href);
  if (PLATFORM_HOSTS[rawRoot] === 'WHATSAPP') {
    const phone = normalizeWhatsApp(raw.href);
    if (!phone) return null;
    return {
      platform: 'WHATSAPP', normalized_profile_url: `https://wa.me/${phone}`,
      account_type: 'BUSINESS', verification_status: 'OFFICIAL_SITE_LINKED'
    };
  }
  const normalized = normalizeSocialUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const root = extractRootDomain(normalized);
  const platform = PLATFORM_HOSTS[root];
  if (!platform) return null;
  const path = url.pathname.toLowerCase();
  if (!path || path === '/') return null;
  if (platform === 'LINKEDIN' && !path.startsWith('/company/') && !path.startsWith('/showcase/')) {
    return { platform, normalized_profile_url: normalized, account_type: 'PERSONAL_REJECTED', verification_status: 'REJECTED' };
  }
  if (platform === 'FACEBOOK' && /\/(?:profile\.php|people)\b/.test(path)) {
    return { platform, normalized_profile_url: normalized, account_type: 'PERSONAL_REJECTED', verification_status: 'REJECTED' };
  }
  if (platform === 'FACEBOOK' && /^\/(?:share|sharer|dialog|login|plugins)(?:\/|$)/.test(path)) return null;
  if (platform === 'INSTAGRAM' && /^\/(?:p|reel|stories|explore)(?:\/|$)/.test(path)) return null;
  return { platform, normalized_profile_url: normalized, account_type: 'BUSINESS', verification_status: 'OFFICIAL_SITE_LINKED' };
}

export function extractBusinessSocialLinks(html, pageUrl) {
  const $ = htmlService.load(html);
  const values = new Set();
  $('a[href]').each((_index, node) => {
    try { values.add(new URL($(node).attr('href'), pageUrl).href); } catch {}
  });
  $('script[type="application/ld+json"]').each((_index, node) => {
    try {
      const parsed = JSON.parse($(node).text());
      const stack = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of stack) {
        const sameAs = Array.isArray(item?.sameAs) ? item.sameAs : item?.sameAs ? [item.sameAs] : [];
        sameAs.forEach(value => values.add(value));
      }
    } catch {}
  });
  return [...values].map(classifySocialUrl).filter(Boolean);
}

function tidy(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function isUsableCompanyName(value) {
  if (!value || value.length > 120 || GENERIC_NAME.test(value)) return false;
  // Reject CSS selectors/declarations and other page-source fragments. These can
  // appear in malformed footer markup and must never become a company identity.
  if (/^(?:[-.#][\w-]+|[\w-]*wrapper)\s+[.#\w-]+[,;{]?$|[{};]/i.test(value)) return false;
  if ((value.match(/[,;{}]/g) || []).length > 1) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

function sentenceEvidence(text, pattern, max = 3) {
  const sentences = tidy(text).split(/(?<=[.!?])\s+|\s*[|•]\s*/).map(tidy).filter(Boolean);
  const matches = sentences.filter(sentence => pattern.test(sentence)).slice(0, max);
  pattern.lastIndex = 0;
  return matches.map(sentence => sentence.slice(0, 700));
}

function bestCompanyName($, fallback, marketProfile) {
  const candidates = [];
  for (const item of htmlService.jsonLdItems($)) {
    if (isStructuredBusiness(item) && item?.name) candidates.push(item.name);
  }
  candidates.push($('meta[property="og:site_name"]').attr('content'));
  candidates.push($('footer').text().match(/(?:©|copyright)\s*(?:\d{4})?\s*([^|.]{3,90})/i)?.[1]);
  candidates.push(...$('title').first().text().split(/\s+[|–—-]\s+/));
  candidates.push($('h1').first().text());
  candidates.push(fallback);
  return candidates.map(tidy).filter(isUsableCompanyName)
    .sort((a, b) => {
      const legalPattern = termsRegex([...(marketProfile.businessSuffixes || []), 'Group', 'Distribution', 'Distributor', 'Company'], /$^/);
      const legal = value => legalPattern.test(value) ? 1 : 0;
      return legal(b) - legal(a) || a.length - b.length;
    })[0] || tidy(fallback) || null;
}

function isStructuredBusiness(item) {
  const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
  return types.some(type => /organization|corporation|localbusiness|store|professionalservice/i.test(String(type || '')));
}

function structuredValue(value) {
  if (Array.isArray(value)) return value.map(structuredValue).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return tidy(value.name || value.value || value['@id'] || '');
  return tidy(value);
}

function structuredDescriptions(items) {
  return items.filter(isStructuredBusiness).flatMap(item => [
    item.description, item.disambiguatingDescription, item.slogan, item.knowsAbout
  ]).map(structuredValue).filter(Boolean);
}

function structuredLocations(items) {
  const values = [];
  for (const item of items.filter(isStructuredBusiness)) {
    const addresses = Array.isArray(item.address) ? item.address : item.address ? [item.address] : [];
    for (const address of addresses) {
      if (typeof address === 'string') {
        values.push({ value: tidy(address), method: 'JSON_LD_POSTAL_ADDRESS' });
        continue;
      }
      const country = typeof address?.addressCountry === 'object'
        ? address.addressCountry.name || address.addressCountry.value : address?.addressCountry;
      const value = [address?.streetAddress, address?.addressLocality, address?.addressRegion,
        address?.postalCode, country].map(tidy).filter(Boolean).join(', ');
      if (value) values.push({ value, method: 'JSON_LD_POSTAL_ADDRESS' });
    }
    const areas = Array.isArray(item.areaServed) ? item.areaServed : item.areaServed ? [item.areaServed] : [];
    for (const area of areas) {
      const value = structuredValue(area);
      if (value) values.push({ value, method: 'JSON_LD_AREA_SERVED' });
    }
  }
  return values;
}

function structuredEmployeeRanges(items) {
  const values = [];
  for (const item of items.filter(isStructuredBusiness)) {
    const employee = item.numberOfEmployees;
    if (employee == null) continue;
    if (typeof employee === 'number' && Number.isFinite(employee)) {
      values.push(`${employee} employees`);
      continue;
    }
    if (typeof employee === 'string') {
      const match = employee.match(/\d{1,5}(?:\s*[-–]\s*\d{1,5})?/);
      if (match) values.push(`${match[0]} employees`);
      continue;
    }
    const min = Number(employee?.minValue);
    const max = Number(employee?.maxValue ?? employee?.value);
    if (Number.isFinite(min) && Number.isFinite(max)) values.push(`${min}-${max} employees`);
    else if (Number.isFinite(max)) values.push(`${max} employees`);
  }
  return values;
}

function pushEvidence(items, type, text, page, confidence, method, value = null) {
  if (!text) return;
  items.push({
    evidence_type: type,
    evidence_value: value,
    evidence_text: tidy(text).slice(0, 700),
    source_type: page.source_type || 'OFFICIAL_WEBSITE',
    source_url: page.url,
    source_page_title: page.title || null,
    confidence,
    verification_method: method,
    captured_at: page.captured_at || new Date()
  });
}

export function extractVerificationEvidence(page, { candidateTitle = '', country = '', city = '', region = '', category = '', marketProfile = GENERIC_MARKET_PROFILE } = {}) {
  const $ = htmlService.load(page.html);
  const structuredItems = htmlService.jsonLdItems($);
  const resolvedName = bestCompanyName($, candidateTitle, marketProfile);
  $('script,style,noscript,template,svg,iframe').remove();
  const text = tidy($('body').text());
  const items = [];
  for (const item of structuredItems.filter(isStructuredBusiness)) {
    const name = tidy(item.name);
    if (name) pushEvidence(items, 'COMPANY_IDENTITY', name, page, 0.95, 'JSON_LD_ORGANIZATION_NAME', name);
  }
  const identitySignals = [
    $('meta[property="og:site_name"]').attr('content'), $('h1').first().text(), $('title').first().text(),
    $('footer').text().match(/(?:©|copyright)[^|.]{0,120}/i)?.[0]
  ].map(tidy).filter(Boolean);
  for (const value of identitySignals.slice(0, 3)) pushEvidence(items, 'COMPANY_IDENTITY', value, page, 0.85, 'OFFICIAL_PAGE_IDENTITY_FIELD', resolvedName);

  const locationPattern = termsRegex([
    country, city, region, marketProfile.countryName,
    ...(marketProfile.searchMarketNames || []), ...(marketProfile.locationTerms || [])
  ], /$^/);
  for (const value of sentenceEvidence(text, locationPattern, 3)) pushEvidence(items, 'LOCATION', value, page, 0.8, 'PUBLIC_PAGE_EXACT_TEXT', [city, country].filter(Boolean).join(', '));
  for (const location of structuredLocations(structuredItems)) {
    const matchesMarket = locationPattern.test(location.value);
    locationPattern.lastIndex = 0;
    if (matchesMarket) pushEvidence(items, 'LOCATION', location.value, page, 0.92, location.method, location.value);
  }

  const patterns = [
    ['IMPORTER', termsRegex(['we import','importer of','import and export',...(marketProfile.importerTerms || [])], /$^/), 0.95, 'EXPLICIT_BUSINESS_ACTIVITY'],
    ['WHOLESALER', termsRegex(['wholesale of','wholesaler','wholesale supplier',...(marketProfile.wholesalerTerms || [])], /$^/), 0.95, 'EXPLICIT_BUSINESS_ACTIVITY'],
    ['DISTRIBUTOR', termsRegex(['we distribute','distributor of','authorized distributor','exclusive distributor','distribution company','distribution arm',...(marketProfile.distributorTerms || [])], /$^/), 0.95, 'EXPLICIT_BUSINESS_ACTIVITY'],
    ['GENERAL_TRADING', termsRegex(marketProfile.tradingTerms || [], /$^/), 0.9, 'MARKET_PROFILE_TRADING_ACTIVITY'],
    ['REGIONAL_COVERAGE', /\b(?:regional\s+(?:operations?|coverage|network)|national\s+(?:operations?|coverage|network)|markets?\s+across|operations?\s+across|throughout\s+the\s+country)\b/i, 0.78, 'PUBLIC_SCALE_SIGNAL'],
    ['LOCATIONS', /\b(?:stores?|branches?|locations?|offices?|showrooms?)\s+(?:across|in|throughout)|\bmultiple\s+(?:stores?|branches?|locations?|offices?)\b/i, 0.72, 'PUBLIC_SCALE_SIGNAL'],
    ['WAREHOUSE', /\b(?:warehouse|warehousing|distribution\s+cent(?:er|re)|logistics\s+facilit)\b/i, 0.78, 'PUBLIC_SCALE_SIGNAL'],
    ['BRANDS', /\b(?:portfolio\s+of\s+(?:international\s+)?brands|represent(?:s|ing)\s+brands|brand\s+portfolio|exclusive\s+brands)\b/i, 0.75, 'PUBLIC_SCALE_SIGNAL'],
    ['RETAIL_CHANNEL', /\b(?:department\s+stores?|retail\s+network|salons?|pharmacies|supermarkets?|e-?commerce)\b/i, 0.7, 'PUBLIC_ACTIVITY_SIGNAL'],
    ['RECENT_ACTIVITY', /\b(?:202[4-9]|latest|recent|new\s+(?:store|launch|brand|partnership))\b/i, 0.62, 'PUBLIC_RECENCY_SIGNAL']
  ];
  for (const [type, pattern, confidence, method] of patterns) {
    for (const value of sentenceEvidence(text, pattern, 3)) pushEvidence(items, type, value, page, confidence, method);
    for (const value of structuredDescriptions(structuredItems)) {
      const matches = pattern.test(value);
      pattern.lastIndex = 0;
      if (matches) pushEvidence(items, type, value, page, confidence, `JSON_LD_${method}`);
    }
  }

  const employeePattern = /\b(?:over|more than|approximately|about)?\s*(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?\s+employees?\b/i;
  for (const value of sentenceEvidence(text, employeePattern, 2)) pushEvidence(items, 'EMPLOYEE_SIZE', value, page, 0.95, 'EXPLICIT_EMPLOYEE_RANGE', value.match(employeePattern)?.[0] || value);
  for (const value of structuredEmployeeRanges(structuredItems)) pushEvidence(items, 'EMPLOYEE_SIZE', value, page, 0.95, 'JSON_LD_NUMBER_OF_EMPLOYEES', value);
  const scalePattern = /\b(?:over|more than|approximately|about)?\s*(\d{1,4})\+?\s+(?:stores?|branches?|locations?|offices?|brands?|countries)\b/i;
  for (const value of sentenceEvidence(text, scalePattern, 3)) pushEvidence(items, 'COMPANY_SCALE', value, page, 0.82, 'EXPLICIT_PUBLIC_SCALE_COUNT', value.match(scalePattern)?.[0] || value);

  const categoryPatterns = termsRegex(getProductCategoryProfile(category).evidenceTerms, /$^/);
  for (const value of sentenceEvidence(text, categoryPatterns, 3)) pushEvidence(items, 'PRODUCT_CATEGORY', value, page, 0.82, 'PUBLIC_PRODUCT_TEXT', category);
  for (const value of structuredDescriptions(structuredItems)) {
    const matches = categoryPatterns.test(value);
    categoryPatterns.lastIndex = 0;
    if (matches) pushEvidence(items, 'PRODUCT_CATEGORY', value, page, 0.82, 'JSON_LD_PRODUCT_TEXT', category);
  }
  return { resolvedName, text, evidence: items };
}

export function resolveOfficialWebsite(candidate, pages = [], _marketProfile = GENERIC_MARKET_PROFILE) {
  const directoryTypes = new Set(['DIRECTORY_PROFILE', 'TRADE_SHOW_PROFILE', 'SOCIAL_PROFILE']);
  const external = candidate.discovered_external_website;
  const preferredUrl = external || candidate.final_url || candidate.url;
  const candidateDomain = extractRootDomain(preferredUrl || '');
  if (external) {
    return { website: normalizeUrl(external), root_domain: extractRootDomain(external), confidence: 0.92, method: 'PROFILE_EXPLICIT_OUTBOUND_LINK' };
  }
  if (!directoryTypes.has(candidate.candidate_type) && candidateDomain) {
    const identityFound = pages.some(page => page.evidence?.some(item => item.evidence_type === 'COMPANY_IDENTITY'));
    const marketFound = pages.some(page => page.evidence?.some(item => item.evidence_type === 'LOCATION'));
    const activityFound = pages.some(page => page.evidence?.some(item => ['IMPORTER','WHOLESALER','DISTRIBUTOR','GENERAL_TRADING'].includes(item.evidence_type)));
    const confidence = identityFound && marketFound ? 0.9 : identityFound && activityFound ? 0.78 : 0.55;
    return {
      website: normalizeUrl(candidate.final_url || candidate.url), root_domain: candidateDomain,
      confidence,
      method: confidence >= 0.9 ? 'STANDALONE_DOMAIN_IDENTITY_AND_MARKET_MATCH'
        : confidence >= 0.7 ? 'STANDALONE_DOMAIN_IDENTITY_AND_ACTIVITY_MATCH'
          : 'WEAK_SEARCH_ASSOCIATED_DOMAIN'
    };
  }
  return { website: null, root_domain: null, confidence: 0, method: 'NO_VERIFIED_OFFICIAL_WEBSITE' };
}

function statusFromEvidence(evidence, type, supportedPatterns = []) {
  const direct = evidence.filter(item => item.evidence_type === type && item.confidence >= 0.9);
  if (direct.length) return { status: 'VERIFIED', evidenceIds: direct.map(item => item.id).filter(Boolean) };
  const supported = evidence.filter(item => supportedPatterns.some(pattern => pattern.test(item.evidence_text)));
  return supported.length ? { status: 'SUPPORTED', evidenceIds: supported.map(item => item.id).filter(Boolean) }
    : { status: 'UNKNOWN', evidenceIds: [] };
}

export function assessBusinessTypes(evidence) {
  return {
    importer: statusFromEvidence(evidence, 'IMPORTER', [/exclusive\s+(?:regional\s+)?distribution/i, /international\s+brands/i]),
    wholesaler: statusFromEvidence(evidence, 'WHOLESALER', [/supply\s+(?:to|for)\s+(?:retailers?|salons?|stores?)/i]),
    distributor: statusFromEvidence(evidence, 'DISTRIBUTOR', [/exclusive\s+(?:regional\s+)?distribution/i, /distribution\s+of\s+(?:international\s+)?brands/i, /distribution\s+arm/i]),
    generalTrading: statusFromEvidence(evidence, 'GENERAL_TRADING', [])
  };
}

function employeeUpperBound(text) {
  const match = String(text || '').match(/(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?\s+employees?/i);
  return match ? Number(match[2] || match[1]) : null;
}

export function assessCompanySize(evidence) {
  const employeeEvidence = evidence.filter(item => item.evidence_type === 'EMPLOYEE_SIZE');
  const employeeCounts = employeeEvidence.map(item => employeeUpperBound(`${item.evidence_value || ''} ${item.evidence_text}`)).filter(Number.isFinite);
  if (employeeCounts.length) {
    const upper = Math.max(...employeeCounts);
    const company_size = upper <= 10 ? 'MICRO' : upper <= 50 ? 'SMALL' : upper <= 250 ? 'MEDIUM' : upper <= 1000 ? 'LARGE' : 'ENTERPRISE';
    return { company_size, confidence: 0.95, method: 'EXPLICIT_EMPLOYEE_RANGE', evidenceIds: employeeEvidence.map(item => item.id).filter(Boolean) };
  }
  const scale = evidence.filter(item => ['COMPANY_SCALE','REGIONAL_COVERAGE','LOCATIONS','WAREHOUSE','BRANDS'].includes(item.evidence_type));
  const countValues = scale.map(item => Number(String(item.evidence_value || item.evidence_text).match(/\d{1,4}/)?.[0])).filter(Number.isFinite);
  const maxCount = countValues.length ? Math.max(...countValues) : 0;
  const types = new Set(scale.map(item => item.evidence_type));
  let company_size = 'UNKNOWN';
  let confidence = 0;
  if (maxCount > 100 || (types.has('REGIONAL_COVERAGE') && types.has('LOCATIONS') && types.has('BRANDS') && types.has('WAREHOUSE'))) {
    company_size = 'LARGE'; confidence = 0.67;
  } else if (maxCount >= 20 || types.size >= 3) {
    company_size = 'MEDIUM'; confidence = 0.62;
  } else if (maxCount >= 3 || types.size >= 2) {
    company_size = 'SMALL'; confidence = 0.58;
  }
  return {
    company_size, confidence,
    method: company_size === 'UNKNOWN' ? 'INSUFFICIENT_PUBLIC_EVIDENCE' : 'INFERRED_FROM_PUBLIC_SCALE_SIGNALS',
    evidenceIds: company_size === 'UNKNOWN' ? [] : scale.map(item => item.id).filter(Boolean)
  };
}

export function assessSmeRelevance({ companySize, businessTypes, directContacts, regionalEvidence }) {
  const target = Object.values(businessTypes).some(item => ['VERIFIED','SUPPORTED'].includes(item.status));
  const reasons = [];
  if (['MICRO','SMALL','MEDIUM'].includes(companySize)) reasons.push('SME_SCALE');
  if (regionalEvidence) reasons.push('REGIONAL_OPERATION');
  if (target) reasons.push('TARGET_BUSINESS_ACTIVITY');
  if (directContacts > 0) reasons.push('DIRECT_PUBLIC_CONTACT');
  if (companySize === 'ENTERPRISE') return { value: 'LOW', reasonCodes: ['ENTERPRISE_SCALE', ...reasons] };
  if (target && directContacts > 0 && ['MICRO','SMALL','MEDIUM'].includes(companySize)) return { value: 'HIGH', reasonCodes: reasons };
  if ((target && regionalEvidence) || (companySize === 'UNKNOWN' && regionalEvidence && directContacts > 0)) return { value: 'MEDIUM', reasonCodes: reasons };
  return { value: reasons.length ? 'LOW' : 'UNKNOWN', reasonCodes: reasons };
}

export function assessPartnershipAccessibility({ companySize, businessTypes, contacts = [], regionalEvidence = false, consumerOnly = false }) {
  const target = Object.values(businessTypes).some(item => ['VERIFIED','SUPPORTED'].includes(item.status));
  const verifiedTarget = Object.values(businessTypes).some(item => item.status === 'VERIFIED');
  const direct = contacts.filter(item => DIRECT_CONTACT_TYPES.has(item.contact_type)).length;
  const reasons = [];
  if (target) reasons.push('TARGET_BUSINESS_ACTIVITY');
  if (direct) reasons.push('DIRECT_PUBLIC_CONTACT');
  if (contacts.some(item => item.contact_type === 'EMAIL')) reasons.push('PUBLIC_BUSINESS_EMAIL');
  if (contacts.some(item => item.contact_type === 'WHATSAPP')) reasons.push('EXPLICIT_WHATSAPP');
  if (contacts.some(item => item.contact_type === 'CONTACT_FORM')) reasons.push('PUBLIC_ENQUIRY_FORM');
  if (regionalEvidence) reasons.push('REGIONAL_OPERATION');
  if (['MICRO','SMALL','MEDIUM'].includes(companySize)) reasons.push('SME_OR_MEDIUM_SCALE');
  if (['LARGE','ENTERPRISE'].includes(companySize)) reasons.push('LARGE_OR_ENTERPRISE_SCALE');
  if (consumerOnly) return { value: 'LOW', confidence: 0.82, reasonCodes: ['CONSUMER_ONLY_RETAIL', ...reasons] };
  if (target && direct > 0 && companySize !== 'ENTERPRISE') return { value: 'HIGH', confidence: verifiedTarget ? 0.86 : 0.74, reasonCodes: reasons };
  if (target && (direct > 0 || ['LARGE','ENTERPRISE'].includes(companySize))) return { value: 'MEDIUM', confidence: 0.68, reasonCodes: reasons };
  if (!target && direct > 0) return { value: 'LOW', confidence: 0.65, reasonCodes: ['WEAK_TARGET_ACTIVITY', ...reasons] };
  return { value: 'UNKNOWN', confidence: 0.35, reasonCodes: reasons.length ? reasons : ['INSUFFICIENT_PUBLIC_EVIDENCE'] };
}

export function strategicAccountAssessment(companySize, evidence) {
  const reasonCodes = [];
  const types = new Set(evidence.map(item => item.evidence_type));
  if (companySize === 'ENTERPRISE') reasonCodes.push('ENTERPRISE_RETAIL_GROUP');
  if (companySize === 'LARGE' && types.has('REGIONAL_COVERAGE')) reasonCodes.push('LARGE_REGIONAL_DISTRIBUTOR');
  if (types.has('LOCATIONS') && types.has('REGIONAL_COVERAGE')) reasonCodes.push('MAJOR_CHANNEL_NETWORK');
  if (types.has('COMPANY_SCALE') || types.has('WAREHOUSE')) reasonCodes.push('HIGH_PURCHASING_CAPACITY_SIGNAL');
  return { strategic_account: reasonCodes.length > 0 && ['LARGE','ENTERPRISE'].includes(companySize), reasonCodes };
}

export function matchExistingCompany(candidate, companies, contacts = [], marketProfile = GENERIC_MARKET_PROFILE) {
  const root = candidate.official_root_domain;
  if (root) {
    const domainMatch = companies.find(company => company.official_root_domain === root || extractRootDomain(company.website_url || '') === root);
    if (domainMatch) return { company: domainMatch, method: 'EXACT_OFFICIAL_ROOT_DOMAIN', confidence: 1 };
  }
  const normalizedName = normalizeCompanyName(candidate.resolved_company_name, marketProfile);
  const nameMatch = companies.find(company => normalizeCompanyName(company.company_name, marketProfile) === normalizedName
    && (!candidate.country_code || company.country_code === candidate.country_code));
  if (nameMatch) return { company: nameMatch, method: 'NORMALIZED_NAME_AND_MARKET', confidence: 0.95 };
  const values = new Set(contacts.map(item => item.normalized_value).filter(Boolean));
  const contactMatch = companies.find(company => (!candidate.country_code || company.country_code === candidate.country_code)
    && company.contact_values?.some(value => values.has(value)));
  return contactMatch ? { company: contactMatch, method: 'PUBLIC_CONTACT_MATCH', confidence: 0.9 } : null;
}
