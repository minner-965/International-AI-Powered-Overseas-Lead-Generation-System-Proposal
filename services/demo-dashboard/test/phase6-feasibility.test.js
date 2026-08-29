import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CooperationFeasibilityEngine, targetFitBand } from '../src/enrichment/cooperationFeasibilityEngine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ruleSource = fs.readFileSync(path.join(root, 'rules/cooperation-feasibility/v1/decision.json'), 'utf8');

const states = (overrides = {}) => ({
  external_supplier_openness:{ state:'UNKNOWN',evidence_ids:[],unknown_fields:['supplier_openness'] },
  supplier_onboarding_accessibility:{ state:'UNKNOWN',evidence_ids:[],unknown_fields:['supplier_onboarding'] },
  buying_procurement_accessibility:{ state:'UNKNOWN',evidence_ids:[],unknown_fields:['buying_access'] },
  product_category_buying_fit:{ state:'UNKNOWN',evidence_ids:[],unknown_fields:['product_fit'] },
  commercial_operational_feasibility:{ state:'UNKNOWN',evidence_ids:[],unknown_fields:['operations'] },
  supplier_lock_in_barrier:{ state:'UNKNOWN',evidence_ids:[],unknown_fields:['supplier_lock_in'] },
  ...overrides
});

async function evaluate(overrides = {}) {
  const engine = new CooperationFeasibilityEngine();
  try {
    return await engine.evaluate({
      target_fit:'HIGH',relationship_status:'NEW_PROSPECT',
      has_verified_decision_route:true,has_usable_contact_route:true,has_traceable_evidence:true,
      role_review_required:false,dimensions:states(),...overrides
    });
  } finally { engine.dispose(); }
}

test('dimension weights total 100 and do not include company size or a hidden composite score', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'rules/cooperation-feasibility/v1/metadata.json'), 'utf8'));
  assert.equal(Object.values(metadata.dimensions).reduce((sum,value)=>sum+value,0), 100);
  assert.doesNotMatch(ruleSource, /company_size|brand_prestige/i);
  assert.doesNotMatch(ruleSource, /dpv_score|mexico_historical_match|management_match/i);
});

test('unknown evidence remains explicit and does not claim closed procurement', async () => {
  const result = await evaluate();
  assert.equal(result.cooperation_feasibility_score, 48);
  assert.equal(result.feasibility_band, 'LOW_MEDIUM');
  assert.equal(result.dimension_breakdown.supplier_onboarding_accessibility.state, 'UNKNOWN');
  assert.equal(result.dimension_breakdown.supplier_lock_in_barrier.state, 'UNKNOWN');
  assert.ok(result.missing_evidence.includes('supplier_onboarding'));
  assert.ok(result.missing_evidence.includes('supplier_lock_in'));
});

test('public supplier onboarding and verified procurement access increase feasibility', async () => {
  const open = await evaluate({ dimensions:states({
    external_supplier_openness:{ state:'OPEN',evidence_ids:['ev-1'],unknown_fields:[] },
    supplier_onboarding_accessibility:{ state:'OPEN',evidence_ids:['ev-2'],unknown_fields:[] },
    buying_procurement_accessibility:{ state:'DEPARTMENT_VERIFIED',evidence_ids:['ev-3'],unknown_fields:[] },
    product_category_buying_fit:{ state:'HIGH',evidence_ids:['ev-4'],unknown_fields:[] },
    commercial_operational_feasibility:{ state:'SUPPORTED',evidence_ids:['ev-5'],unknown_fields:[] },
    supplier_lock_in_barrier:{ state:'LOW',evidence_ids:['ev-6'],unknown_fields:[] }
  }) });
  assert.equal(open.cooperation_feasibility_score, 95);
  assert.equal(open.feasibility_band, 'HIGH');
  assert.equal(open.access_opportunity_matrix, 'HIGH_FIT_HIGH_ACCESS');
  assert.equal(open.opportunity_readiness, 'SALES_READY');
  assert.deepEqual(open.missing_evidence, []);
});

test('fixed supplier and invitation-only evidence lower access for a high-fit enterprise', async () => {
  const closed = await evaluate({
    company_size:'ENTERPRISE',
    dimensions:states({
      external_supplier_openness:{ state:'CLOSED',evidence_ids:['ev-closed'],unknown_fields:[] },
      supplier_onboarding_accessibility:{ state:'INVITATION_ONLY',evidence_ids:['ev-invite'],unknown_fields:[] },
      buying_procurement_accessibility:{ state:'CLOSED',evidence_ids:['ev-central'],unknown_fields:[] },
      product_category_buying_fit:{ state:'HIGH',evidence_ids:['ev-fit'],unknown_fields:[] },
      commercial_operational_feasibility:{ state:'BARRIER',evidence_ids:['ev-gate'],unknown_fields:[] },
      supplier_lock_in_barrier:{ state:'HIGH',evidence_ids:['ev-lock'],unknown_fields:[] }
    })
  });
  assert.equal(closed.cooperation_feasibility_score, 30);
  assert.equal(closed.feasibility_band, 'LOW');
  assert.equal(closed.access_opportunity_matrix, 'HIGH_FIT_LOW_ACCESS');
  assert.equal(closed.opportunity_readiness, 'STRATEGIC_LONG_SHOT');
});

test('company size alone has no effect on cooperation feasibility', async () => {
  const small = await evaluate({ company_size:'SMALL' });
  const enterprise = await evaluate({ company_size:'ENTERPRISE' });
  assert.equal(small.cooperation_feasibility_score, enterprise.cooperation_feasibility_score);
  assert.deepEqual(small.dimension_breakdown, enterprise.dimension_breakdown);
});

test('relationship status takes priority over ordinary sales readiness', async () => {
  const existing = await evaluate({ relationship_status:'INTERNAL_EXISTING_CUSTOMER' });
  const suppressed = await evaluate({ relationship_status:'SUPPRESSED' });
  const historical = await evaluate({ relationship_status:'HISTORICAL_CONTACTED_LEAD' });
  assert.equal(existing.opportunity_readiness, 'EXISTING_CUSTOMER');
  assert.equal(suppressed.opportunity_readiness, 'SUPPRESSED');
  assert.equal(historical.opportunity_readiness, 'HISTORICAL_REVIEW');
});

test('readiness separates missing buyer, missing contact and weak evidence', async () => {
  assert.equal((await evaluate({ has_verified_decision_route:false })).opportunity_readiness, 'NEEDS_DECISION_MAKER');
  assert.equal((await evaluate({ has_usable_contact_route:false })).opportunity_readiness, 'NEEDS_CONTACT_ROUTE');
  assert.equal((await evaluate({ has_traceable_evidence:false })).opportunity_readiness, 'NEEDS_VERIFICATION');
  assert.equal((await evaluate({ role_review_required:true })).opportunity_readiness, 'NEEDS_VERIFICATION');
});

test('target fit band uses Management Match thresholds without changing its value', () => {
  assert.equal(targetFitBand(60), 'HIGH');
  assert.equal(targetFitBand(59.99), 'MEDIUM');
  assert.equal(targetFitBand(35), 'MEDIUM');
  assert.equal(targetFitBand(34.99), 'LOW');
  assert.equal(targetFitBand(null), 'LOW');
});
