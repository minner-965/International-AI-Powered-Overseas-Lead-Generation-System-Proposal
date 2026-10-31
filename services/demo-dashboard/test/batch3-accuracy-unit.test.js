// Batch 3 (plan section 3, C1/C3-C8): rules-only lead accuracy. Pure tests, zero external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCandidateVerification, extractVerificationEvidence, retailChainSignal } from '../src/verification/verificationRules.js';
import {
  acceptAllDecision, companyRootDomain, contactVerificationTtlDays, emailMatchesCompanyDomain, isFreeWebmail, sourceOnCompanySite
} from '../src/verification/contactVerificationPolicy.js';
import { evaluateContactVerification } from '../src/outreach/eligibility.js';
import { selectRecipientRoute, loadPhase13EmailEligibilityFacts } from '../src/outreach/Phase13EmailFactLoader.js';
import { selectFirstTouchTemplate, isGenericMailbox } from '../src/outreach/firstTouchTemplates.js';
import { evaluatePhase13EmailEligibility } from '../src/outreach/phase13EmailEligibility.js';
import { SIM_FIRST_TOUCH_CANDIDATES_SQL, MERCHANT_FIRST_TOUCH_CANDIDATES_SQL } from '../src/outreach/firstTouchCandidates.js';
import { buildCompanyFactsSnapshot, wholeWordPattern } from '../src/scoring/factsSnapshotBuilder.js';
import { DpvScoringEngine, CURRENT_SCORE_RULE_VERSION } from '../src/scoring/zenRulesAdapter.js';
import {
  calculateCategoryProcurementMatch, buildCategoryProcurementDimensions, categoryBandScoreSql, resolveCategoryProcurementMatchBand,
  CATEGORY_PROCUREMENT_MATCH_VERSION, APPROVED_CATEGORY_MATCH_VERSIONS
} from '../src/categoryProcurement/categoryProcurementMatch.js';
import { extractCategoryBuyerObservations } from '../src/categoryProcurement/categoryObservationExtractor.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';
import { getProductCategoryProfile } from '../src/market/productProfiles.js';
import { classifyContactReadiness } from '../src/opportunityPool/contactReadiness.js';
import { createContactReverifier, verificationExpired } from '../src/verification/contactReverification.js';

let seq = 1;
const id = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
const ev = (evidence_type, evidence_text, confidence = 0.9) => ({ id: id(), evidence_type, evidence_text, confidence, captured_at: '2026-10-01T00:00:00Z' });

// ---------- C1 retail chains ----------
test('C1: own counted store network + category evidence verifies a retail chain; consumerOnly no longer blocks it', () => {
  const base = [ev('COMPANY_IDENTITY', 'Apparel Group'), ev('LOCATION', 'Dubai, United Arab Emirates'),
    ev('RETAIL_CHANNEL', 'department stores and e-commerce')];
  const chainOnly = decideCandidateVerification({ evidence: [...base, ev('RETAIL_CHAIN', 'Apparel Group operates over 2,600 stores')], officialConfidence: 0.9 });
  assert.equal(chainOnly.verificationStatus, 'REVIEW');
  assert.ok(chainOnly.rejectionReasons.includes('RETAIL_CHAIN_CATEGORY_EVIDENCE_MISSING'));
  const chain = decideCandidateVerification({ evidence: [...base, ev('RETAIL_CHAIN', 'Apparel Group operates over 2,600 stores'),
    ev('PRODUCT_CATEGORY', "women's apparel and dresses", 0.82)], officialConfidence: 0.9 });
  assert.equal(chain.verificationStatus, 'VERIFIED_BUSINESS');
  assert.equal(chain.consumerOnly, false);
  assert.equal(chain.businessTypes.retailChain.status, 'VERIFIED');
  const consumer = decideCandidateVerification({ evidence: [...base, ev('PRODUCT_CATEGORY', 'dresses', 0.82)], officialConfidence: 0.9 });
  assert.deepEqual(consumer.rejectionReasons, ['CONSUMER_ONLY_RETAIL']);
});

