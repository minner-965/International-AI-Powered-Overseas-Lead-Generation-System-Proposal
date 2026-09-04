import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { CATEGORY_SYNONYMS, generateResearchQueries } from '../src/search/queryGenerator.js';
import { normalizeUrl, extractRootDomain, normalizeSearchResult } from '../src/search/resultNormalizer.js';
import { classifySearchResult, mergeSearchCandidates } from '../src/search/resultFilter.js';
import { BraveSearchProvider } from '../src/search/BraveSearchProvider.js';
import { DataForSeoSearchProvider } from '../src/search/DataForSeoSearchProvider.js';
import { TavilySearchProvider } from '../src/search/TavilySearchProvider.js';
import { discoverResearchCandidates } from '../src/search/discoveryService.js';
import { getMarketProfile } from '../src/market/marketProfiles.js';

test('query generation depends on category, market and buyer inputs', () => {
  const beauty = generateResearchQueries({
    country: 'United Arab Emirates', city: 'Dubai', product_category: 'Beauty & Personal Care',
    buyer_types: ['Importer', 'Wholesaler', 'Distributor']
  });
  const bags = generateResearchQueries({
    country: 'United Arab Emirates', city: 'Dubai', product_category: 'Bags',
    buyer_types: ['Importer', 'Wholesaler', 'Distributor']
  });
  assert.ok(beauty.length > 5);
  assert.ok(bags.length > 5);
  assert.ok(beauty.some(item => /cosmetics|beauty products|skincare/.test(item.query_text)));
  assert.ok(bags.some(item => /bags|handbags|fashion bags/.test(item.query_text)));
  assert.ok(beauty.every(item => /Dubai|UAE/.test(item.query_text)));
  assert.ok(beauty.some(item => /importer/.test(item.query_text)));
  assert.ok(beauty.some(item => /wholesaler/.test(item.query_text)));
  assert.ok(beauty.some(item => /distributor/.test(item.query_text)));
  assert.ok(beauty.some(item => /general trading/.test(item.query_text)));
  assert.equal(new Set(beauty.map(item => item.query_text.toLowerCase())).size, beauty.length);
  assert.ok(CATEGORY_SYNONYMS["Women's Apparel"].includes("women's clothing"));
  const uk = generateResearchQueries({
    country: 'United Kingdom', city: 'London', product_category: 'Household Goods',
    buyer_types: ['Importer', 'Wholesaler', 'Distributor']
  });
  assert.ok(uk.length > 5);
  assert.ok(uk.every(item => /London|United Kingdom/.test(item.query_text)));
  assert.ok(uk.every(item => !/UAE|site:\.ae/.test(item.query_text)));
});

test('dynamic discovery service is isolated from legacy fixed candidate arrays', async () => {
  const source = await readFile(new URL('../src/search/discoveryService.js', import.meta.url), 'utf8');
  assert.equal(source.includes('verifiedCompanySources'), false);
  assert.equal(source.includes('publicBusinessProfiles'), false);
});

test('research target is not reduced by legacy search, contact or verification candidate caps', async () => {
  const [server,discovery,contacts,verification]=await Promise.all([
    readFile(new URL('../src/server.js',import.meta.url),'utf8'),
    readFile(new URL('../src/search/discoveryService.js',import.meta.url),'utf8'),
    readFile(new URL('../src/contact/researchContactService.js',import.meta.url),'utf8'),
    readFile(new URL('../src/verification/companyVerificationService.js',import.meta.url),'utf8')
  ]);
  for(const legacy of ['SEARCH_MAX_QUERIES_PER_JOB','SEARCH_RESULTS_PER_QUERY','CONTACT_CHECK_MAX_CANDIDATES','COMPANY_VERIFY_MAX_CANDIDATES']) {
    assert.equal(server.includes(legacy),false);
  }
  assert.equal(discovery.includes('slice(0, config.maxQueries)'),false);
  assert.equal(contacts.includes('config.maxCandidates'),false);
  assert.equal(verification.includes('config.maxCandidates'),false);
});

