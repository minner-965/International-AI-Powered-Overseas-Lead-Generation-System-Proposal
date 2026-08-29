import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessBusinessTypes,
  assessCompanySize,
  assessPartnershipAccessibility,
  classifySocialUrl,
  extractBusinessSocialLinks,
  extractVerificationEvidence,
  matchExistingCompany,
  normalizeCompanyName,
  resolveOfficialWebsite,
  strategicAccountAssessment
  , socialResultMatchesCompany
} from '../src/verification/verificationRules.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';

const evidence = (type, text, confidence = 0.95, id = `${type}-1`) => ({
  id, evidence_type: type, evidence_text: text, evidence_value: text, confidence
});

test('official website resolver needs identity plus market or activity evidence for a strong standalone match', () => {
  const candidate = { candidate_type: 'POSSIBLE_COMPANY_SITE', url: 'https://buyer.example/about', final_url: 'https://buyer.example/' };
  const weak = resolveOfficialWebsite(candidate, [{ evidence: [] }]);
  assert.equal(weak.confidence, 0.55);
  const strong = resolveOfficialWebsite(candidate, [{ evidence: [evidence('COMPANY_IDENTITY', 'Buyer Limited'), evidence('LOCATION', 'Dhaka, Bangladesh')] }]);
  assert.equal(strong.confidence, 0.9);
  assert.equal(strong.root_domain, 'buyer.example');
});

test('directory outbound company link is preferred over the directory domain', () => {
  const resolved = resolveOfficialWebsite({
    candidate_type: 'DIRECTORY_PROFILE', url: 'https://directory.example/company/buyer',
    discovered_external_website: 'https://buyer.example/contact'
  });
  assert.equal(resolved.root_domain, 'buyer.example');
  assert.equal(resolved.method, 'PROFILE_EXPLICIT_OUTBOUND_LINK');
});

test('market-specific legal suffix normalization is UTF-8 safe', () => {
  assert.equal(normalizeCompanyName('ঢাকা বিউটি ট্রেডিং প্রাইভেট Limited', getMarketProfile('BD')), 'ঢাকা বিউটি ট্রেডিং প্রাইভেট');
  assert.equal(normalizeCompanyName('Example Beauty FZCO', getMarketProfile('AE')), 'example beauty');
  assert.equal(normalizeCompanyName('Moda Ejemplo S.A. de C.V.', getMarketProfile('MX')), 'moda ejemplo');
  assert.equal(normalizeCompanyName('Comercial del Norte S. de R.L. de C.V.', getMarketProfile('MX')), 'comercial del norte');
});

test('business-type rules preserve VERIFIED and SUPPORTED distinction', () => {
  const result = assessBusinessTypes([
    evidence('WHOLESALER', 'We are a wholesaler of professional cosmetics.'),
    evidence('BRANDS', 'Exclusive regional distribution of international brands.', 0.8)
  ]);
  assert.equal(result.wholesaler.status, 'VERIFIED');
  assert.equal(result.distributor.status, 'SUPPORTED');
  assert.equal(result.importer.status, 'SUPPORTED');
  assert.equal(result.generalTrading.status, 'UNKNOWN');
});

test('company-size classification uses explicit employees, conservative scale signals, and UNKNOWN fallback', () => {
  assert.equal(assessCompanySize([evidence('EMPLOYEE_SIZE', 'The company has 38 employees.')]).company_size, 'SMALL');
  const inferred = assessCompanySize([
    evidence('REGIONAL_COVERAGE', 'Operations across the country', 0.8),
    evidence('LOCATIONS', 'Multiple locations', 0.8),
    evidence('WAREHOUSE', 'Distribution warehouse', 0.8)
  ]);
  assert.equal(inferred.company_size, 'MEDIUM');
  assert.equal(inferred.method, 'INFERRED_FROM_PUBLIC_SCALE_SIGNALS');
  assert.equal(assessCompanySize([]).company_size, 'UNKNOWN');
});

test('accessibility does not make enterprise automatically LOW or small automatically HIGH', () => {
  const supported = { importer: { status: 'SUPPORTED' }, wholesaler: { status: 'UNKNOWN' }, distributor: { status: 'UNKNOWN' }, generalTrading: { status: 'UNKNOWN' } };
  const enterprise = assessPartnershipAccessibility({
    companySize: 'ENTERPRISE', businessTypes: supported,
    contacts: [{ contact_type: 'EMAIL' }], regionalEvidence: true
  });
  assert.equal(enterprise.value, 'MEDIUM');
  const small = assessPartnershipAccessibility({
    companySize: 'SMALL', businessTypes: Object.fromEntries(Object.keys(supported).map(key => [key, { status: 'UNKNOWN' }])), contacts: []
  });
  assert.equal(small.value, 'UNKNOWN');
});