test('C1: market statistics, single shops and articles are not store-network evidence', () => {
  assert.equal(retailChainSignal('According to ANTAD, there are 26 supermarket chains with more than 3,323 stores.'), null);
  assert.equal(retailChainSignal('In 2021 there were 93 supermarket chains, with 46,643 stores throughout the country.'), null);
  assert.equal(retailChainSignal('Grocery stores in Mexico are stocked with familiar items.'), null);
  assert.equal(retailChainSignal('Visit our store in Dubai Mall'), null);
  assert.equal(retailChainSignal('UAE Kuwait Oman 50+ Supermarkets 100+ Brands').method, 'STORE_NETWORK_COUNT');
  assert.equal(retailChainSignal('Contamos con más de 120 tiendas en todo México').count, 120);
  assert.equal(retailChainSignal('Nossas lojas estão em todo o Brasil').method, 'OWN_STORE_NETWORK_WORDING');
  assert.equal(retailChainSignal('Liverpool es una tienda departamental líder').evidence_type, 'DEPARTMENT_STORE');
});

test('C1/C8: page extraction emits RETAIL_CHAIN, drops beauty-era salon/pharmacy words and bare "stores in"', () => {
  const html = `<html><head><title>Rede Moda Ltda</title></head><body><h1>Rede Moda Ltda</h1>
    <p>Somos uma rede de lojas em São Paulo, Brasil. Operamos 45 lojas próprias.</p>
    <p>Moda feminina, vestidos e saias para toda a família.</p><p>Salon-quality results for pharmacies.</p>
    <p>Grocery stores in Brazil are everywhere.</p></body></html>`;
  const profile = getMarketProfile('BR');
  const { evidence } = extractVerificationEvidence({ html, url: 'https://redemoda.com.br/' }, { category: "Women's Apparel", marketProfile: profile });
  const types = evidence.map(item => item.evidence_type);
  assert.ok(types.includes('RETAIL_CHAIN'));
  assert.ok(types.includes('PRODUCT_CATEGORY'), 'Portuguese Shopify names count as category evidence');
  assert.equal(evidence.some(item => item.evidence_type === 'RETAIL_CHANNEL' && /salon|pharmac/i.test(item.evidence_text)), false);
  assert.equal(evidence.some(item => item.evidence_type === 'LOCATIONS' && /Grocery stores in Brazil/.test(item.evidence_text)), false);
});

// ---------- C8 markets and terms ----------
test('C8: BR AU CA SG market profiles and es/pt/ar category terms', () => {
  for (const code of ['BR', 'AU', 'CA', 'SG']) assert.equal(getMarketProfile(code).profileKey, code);
  assert.equal(getMarketProfile('BR').defaultLanguage, 'pt');
  const terms = getProductCategoryProfile("Women's Apparel", { languages: ['es', 'pt', 'ar'] }).evidenceTerms;
  for (const term of ['vestidos', 'faldas', 'saias', 'فساتين']) assert.ok(terms.includes(term), term);
  assert.deepEqual(getProductCategoryProfile("Women's Apparel").evidenceTerms.includes('vestidos'), false);
});

test('C8: bare "locations" / "shop online" / "inventario" are not operating evidence; quantities and context are', () => {
  const types = html => extractCategoryBuyerObservations({ html: `<body>${html}</body>`, source_url: 'https://a.example', source_authority: 'OFFICIAL' })
    .map(row => row.observation_type);
  assert.deepEqual(types('Home | Locations | Shop online | Contact | inventario'), []);
  assert.deepEqual(types('We have 35 locations across Mexico. Nuestro inventario propio.'), ['STORE_NETWORK', 'WAREHOUSE_INVENTORY']);
  assert.ok(types('Nossas lojas e importadora de moda').includes('RETAIL_CHANNEL'));
});

