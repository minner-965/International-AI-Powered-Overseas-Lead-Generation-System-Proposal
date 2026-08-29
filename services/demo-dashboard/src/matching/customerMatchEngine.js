import { DpvZenRulesAdapter } from '../scoring/zenRulesAdapter.js';
import { buildCustomerMatchDimensions } from './customerMatchFacts.js';

export class CustomerMatchEngine {
  constructor({ adapter = new DpvZenRulesAdapter() } = {}) {
    this.adapter = adapter;
  }

  async evaluate({ companyFacts, profile, dpvScore = 0 }) {
    const dimensions = buildCustomerMatchDimensions({ companyFacts, profile });
    const result = await this.adapter.evaluate('customerMatch', {
      dimensions,
      reference_profile_type: profile.profile_type,
      profile_version: profile.version,
      profile_feature_coverage: Number(profile.feature_coverage || 0),
      dpv_score: Number(dpvScore || 0)
    });
    return { ...result, match_score: result.match_score ?? null };
  }

  dispose() {
    this.adapter.dispose();
  }
}

export function opportunityMatrixLabel({ dpvScore, matchScore }) {
  const dpvHigh = Number(dpvScore || 0) >= 55;
  const matchHigh = matchScore != null && Number(matchScore) >= 60;
  if (dpvHigh && matchHigh) return 'PRIORITY_OPPORTUNITY';
  if (dpvHigh) return 'STRATEGIC_MANUAL_REVIEW';
  if (matchHigh) return 'EVIDENCE_GAP_REVIEW';
  return 'LOWER_PRIORITY';
}
