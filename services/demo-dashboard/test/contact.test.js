import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPublicContacts } from '../src/contact/ContactExtractor.js';
import { isValidEmailSyntax, verifyObservedEmail } from '../src/contact/emailVerifier.js';
import { normalizePhone, normalizeWhatsApp } from '../src/contact/phoneUtils.js';
import { discoverCompanyPages, discoverExternalWebsite } from '../src/contact/pageDiscovery.js';
import { WebsiteReachabilityChecker, robotsAllowsPath } from '../src/contact/WebsiteReachabilityChecker.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('email syntax and MX checks use the observed address domain only', async () => {
  assert.equal(isValidEmailSyntax('sales@company.test'), true);
  assert.equal(isValidEmailSyntax('sales@localhost'), false);
  const verified = await verifyObservedEmail('sales@company.test', { resolveMxImpl: async domain => {
    assert.equal(domain, 'company.test');
    return [{ exchange: 'mail.company.test', priority: 10 }];
  }});
  assert.deepEqual({status:verified.verification_status,syntax:verified.syntax_valid,mx:verified.mx_present}, {
    status:'DOMAIN_MX_VERIFIED',syntax:true,mx:true
  });
});

test('extractor observes mailto and visible email and rejects examples and image filenames', async () => {
  const result = await extractPublicContacts(`<!doctype html><title>Contact</title><body>
    <a href="mailto:Sales@Company.test?subject=Hello">Email us</a>
    <p>Support: help@company.test</p><p>example@example.test image@asset.png</p></body>`,
  'https://company.test/contact', { resolveMxImpl: async () => [] });
  const emails = result.contacts.filter(item => item.contact_type === 'EMAIL');
  assert.deepEqual(emails.map(item => item.normalized_value).sort(), ['help@company.test','sales@company.test']);
  assert.ok(emails.every(item => item.source_url === 'https://company.test/contact'));
  assert.ok(emails.every(item => item.source_page_title === 'Contact'));
});

test('extractor records tel links and labeled visible phones without treating a date as a phone', async () => {
  const result = await extractPublicContacts(`<body><a href="tel:+971 4 123 4567">Call</a>
    <p>Phone: 04 987 6543</p><p>Fax: +971 4 111 2222</p><p>Updated 2026-08-27</p></body>`, 'https://company.test/contact',
  { resolveMxImpl: async () => [] });
  const phones = result.contacts.filter(item => item.contact_type === 'PHONE');
  assert.deepEqual(phones.map(item => item.normalized_value).sort(), ['+97141234567','049876543']);
});

test('pages with many unlabeled regional numbers retain only explicit phone links or labels', async () => {
  const result = await extractPublicContacts(`<body><a href="tel:+971 4 201 1111">Head office</a>
    <p>+965 2205 2639 +966 11 510 0488 +968 2444 2642 +971 4 818 8440 +973 1660 9370 +974 4419 6414</p></body>`,
  'https://group.example/contact', { resolveMxImpl: async () => [] });
  const phones = result.contacts.filter(item => item.contact_type === 'PHONE');
  assert.deepEqual(phones.map(item => item.normalized_value), ['+97142011111']);
});

test('WhatsApp requires an explicit WhatsApp link and is never inferred from a normal phone', async () => {
  const result = await extractPublicContacts(`<body><a href="tel:+971501234567">Phone</a>
    <a href="https://wa.me/971509876543">WhatsApp</a></body>`, 'https://company.test/contact',
  { resolveMxImpl: async () => [] });
  assert.equal(result.contacts.filter(item => item.contact_type === 'WHATSAPP').length, 1);
  assert.equal(result.contacts.find(item => item.contact_type === 'WHATSAPP').normalized_value, '971509876543');
  assert.equal(normalizeWhatsApp('https://wa.me/+971509876543'), '971509876543');
  assert.equal(normalizeWhatsApp('https://example.com/971501234567'), null);
});

test('contact form detection requires contact signals and a submit control', async () => {
  const result = await extractPublicContacts(`<body><form id="contact-form"><textarea name="message"></textarea>
    <button type="submit">Send message</button></form></body>`, 'https://company.test/contact',
  { resolveMxImpl: async () => [] });
  const form = result.contacts.find(item => item.contact_type === 'CONTACT_FORM');
  assert.equal(form.contact_value, 'https://company.test/contact');
});