// ---------- C7 verification policy ----------
test('C7: one TTL setting (default 90 days) and accept-all thresholds', () => {
  assert.equal(contactVerificationTtlDays({}), 90);
  assert.equal(contactVerificationTtlDays({ CONTACT_VERIFICATION_TTL_DAYS: '45', OUTREACH_VERIFICATION_TTL_DAYS: '30' }), 45);
  assert.equal(contactVerificationTtlDays({ OUTREACH_VERIFICATION_TTL_DAYS: '30' }), 30);
  const now = new Date('2026-10-29T00:00:00Z');
  const at = '2026-08-15T00:00:00Z'; // 75 days
  assert.equal(evaluateContactVerification({ verification_status: 'VALID', last_verified_at: at }, { now }).eligible_for_send, true);
  assert.ok(evaluateContactVerification({ verification_status: 'VALID', last_verified_at: '2026-07-01T00:00:00Z' }, { now }).reason_codes.includes('CONTACT_VERIFICATION_EXPIRED'));
  assert.deepEqual([90, 85, 84, 80, 79, null].map(acceptAllDecision), ['AUTO_SEND', 'AUTO_SEND', 'MANUAL_REVIEW', 'MANUAL_REVIEW', 'BLOCKED_LOW_SCORE', 'BLOCKED_NO_SCORE']);
  const acceptAll = score => evaluateContactVerification({ verification_status: 'ACCEPT_ALL', verification_score: score, last_verified_at: at }, { now });
  assert.equal(acceptAll(88).eligible_for_send, true);
  assert.deepEqual(acceptAll(82).reason_codes, ['CONTACT_ACCEPT_ALL_REQUIRES_MANUAL_RISK_REVIEW']);
  assert.equal(evaluateContactVerification({ verification_status: 'ACCEPT_ALL', verification_score: 82, last_verified_at: at }, { now, allowAcceptAllSend: true }).eligible_for_send, true);
  assert.deepEqual(acceptAll(70).reason_codes, ['CONTACT_ACCEPT_ALL_SCORE_TOO_LOW']);
  assert.deepEqual(acceptAll(null).reason_codes, ['CONTACT_ACCEPT_ALL_SCORE_TOO_LOW']);
  assert.equal(evaluateContactVerification({ verification_status: 'UNKNOWN', last_verified_at: at }, { now }).eligible_for_send, false);
});

test('C7: contact readiness uses the same TTL', () => {
  const snapshot = { observed_at: '2026-10-29T00:00:00Z', tables: { decision_maker_contacts: [{ id: 'r1', company_id: 'c1', contact_type: 'GENERIC_BUSINESS_EMAIL',
    contact_value_normalized: 'info@a.example', verification_status: 'VALID', last_verified_at: '2026-08-15T00:00:00Z', source_url: 'https://a.example/contact' }] } };
  const result = classifyContactReadiness({ id: 'c1' }, snapshot);
  assert.ok(result.contact_readiness.includes('EMAIL_READY'));
  assert.equal(result.email_eligibility.verification_ttl_days, 90);
});

test('C3/C7: company domain, published-on-site and webmail rules', () => {
  assert.equal(companyRootDomain({ website_url: 'https://www.shop.example.com.br/x' }), 'example.com.br');
  assert.equal(emailMatchesCompanyDomain('compras@mail.example.com.br', 'example.com.br'), true);
  assert.equal(emailMatchesCompanyDomain('buyer@other.example', 'example.com.br'), false);
  assert.equal(isFreeWebmail('tienda.mx@gmail.com'), true);
  assert.equal(sourceOnCompanySite('https://www.example.com.br/contato', 'example.com.br'), true);
  assert.equal(sourceOnCompanySite('https://directory.example/listing', 'example.com.br'), false);
});

// ---------- C3 recipient selection ----------
const fresh = '2026-10-20T00:00:00Z';
const route = (address, extra = {}) => ({ outreach_recipient_id: null, decision_maker_contact_id: id(), normalized_recipient: address,
  verification_status: 'VALID', verified_at: fresh, lifecycle_status: 'ACTIVE', recipient_type: 'OFFICIAL_COMPANY_EMAIL',
  recipient_source_class: 'VERIFIED_DECISION_MAKER_CONTACT', evidence_origin: 'PROVIDER_FOUND', source_url: null, is_generic: true, ...extra });
const now = new Date('2026-10-29T00:00:00Z');