test('URL normalization removes tracking and extracts registrable root domain', () => {
  assert.equal(normalizeUrl('http://www.example.co.ae/about/?utm_source=x&gclid=y#team'), 'https://example.co.ae/about');
  assert.equal(extractRootDomain('https://sub.example.co.ae/about'), 'example.co.ae');
  assert.equal(extractRootDomain('https://www.example.ae'), 'example.ae');
});

test('search result normalization retains provider, query, rank and provider score', () => {
  const normalized = normalizeSearchResult({title:'  Supplier  ',url:'https://www.supplier.ae/?fbclid=x',snippet:' UAE distributor ',provider_score:0.8765,rank:3}, {
    provider:'mock', queryId:'query-1', capturedAt:new Date('2026-08-27T00:00:00Z')
  });
  assert.equal(normalized.normalized_url, 'https://supplier.ae');
  assert.equal(normalized.root_domain, 'supplier.ae');
  assert.equal(normalized.search_query_id, 'query-1');
  assert.equal(normalized.rank, 3);
  assert.equal(normalized.provider_score, 0.8765);
});

test('filter classifies social results and rejects consumer marketplaces and noise', () => {
  const social = classifySearchResult({root_domain:'linkedin.com',normalized_url:'https://linkedin.com/company/example',title:'Example',snippet:''});
  assert.deepEqual([social.candidate_type,social.candidate_status], ['SOCIAL_PROFILE','REVIEW']);
  const marketplace = classifySearchResult({root_domain:'amazon.ae',normalized_url:'https://amazon.ae/product/123',title:'Product',snippet:''});
  assert.deepEqual([marketplace.candidate_type,marketplace.candidate_status], ['MARKETPLACE','REJECTED']);
  const b2bMarketplace = classifySearchResult({root_domain:'trade.example',normalized_url:'https://trade.example/product-category/women',title:'Wholesale B2B Market',snippet:'Buy and sell products'});
  assert.deepEqual([b2bMarketplace.candidate_type,b2bMarketplace.candidate_status], ['MARKETPLACE','REJECTED']);
  const noise = classifySearchResult({root_domain:'wikipedia.org',normalized_url:'https://wikipedia.org/wiki/Cosmetics',title:'Cosmetics',snippet:''});
  assert.equal(noise.candidate_status, 'REJECTED');
  const datedArticle = classifySearchResult({root_domain:'supplier.com',normalized_url:'https://supplier.com/2025/12/29/cosmetic-supplier-in-dubai',title:'Cosmetic supplier in Dubai',snippet:''});
  assert.deepEqual([datedArticle.candidate_type,datedArticle.candidate_status], ['ARTICLE','REJECTED']);
  const listicle = classifySearchResult({root_domain:'business.com',normalized_url:'https://business.com/cosmetics-distributors-in-uae',title:'5 Top Cosmetics Distributors in UAE',snippet:''});
  assert.deepEqual([listicle.candidate_type,listicle.candidate_status], ['ARTICLE','REJECTED']);
  const aggregateDirectory = classifySearchResult({root_domain:'atninfo.com',normalized_url:'https://atninfo.com/brand-description/uae/all/cosmetics-7003',title:'Cosmetics In UAE | Top Dealers & Suppliers',snippet:''});
  assert.deepEqual([aggregateDirectory.candidate_type,aggregateDirectory.candidate_status], ['DIRECTORY_PROFILE','REVIEW']);
  const hostedCompanyProfile = classifySearchResult({root_domain:'kompass.com',normalized_url:'https://ae.kompass.com/c/example/ae123',title:'Example Trading LLC - Kompass',snippet:'General trading company'});
  assert.deepEqual([hostedCompanyProfile.candidate_type,hostedCompanyProfile.candidate_status], ['DIRECTORY_PROFILE','NEW']);
});

