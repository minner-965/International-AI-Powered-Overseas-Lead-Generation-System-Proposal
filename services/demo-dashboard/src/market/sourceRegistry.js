const connectors = new Map();

export function registerMarketSource(countryCode, connector) {
  if (!connector || typeof connector.discover !== 'function' || typeof connector.verify !== 'function') {
    throw new TypeError('Market source connector must implement discover(job) and verify(candidate)');
  }
  const code = String(countryCode || 'GENERIC').toUpperCase();
  const list = connectors.get(code) || [];
  list.push(connector);
  connectors.set(code, list);
}

export function marketSources(countryCode) {
  const code = String(countryCode || 'GENERIC').toUpperCase();
  return [...(connectors.get('GENERIC') || []), ...(connectors.get(code) || [])];
}