test('phone normalization is conservative', () => {
  const market = getMarketProfile('AE');
  assert.equal(normalizePhone('+971 (50) 123-4567', market), '+971501234567');
  assert.equal(normalizePhone('+971 04 269 5969', market), '+97142695969');
  assert.equal(normalizePhone('123'), null);
});

test('page discovery prefers same-site contact/about links and only labeled external websites', () => {
  const html = `<a href="/contact-us">Contact us</a><a href="https://company.test/about">About</a>
    <a href="https://supplier.example/">Official website</a><a href="https://facebook.com/company">Facebook</a>`;
  assert.deepEqual(discoverCompanyPages(html, 'https://directory.ae/company/1'), {
    contactUrl:'https://directory.ae/contact-us',aboutUrl:null
  });
  assert.equal(discoverExternalWebsite(html, 'https://directory.ae/company/1'), 'https://supplier.example');
  assert.deepEqual(discoverCompanyPages(html, 'https://company.test/listing'), {
    contactUrl:'https://company.test/contact-us',aboutUrl:'https://company.test/about'
  });
});

test('website checker follows bounded redirects and returns final-page evidence', async () => {
  const requests = [];
  const checker = new WebsiteReachabilityChecker({
    lookupImpl: publicLookup,
    fetchImpl: async url => {
      requests.push(url);
      if (url === 'https://company.test') return new Response('', {status:302,headers:{location:'/contact'}});
      return new Response('<title>Contact page</title><p>Reachable</p>', {status:200,headers:{'content-type':'text/html'}});
    }
  });
  const result = await checker.fetchPage('https://company.test');
  assert.equal(result.reachable, true);
  assert.equal(result.final_url, 'https://company.test/contact');
  assert.equal(result.page_title, 'Contact page');
  assert.deepEqual(requests, ['https://company.test','https://company.test/contact']);
});

test('website checker records timeout, response size limit and non-HTML responses', async () => {
  const timeout = new WebsiteReachabilityChecker({lookupImpl:publicLookup,fetchImpl:async()=>{throw new DOMException('timeout','TimeoutError')}});
  assert.equal((await timeout.fetchPage('https://company.test')).fetch_status, 'TIMEOUT');
  const large = new WebsiteReachabilityChecker({maxResponseBytes:5,lookupImpl:publicLookup,
    fetchImpl:async()=>new Response('123456',{status:200,headers:{'content-type':'text/html','content-length':'6'}})});
  assert.equal((await large.fetchPage('https://company.test')).fetch_status, 'TOO_LARGE');
  const binary = new WebsiteReachabilityChecker({lookupImpl:publicLookup,
    fetchImpl:async()=>new Response('pdf',{status:200,headers:{'content-type':'application/pdf'}})});
  assert.equal((await binary.fetchPage('https://company.test/file')).fetch_status, 'NON_HTML');
});

test('website checker rejects private-network targets', async () => {
  const checker = new WebsiteReachabilityChecker({fetchImpl:async()=>new Response('ok')});
  const result = await checker.fetchPage('http://127.0.0.1/private');
  assert.equal(result.fetch_status, 'INVALID_URL');
});

test('website checker accepts Docker Desktop public-DNS proxy addresses for named hosts', async () => {
  const checker = new WebsiteReachabilityChecker({
    lookupImpl: async () => [{address:'198.18.0.10',family:4},{address:'fdfe:dcba:9876::10',family:6}],
    fetchImpl: async () => new Response('<title>External</title>', {status:200,headers:{'content-type':'text/html'}})
  });
  const result = await checker.fetchPage('https://company.example');
  assert.equal(result.fetch_status, 'COMPLETED');
});

test('robots rules honor specific disallow and longest allow paths', () => {
  const robots = `User-agent: *\nDisallow: /private\nAllow: /private/public\n`;
  assert.equal(robotsAllowsPath(robots, '/contact'), true);
  assert.equal(robotsAllowsPath(robots, '/private/file'), false);
  assert.equal(robotsAllowsPath(robots, '/private/public/page'), true);
});