test('duplicate merging retains query associations and enforces max_results', () => {
  const base = {provider:'mock',title:'Supplier',url:'https://supplier.ae',normalized_url:'https://supplier.ae',root_domain:'supplier.ae',snippet:'Beauty products distributor LLC',candidate_type:'OFFICIAL_SITE_CANDIDATE',candidate_status:'NEW',captured_at:new Date()};
  const merged = mergeSearchCandidates([
    {...base,search_query_id:'q1',rank:2},
    {...base,search_query_id:'q2',rank:1},
    {...base,title:'Other',url:'https://other.ae',normalized_url:'https://other.ae',root_domain:'other.ae',search_query_id:'q3',rank:4}
  ], 1);
  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.candidates[0].query_matches.length, 2);
  assert.equal(merged.duplicates, 1);
});

test('Brave provider reports missing key, 401 and timeout without exposing a key', async () => {
  await assert.rejects(() => new BraveSearchProvider().search({query:'test'}), error => error.code === 'MISSING_API_KEY');
  const unauthorized = new BraveSearchProvider({apiKey:'test-token',fetchImpl:async()=>new Response('{}',{status:401})});
  await assert.rejects(() => unauthorized.search({query:'test'}), error => error.code === 'AUTHENTICATION_FAILED');
  const timedOut = new BraveSearchProvider({apiKey:'test-token',fetchImpl:async()=>{throw new DOMException('timeout','TimeoutError')}});
  await assert.rejects(() => timedOut.search({query:'test'}), error => error.code === 'TIMEOUT');
});

