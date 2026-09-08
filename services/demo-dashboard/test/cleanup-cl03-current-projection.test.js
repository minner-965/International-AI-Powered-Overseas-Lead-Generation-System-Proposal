import test from 'node:test';
import assert from 'node:assert/strict';
import {currentBusinessProjection,HISTORICAL_BUSINESS_FIELDS} from '../src/opportunityPool/currentBusinessProjection.js';
import {EXPORT_COLUMN_ALLOWLISTS} from '../src/dataExchange/exportPolicy.js';

test('CL03 five current bands are not downgraded by historical access or missing contact',()=>{
  for(const band of ['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE']){
    const source={opportunity_pool_band:band,display_opportunity_status:'EVIDENCE_REQUIRED',
      legacy_display_opportunity_status:'EVIDENCE_REQUIRED',supplier_access_band:'LOW',
      product_access_matrix:'UNKNOWN_PRODUCT',readiness:'NEEDS_PRODUCT_EVIDENCE',
      readiness_blockers:['CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'],
      contact_readiness_labels:['NO_CONTACT_FOUND'],email_send_eligibility:{send_authorized:false}};
    const before=JSON.stringify(source);const projected=currentBusinessProjection(source);
    assert.equal(projected.display_opportunity_status,band);
    assert.equal(projected.historical_compatibility.supplier_access_band,'LOW');
    assert.deepEqual(projected.contact_readiness_labels,['NO_CONTACT_FOUND']);
    assert.equal(projected.email_send_eligibility.send_authorized,false);
    for(const key of HISTORICAL_BUSINESS_FIELDS)assert.equal(Object.hasOwn(projected,key),false);
    assert.equal(JSON.stringify(source),before);
  }
});

test('CL03 current exports retain independent states and retire old access columns',()=>{
  for(const columns of Object.values(EXPORT_COLUMN_ALLOWLISTS)){
    for(const key of ['product_access_matrix','readiness','readiness_blockers'])assert.ok(!columns.includes(key));
    for(const key of ['opportunity_pool_band','contact_readiness','email_send_eligibility'])assert.ok(columns.includes(key));
  }
});
