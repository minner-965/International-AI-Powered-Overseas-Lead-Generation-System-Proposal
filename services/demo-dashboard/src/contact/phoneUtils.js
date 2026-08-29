import { GENERIC_MARKET_PROFILE, marketProfileForJob } from '../market/marketProfiles.js';
import { phoneService } from '../platform/PhoneService.js';

function profileFrom(value) {
  if (value?.profileKey && Array.isArray(value?.businessSuffixes)) return value;
  if (value?.phoneCountryCode) return {
    ...GENERIC_MARKET_PROFILE,
    ...value,
    countryCode: value.countryCode || 'XX'
  };
  if (value && typeof value === 'object') return marketProfileForJob(value);
  return GENERIC_MARKET_PROFILE;
}

export function normalizePhoneDetailed(value, market = GENERIC_MARKET_PROFILE, options = {}) {
  const profile = profileFrom(market);
  const result = phoneService.normalize(value, {
    countryCode: profile.countryCode,
    phoneCountryCode: profile.phoneCountryCode,
    nationalPhonePrefix: profile.nationalPhonePrefix,
    nationalPhoneLengths: profile.nationalPhoneLengths,
    allowNationalWithoutPrefix: profile.allowNationalWithoutPrefix === true,
    internationalFormat: options.internationalFormat === true
  });
  if (!result) return null;
  return {
    normalized_value: result.compatibility_value,
    normalization_certainty: result.normalization_certainty,
    normalization_status: result.normalization_status,
    country_code: result.country
  };
}

export function normalizePhone(value, market, options) {
  return normalizePhoneDetailed(value, market, options)?.normalized_value || null;
}

export function normalizePhoneWithContext(value, market, options) {
  const result = normalizePhoneDetailed(value, market, options);
  return result || { normalized_value: null, normalization_status: 'INVALID', normalization_certainty: 'INVALID', country_code: null };
}

export function normalizeWhatsApp(value, market) {
  let normalized = null;
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'wa.me') normalized = normalizePhone(url.pathname.split('/').filter(Boolean)[0], market, { internationalFormat: true });
    if (host === 'api.whatsapp.com' || host === 'web.whatsapp.com') {
      normalized = normalizePhone(url.searchParams.get('phone'), market, { internationalFormat: true });
    }
  } catch {
    if (String(value).startsWith('whatsapp://')) {
      try {
        const url = new URL(String(value));
        normalized = normalizePhone(url.searchParams.get('phone'), market, { internationalFormat: true });
      } catch {}
    }
  }
  return normalized ? normalized.replace(/^\+/, '') : null;
}
