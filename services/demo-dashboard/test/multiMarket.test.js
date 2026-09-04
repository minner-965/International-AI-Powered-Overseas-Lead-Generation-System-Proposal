import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMarketProfile, listConfiguredMarkets, marketProfileForJob, marketProviderLocationName,
  marketSearchLanguage
} from '../src/market/marketProfiles.js';
import { generateResearchQueries, searchCountryCode } from '../src/search/queryGenerator.js';
import { mergeSearchCandidates } from '../src/search/resultFilter.js';
import { TavilySearchProvider } from '../src/search/TavilySearchProvider.js';
import { BraveSearchProvider } from '../src/search/BraveSearchProvider.js';
import { DataForSeoSearchProvider } from '../src/search/DataForSeoSearchProvider.js';
import { normalizePhone, normalizePhoneWithContext } from '../src/contact/phoneUtils.js';
import { extractPublicContacts } from '../src/contact/ContactExtractor.js';

const buyers = ['Importer', 'Wholesaler', 'Distributor'];

function researchJob(countryCode, countryName, city = null, extra = {}) {
  return {
    country_code: countryCode,
    country_name: countryName,
    city,
    product_category: 'Beauty & Personal Care',
    buyer_types: buyers,
    max_results: 5,
    ...extra
  };
}

test('AE, MX, BD and unknown-country GENERIC profiles resolve without core rewrites', () => {
  const ae = getMarketProfile('AE');
  const mx = getMarketProfile('MX');
  const bd = getMarketProfile('BD');
  const generic = getMarketProfile('XX', 'Example Market');
  assert.deepEqual([ae.profileKey, ae.countryCode, ae.phoneCountryCode], ['AE', 'AE', '+971']);
  assert.deepEqual([mx.profileKey, mx.countryCode, mx.phoneCountryCode, mx.defaultLanguage], ['MX', 'MX', '+52', 'es']);
  assert.deepEqual([bd.profileKey, bd.countryCode, bd.phoneCountryCode], ['BD', 'BD', '+880']);
  assert.deepEqual([generic.profileKey, generic.countryCode, generic.countryName], ['GENERIC', 'XX', 'Example Market']);
  assert.equal(marketProfileForJob({ country: 'Bangladesh' }).profileKey, 'BD');
  assert.deepEqual(listConfiguredMarkets().map(item => item.country_code), ['AE', 'MX', 'BD']);
});

test('query generation exposes the full distinct strategy set in every market', () => {
  for (const job of [
    researchJob('AE', 'United Arab Emirates', 'Dubai'),
    researchJob('BD', 'Bangladesh', 'Dhaka'),
    researchJob('MX', 'Mexico', 'Mexico City')
  ]) {
    const queries = generateResearchQueries(job);
    assert.ok(queries.length > 5);
    for(const type of ['sme_regional','buyer_category','general_trading','strategic_account']) {
      assert.ok(queries.some(item=>item.query_type===type));
    }
    assert.equal(new Set(queries.map(item=>item.query_text.toLowerCase())).size,queries.length);
    assert.ok(queries.every(item => item.country_code === job.country_code));
  }
});

test('BD and GENERIC queries include their selected market without token leakage', () => {
  const bd = generateResearchQueries(researchJob('BD', 'Bangladesh', 'Dhaka', { preferred_language: 'bn' }));
  assert.ok(bd.every(item => /Bangladesh/.test(item.query_text)));
  assert.ok(bd.every(item => /Dhaka/.test(item.query_text)));
  assert.ok(bd.every(item => !/Dubai|UAE|United Arab Emirates|\+971|\.ae\b/i.test(item.query_text)));
  assert.ok(bd.every(item => item.market_profile === 'BD' && item.preferred_language === 'bn'));

  const generic = generateResearchQueries(researchJob('XX', 'Example Market', null, { region: 'Example Region' }));
  assert.ok(generic.every(item => /Example Market/.test(item.query_text)));
  assert.ok(generic.every(item => /Example Region/.test(item.query_text)));
  assert.ok(generic.every(item => item.market_profile === 'GENERIC'));
  assert.ok(generic.every(item => !/Bangladesh|Dhaka|Dubai|UAE|United Arab Emirates/i.test(item.query_text)));
});

test('city is optional and provider location/language follow the active market', () => {
  const job = researchJob('BD', 'Bangladesh', null, { preferred_language: 'bn' });
  const profile = marketProfileForJob(job);
  const queries = generateResearchQueries(job);
  assert.ok(queries.every(item => item.city === null && /Bangladesh/.test(item.query_text)));
  assert.equal(marketProviderLocationName(job, profile), 'Bangladesh');
  assert.equal(marketSearchLanguage(job, profile), 'bn');
  assert.equal(searchCountryCode('Bangladesh'), 'BD');
  assert.equal(searchCountryCode('Example Market', 'XX'), 'ALL');
});

