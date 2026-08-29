import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPublicContacts } from '../src/contact/ContactExtractor.js';
import { discoverCompanyPages, discoverExternalWebsite } from '../src/contact/pageDiscovery.js';
import { selectVerificationLinks } from '../src/verification/companyVerificationService.js';
import {
  assessBusinessTypes, assessCompanySize, extractVerificationEvidence, resolveOfficialWebsite
} from '../src/verification/verificationRules.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';

test('structured Organization contacts are captured while Person contacts remain excluded', async () => {
  const html = `<script type="application/ld+json">{
    "@graph": [
      {"@type":"Organization","name":"Sample Buyer Ltd","email":"Wholesale@Buyer.test",
       "telephone":"+880 1712 345678","contactPoint":{"@type":"ContactPoint","email":"sales@buyer.test"}},
      {"@type":"Person","name":"Employee","email":"private@example.test","telephone":"+880 1999 999999"}
    ]
  }</script><p>Business enquiries</p>`;
  const result = await extractPublicContacts(html, 'https://buyer.test/about', {
    marketProfile: getMarketProfile('BD'), resolveMxImpl: async () => []
  });
  assert.deepEqual(result.contacts.filter(item => item.contact_type === 'EMAIL').map(item => item.contact_value).sort(),
    ['Wholesale@Buyer.test', 'sales@buyer.test']);
  assert.deepEqual(result.contacts.filter(item => item.contact_type === 'PHONE').map(item => item.normalized_value),
    ['+8801712345678']);
  assert.ok(result.contacts.every(item => !/private@example|1999999999/.test(item.contact_value)));
});

test('JSON-LD business address, activity and employee count become direct source evidence', () => {
  const page = {
    url: 'https://buyer.test/about', title: 'About Sample Buyer', source_type: 'OFFICIAL_WEBSITE',
    captured_at: new Date('2026-08-28T00:00:00Z'),
    html: `<script type="application/ld+json">{
      "@type":"Organization","name":"Sample Buyer Limited",
      "description":"We are a wholesale supplier of cosmetics and beauty products for retailers.",
      "address":{"@type":"PostalAddress","addressLocality":"Dhaka","addressCountry":"Bangladesh"},
      "numberOfEmployees":{"@type":"QuantitativeValue","minValue":20,"maxValue":45}
    }</script><main><h1>About our company</h1></main>`
  };
  const result = extractVerificationEvidence(page, {
    candidateTitle: 'Sample Buyer', country: 'Bangladesh', city: 'Dhaka',
    category: 'Beauty & Personal Care', marketProfile: getMarketProfile('BD')
  });
  const location = result.evidence.find(item => item.evidence_type === 'LOCATION' && item.verification_method === 'JSON_LD_POSTAL_ADDRESS');
  const identity = result.evidence.find(item => item.evidence_type === 'COMPANY_IDENTITY' && item.verification_method === 'JSON_LD_ORGANIZATION_NAME');
  const wholesale = result.evidence.find(item => item.evidence_type === 'WHOLESALER' && item.verification_method.startsWith('JSON_LD_'));
  const employees = result.evidence.find(item => item.evidence_type === 'EMPLOYEE_SIZE' && item.verification_method === 'JSON_LD_NUMBER_OF_EMPLOYEES');
  assert.equal(identity.evidence_value, 'Sample Buyer Limited');
  assert.equal(location.evidence_text, 'Dhaka, Bangladesh');
  assert.match(wholesale.evidence_text, /wholesale supplier/i);
  assert.equal(wholesale.confidence, 0.95);
  assert.equal(employees.evidence_value, '20-45 employees');
  assert.equal(assessBusinessTypes(result.evidence).wholesaler.status, 'VERIFIED');
  assert.equal(assessCompanySize(result.evidence).company_size, 'SMALL');
});

test('company identity rejects CSS fragments and selects the title brand segment', () => {
  const page = {
    url: 'https://fashion.example/', title: 'Example Fashion Dubai', source_type: 'OFFICIAL_WEBSITE',
    captured_at: new Date('2026-08-28T00:00:00Z'),
    html: `<html><head><title>Clothing Wholesaler in Dubai | Example Fashion Dubai</title></head>
      <body><h1>Clothing Wholesaler in Dubai</h1><footer>Copyright 2026 -wrapper a,</footer></body></html>`
  };
  const result = extractVerificationEvidence(page, {
    candidateTitle: 'Clothing Wholesaler in Dubai | Wholesale Clothing Supplier - Example Fashion Dubai',
    country: 'United Arab Emirates', city: 'Dubai', category: "Women's Apparel",
    marketProfile: getMarketProfile('AE')
  });
  assert.equal(result.resolvedName, 'Example Fashion Dubai');
  assert.ok(result.evidence.every(item => item.evidence_value !== '-wrapper a,'));
});

test('directory profile resolves only explicit external business URLs from structured data', () => {
  const html = `<script type="application/ld+json">{
    "@type":"LocalBusiness","name":"Buyer Trading","url":"https://buyer.test/about"
  }</script><a href="https://facebook.com/buyer">Facebook</a>`;
  assert.equal(discoverExternalWebsite(html, 'https://directory.example/listing/1'), 'https://buyer.test/about');

  const personOnly = `<script type="application/ld+json">{
    "@type":"Person","name":"Owner","url":"https://personal.example/profile"
  }</script>`;
  assert.equal(discoverExternalWebsite(personOnly, 'https://directory.example/listing/1'), null);

  const resolved = resolveOfficialWebsite({
    candidate_type: 'POSSIBLE_COMPANY_SITE', url: 'https://directory.example/distributor/fashion',
    discovered_external_website: 'https://buyer.test/about'
  });
  assert.deepEqual({ website: resolved.website, root: resolved.root_domain, method: resolved.method }, {
    website: 'https://buyer.test/about', root: 'buyer.test', method: 'PROFILE_EXPLICIT_OUTBOUND_LINK'
  });
});

test('directory outbound redirects and structured same-site pages are bounded and semantic', () => {
  const directoryHtml = `<a href="/outbound/website?url=${encodeURIComponent('https://buyer.test/')}">Visit website</a>`;
  assert.equal(discoverExternalWebsite(directoryHtml, 'https://directory.example/listing/1'), 'https://buyer.test');

  const companyHtml = `<nav><a href="/privacy">Privacy</a><a href="/distribution" aria-label="Distribution network"></a></nav>
    <script type="application/ld+json">{
      "@type":"Organization","contactPoint":{"@type":"ContactPoint","url":"/contact-business"},
      "aboutPage":{"@type":"AboutPage","url":"/company-profile"},
      "hasOfferCatalog":{"@type":"OfferCatalog","url":"/brands"}
    }</script>`;
  assert.deepEqual(discoverCompanyPages(companyHtml, 'https://buyer.test/'), {
    contactUrl: 'https://buyer.test/contact-business', aboutUrl: 'https://buyer.test/company-profile'
  });
  const links = selectVerificationLinks(companyHtml, 'https://buyer.test/', 'buyer.test', 3, getMarketProfile('AE'));
  assert.deepEqual(links, [
    'https://buyer.test/contact-business', 'https://buyer.test/company-profile', 'https://buyer.test/distribution'
  ]);
  assert.ok(!links.some(value => value.includes('privacy')));
});