test('business social extraction accepts company accounts and rejects personal LinkedIn profiles', () => {
  assert.equal(classifySocialUrl('https://linkedin.com/in/a-person').account_type, 'PERSONAL_REJECTED');
  assert.equal(classifySocialUrl('https://linkedin.com/company/example-ltd').account_type, 'BUSINESS');
  assert.equal(classifySocialUrl('https://api.whatsapp.com/send'), null);
  assert.equal(classifySocialUrl('https://api.whatsapp.com/send?phone=971501234567').normalized_profile_url, 'https://wa.me/971501234567');
  assert.equal(classifySocialUrl('https://facebook.com/sharer/sharer.php?u=https://example.com'), null);
  const found = extractBusinessSocialLinks(`
    <a href="https://instagram.com/examplebusiness/?utm_source=site">Instagram</a>
    <script type="application/ld+json">{"@type":"Organization","sameAs":["https://facebook.com/examplebusiness"]}</script>
  `, 'https://buyer.example');
  assert.deepEqual(new Set(found.map(item => item.platform)), new Set(['INSTAGRAM','FACEBOOK']));
});

test('market-aware evidence extraction works for Bangladesh without UAE token dependencies', () => {
  const page = {
    url: 'https://dhakabeauty.example/about', title: 'Dhaka Beauty Limited', captured_at: new Date(),
    html: `<html><head><title>Dhaka Beauty Limited</title><meta property="og:site_name" content="Dhaka Beauty Limited"><script>const DubaiNoise = 'UAE';</script></head>
      <body><h1>Dhaka Beauty Limited</h1><p>Based in Dhaka, Bangladesh, we distribute cosmetics to retailers.</p>
      <p>Our 45 employees support a national distribution network.</p><footer>Copyright 2026 Dhaka Beauty Limited</footer></body></html>`
  };
  const result = extractVerificationEvidence(page, {
    candidateTitle: 'Dhaka Beauty Limited', country: 'Bangladesh', city: 'Dhaka',
    category: 'Beauty & Personal Care', marketProfile: getMarketProfile('BD')
  });
  assert.ok(result.evidence.some(item => item.evidence_type === 'LOCATION'));
  assert.ok(result.evidence.some(item => item.evidence_type === 'DISTRIBUTOR'));
  assert.ok(result.evidence.some(item => item.evidence_type === 'PRODUCT_CATEGORY'));
  assert.equal(result.text.includes('DubaiNoise'), false);
});

test('country-aware duplicate matching prevents weak cross-market name merge', () => {
  const companies = [{ id: 'ae-1', company_name: 'Example Trading Limited', country_code: 'AE', website_url: null, official_root_domain: null, contact_values: [] }];
  const bdCandidate = { resolved_company_name: 'Example Trading Limited', country_code: 'BD', official_root_domain: null };
  assert.equal(matchExistingCompany(bdCandidate, companies, [], getMarketProfile('BD')), null);
  const aeCandidate = { ...bdCandidate, country_code: 'AE' };
  assert.equal(matchExistingCompany(aeCandidate, companies, [], getMarketProfile('AE')).method, 'NORMALIZED_NAME_AND_MARKET');
});

test('strategic account stays visible when scale evidence supports it', () => {
  const result = strategicAccountAssessment('LARGE', [
    evidence('REGIONAL_COVERAGE', 'Regional distribution network'),
    evidence('LOCATIONS', 'Multiple locations')
  ]);
  assert.equal(result.strategic_account, true);
  assert.ok(result.reasonCodes.includes('LARGE_REGIONAL_DISTRIBUTOR'));
});

test('social fallback requires distinctive company identity in title or account path', () => {
  const market = getMarketProfile('AE');
  assert.equal(socialResultMatchesCompany('Vivandi Distribution', {
    title: 'Vivandi Group', url: 'https://ae.linkedin.com/company/vivandigroup', snippet: 'distributor UAE'
  }, market), true);
  assert.equal(socialResultMatchesCompany('United General Trading FZCO', {
    title: 'Worldwide Distribution Center', url: 'https://linkedin.com/company/worldwide-distribution-center-fzco',
    snippet: 'United General Trading FZCO UAE'
  }, market), false);
});
