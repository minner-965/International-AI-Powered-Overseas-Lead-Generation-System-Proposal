import { GENERIC_MARKET_PROFILE } from '../market/marketProfiles.js';
import { getProductCategoryProfile } from '../market/productProfiles.js';

const socialDomains = new Set(['linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com']);
const rejectedDomains = new Set(['wikipedia.org', 'pinterest.com', 'reddit.com', 'quora.com', 'glassdoor.com', 'indeed.com']);
const directorySignals = /directory|yellowpages|yellow-pages|business-listing|brand-description|companies\/|company-profile|supplier-profile|exhibitor/i;
const aggregateDirectorySignals = /top dealers?\s*&\s*suppliers?|business directory|companies in|suppliers in/i;
const tradeShowSignals = /trade.?show|trade.?fair|exhibitor|exhibition/i;
const articleSignals = /\/news\/|\/article\/|\/blog\/|\/20\d{2}\/\d{1,2}\/\d{1,2}\/|press-release|jobs?|careers?/i;
const supplierProfileSignals = /supplier|company|manufacturer|seller|business/i;
const listicleSignals = /^(?:\s*\d+\s+(?:top|best)\b)|\btop\s+\d+\b|\bbest\s+.{0,45}\b(?:distributors?|suppliers?|wholesalers?)\b/i;
const manufacturingOnlyTerms = ['manufacturer', 'manufacturing', 'private label', 'oem'];

function textOf(candidate) {
  return `${candidate?.title || ''} ${candidate?.snippet || ''} ${candidate?.normalized_url || ''}`.toLocaleLowerCase('en');
}

function includesAny(text, values = []) {
  return values.some(value => value && text.includes(String(value).toLocaleLowerCase('en')));
}

function businessTerms(profile) {
  const configured = profile.businessEvidenceTerms || {};
  return [...new Set([
    ...(configured.importer || profile.importerTerms || []),
    ...(configured.wholesaler || profile.wholesalerTerms || []),
    ...(configured.distributor || profile.distributorTerms || []),
    ...(configured.trading || profile.tradingTerms || [])
  ])];
}

function companyTerms(profile) {
  return [...new Set([
    ...(profile.businessEvidenceTerms?.company || []),
    ...(profile.businessSuffixes || [])
  ])];
}

function marketConfig(options = {}) {
  return options.marketProfile || GENERIC_MARKET_PROFILE;
}

function productConfig(options = {}) {
  return options.productProfile || getProductCategoryProfile('');
}

function businessRelevanceScore(candidate, options = {}) {
  const profile = marketConfig(options);
  const product = productConfig(options);
  const text = textOf(candidate);
  const business = includesAny(text, businessTerms(profile));
  let score = 0;
  if (business) score += 35;
  if (includesAny(text, profile.locationTerms)) score += 20;
  if (includesAny(text, product.evidenceTerms)) score += 15;
  if (includesAny(text, companyTerms(profile))) score += 10;
  if (includesAny(text, manufacturingOnlyTerms) && !business) score -= 25;
  return score;
}

function isMarketplaceDomain(domain, profile) {
  if ((profile.marketplaceDomains || []).includes(domain)) return true;
  return (profile.marketplaceDomainPrefixes || []).some(prefix => domain.startsWith(prefix));
}

