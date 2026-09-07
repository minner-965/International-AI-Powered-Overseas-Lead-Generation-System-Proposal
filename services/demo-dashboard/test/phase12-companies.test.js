import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companySections, groupContactCompanies, distinctContactChannels, renderContactCompanies } from '../public/ui/v3/companies.js';

test('company detail defines eight distinct sections and preserves all 15 panel hooks',()=>{
  assert.deepEqual(companySections.map(item=>item[0]),['snapshot','category-fit','contacts','opportunity','communication','evidence','activity','records']);
  const keys=companySections.flatMap(item=>item[3]);
  assert.equal(new Set(keys).size,keys.length);
  for(const key of ['overview','product-match','feasibility','matching','scoring','contacts','buying','social','outreach-readiness','outreach-drafts','outreach-messages','evidence','outreach-replies','data-history','history']) assert.ok(keys.includes(key));
});
test('contact-ready groups company categories without named-person gate or Tier fallback',()=>{
  const groups=groupContactCompanies([
    {company_id:'a',company_name:'A',country_code:'AE',product_profile:'WOMENSWEAR',display_opportunity_status:'RECOMMENDED'},
    {company_id:'a',company_name:'A',country_code:'AE',product_profile:'GENERAL_MERCHANDISE',display_opportunity_status:'MANAGEMENT_APPROVED'},
    {company_id:'b',tier:'A',country_code:'AE',display_opportunity_status:'EVIDENCE_REQUIRED'},
    {company_id:'c',country_code:'BD',display_opportunity_status:'RECOMMENDED'},
    {company_id:'d',display_opportunity_status:'HOLD',opportunity_status:'RECOMMENDED'}
  ]);
  assert.equal(groups.length,1);
  assert.deepEqual(groups[0].categories,['WOMENSWEAR','GENERAL_MERCHANDISE']);
});
test('mailboxes deduplicate case-insensitively while preserving channel distinctions',()=>{
  const channels=distinctContactChannels([
    {contact_type:'EMAIL',contact_value_raw:'Sales@Example.test',verification_status:'VALID'},
    {contact_type:'EMAIL',value:'sales@example.test',verification_status:'VALID'},
    {contact_type:'PHONE',value:'+12345'},
    {contact_type:'WHATSAPP',value:'+12345'}
  ]);
  assert.equal(channels.length,3);
  assert.equal(channels[0].value,'Sales@Example.test');
});
test('actual company route aliases normalize to email and phone channels',()=>{
  const channels=distinctContactChannels([{contact_type:'GENERIC_BUSINESS_EMAIL',value:'a@example.test',verification_status:'VALID'},{contact_type:'BUSINESS_PHONE',value:'+123'}]);
  assert.deepEqual(channels.map(item=>item.type),['EMAIL','PHONE']);
  assert.match(renderContactCompanies([{companyId:'a',name:'A',categories:[],channels}]),/data-contact-review/);
});
test('contact-ready escapes evidence and keeps manual channels separate from send controls',()=>{
  const html=renderContactCompanies([{companyId:'a',name:'<script>x</script>',market:'AE',categories:['WOMENSWEAR'],channels:[{type:'EMAIL',value:'sales@example.test',verification_status:'DOMAIN_MX_VERIFIED'},{type:'CONTACT_FORM',value:'https://example.test/contact',verification_status:'PUBLICLY_OBSERVED'}]}]);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Mail domain valid'));
  assert.ok(html.includes('data-contact-review'));
  assert.ok(!html.includes('mailto:'));
  assert.ok(!html.includes('send-one'));
});
test('duplicate mailbox uses latest observed verification, and manual-only company has no email entry',()=>{
  const channels=distinctContactChannels([{contact_type:'EMAIL',value:'a@example.test',verification_status:'VALID',last_verified_at:'2026-01-01'},{contact_type:'EMAIL',value:'A@example.test',verification_status:'INVALID',last_verified_at:'2026-02-01'}]);
  assert.equal(channels[0].verification_status,'INVALID');
  const html=renderContactCompanies([{companyId:'a',name:'A',categories:[],channels:[{type:'PHONE',value:'+123'}]}]);
  assert.doesNotMatch(html,/data-contact-review/);
});
test('empty and degraded contact states do not fabricate channels',()=>{
  assert.match(renderContactCompanies([]),/data-state="empty"/);
  assert.match(renderContactCompanies([{companyId:'a',name:'A',categories:[],error:true}]),/data-state="degraded"/);
  assert.match(renderContactCompanies([{companyId:'a',name:'A',categories:[],channels:[]}]),/data-state="warning"/);
});
test('adapter is read-only, uses existing endpoints and preserves native panels',async()=>{
  const source=await readFile(new URL('../public/ui/v3/companies.js',import.meta.url),'utf8');
  assert.ok(source.includes('/api/opportunities?status=ALL&limit=500'));
  assert.ok(source.includes('/contact-routes'));
  assert.ok(source.includes('workspace.replaceChildren(fragment)'));
  assert.doesNotMatch(source,/method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source,/showModal\(|\.close\(/);
});
test('phone filter disclosure moves original controls and preserves desktop access',async()=>{
  const source=await readFile(new URL('../public/ui/v3/companies.js',import.meta.url),'utf8');
  assert.match(source,/createElement\('details'\)/);
  assert.match(source,/disclosure\.append\(summary,filters\)/);
  assert.match(source,/disclosure\.open = !compact\.matches/);
  assert.doesNotMatch(source,/filters\.cloneNode/);
});
