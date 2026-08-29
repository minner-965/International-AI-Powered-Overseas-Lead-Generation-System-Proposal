import { DpvZenRulesAdapter } from '../scoring/zenRulesAdapter.js';

export class CooperationFeasibilityEngine {
  constructor({ adapter = new DpvZenRulesAdapter() } = {}) {
    this.adapter = adapter;
  }

  async evaluate(input) {
    return this.adapter.evaluate('cooperationFeasibility', input);
  }

  dispose() {
    this.adapter.dispose();
  }
}

export function targetFitBand(managementMatch) {
  const score = Number(managementMatch);
  if (!Number.isFinite(score)) return 'LOW';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}
