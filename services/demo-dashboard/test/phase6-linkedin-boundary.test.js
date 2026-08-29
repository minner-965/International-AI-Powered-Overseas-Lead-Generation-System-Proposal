import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { LinkedInDiscoveryAdapter, LINKEDIN_MODES } from '../src/enrichment/LinkedInDiscoveryAdapter.js';
import { WebsiteReachabilityChecker } from '../src/contact/WebsiteReachabilityChecker.js';

test('LinkedIn defaults to SEARCH_DISCOVERY_ONLY and stores a review reference', () => {
  const adapter = new LinkedInDiscoveryAdapter();
  assert.equal(adapter.activeMode, LINKEDIN_MODES.SEARCH_DISCOVERY_ONLY);
  const reference = adapter.discoverReference({
    url:'https://www.linkedin.com/in/avery-buyer?utm_source=synthetic',
    title:'Avery Buyer - Senior Womenswear Buyer',
    snippet:'Synthetic discovery hint',provider:'tavily',capturedAt:new Date('2026-08-29T00:00:00Z')
  });
  assert.equal(reference.profile_kind, 'PERSON');
  assert.equal(reference.verification_status, 'REVIEW');
  assert.equal(reference.evidence_strength, 'DISCOVERY_HINT');
  assert.equal(reference.content_fetched, false);
  assert.equal(adapter.crawlDecision().allowed, false);
});

test('non-LinkedIn URLs are not stored by the LinkedIn adapter', () => {
  const adapter = new LinkedInDiscoveryAdapter();
  assert.equal(adapter.discoverReference({url:'https://buyer.example/team'}), null);
});

test('OFFICIAL_API fails closed without both approval and credentials', () => {
  assert.equal(new LinkedInDiscoveryAdapter({mode:'OFFICIAL_API'}).activeMode, 'SEARCH_DISCOVERY_ONLY');
  assert.equal(new LinkedInDiscoveryAdapter({mode:'OFFICIAL_API',officialApiApproved:true}).activeMode, 'SEARCH_DISCOVERY_ONLY');
  assert.equal(new LinkedInDiscoveryAdapter({mode:'OFFICIAL_API',officialApiToken:'synthetic-token'}).activeMode, 'SEARCH_DISCOVERY_ONLY');
  assert.equal(new LinkedInDiscoveryAdapter({mode:'OFFICIAL_API',officialApiApproved:true,officialApiToken:'synthetic-token'}).activeMode, 'OFFICIAL_API');
});

test('PERMITTED_CRAWL fails closed without a current permission and allowlist', () => {
  const future = new Date(Date.now()+86400000).toISOString();
  const expired = new Date(Date.now()-86400000).toISOString();
  assert.equal(new LinkedInDiscoveryAdapter({mode:'PERMITTED_CRAWL'}).activeMode, 'SEARCH_DISCOVERY_ONLY');
  assert.equal(new LinkedInDiscoveryAdapter({mode:'PERMITTED_CRAWL',crawlPermissionId:'synthetic-permit',crawlPermissionExpiresAt:expired,crawlAllowedPaths:['/company/']}).activeMode, 'SEARCH_DISCOVERY_ONLY');
  assert.equal(new LinkedInDiscoveryAdapter({mode:'PERMITTED_CRAWL',crawlPermissionId:'synthetic-permit',crawlPermissionExpiresAt:future}).activeMode, 'SEARCH_DISCOVERY_ONLY');
  const configured = new LinkedInDiscoveryAdapter({mode:'PERMITTED_CRAWL',crawlPermissionId:'synthetic-permit',crawlPermissionExpiresAt:future,crawlAllowedPaths:['/company/']});
  assert.equal(configured.activeMode, 'PERMITTED_CRAWL');
  assert.equal(configured.crawlDecision().allowed, false, 'Phase 6 must still avoid LinkedIn HTML retrieval');
});

test('WebsiteReachabilityChecker blocks LinkedIn and subdomains before network access', async () => {
  let fetchCalls = 0;
  const checker = new WebsiteReachabilityChecker({
    fetchImpl:async()=>{ fetchCalls += 1; throw new Error('network must not be called'); },
    lookupImpl:async()=>[{address:'93.184.216.34',family:4}]
  });
  for (const url of ['https://linkedin.com/in/avery-buyer','https://ae.linkedin.com/company/buyer-example']) {
    const result = await checker.fetchPage(url);
    assert.equal(result.fetch_status, 'POLICY_BLOCKED');
    assert.equal(result.reachable, false);
  }
  assert.equal(fetchCalls, 0);
});

test('redirects from a public site to LinkedIn are blocked before fetching LinkedIn', async () => {
  const requested = [];
  const checker = new WebsiteReachabilityChecker({
    lookupImpl:async()=>[{address:'93.184.216.34',family:4}],
    fetchImpl:async url=>{
      requested.push(String(url));
      return new Response('',{status:302,headers:{location:'https://www.linkedin.com/in/avery-buyer'}});
    }
  });
  const result = await checker.fetchPage('https://buyer.example/team');
  assert.equal(result.fetch_status, 'POLICY_BLOCKED');
  assert.deepEqual(requested, ['https://buyer.example/team']);
});

test('LinkedIn adapter has no browser, login, cookie or page-fetch implementation', async () => {
  const source = await fs.promises.readFile(new URL('../src/enrichment/LinkedInDiscoveryAdapter.js', import.meta.url),'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /cookie|session reuse|captcha|browser automation|page\.goto|playwright|puppeteer/i);
});
