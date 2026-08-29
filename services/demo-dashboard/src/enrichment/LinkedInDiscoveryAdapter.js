import { domainService } from '../platform/DomainService.js';

export const LINKEDIN_MODES = Object.freeze({
  SEARCH_DISCOVERY_ONLY: 'SEARCH_DISCOVERY_ONLY',
  OFFICIAL_API: 'OFFICIAL_API',
  PERMITTED_CRAWL: 'PERMITTED_CRAWL'
});

function parseExpiry(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export class LinkedInDiscoveryAdapter {
  constructor({
    mode = LINKEDIN_MODES.SEARCH_DISCOVERY_ONLY,
    officialApiToken = '',
    officialApiApproved = false,
    crawlPermissionId = '',
    crawlPermissionExpiresAt = '',
    crawlAllowedPaths = []
  } = {}) {
    this.requestedMode = String(mode || LINKEDIN_MODES.SEARCH_DISCOVERY_ONLY).toUpperCase();
    this.officialApiToken = officialApiToken;
    this.officialApiApproved = officialApiApproved === true;
    this.crawlPermissionId = String(crawlPermissionId || '').trim();
    this.crawlPermissionExpiresAt = parseExpiry(crawlPermissionExpiresAt);
    this.crawlAllowedPaths = Array.isArray(crawlAllowedPaths) ? crawlAllowedPaths.filter(Boolean) : [];
  }

  get activeMode() {
    if (this.requestedMode === LINKEDIN_MODES.OFFICIAL_API && this.officialApiApproved && this.officialApiToken) {
      return LINKEDIN_MODES.OFFICIAL_API;
    }
    if (this.requestedMode === LINKEDIN_MODES.PERMITTED_CRAWL
      && this.crawlPermissionId
      && this.crawlPermissionExpiresAt?.getTime() > Date.now()
      && this.crawlAllowedPaths.length) {
      return LINKEDIN_MODES.PERMITTED_CRAWL;
    }
    return LINKEDIN_MODES.SEARCH_DISCOVERY_ONLY;
  }

  isLinkedInUrl(value) {
    return domainService.getRegistrableDomain(value) === 'linkedin.com';
  }

  discoverReference({ url, title = '', snippet = '', provider = 'public_search', capturedAt = new Date() } = {}) {
    if (!this.isLinkedInUrl(url)) return null;
    const normalized = domainService.normalizeUrl(url);
    if (!normalized) return null;
    const pathname = new URL(normalized).pathname.toLowerCase();
    return {
      platform: 'LINKEDIN',
      profile_url: normalized,
      profile_kind: pathname.startsWith('/in/') ? 'PERSON' : pathname.startsWith('/company/') ? 'COMPANY' : 'UNKNOWN',
      title_hint: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null,
      snippet_hint: String(snippet || '').replace(/\s+/g, ' ').trim().slice(0, 1000) || null,
      discovered_via: String(provider || 'public_search').toUpperCase(),
      verification_status: 'REVIEW',
      evidence_strength: 'DISCOVERY_HINT',
      content_fetched: false,
      captured_at: capturedAt
    };
  }

  crawlDecision() {
    return {
      allowed: false,
      mode: this.activeMode,
      reason: this.activeMode === LINKEDIN_MODES.SEARCH_DISCOVERY_ONLY
        ? 'SEARCH_DISCOVERY_ONLY stores references without requesting LinkedIn pages.'
        : 'Phase 6 does not request LinkedIn member or search-result HTML.'
    };
  }
}