test('C3: a suppressed or hard-bounced address is skipped and the next valid one is used', () => {
  const choice = selectRecipientRoute([
    route('sales@buyer.example', { contact_suppressed: true }),
    route('info@buyer.example', { hard_bounced: true }),
    route('compras@buyer.example')
  ], { rootDomain: 'buyer.example', now });
  assert.equal(choice.recipient.normalized_recipient, 'compras@buyer.example');
  assert.equal(choice.route.hard_bounced, undefined);
  assert.deepEqual(choice.evaluated.find(row => row.normalized_recipient === 'info@buyer.example').reason_codes.includes('HARD_BOUNCED'), true);
  const allStopped = selectRecipientRoute([route('info@buyer.example', { hard_bounced: true })], { rootDomain: 'buyer.example', now });
  assert.equal(allStopped.route.hard_bounced, true, 'when nothing is usable the blocked address is reported, not hidden');
});

test('C3: a found address is domain-verified only on the company root domain; published-on-site webmail is accepted', () => {
  const off = selectRecipientRoute([route('buyer@reseller.example')], { rootDomain: 'buyer.example', now });
  assert.equal(off.recipient.domain_verified, false);
  assert.ok(off.evaluated[0].reason_codes.includes('RECIPIENT_ROUTE_NOT_VERIFIED'));
  const gmail = selectRecipientRoute([route('lojamoda@gmail.com', { evidence_origin: 'OFFICIAL_SITE_OBSERVED', source_url: 'https://lojamoda.com.br/contato' })],
    { rootDomain: 'lojamoda.com.br', now });
  assert.equal(gmail.recipient.official_source_verified, true);
  assert.equal(gmail.evaluated[0].usable, true);
  const hiddenGmail = selectRecipientRoute([route('lojamoda@gmail.com')], { rootDomain: 'lojamoda.com.br', now });
  assert.ok(hiddenGmail.evaluated[0].reason_codes.includes('WEBMAIL_NOT_PUBLISHED_ON_COMPANY_SITE'));
});

test('C3: the fact loader stays one read and exposes the per-address evaluation', async () => {
  const companyId = '8b19d2b9-e7a7-4bd0-a57b-0f8a5f7da9db';
  const row = { id: companyId, company_name: 'Buyer', company_type: 'Chain Retailer VERIFIED', verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE',
    official_root_domain: 'buyer.example', recipient_routes: [route('sales@buyer.example', { opted_out: true }), route('info@buyer.example')] };
  const calls = [];
  const facts = await loadPhase13EmailEligibilityFacts({ async query(sql, values) { calls.push(sql); return { rowCount: 1, rows: [row] }; } }, companyId, {});
  assert.equal(calls.length, 1);
  assert.equal(facts.recipient.normalized_recipient, 'info@buyer.example');
  assert.equal(facts.opted_out, false);
  assert.equal(facts.recipient_candidates.length, 2);
  assert.deepEqual(facts.company_types, ['RETAILER']);
  assert.match(calls[0], /HARD_BOUNCED/);
  assert.doesNotMatch(calls[0], /message\.company_id=candidate\.id\s+AND message\.send_status='HARD_BOUNCED'/);
});