test('blank optional geography searches the country while supplied region and city narrow the market',()=>{
  const countryJob=researchJob('MX','Mexico',null,{region:null});
  assert.ok(generateResearchQueries(countryJob).every(item=>/Mexico/.test(item.query_text)
    &&!/Jalisco|Guadalajara/.test(item.query_text)));
  assert.equal(marketProviderLocationName(countryJob,marketProfileForJob(countryJob)),'Mexico');

  const regionJob=researchJob('MX','Mexico',null,{region:'Jalisco'});
  assert.ok(generateResearchQueries(regionJob).every(item=>/Jalisco/.test(item.query_text)&&/Mexico/.test(item.query_text)));
  assert.equal(marketProviderLocationName(regionJob,marketProfileForJob(regionJob)),'Jalisco,Mexico');

  const cityJob=researchJob('MX','Mexico','Guadalajara',{region:'Jalisco'});
  assert.ok(generateResearchQueries(cityJob).every(item=>/Guadalajara/.test(item.query_text)
    &&/Jalisco/.test(item.query_text)&&/Mexico/.test(item.query_text)));
  assert.equal(marketProviderLocationName(cityJob,marketProfileForJob(cityJob)),'Guadalajara,Jalisco,Mexico');
});

test('balanced candidate selection reserves two SME, one direct, one local-business and one strategic slot', () => {
  const queryTypes = ['strategic_account', 'sme_regional', 'buyer_category', 'general_trading', 'sme_regional'];
  const discoveries = queryTypes.map((queryType, index) => ({
    provider: 'mock',
    title: `Supplier ${index}`,
    url: `https://supplier-${index}.example`,
    normalized_url: `https://supplier-${index}.example`,
    root_domain: `supplier-${index}.example`,
    snippet: 'wholesale distributor business',
    search_query_id: `q${index}`,
    search_query_type: queryType,
    provider_score: 1 - index / 10,
    rank: index + 1,
    captured_at: new Date('2026-08-27T00:00:00Z')
  }));
  const merged = mergeSearchCandidates(discoveries, 5, { marketProfile: getMarketProfile('BD') });
  const selectedTypes = merged.candidates.flatMap(item => item.query_matches.map(match => match.query_type));
  assert.equal(selectedTypes.filter(value => value === 'sme_regional').length, 2);
  assert.equal(selectedTypes.filter(value => value === 'buyer_category').length, 1);
  assert.equal(selectedTypes.filter(value => value === 'general_trading').length, 1);
  assert.equal(selectedTypes.filter(value => value === 'strategic_account').length, 1);
});

test('Tavily sends the configured Bangladesh market name', async () => {
  let body;
  const provider = new TavilySearchProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ results: [], usage: { credits: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  await provider.search({ query: 'cosmetics distributor Bangladesh', country: 'BD' });
  assert.equal(body.country, 'bangladesh');
});

test('provider fallbacks are market-neutral', async () => {
  let braveUrl;
  const brave = new BraveSearchProvider({
    apiKey: 'test-key',
    fetchImpl: async url => {
      braveUrl = new URL(url);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }
  });
  await brave.search({ query: 'supplier' });
  assert.equal(braveUrl.searchParams.get('country'), 'ALL');
  assert.equal(braveUrl.searchParams.has('search_lang'), false);

  let dataForSeoTask;
  const dataForSeo = new DataForSeoSearchProvider({
    login: 'login',
    password: 'password',
    fetchImpl: async (_url, options) => {
      [dataForSeoTask] = JSON.parse(options.body);
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{ id: 'task', status_code: 20000, result: [{ items: [] }] }]
      }), { status: 200 });
    }
  });
  await dataForSeo.search({ query: 'supplier' });
  assert.equal('location_name' in dataForSeoTask, false);
  assert.equal('language_code' in dataForSeoTask, false);
});

test('phone normalization uses AE, MX or BD context and leaves unknown local numbers uncertain', () => {
  const ae = getMarketProfile('AE');
  const mx = getMarketProfile('MX');
  const bd = getMarketProfile('BD');
  assert.equal(normalizePhone('+971 04 269 5969', ae), '+97142695969');
  assert.deepEqual(normalizePhoneWithContext('050 123 4567', ae), {
    normalized_value: '+971501234567',
    normalization_certainty: 'COUNTRY_CONTEXT_LOCAL_PREFIX',
    normalization_status: 'COUNTRY_CONTEXT_LOCAL_PREFIX',
    country_code: 'AE'
  });
  assert.equal(normalizePhone('+880 1712 345678', bd), '+8801712345678');
  assert.equal(normalizePhone('01712 345678', bd), '+8801712345678');
  assert.deepEqual(normalizePhoneWithContext('55 1234 5678', mx), {
    normalized_value: '+525512345678',
    normalization_certainty: 'COUNTRY_CONTEXT_NATIONAL',
    normalization_status: 'COUNTRY_CONTEXT_NATIONAL',
    country_code: 'MX'
  });
  const unknown = normalizePhoneWithContext('01712 345678', getMarketProfile('XX', 'Example Market'));
  assert.equal(unknown.normalized_value, '01712345678');
  assert.equal(unknown.normalization_status, 'AMBIGUOUS_LOCAL');
});

test('contact extraction preserves public phone text and stores BD-normalized value separately', async () => {
  const result = await extractPublicContacts(
    '<body><p>Phone: 01712 345678</p></body>',
    'https://supplier.example/contact',
    { marketProfile: getMarketProfile('BD'), resolveMxImpl: async () => [] }
  );
  const phone = result.contacts.find(item => item.contact_type === 'PHONE');
  assert.equal(phone.contact_value, '01712 345678');
  assert.equal(phone.normalized_value, '+8801712345678');
  assert.equal(phone.phone_country_context, '+880');
  assert.equal(phone.normalization_status, 'COUNTRY_CONTEXT_LOCAL_PREFIX');
});