export function classifySearchResult(candidate, options = {}) {
  const profile = marketConfig(options);
  const domain = candidate.root_domain;
  const normalizedUrl = String(candidate.normalized_url || '');
  const combined = textOf(candidate);
  if (!domain || rejectedDomains.has(domain) || normalizedUrl.toLocaleLowerCase('en').endsWith('.pdf')) {
    return { candidate_type: 'OTHER', candidate_status: 'REJECTED', rejection_reason: 'obvious_noise' };
  }
  if (socialDomains.has(domain)) return { candidate_type: 'SOCIAL_PROFILE', candidate_status: 'REVIEW', rejection_reason: null };
  if ((profile.newsDomains || []).includes(domain) || articleSignals.test(normalizedUrl) || listicleSignals.test(candidate.title || '')) {
    return { candidate_type: 'ARTICLE', candidate_status: 'REJECTED', rejection_reason: 'article_or_job' };
  }
  if (isMarketplaceDomain(domain, profile)) {
    const businessProfile = supplierProfileSignals.test(normalizedUrl) && !/product|item|dp\//i.test(normalizedUrl);
    return {
      candidate_type: 'MARKETPLACE',
      candidate_status: businessProfile ? 'REVIEW' : 'REJECTED',
      rejection_reason: businessProfile ? null : 'consumer_marketplace'
    };
  }
  if (tradeShowSignals.test(combined)) return { candidate_type: 'TRADE_SHOW_PROFILE', candidate_status: 'NEW', rejection_reason: null };
  if ((profile.directoryDomains || []).includes(domain) || directorySignals.test(normalizedUrl)
      || /directory|business directory|company profile/.test(combined)) {
    return { candidate_type: 'DIRECTORY_PROFILE', candidate_status: aggregateDirectorySignals.test(combined) ? 'REVIEW' : 'NEW', rejection_reason: null };
  }
  if (includesAny(combined, [...businessTerms(profile), ...companyTerms(profile)])) {
    return { candidate_type: 'POSSIBLE_COMPANY_SITE', candidate_status: 'NEW', rejection_reason: null };
  }
  return { candidate_type: 'OTHER', candidate_status: 'REVIEW', rejection_reason: null };
}

export function mergeSearchCandidates(discoveries, maxResults, options = {}) {
  const byUrl = new Map();
  let rejected = 0;
  let duplicates = 0;
  for (const discovery of discoveries) {
    const classification = classifySearchResult(discovery, options);
    if (classification.candidate_status === 'REJECTED') {
      rejected += 1;
      continue;
    }
    const existing = byUrl.get(discovery.normalized_url);
    if (existing) {
      duplicates += 1;
      existing.query_matches.push({
        search_query_id: discovery.search_query_id,
        query_type: discovery.search_query_type,
        rank: discovery.rank
      });
      if (discovery.rank < existing.rank) existing.rank = discovery.rank;
      continue;
    }
    byUrl.set(discovery.normalized_url, {
      ...discovery,
      ...classification,
      query_matches: [{
        search_query_id: discovery.search_query_id,
        query_type: discovery.search_query_type,
        rank: discovery.rank
      }]
    });
  }

  const seenOfficialDomains = new Set();
  const sorted = [...byUrl.values()].sort((a, b) => {
    const statusOrder = { NEW: 0, REVIEW: 1 };
    const typeOrder = { POSSIBLE_COMPANY_SITE: 0, OFFICIAL_SITE_CANDIDATE: 0, TRADE_SHOW_PROFILE: 1, DIRECTORY_PROFILE: 2, SOCIAL_PROFILE: 3, OTHER: 4 };
    return (statusOrder[a.candidate_status] - statusOrder[b.candidate_status])
      || (typeOrder[a.candidate_type] - typeOrder[b.candidate_type])
      || (businessRelevanceScore(b, options) - businessRelevanceScore(a, options))
      || ((Number(b.provider_score) || 0) - (Number(a.provider_score) || 0))
      || (a.rank - b.rank);
  });
  const selected = [];
  const selectedUrls = new Set();
  const canAdd = candidate => {
    if (['POSSIBLE_COMPANY_SITE','OFFICIAL_SITE_CANDIDATE'].includes(candidate.candidate_type)) {
      if (seenOfficialDomains.has(candidate.root_domain)) return false;
    }
    return !selectedUrls.has(candidate.normalized_url);
  };
  const add = candidate => {
    if (!canAdd(candidate)) return false;
    if (['POSSIBLE_COMPANY_SITE','OFFICIAL_SITE_CANDIDATE'].includes(candidate.candidate_type)) seenOfficialDomains.add(candidate.root_domain);
    selectedUrls.add(candidate.normalized_url);
    selected.push(candidate);
    return true;
  };
  const lane = (type, quota) => {
    for (const candidate of sorted) {
      if (selected.length >= maxResults || quota <= 0) break;
      if (candidate.query_matches.some(match => match.query_type === type) && add(candidate)) quota -= 1;
    }
  };
  if (maxResults >= 5) {
    lane('sme_regional', 2);
    lane('buyer_category', 1);
    lane('general_trading', 1);
    lane('strategic_account', 1);
  }
  for (const candidate of sorted) {
    if (selected.length >= maxResults) break;
    add(candidate);
  }
  return { candidates: selected, rejected, duplicates };
}