// ---------- C8 templates / Simon rule ----------
test('C8/Simon: retail-chain mailboxes use template C; any company mailbox is acceptable; new generic names', () => {
  const recipient = { normalized_recipient: 'buyer.anna@buyer.example', verification_status: 'VALID', recipient_type: 'NAMED_BUYER_EMAIL',
    named_person_verified: true, domain_verified: true, official_source_verified: false };
  assert.equal(selectFirstTouchTemplate({ recipient, company_types: ['RETAILER'] }), 'A_NAMED_BUYER', 'a verified named buyer keeps A');
  const dept = { ...recipient, normalized_recipient: 'womenswear.team@buyer.example', recipient_type: 'OFFICIAL_DEPARTMENT_EMAIL', named_person_verified: false };
  assert.equal(selectFirstTouchTemplate({ recipient: dept, company_types: ['RETAILER'] }), 'C_OFFICIAL_GENERIC_MAILBOX', 'retail chain mailbox -> C');
  assert.equal(selectFirstTouchTemplate({ recipient: dept, company_types: ['IMPORTER'] }), 'B_IMPORTER_WHOLESALER_DISTRIBUTOR');
  const office = { ...recipient, normalized_recipient: 'anna@buyer.example', recipient_type: 'OFFICIAL_COMPANY_EMAIL', named_person_verified: false };
  assert.equal(selectFirstTouchTemplate({ recipient: office, company_types: [] }), 'C_OFFICIAL_GENERIC_MAILBOX');
  for (const local of ['compras', 'ventas', 'vendas', 'purchasing', 'buying']) assert.equal(isGenericMailbox({ normalized_recipient: `${local}@x.example` }), true);
  assert.equal(selectFirstTouchTemplate({ recipient: { ...office, verification_status: 'ACCEPT_ALL', verification_score: 90 } }), 'C_OFFICIAL_GENERIC_MAILBOX');
  assert.equal(selectFirstTouchTemplate({ recipient: { ...office, verification_status: 'ACCEPT_ALL', verification_score: 82 } }), null);
});

test('C7: phase13 gate blocks unpublished webmail and accepts own-domain mailbox without a named person', () => {
  const facts = { company: { verification_status: 'VERIFIED', lifecycle_status: 'ACTIVE' }, company_types: [], opportunity_pool_band: 'RELEVANT',
    is_active_business_opportunity: true, category_id: 'cat', market: { market_code: 'BR', status: 'ACTIVE', search_enabled: true, timezone: 'UTC',
      business_send_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } },
    recipient: { normalized_recipient: 'vendas@loja.example', verification_status: 'VALID', verified_at: '2026-10-20T00:00:00Z', lifecycle_status: 'ACTIVE',
      recipient_type: 'OFFICIAL_COMPANY_EMAIL', domain_verified: true, official_source_verified: false } };
  const policy = { mode: 'AUTO_FIRST_TOUCH', automated_acquisition: true, auto_first_touch_email: true, template_set_key: 'DPV_FIRST_TOUCH_V1',
    template_set_status: 'APPROVED', policy_revision: 'V1', sender_ready: true, allowed_markets: ['BR'], allowed_category_ids: ['cat'] };
  assert.equal(evaluatePhase13EmailEligibility(facts, policy, now).eligible, true);
  const webmail = evaluatePhase13EmailEligibility({ ...facts, recipient: { ...facts.recipient, normalized_recipient: 'loja@gmail.com', domain_verified: false } }, policy, now);
  assert.ok(webmail.reason_codes.includes('WEBMAIL_NOT_PUBLISHED_ON_COMPANY_SITE'));
});

// ---------- C5 candidates ----------
test('C5: candidate SQL pre-filters unusable companies before the limit and orders by band, buyer, size, import, contact', () => {
  for (const sql of [SIM_FIRST_TOUCH_CANDIDATES_SQL, MERCHANT_FIRST_TOUCH_CANDIDATES_SQL]) {
    assert.match(sql, /company_suppressions/);
    assert.match(sql, /outreach_recipient_suppressions/);
    assert.match(sql, /status IN\('VALID','ACCEPT_ALL'\)/);
    assert.match(sql, /outbound_messages m/);
    const order = sql.slice(sql.indexOf('ORDER BY'));
    const positions = ['opportunity_pool_band', 'buyer.buyer_model', 'company_size_band', "'IMPORTER'", "verification_status='VALID'"].map(token => order.indexOf(token));
    assert.ok(positions.every(value => value >= 0), positions.join(','));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.doesNotMatch(order, /company_name/);
  }
});

// ---------- C4 company score ----------
test('C4: product terms use whole words (address/laptop do not hit dress/top)', () => {
  const pattern = wholeWordPattern(['dress', 'top']);
  assert.equal(pattern.test('Please enter your address'), false);
  assert.equal(pattern.test('laptop accessories'), false);
  assert.equal(pattern.test('a summer dress and a top'), true);
  const facts = buildCompanyFactsSnapshot({ company: { product_categories: ["Women's Apparel"] }, verification: { verification_status: 'VERIFIED_BUSINESS' },
    evidence: [ev('PRODUCT_CATEGORY', 'laptop bags and address books', 0.82)] }).facts;
  assert.equal(facts.product_fit.value, 'SUPPORTED');
});

