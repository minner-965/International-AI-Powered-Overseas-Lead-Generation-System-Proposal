import test from 'node:test';
import assert from 'node:assert/strict';
import { domainService } from '../src/platform/DomainService.js';
import { phoneService } from '../src/platform/PhoneService.js';
import { emailService } from '../src/platform/EmailService.js';
import { normalizeUrl, extractRootDomain } from '../src/search/resultNormalizer.js';
import { normalizePhoneWithContext } from '../src/contact/phoneUtils.js';
import { extractPublicContacts } from '../src/contact/ContactExtractor.js';
import { extractBusinessSocialLinks } from '../src/verification/verificationRules.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';

function legacyNormalizeUrl(value) {
  try {
    const trackingKeys = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid']);
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || trackingKeys.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const search = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname === '/' ? '' : url.pathname}${search ? `?${search}` : ''}`;
  } catch { return null; }
}

function legacyEmailSyntax(value) {
  const pattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  const email = String(value || '').trim();
  return email.length <= 254 && pattern.test(email);
}

test('DomainService preserves URL normalization while tldts handles public suffixes', () => {
  const inputs = [
    'http://www.Example.com.bd/path/?utm_source=x&b=2&a=1#part',
    'https://www.shop.example.co.uk/?gclid=x',
    'https://subdomain.example.ae/about/'
  ];
  for (const input of inputs) assert.equal(domainService.normalizeUrl(input), legacyNormalizeUrl(input));
  assert.equal(normalizeUrl(inputs[0]), 'https://example.com.bd/path?a=1&b=2');
  assert.equal(extractRootDomain(inputs[0]), 'example.com.bd');
  assert.equal(extractRootDomain(inputs[1]), 'example.co.uk');
  assert.equal(extractRootDomain(inputs[2]), 'example.ae');
  assert.equal(domainService.getHostname('www.example.ae'), 'example.ae');
});

test('PhoneService uses AE and BD metadata and keeps ambiguous values unmodified', () => {
  const ae = getMarketProfile('AE');
  const bd = getMarketProfile('BD');
  const aeResult = phoneService.normalize('050 123 4567', ae);
  assert.deepEqual({
    raw: aeResult.raw_value, e164: aeResult.normalized_e164, country: aeResult.country,
    possible: aeResult.is_possible, valid: aeResult.is_valid, status: aeResult.normalization_status
  }, {
    raw: '050 123 4567', e164: '+971501234567', country: 'AE', possible: true, valid: true,
    status: 'COUNTRY_CONTEXT_LOCAL_PREFIX'
  });
  assert.equal(phoneService.normalize('01712 345678', bd).normalized_e164, '+8801712345678');
  const ambiguous = phoneService.normalize('01712 345678', { countryCode: 'XX' });
  assert.equal(ambiguous.raw_value, '01712 345678');
  assert.equal(ambiguous.normalized_e164, null);
  assert.equal(ambiguous.compatibility_value, '01712345678');
  assert.equal(ambiguous.country, null);
  assert.equal(ambiguous.normalization_status, 'AMBIGUOUS_LOCAL');
});

test('phone compatibility facade retains the Phase 4 fields and values', () => {
  assert.deepEqual(normalizePhoneWithContext('050 123 4567', getMarketProfile('AE')), {
    normalized_value: '+971501234567',
    normalization_certainty: 'COUNTRY_CONTEXT_LOCAL_PREFIX',
    normalization_status: 'COUNTRY_CONTEXT_LOCAL_PREFIX',
    country_code: 'AE'
  });
  assert.deepEqual(normalizePhoneWithContext('01712 345678', getMarketProfile('BD')), {
    normalized_value: '+8801712345678',
    normalization_certainty: 'COUNTRY_CONTEXT_LOCAL_PREFIX',
    normalization_status: 'COUNTRY_CONTEXT_LOCAL_PREFIX',
    country_code: 'BD'
  });
});

test('EmailService retains MX meanings and validator rejects a legacy false positive', async () => {
  for (const email of ['sales@company.test', 'buyer@buyer.test', 'contact@example.test']) {
    assert.equal(emailService.isValidSyntax(email), legacyEmailSyntax(email));
  }
  assert.equal(legacyEmailSyntax('sales..team@company.test'), true);
  assert.equal(emailService.isValidSyntax('sales..team@company.test'), false);
  const verified = await emailService.verifyObserved('Sales@Company.test', {
    resolveMxImpl: async domain => {
      assert.equal(domain, 'company.test');
      return [{ exchange: 'mx.company.test', priority: 10 }];
    }
  });
  assert.equal(verified.verification_status, 'DOMAIN_MX_VERIFIED');
  assert.equal(verified.verification_method, 'public_page+syntax+dns_mx');
  assert.equal(verified.syntax_valid, true);
  assert.equal(verified.mx_present, true);
});

test('Cheerio extraction retains raw contacts and discovers anchor and JSON-LD social accounts', async () => {
  const html = `<!doctype html><html><head><title>Contact DPV Buyer</title></head><body>
    <a href="mailto:Sales@Buyer.test?subject=Wholesale">Sales</a>
    <a href="tel:+880 1712 345678">Phone</a>
    <a href="https://instagram.com/dpvbuyer/?utm_source=website">Instagram</a>
    <form id="contact"><textarea name="message"></textarea><button type="submit">Send</button></form>
    <script type="application/ld+json">{"@type":"Organization","sameAs":["https://linkedin.com/company/dpv-buyer"]}</script>
  </body></html>`;
  const extracted = await extractPublicContacts(html, 'https://buyer.test/contact', {
    marketProfile: getMarketProfile('BD'), resolveMxImpl: async () => []
  });
  const email = extracted.contacts.find(item => item.contact_type === 'EMAIL');
  const phone = extracted.contacts.find(item => item.contact_type === 'PHONE');
  assert.equal(email.contact_value, 'Sales@Buyer.test');
  assert.equal(email.normalized_value, 'sales@buyer.test');
  assert.equal(email.verification_status, 'PUBLICLY_OBSERVED');
  assert.equal(phone.contact_value, '+880 1712 345678');
  assert.equal(phone.normalized_value, '+8801712345678');
  assert.ok(extracted.contacts.some(item => item.contact_type === 'CONTACT_FORM'));

  const social = extractBusinessSocialLinks(html, 'https://buyer.test/contact');
  assert.deepEqual(social.map(item => item.platform).sort(), ['INSTAGRAM', 'LINKEDIN']);
  assert.ok(social.every(item => item.account_type === 'BUSINESS'));
});
