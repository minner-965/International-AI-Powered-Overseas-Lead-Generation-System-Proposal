import { marketProfileForJob } from './marketProfiles.js';

// Provider geography conversion shared by company verification. Query strategy
// generation belongs exclusively to the versioned frozen search planner.
export function searchCountryCode(country, explicitCode = '') {
  const profile = marketProfileForJob({ country_code: explicitCode, country_name: country });
  return profile.countryCode === 'XX' ? 'ALL' : profile.countryCode;
}
