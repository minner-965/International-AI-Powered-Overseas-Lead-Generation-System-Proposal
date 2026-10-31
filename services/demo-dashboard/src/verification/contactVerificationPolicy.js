import { extractRootDomain } from '../search/resultNormalizer.js';

// One place for the mailbox-verification rules shared by enrichment, contact readiness and the
// send gates (plan C3/C7). Pure: no I/O.

// One verification freshness setting. CONTACT_VERIFICATION_TTL_DAYS wins; the older
// OUTREACH_VERIFICATION_TTL_DAYS is read only as a fallback so existing installs keep working.
export const DEFAULT_CONTACT_VERIFICATION_TTL_DAYS = 90;
export function contactVerificationTtlDays(env = process.env) {
  for (const key of ['CONTACT_VERIFICATION_TTL_DAYS', 'OUTREACH_VERIFICATION_TTL_DAYS']) {
    const value = Number(env?.[key]);
    if (Number.isFinite(value) && value >= 1) return Math.min(3650, Math.floor(value));
  }
  return DEFAULT_CONTACT_VERIFICATION_TTL_DAYS;
}
export function resolveTtlDays(value, env = process.env) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.min(3650, Math.floor(number)) : contactVerificationTtlDays(env);
}

// Hunter accept-all (catch-all) guidance: score >= 85 may be sent automatically, 80–84 needs a
// person to confirm, below 80 or without a verifier score is not sent.
export const ACCEPT_ALL_AUTO_SEND_MIN_SCORE = 85;
export const ACCEPT_ALL_REVIEW_MIN_SCORE = 80;
export function acceptAllDecision(score) {
  if (score === null || score === undefined || score === '') return 'BLOCKED_NO_SCORE';
  const value = Number(score);
  if (!Number.isFinite(value)) return 'BLOCKED_NO_SCORE';
  if (value >= ACCEPT_ALL_AUTO_SEND_MIN_SCORE) return 'AUTO_SEND';
  if (value >= ACCEPT_ALL_REVIEW_MIN_SCORE) return 'MANUAL_REVIEW';
  return 'BLOCKED_LOW_SCORE';
}

// Free mailbox providers. Such an address is accepted only when the company publishes it on
// its own website (small buyers in MX, BR and the Gulf often use one).
export const FREE_WEBMAIL_DOMAINS = Object.freeze(new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.co.uk', 'hotmail.fr', 'outlook.com', 'outlook.es',
  'live.com', 'live.com.mx', 'msn.com', 'yahoo.com', 'yahoo.com.mx', 'yahoo.com.br', 'yahoo.es', 'yahoo.co.uk', 'ymail.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com',
  'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br',
  'prodigy.net.mx', 'qq.com', '163.com', '126.com', 'sina.com'
]));

const EMAIL = /^[^\s@<>]+@([^\s@<>]+\.[^\s@<>]+)$/;
export function emailDomain(address) {
  const match = EMAIL.exec(String(address || '').trim().toLowerCase());
  return match ? match[1] : null;
}
export function isFreeWebmail(address) {
  const domain = emailDomain(address);
  return Boolean(domain && FREE_WEBMAIL_DOMAINS.has(domain));
}

function hostOf(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, ''); } catch { return null; }
}
/** Registrable root domain of the company from its official root domain or website. */
export function companyRootDomain(company = {}) {
  for (const value of [company.official_root_domain, company.website_url, company.normalized_domain]) {
    const host = hostOf(value);
    if (host && host.includes('.') && !host.startsWith('live:')) {
      const root = extractRootDomain(`https://${host}`);
      if (root) return root;
    }
  }
  return null;
}
/** The address is on the company's own domain (same registrable domain, subdomains included). */
export function emailMatchesCompanyDomain(address, rootDomain) {
  const domain = emailDomain(address);
  const root = String(rootDomain || '').trim().toLowerCase();
  if (!domain || !root || FREE_WEBMAIL_DOMAINS.has(domain)) return false;
  return domain === root || domain.endsWith(`.${root}`) || extractRootDomain(`https://${domain}`) === root;
}
/** The page the address was captured from belongs to the company's own website. */
export function sourceOnCompanySite(sourceUrl, rootDomain) {
  const host = hostOf(sourceUrl);
  const root = String(rootDomain || '').trim().toLowerCase();
  if (!host || !root) return false;
  return host === root || host.endsWith(`.${root}`);
}