test('Tavily provider uses Basic Search only and maps score, usage and deterministic rank', async () => {
  let captured;
  const provider = new TavilySearchProvider({
    apiKey:'tvly-test',
    fetchImpl:async(url,options)=>{
      captured={url,options};
      return new Response(JSON.stringify({
        query:'beauty distributor Dubai UAE',request_id:'request-1',response_time:1.2,usage:{credits:1},
        results:[
          {title:'Supplier LLC',url:'https://supplier.ae',content:'Beauty distributor in Dubai',score:0.91},
          {title:'Directory profile',url:'https://directory.ae/company/supplier',content:'Company listing',score:0.72}
        ]
      }),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  const result=await provider.search({query:'beauty distributor Dubai UAE',count:5,country:'AE'});
  const body=JSON.parse(captured.options.body);
  assert.equal(captured.url,'https://api.tavily.com/search');
  assert.equal(captured.options.method,'POST');
  assert.ok(captured.options.headers.authorization.startsWith('Bearer '));
  assert.deepEqual({search_depth:body.search_depth,max_results:body.max_results,include_answer:body.include_answer,include_raw_content:body.include_raw_content,include_images:body.include_images,auto_parameters:body.auto_parameters,country:body.country}, {
    search_depth:'basic',max_results:5,include_answer:false,include_raw_content:false,include_images:false,auto_parameters:false,country:'united arab emirates'
  });
  assert.equal(result.provider,'tavily');
  assert.equal(result.credits,1);
  assert.deepEqual(result.results[0],{title:'Supplier LLC',url:'https://supplier.ae',snippet:'Beauty distributor in Dubai',provider_score:0.91,rank:1});
  assert.equal(result.results[1].rank,2);
});

test('Tavily provider rejects missing key, non-basic depth, 401, 403, credit limit and timeout', async () => {
  await assert.rejects(()=>new TavilySearchProvider().search({query:'test'}),error=>error.code==='MISSING_API_KEY');
  await assert.rejects(()=>new TavilySearchProvider({apiKey:'x',searchDepth:'advanced'}).search({query:'test'}),error=>error.code==='INVALID_SEARCH_DEPTH');
  for (const status of [401,403]) {
    const provider=new TavilySearchProvider({apiKey:'x',fetchImpl:async()=>new Response(JSON.stringify({detail:'invalid key'}),{status})});
    await assert.rejects(()=>provider.search({query:'test'}),error=>error.code==='AUTH_ERROR');
  }
  const limited=new TavilySearchProvider({apiKey:'x',fetchImpl:async()=>new Response(JSON.stringify({detail:'rate limited'}),{status:429,headers:{'retry-after':'60'}})});
  await assert.rejects(()=>limited.search({query:'test'}),error=>error.code==='RATE_LIMITED'&&error.retryAfterSeconds===60);
  const exhausted=new TavilySearchProvider({apiKey:'x',fetchImpl:async()=>new Response(JSON.stringify({detail:"This request exceeds your plan's set usage limit."}),{status:432})});
  await assert.rejects(()=>exhausted.search({query:'test'}),error=>error.code==='CREDIT_EXHAUSTED');
  const timedOut=new TavilySearchProvider({apiKey:'x',fetchImpl:async()=>{throw new DOMException('timeout','TimeoutError')}});
  await assert.rejects(()=>timedOut.search({query:'test'}),error=>error.code==='TIMEOUT');
});

test('DataForSEO provider sends a live structured request and maps organic results', async () => {
  let captured;
  const provider = new DataForSeoSearchProvider({
    login: 'api-login', password: 'api-password',
    fetchImpl: async (url, options) => {
      captured = {url, options};
      return new Response(JSON.stringify({
        status_code: 20000,
        tasks: [{id:'task-1',status_code:20000,cost:0.002,result:[{items:[
          {type:'organic',title:'Supplier LLC',url:'https://supplier.ae/about',description:'Beauty distributor in Dubai',rank_absolute:3},
          {type:'people_also_ask',title:'Ignored',url:'https://ignored.example',rank_absolute:4}
        ]}]}]
      }), {status:200,headers:{'content-type':'application/json'}});
    }
  });
  const result = await provider.search({query:'beauty distributor Dubai',count:20,locationName:'Dubai,Dubai,United Arab Emirates',searchLang:'en'});
  assert.equal(captured.url, 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
  assert.equal(captured.options.method, 'POST');
  assert.ok(captured.options.headers.authorization.startsWith('Basic '));
  const [task] = JSON.parse(captured.options.body);
  assert.deepEqual({keyword:task.keyword,location_name:task.location_name,language_code:task.language_code,depth:task.depth}, {
    keyword:'beauty distributor Dubai',location_name:'Dubai,Dubai,United Arab Emirates',language_code:'en',depth:20
  });
  assert.equal(result.provider, 'dataforseo');
  assert.equal(result.taskId, 'task-1');
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0], {title:'Supplier LLC',url:'https://supplier.ae/about',snippet:'Beauty distributor in Dubai',rank:3});
});

test('DataForSEO provider reports missing credentials, 401, verification, API error and timeout', async () => {
  await assert.rejects(() => new DataForSeoSearchProvider().search({query:'test'}), error => error.code === 'MISSING_API_CREDENTIALS');
  const unauthorized = new DataForSeoSearchProvider({login:'x',password:'y',fetchImpl:async()=>new Response('{}',{status:401})});
  await assert.rejects(() => unauthorized.search({query:'test'}), error => error.code === 'AUTHENTICATION_FAILED');
  const unverified = new DataForSeoSearchProvider({login:'x',password:'y',fetchImpl:async()=>new Response(JSON.stringify({status_code:40104,status_message:'Please verify your account before using the API.'}),{status:403})});
  await assert.rejects(() => unverified.search({query:'test'}), error => error.code === 'ACCOUNT_VERIFICATION_REQUIRED');
  const apiError = new DataForSeoSearchProvider({login:'x',password:'y',fetchImpl:async()=>new Response(JSON.stringify({status_code:40501,status_message:'Invalid field'}),{status:200})});
  await assert.rejects(() => apiError.search({query:'test'}), error => error.code === 'PROVIDER_ERROR');
  const timedOut = new DataForSeoSearchProvider({login:'x',password:'y',fetchImpl:async()=>{throw new DOMException('timeout','TimeoutError')}});
  await assert.rejects(() => timedOut.search({query:'test'}), error => error.code === 'TIMEOUT');
});

const databaseConfigured = Boolean(process.env.POSTGRES_HOST && process.env.POSTGRES_PASSWORD);
const { Pool } = pg;

async function withResearchJob(callback) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  });
  const created = await pool.query(`
    INSERT INTO leadgen.research_jobs (country,country_code,country_name,market_profile,city,product_category,buyer_types,max_results,status,started_at)
    VALUES ('United Arab Emirates','AE','United Arab Emirates','AE','Dubai','Beauty & Personal Care',ARRAY['Importer','Wholesaler','Distributor'],5,'DISCOVERING',now())
    RETURNING id`);
  try { await callback(pool, created.rows[0].id); }
  finally {
    await pool.query('DELETE FROM leadgen.research_jobs WHERE id=$1', [created.rows[0].id]);
    await pool.end();
  }
}

