export class SearchProviderError extends Error {
  constructor(message, { code = 'SEARCH_PROVIDER_ERROR', status = null, cause = null, retryable=false,
    retryAfterSeconds=null } = {}) {
    super(message, { cause });
    this.name = 'SearchProviderError';
    this.code = code;
    this.status = status;
    this.retryable=retryable===true;
    this.retryAfterSeconds=retryAfterSeconds;
  }
}

export class SearchProvider {
  constructor(name) {
    if (new.target === SearchProvider) throw new TypeError('SearchProvider is abstract');
    this.name = name;
  }

  async search(_params) {
    throw new SearchProviderError('SearchProvider.search() is not implemented', { code: 'NOT_IMPLEMENTED' });
  }
}