test('C4: Hunter upper-case VALID scores as a verified mailbox; legacy lower-case valid stays domain/MX level', () => {
  const contact = (extra) => buildCompanyFactsSnapshot({ contacts: [{ id: id(), captured_at: '2026-10-01T00:00:00Z', ...extra }] }).facts.contact_validity.value;
  assert.equal(contact({ contact_type: 'GENERIC_BUSINESS_EMAIL', verification_status: 'VALID' }), 'MAILBOX_VERIFIED');
  assert.equal(contact({ contact_type: 'EMAIL', email_verification_status: 'valid', contact_verification_status: 'DOMAIN_MX_VERIFIED' }), 'DOMAIN_MX_VERIFIED');
});

test('C4: v2 excludes missing dimensions from the denominator, ranks medium size highest, needs coverage for a tier', async () => {
  const engine = new DpvScoringEngine();
  try {
    const fact = value => ({ value, confidence: 0.9, evidence_ids: [id()], captured_at: '2026-10-01T00:00:00Z' });
    const unknown = { value: 'UNKNOWN', confidence: 0, evidence_ids: [], captured_at: null };
    const snapshot = scale => ({ schema_version: 'x', verification_status: 'VERIFIED_BUSINESS', facts: {
      product_fit: fact('VERIFIED'), market_fit: fact('TARGET'), importer_wholesaler_fit: fact('VERIFIED'), chain_supply_evidence: fact('SUPPORTED'),
      distribution_scale: fact(scale), recent_buying_signal: unknown, decision_maker_quality: unknown, contact_validity: fact('MAILBOX_VERIFIED') } });
    const medium = await engine.evaluate(snapshot('MEDIUM'));
    assert.equal(CURRENT_SCORE_RULE_VERSION, 'dpv-score-v2');
    assert.equal(medium.rule_version, 'dpv-score-v2');
    assert.equal(medium.evidence_coverage, 80);
    assert.equal(medium.final_score, Math.round((20 + 15 + 15 + 10 + 10 + 5) * 100 / 80));
    const sizes = {};
    for (const size of ['MEDIUM', 'SMALL', 'LARGE', 'MICRO', 'ENTERPRISE']) sizes[size] = (await engine.evaluate(snapshot(size))).dimension_scores.distribution_scale.points;
    assert.deepEqual(sizes, { MEDIUM: 10, SMALL: 8, LARGE: 6, MICRO: 4, ENTERPRISE: 3 });
    // Core fit dimensions (product, market, buyer type) always count: no product evidence is not a perfect fit.
    const thin = await engine.evaluate({ schema_version: 'x', verification_status: 'REVIEW', facts: { market_fit: fact('TARGET'), contact_validity: fact('MAILBOX_VERIFIED') } });
    assert.equal(thin.final_score, Math.round(20 * 100 / 55));
    assert.equal(thin.tier, 'C');
    const noProduct = await engine.evaluate({ ...snapshot('MEDIUM'), facts: { ...snapshot('MEDIUM').facts, product_fit: unknown } });
    assert.equal(noProduct.final_score, Math.round(55 * 100 / 80));
    assert.notEqual(noProduct.tier, 'A');
    const strongNoProduct = await engine.evaluate({ schema_version: 'x', verification_status: 'VERIFIED_BUSINESS', facts: { market_fit: fact('TARGET'),
      importer_wholesaler_fit: fact('VERIFIED'), chain_supply_evidence: fact('VERIFIED'), distribution_scale: fact('MEDIUM'), contact_validity: fact('MAILBOX_VERIFIED') } });
    assert.equal(strongNoProduct.final_score, 75);
    assert.equal(strongNoProduct.tier, 'B');
    assert.ok(strongNoProduct.reason_codes.includes('PRODUCT_EVIDENCE_REQUIRED_FOR_TIER_A'));
    const core = await engine.evaluate({ schema_version: 'x', verification_status: 'VERIFIED_BUSINESS', facts: { product_fit: fact('VERIFIED'), market_fit: fact('TARGET'), importer_wholesaler_fit: fact('VERIFIED') } });
    assert.equal(core.final_score, 100);
    assert.equal(core.tier, 'C', 'a tier above C needs 60 coverage');
    assert.ok(core.reason_codes.includes('SCORE_COVERAGE_TOO_LOW_FOR_TIER'));
  } finally { engine.dispose(); }
});