test('mock discovery tolerates partial query failure, merges duplicates and updates counters', {skip:!databaseConfigured}, async () => {
  await withResearchJob(async (pool, jobId) => {
    let calls = 0;
    const provider = {
      name:'mock',
      async search() {
        calls += 1;
        if (calls === 1) throw new Error('mock timeout');
        return {provider:'mock',results:[
          {title:'Supplier LLC',url:'https://supplier.ae/?utm_source=test',snippet:'Beauty products distributor in Dubai UAE',rank:1},
          {title:'Supplier duplicate',url:'https://supplier.ae/?utm_campaign=duplicate',snippet:'Beauty products distributor in Dubai UAE',rank:2},
          {title:'Second LLC',url:'https://second.ae',snippet:'Beauty products wholesaler in Dubai UAE',rank:3},
          {title:'Third LLC',url:'https://third.ae',snippet:'Cosmetics importer in Dubai UAE',rank:4},
          {title:'Fourth LLC',url:'https://fourth.ae',snippet:'Personal care distributor in Dubai UAE',rank:5},
          {title:'Fifth LLC',url:'https://fifth.ae',snippet:'Skincare wholesaler in Dubai UAE',rank:6},
          {title:'Pinterest',url:'https://pinterest.com/example',snippet:'ideas',rank:7}
        ]};
      }
    };
    const result = await discoverResearchCandidates(pool, jobId, {
      provider:'mock',storageRightsConfirmed:true,timeoutMs:1000
    }, {provider});
    assert.equal(result.api_requests, 2);
    assert.equal(result.successful_requests, 1);
    assert.equal(result.failed_requests, 1);
    assert.equal(result.candidates_found, 5);
    assert.equal(result.completion_reason, 'TARGET_REACHED');
    assert.ok(result.noise_rejected >= 1);
    assert.ok(result.duplicates_removed >= 1);
    const job = await pool.query('SELECT candidates_found,error_count,search_raw_results FROM leadgen.research_jobs WHERE id=$1', [jobId]);
    assert.deepEqual(job.rows[0], {candidates_found:5,error_count:1,search_raw_results:7});
  });
});

test('mock discovery rejects all-query failure and persists no candidates', {skip:!databaseConfigured}, async () => {
  await withResearchJob(async (pool, jobId) => {
    const provider = {name:'mock',async search(){throw new Error('mock provider unavailable')}};
    await assert.rejects(() => discoverResearchCandidates(pool, jobId, {
      provider:'mock',storageRightsConfirmed:true,timeoutMs:1000
    }, {provider}), error => error.code === 'ALL_SEARCH_QUERIES_FAILED');
    const candidates = await pool.query('SELECT count(*)::int AS count FROM leadgen.research_candidates WHERE research_job_id=$1', [jobId]);
    assert.equal(candidates.rows[0].count, 0);
    const job = await pool.query('SELECT error_count,search_failed_requests FROM leadgen.research_jobs WHERE id=$1', [jobId]);
    const expectedQueries=generateResearchQueries({country:'United Arab Emirates',country_code:'AE',country_name:'United Arab Emirates',market_profile:'AE',city:'Dubai',product_category:'Beauty & Personal Care',buyer_types:['Importer','Wholesaler','Distributor'],max_results:5}).length;
    assert.deepEqual(job.rows[0], {error_count:expectedQueries,search_failed_requests:expectedQueries});
  });
});
