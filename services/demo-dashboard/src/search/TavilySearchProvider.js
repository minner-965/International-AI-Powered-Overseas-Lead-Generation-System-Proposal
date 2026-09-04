import { SearchProvider, SearchProviderError } from './SearchProvider.js';
import { getMarketProfile } from '../market/marketProfiles.js';

const defaultEndpoint = 'https://api.tavily.com/search';

function safeProviderMessage(payload, fallback) {
  return String(payload?.detail?.error || payload?.detail || payload?.error || payload?.message || fallback)
    .replace(/\s+/g, ' ').slice(0, 300);
}

export class TavilySearchProvider extends SearchProvider {
  constructor({ apiKey, endpoint = defaultEndpoint, searchDepth = 'basic', timeoutMs = 15000, fetchImpl = fetch } = {}) {
    super('tavily');
    this.apiKey = apiKey;
    this.endpoint = endpoint || defaultEndpoint;
    this.searchDepth = String(searchDepth || 'basic').toLowerCase();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async search({ query, count = 5, country, countryName }) {
    if (!this.apiKey) {
      throw new SearchProviderError('Tavily API key is not configured', { code: 'MISSING_API_KEY' });
    }
    if (this.searchDepth !== 'basic') {
      throw new SearchProviderError('Phase 3 requires Tavily Basic Search', { code: 'INVALID_SEARCH_DEPTH' });
    }
    const body = {
      query: String(query),
      search_depth: 'basic',
      topic: 'general',
      max_results: Math.max(1, Math.min(20, Number(count) || 5)),
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false
    };
    if (country && String(country).toUpperCase() !== 'ALL') {
      const profile = getMarketProfile(country, countryName);
      if (profile.providerCountryName) body.country = profile.providerCountryName;
    }

    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SearchProviderError(timedOut ? 'Tavily search request timed out' : 'Tavily search request failed', {
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', cause: error
      });
    }

    let payload;
    try { payload = await response.json(); }
    catch { throw new SearchProviderError('Tavily returned invalid JSON', { code: 'INVALID_RESPONSE', status: response.status }); }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'AUTH_ERROR'
        : response.status === 429 ? 'RATE_LIMITED'
          : response.status === 432 ? 'CREDIT_EXHAUSTED'
            : response.status >= 500 ? 'TEMPORARY_ERROR' : 'BAD_REQUEST';
      const retryAfterSeconds=response.status===429
        ?Math.max(1,Math.min(86400,Number(response.headers?.get?.('retry-after'))||60)):null;
      throw new SearchProviderError(safeProviderMessage(payload, `Tavily returned HTTP ${response.status}`), {
        code, status: response.status,retryable:response.status===429||response.status>=500,retryAfterSeconds
      });
    }
    if (!Array.isArray(payload?.results)) {
      throw new SearchProviderError('Tavily response is missing results', { code: 'INVALID_RESPONSE' });
    }
    return {
      provider: this.name,
      query,
      requestId: payload.request_id || null,
      responseTime: Number(payload.response_time || 0),
      credits: Number(payload?.usage?.credits || 1),
      results: payload.results.map((result, index) => ({
        title: result?.title || '',
        url: result?.url || '',
        snippet: result?.content || '',
        provider_score: Number.isFinite(Number(result?.score)) ? Number(result.score) : null,
        rank: index + 1
      }))
    };
  }
}