// ---------- C6 category procurement ----------
test('C6: normalized category score, one band set for SQL and display, no triple counting', () => {
  assert.equal(CATEGORY_PROCUREMENT_MATCH_VERSION, 'category-company-match-v4');
  assert.ok(APPROVED_CATEGORY_MATCH_VERSIONS.includes('category-company-match-v3'));
  for (const [score, band] of [[80, 'VERY_HIGH'], [79, 'HIGH'], [65, 'HIGH'], [64, 'MEDIUM'], [60, 'MEDIUM'], [59, 'LOW'], [30, 'LOW'], [29, 'VERY_LOW'], [null, 'UNKNOWN']])
    assert.equal(resolveCategoryProcurementMatchBand(score), band);
  assert.equal(categoryBandScoreSql('cpm.score', 'HIGH'), 'cpm.score>=65 AND cpm.score<80');
  assert.equal(categoryBandScoreSql('cpm.score', 'very_high'), 'cpm.score>=80');
  assert.equal(categoryBandScoreSql('cpm.score', 'bogus'), '');
  const one = [{ id: id(), observation_type: 'PRODUCT_CATEGORY', verification_status: 'VERIFIED', source_authority: 'OFFICIAL', normalized_profile: 'WOMENSWEAR',
    normalized_category: 'DRESSES', raw_product_name: null }];
  const built = buildCategoryProcurementDimensions({ observations: one, product_profile: 'WOMENSWEAR' });
  assert.equal(built.dimensions.target_category_procurement_evidence.state, 'OBSERVED');
  assert.equal(built.dimensions.assortment_depth.state, 'UNKNOWN', 'one observation is not also assortment depth');
  assert.equal(built.dimensions.recent_category_activity.state, 'UNKNOWN', 'an undated page is not recency evidence');
  const result = calculateCategoryProcurementMatch({ dimensions: { target_category_procurement_evidence: { state: 'OBSERVED', points: 36, maximum: 45, evidence_ids: [id()] },
    buyer_business_model_fit: { state: 'UNKNOWN' } } });
  assert.equal(result.coverage_percent, 45);
});

// ---------- C7 re-verify before send ----------
test('C7: expired recipient is re-verified once through the Hunter verifier and stored', async () => {
  const recipient = { normalized_recipient: 'info@buyer.example', verification_status: 'VALID', verified_at: '2026-06-01T00:00:00Z',
    decision_maker_contact_id: id(), outreach_recipient_id: id() };
  assert.equal(verificationExpired(recipient, { now }), true);
  const writes = [];
  const pool = { async query(sql, values) { writes.push(sql); return { rows: [{ research_job_id: 'job-1' }] }; } };
  const calls = [];
  const hunter = { async verifyEmail(input) { calls.push(input); return { status: 'COMPLETED', results: [{ verification_status: 'ACCEPT_ALL', verification_score: 91 }] }; } };
  const result = await createContactReverifier({ pool, hunter, now: () => now })({ companyId: 'c1', recipient });
  assert.equal(result.reverified, true);
  assert.equal(result.verification_status, 'ACCEPT_ALL');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].researchJobId, 'job-1');
  assert.equal(writes.filter(sql => /UPDATE/.test(sql)).length, 2);
  const freshOne = await createContactReverifier({ pool, hunter, now: () => now })({ companyId: 'c1', recipient: { ...recipient, verified_at: '2026-10-20T00:00:00Z' } });
  assert.equal(freshOne.reverified, false);
  assert.equal(calls.length, 1);
});
