import { SearchProvider, SearchProviderError } from './SearchProvider.js';

const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

function providerError(message, code, status = null) {
  return new SearchProviderError(message, { code, status });
}

export class DataForSeoSearchProvider extends SearchProvider {
  constructor({ login, password, timeoutMs = 10000, fetchImpl = fetch } = {}) {
    super('dataforseo');
    this.login = login;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async search({ query, count = 10, locationName, searchLang, tag = 'dpv-phase3' }) {
    if (!this.login || !this.password) {
      throw providerError('DataForSEO API credentials are not configured', 'MISSING_API_CREDENTIALS');
    }
    const depth = Math.max(1, Math.min(100, Number(count) || 10));
    const task = {
      keyword: String(query),
      depth,
      device: 'desktop',
      os: 'windows',
      tag
    };
    if (locationName) task.location_name = String(locationName);
    if (searchLang) task.language_code = String(searchLang);
    let response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString('base64')}`
        },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new SearchProviderError(timedOut ? 'DataForSEO request timed out' : 'DataForSEO request failed', {
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', cause: error
      });
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw providerError('DataForSEO returned invalid JSON', 'INVALID_RESPONSE'); }

    if (!response.ok) {
      const providerStatus = Number(payload?.status_code) || response.status;
      const code = providerStatus === 40104 ? 'ACCOUNT_VERIFICATION_REQUIRED'
        : providerStatus === 40101 || providerStatus === 40102 || response.status === 401
          ? 'AUTHENTICATION_FAILED' : 'HTTP_ERROR';
      throw providerError(`DataForSEO error ${providerStatus}: ${String(payload?.status_message || `HTTP ${response.status}`).slice(0, 300)}`,
        code, providerStatus);
    }

    if (Number(payload?.status_code) !== 20000) {
      const status = Number(payload?.status_code) || null;
      const authFailure = status === 40101 || status === 40102;
      throw providerError(`DataForSEO API error ${status || 'unknown'}: ${String(payload?.status_message || 'request failed').slice(0, 300)}`,
        status === 40104 ? 'ACCOUNT_VERIFICATION_REQUIRED' : authFailure ? 'AUTHENTICATION_FAILED' : 'PROVIDER_ERROR', status);
    }
    const taskResult = Array.isArray(payload.tasks) ? payload.tasks[0] : null;
    if (!taskResult || Number(taskResult.status_code) !== 20000) {
      const status = Number(taskResult?.status_code) || null;
      throw providerError(`DataForSEO task error ${status || 'unknown'}: ${String(taskResult?.status_message || 'task failed').slice(0, 300)}`,
        status === 40101 || status === 40102 ? 'AUTHENTICATION_FAILED' : 'PROVIDER_TASK_ERROR', status);
    }
    const resultBlock = Array.isArray(taskResult.result) ? taskResult.result[0] : null;
    const items = Array.isArray(resultBlock?.items)
      ? resultBlock.items.filter(item => item?.type === 'organic' && item.url)
      : [];
    return {
      provider: this.name,
      query,
      taskId: taskResult.id || null,
      cost: Number(taskResult.cost || 0),
      results: items.map((item, index) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.description || '',
        rank: Number(item.rank_absolute || item.rank_group || index + 1)
      }))
    };
  }
}
