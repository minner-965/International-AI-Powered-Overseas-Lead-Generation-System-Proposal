import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { load } from 'cheerio';
import { domainService } from '../platform/DomainService.js';

function isPrivateAddress(address) {
  if (!address) return true;
  if (address === '::1' || address === '::' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  if (address.startsWith('::ffff:')) return isPrivateAddress(address.slice(7));
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function isDockerDesktopDnsProxyAddress(address) {
  return /^198\.(?:18|19)\./.test(address) || address.toLowerCase().startsWith('fdfe:dcba:9876:');
}

async function assertPublicUrl(value, lookupImpl, blockedDomains = []) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid URL'), { code: 'INVALID_URL' }); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw Object.assign(new Error('Invalid public URL'), { code: 'INVALID_URL' });
  }
  const host = url.hostname.toLowerCase();
  const rootDomain = domainService.getRegistrableDomain(url.href);
  if (blockedDomains.some(domain => rootDomain === domain || host === domain || host.endsWith(`.${domain}`))) {
    throw Object.assign(new Error('Provider-controlled profile pages are discovery references only'), { code: 'POLICY_BLOCKED' });
  }
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isPrivateAddress(host))) {
    throw Object.assign(new Error('Private network URL rejected'), { code: 'INVALID_URL' });
  }
  if (!isIP(host)) {
    let addresses;
    try { addresses = await lookupImpl(host, { all: true, verbatim: true }); }
    catch { throw Object.assign(new Error('Host lookup failed'), { code: 'NETWORK_ERROR' }); }
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address) && !isDockerDesktopDnsProxyAddress(item.address))) {
      throw Object.assign(new Error('Private or unresolved host rejected'), { code: 'INVALID_URL' });
    }
  }
  return url;
}

function titleFromHtml(html) {
  try { return load(html)('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 1000) || null; }
  catch { return null; }
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('Response exceeds configured size limit'), { code: 'TOO_LARGE' });
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error('Response exceeds configured size limit'), { code: 'TOO_LARGE' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function fetchStatusFromError(error) {
  if (error?.code === 'POLICY_BLOCKED') return 'POLICY_BLOCKED';
  if (error?.code === 'INVALID_URL') return 'INVALID_URL';
  if (error?.code === 'TOO_LARGE') return 'TOO_LARGE';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'TIMEOUT';
  return error?.code === 'NETWORK_ERROR' ? 'NETWORK_ERROR' : 'NETWORK_ERROR';
}

export class WebsiteReachabilityChecker {
  constructor({ timeoutMs = 10000, maxResponseBytes = 2000000, userAgent = 'DPVLeadResearchDemo/1.0', maxRedirects = 5, fetchImpl = fetch, lookupImpl = lookup, blockedDomains = ['linkedin.com'] } = {}) {
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.userAgent = userAgent;
    this.maxRedirects = maxRedirects;
    this.fetchImpl = fetchImpl;
    this.lookupImpl = lookupImpl;
    this.blockedDomains = blockedDomains.map(value => String(value || '').toLowerCase()).filter(Boolean);
  }

  async fetchPage(requestedUrl, { robotsAllowed = null, acceptedTypes = ['text/html', 'application/xhtml+xml'] } = {}) {
    const capturedAt = new Date();
    let current = requestedUrl;
    let response;
    try {
      for (let redirects = 0; redirects <= this.maxRedirects; redirects += 1) {
        await assertPublicUrl(current, this.lookupImpl, this.blockedDomains);
        response = await this.fetchImpl(current, {
          method: 'GET', redirect: 'manual',
          headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.5', 'user-agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
          if (redirects === this.maxRedirects) throw Object.assign(new Error('Redirect limit exceeded'), { code: 'NETWORK_ERROR' });
          current = new URL(response.headers.get('location'), current).href;
          continue;
        }
        break;
      }
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const base = {
        requested_url: requestedUrl, final_url: response.url || current, http_status: response.status,
        content_type: contentType || null, robots_allowed: robotsAllowed, captured_at: capturedAt
      };
      if (!response.ok) return { ...base, reachable: false, fetch_status: 'HTTP_ERROR', error_message: `HTTP ${response.status}`, page_title: null, html: null };
      if (contentType && !acceptedTypes.some(type => contentType === type || contentType.startsWith(`${type};`))) {
        return { ...base, reachable: false, fetch_status: 'NON_HTML', error_message: `Unsupported content type: ${contentType}`, page_title: null, html: null };
      }
      const html = await readLimitedBody(response, this.maxResponseBytes);
      return { ...base, reachable: true, fetch_status: 'COMPLETED', error_message: null, page_title: titleFromHtml(html), html };
    } catch (error) {
      return {
        requested_url: requestedUrl, final_url: response?.url || current || null,
        http_status: response?.status || null, reachable: false, content_type: response?.headers?.get('content-type') || null,
        page_title: null, robots_allowed: robotsAllowed, fetch_status: fetchStatusFromError(error),
        error_message: String(error.message || 'Page check failed').replace(/\s+/g, ' ').slice(0, 500), captured_at: capturedAt, html: null
      };
    }
  }

  async robotsAllows(url) {
    let target;
    try { target = new URL(url); } catch { return false; }
    const robotsUrl = `${target.origin}/robots.txt`;
    const result = await this.fetchPage(robotsUrl, { acceptedTypes: ['text/plain', 'text/html'] });
    if (result.fetch_status === 'HTTP_ERROR' && result.http_status === 404) return true;
    if (!result.reachable || !result.html) return true;
    return robotsAllowsPath(result.html, target.pathname || '/', this.userAgent);
  }
}

export function robotsAllowsPath(text, path, userAgent = 'DPVLeadResearchDemo/1.0') {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) current.rules.push({ type: key, value });
  }
  const token = userAgent.toLowerCase().split(/[\s/]/)[0];
  const matching = groups.filter(group => group.agents.some(agent => agent === '*' || token.includes(agent)));
  const specific = matching.filter(group => group.agents.some(agent => agent !== '*' && token.includes(agent)));
  const rules = (specific.length ? specific : matching).flatMap(group => group.rules)
    .filter(rule => rule.value && path.startsWith(rule.value));
  if (!rules.length) return true;
  rules.sort((a, b) => b.value.length - a.value.length || (a.type === 'allow' ? -1 : 1));
  return rules[0].type === 'allow';
}
