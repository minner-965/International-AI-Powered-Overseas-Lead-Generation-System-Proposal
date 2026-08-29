import { getDomain as tldtsGetDomain } from 'tldts';

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid']);

function asUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
}

export class DomainService {
  normalizeUrl(value) {
    const url = asUrl(value);
    if (!url || !['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith('utm_') || TRACKING_KEYS.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const search = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname === '/' ? '' : url.pathname}${search ? `?${search}` : ''}`;
  }

  getHostname(value) {
    const url = asUrl(value);
    return url?.hostname.toLowerCase().replace(/^www\./, '') || null;
  }

  getRegistrableDomain(value) {
    const hostname = this.getHostname(value);
    if (!hostname) return null;
    return tldtsGetDomain(hostname, { allowPrivateDomains: true }) || hostname;
  }
}

export const domainService = new DomainService();
