import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOpportunityQuery } from '../public/opportunity-ui.js';
import { opportunityDimensionsMarkup } from '../public/ui/v3/opportunity-dimensions.js';
import { overviewModel } from '../public/ui/v3/overview.js';

test('CL03 current opportunity views expose all five bands without retired admission states', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const band of ['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE']) {
    assert.match(html,new RegExp(`data-opportunity-status="${band}"`));
  }
  assert.doesNotMatch(html,/data-opportunity-status="(?:RECOMMENDED|EVIDENCE_REQUIRED)"/);
  assert.doesNotMatch(html,/name="(?:readiness|product_access_matrix|cooperation_matrix)"/);
  assert.match(html,/<option value="ACTIVE" selected>/);
  const jobBlocker = html.match(/<select id="research-jobs-blocker"[\s\S]*?<\/select>/)?.[0] || '';
  assert.match(jobBlocker,/<option value="EVIDENCE_REQUIRED">等待资料 \/ Waiting for evidence<\/option>/);
  assert.doesNotMatch(jobBlocker,/value="EXPLORATORY"/);
  assert.doesNotMatch(html,/aria-label="待补资料机会 Evidence Required opportunities"/);
});

test('CL03 current request excludes retired gates while preserving current band', () => {
  const query = buildOpportunityQuery({status:'GENERAL_RELEVANT',readiness:'SALES_READY',product_access_matrix:'LOW_PRODUCT',cooperation_matrix:'LOW_PRIORITY'});
  assert.equal(query.get('status'),'GENERAL_RELEVANT');
  for(const key of ['readiness','product_access_matrix','cooperation_matrix'])assert.equal(query.has(key),false);
});

test('CL03 positive membership remains independent of contact, send and old recommendation', () => {
  const rows = ['PRECISION','RELEVANT','GENERAL_RELEVANT'].map((band,i)=>({company_id:String(i),country_code:'AE',opportunity_pool_band:band,active_opportunity_pool:true,contact_readiness_labels:['NO_CONTACT_FOUND'],email_send_eligibility:'BLOCKED',display_opportunity_status:band,historical_compatibility:{system_recommendation_status:'NOT_SUITABLE'}}));
  assert.equal(overviewModel({opportunities:rows,getStatus:r=>r.display_opportunity_status}).recommended,3);
  for(const row of rows){
    const html=opportunityDimensionsMarkup(row);
    assert.match(html,/data-business-opportunity/);
    assert.match(html,/No contact found/);
    assert.match(html,/Not eligible/);
  }
});
