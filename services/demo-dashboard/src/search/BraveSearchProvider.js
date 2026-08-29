import { SearchProvider, SearchProviderError } from './SearchProvider.js';

const endpoint = 'https://api.search.brave.com/res/v1/web/search';

export class BraveSearchProvider extends SearchProvider {
  constructor({ apiKey, timeoutMs = 10000, fetchImpl = fetch } = {}) {
    super('brave');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async search({ query, count = 10, country = 'ALL', searchLang }) {
    if (!this.apiKey) throw new SearchProviderError('Brave Search API key is not configured', { code: 'MISSING_API_KEY' });
    const url = new URL(endpoint);
    const params = {
      q: query,
      count: String(Math.max(1, Math.min(20, count))),
      country: String(country || 'ALL').toUpperCase()
    };
    if (searchLang) params.search_lang = String(searchLang);
    url.search = new URLSearchParams(params);
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'x-subscription-token': this.apiKey
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SearchProviderError(timedOut ? 'Brave Search request timed out' : 'Brave Search request failed', {
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', cause: error
      });
    }
    if (!response.ok) {
      throw new SearchProviderError(`Brave Search returned HTTP ${response.status}`, {
        code: response.status === 401 ? 'AUTHENTICATION_FAILED' : 'HTTP_ERROR',
        status: response.status
      });
    }
    const payload = await response.json();
    const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
    return {
      provider: this.name,
      query,
      results: results.map((result, index) => ({
        title: result.title || '',
        url: result.url || '',
        snippet: result.description || '',
        rank: index + 1
      }))
    };
  }
}
