import { domainService } from '../platform/DomainService.js';

export function normalizeUrl(value) {
  return domainService.normalizeUrl(value);
}

export function extractRootDomain(value) {
  return domainService.getRegistrableDomain(value);
}

export function normalizeSearchResult(result, { provider, queryId, queryType = null, capturedAt = new Date() }) {
  const normalizedUrl = normalizeUrl(result.url);
  if (!normalizedUrl) return null;
  return {
    provider,
    search_query_id: queryId,
    search_query_type: queryType,
    title: String(result.title || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    url: String(result.url),
    normalized_url: normalizedUrl,
    root_domain: extractRootDomain(normalizedUrl),
    snippet: String(result.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    provider_score: Number.isFinite(Number(result.provider_score)) ? Number(result.provider_score) : null,
    rank: Math.max(1, Number(result.rank) || 1),
    captured_at: capturedAt
  };
}
