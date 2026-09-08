import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { opportunityDimensionsMarkup, businessOpportunityMarkup, isActiveBusinessOpportunity, opportunityPoolSummaryMarkup } from '../public/ui/v3/opportunity-dimensions.js';
import { groupContactCompanies } from '../public/ui/v3/companies.js';

test('MC04 three independent labels preserve active fit despite blocked email and warning', () => {
  const row = { opportunity_pool_band:'GENERAL_RELEVANT',active_opportunity_pool:true,contact_readiness_labels:['PHONE_READY'],email_eligibility:{status:'BLOCKED'},review_flags:['IDENTITY_NOTE'] };
  const html = opportunityDimensionsMarkup(row);
  assert.equal(isActiveBusinessOpportunity(row),true);
  for (const label of ['data-business-opportunity','data-contact-readiness','data-email-eligibility','泛相关','电话就绪','资格待完善','资料提示']) assert.ok(html.includes(label));
  assert.ok(!html.includes('IDENTITY_NOTE'));
  assert.ok(!html.includes('<button'));
});
test('MC04 missing additive projection does not fabricate an opportunity', () => {
  assert.equal(opportunityDimensionsMarkup({tier:'A'}),'');
  assert.equal(isActiveBusinessOpportunity({opportunity_pool_band:'PRECISION'}),false);
  assert.ok(businessOpportunityMarkup({opportunity_pool_band:'PRECISION'}).includes('精准匹配'));
});
test('MC04 broad opportunity with legacy rejected label appears in contact list', () => {
  const rows = [{company_id:'a',country_code:'AE',opportunity_pool_band:'GENERAL_RELEVANT',active_opportunity_pool:true,display_opportunity_status:'NOT_SUITABLE'}];
  assert.equal(groupContactCompanies(rows).length,1);
  assert.equal(groupContactCompanies([{...rows[0],active_opportunity_pool:false}]).length,0);
});
test('MC04 summary uses actual independent counts and unknown placeholder', () => {
  const html = opportunityPoolSummaryMarkup({active:16,contact_ready:12});
  assert.ok(html.includes('16'));assert.ok(html.includes('12'));assert.ok(html.includes('—'));
  assert.equal(opportunityPoolSummaryMarkup(null),'');
});
test('MC04 removes pool confirmation but preserves exact-message send guard and approval hooks', async () => {
  const phase7 = await readFile(new URL('../public/phase7-ui.js',import.meta.url),'utf8');
  const outreach = await readFile(new URL('../public/ui/outreach-workbench.js',import.meta.url),'utf8');
  assert.match(phase7,/function readinessActions\(record\) \{\s+if \(hasOpportunityPool\(record\)\) return '';/);
  for (const hook of ['outreach-send','outreach-approve','outreach-contact-approve']) assert.ok(outreach.includes(hook));
  assert.match(outreach,/row\.send_allowed/);
  assert.match(outreach,/sending_enabled/);
  assert.match(outreach,/row\.eligibility_status==='ELIGIBLE'/);
});
