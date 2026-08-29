function upperList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(item => String(item).trim().toUpperCase()).filter(Boolean))];
}

function unpackFeature(profile, key) {
  const raw = profile.features?.[key] || {};
  const value = raw.feature_value || raw.value || raw;
  return {
    values: upperList(value.values),
    coverage: Number(raw.coverage ?? value.coverage ?? 0),
    status: value.status,
    min: Number(value.min),
    max: Number(value.max)
  };
}

function unpackCompanyFact(companyFacts, key) {
  const raw = companyFacts[key] || {};
  return {
    values: upperList(raw.values ?? raw.value),
    evidence_ids: [...new Set((raw.evidence_ids || []).filter(Boolean).map(String))],
    numeric_value: Number(raw.numeric_value ?? raw.value),
    similarity: Number(raw.similarity),
    available: raw.available
  };
}

function overlapFit(company, profile) {
  if (!company.values.length || !profile.values.length) return 0;
  return company.values.some(value => profile.values.includes(value)) ? 1 : 0;
}

function categoricalDimension(company, profile, reasonPrefix) {
  const available = company.evidence_ids.length > 0 && company.values.length > 0 && profile.coverage > 0 && profile.values.length > 0;
  const fit = available ? overlapFit(company, profile) : 0;
  return {
    available,
    fit,
    profile_coverage: profile.coverage,
    evidence_ids: company.evidence_ids,
    reason_code: !available ? `${reasonPrefix}_DATA_MISSING` : fit ? `${reasonPrefix}_MATCH` : `${reasonPrefix}_MISMATCH`
  };
}

export function buildCustomerMatchDimensions({ companyFacts = {}, profile }) {
  if (!profile?.id || !profile.profile_type || !profile.version) {
    const error = new Error('A versioned ICP profile is required');
    error.code = 'ICP_PROFILE_REQUIRED';
    throw error;
  }
  const buyer = categoricalDimension(unpackCompanyFact(companyFacts, 'buyer_types'), unpackFeature(profile, 'buyer_types'), 'BUYER_MODEL');
  const product = categoricalDimension(unpackCompanyFact(companyFacts, 'product_categories'), unpackFeature(profile, 'product_categories'), 'PRODUCT_CATEGORY');
  const market = categoricalDimension(unpackCompanyFact(companyFacts, 'markets'), unpackFeature(profile, 'markets'), 'MARKET');
  const channels = categoricalDimension(unpackCompanyFact(companyFacts, 'channels'), unpackFeature(profile, 'channels'), 'CHANNEL');
  const marketChannelAvailable = market.available || channels.available;
  const marketChannelFit = market.available && channels.available ? (market.fit + channels.fit) / 2 : market.available ? market.fit : channels.fit;
  const marketChannelIds = [...new Set([...market.evidence_ids, ...channels.evidence_ids])];
  const scale = categoricalDimension(unpackCompanyFact(companyFacts, 'company_sizes'), unpackFeature(profile, 'company_sizes'), 'COMPANY_SCALE');
  const distribution = categoricalDimension(unpackCompanyFact(companyFacts, 'distribution_patterns'), unpackFeature(profile, 'distribution_patterns'), 'DISTRIBUTION_PATTERN');

  const commercialCompany = unpackCompanyFact(companyFacts, 'commercial_moq');
  const commercialProfile = unpackFeature(profile, 'commercial_moq');
  const commercialAvailable = commercialCompany.evidence_ids.length > 0 && Number.isFinite(commercialCompany.numeric_value)
    && commercialProfile.coverage > 0 && Number.isFinite(commercialProfile.min) && Number.isFinite(commercialProfile.max);
  const commercialFit = commercialAvailable && commercialCompany.numeric_value >= commercialProfile.min
    && commercialCompany.numeric_value <= commercialProfile.max ? 1 : 0;

  const historicalCompany = unpackCompanyFact(companyFacts, 'historical_win_similarity');
  const historicalProfile = unpackFeature(profile, 'historical_win_similarity');
  const historicalAvailable = profile.profile_type === 'HISTORICAL_CUSTOMER_ICP'
    && historicalCompany.evidence_ids.length > 0 && Number.isFinite(historicalCompany.similarity)
    && historicalProfile.coverage > 0;

  return {
    buyer_business_model_fit: buyer,
    product_category_fit: product,
    market_channel_fit: {
      available: marketChannelAvailable,
      fit: marketChannelFit,
      profile_coverage: Math.max(market.profile_coverage || 0, channels.profile_coverage || 0),
      evidence_ids: marketChannelIds,
      reason_code: !marketChannelAvailable ? 'MARKET_CHANNEL_DATA_MISSING' : marketChannelFit >= 0.5 ? 'MARKET_CHANNEL_MATCH' : 'MARKET_CHANNEL_MISMATCH'
    },
    commercial_moq_fit: {
      available: commercialAvailable,
      fit: commercialFit,
      profile_coverage: commercialProfile.coverage,
      evidence_ids: commercialCompany.evidence_ids,
      reason_code: !commercialAvailable ? 'COMMERCIAL_MOQ_DATA_MISSING' : commercialFit ? 'COMMERCIAL_MOQ_MATCH' : 'COMMERCIAL_MOQ_MISMATCH'
    },
    company_scale_fit: scale,
    distribution_pattern_fit: distribution,
    historical_win_similarity: {
      available: historicalAvailable,
      fit: historicalAvailable ? Math.max(0, Math.min(1, historicalCompany.similarity)) : 0,
      profile_coverage: historicalProfile.coverage,
      evidence_ids: historicalCompany.evidence_ids,
      reason_code: !historicalAvailable ? 'HISTORICAL_WIN_DATA_MISSING' : 'HISTORICAL_WIN_SIMILARITY_CALCULATED'
    }
  };
}
