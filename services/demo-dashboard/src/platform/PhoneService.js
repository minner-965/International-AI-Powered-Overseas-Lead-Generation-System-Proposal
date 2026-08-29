import { parsePhoneNumberFromString } from 'libphonenumber-js';

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function validLegacyLength(digits) {
  return digits.length >= 7 && digits.length <= 15;
}

function normalizedCountry(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

function parseSafely(value, country) {
  try {
    return country ? parsePhoneNumberFromString(value, country) : parsePhoneNumberFromString(value);
  } catch {
    return null;
  }
}

export class PhoneService {
  normalize(rawValue, context = {}) {
    const raw = String(rawValue || '').replace(/\s+/g, ' ').trim();
    let digits = digitsOnly(raw);
    if (!raw || !validLegacyLength(digits)) return null;

    const countryContext = normalizedCountry(context.countryCode);
    const callingCode = digitsOnly(context.phoneCountryCode);
    const hasPlus = raw.startsWith('+');
    const hasInternationalPrefix = raw.startsWith('00');
    const explicitInternational = hasPlus || hasInternationalPrefix || context.internationalFormat === true;
    if (hasInternationalPrefix) digits = digits.slice(2);

    let status = 'AMBIGUOUS_LOCAL';
    let parseInput = null;
    let parseCountry = null;
    if (explicitInternational) {
      status = 'EXPLICIT_INTERNATIONAL';
      parseInput = `+${digits}`;
    } else if (callingCode && digits.startsWith(callingCode)) {
      status = 'COUNTRY_CONTEXT_MATCH';
      parseInput = `+${digits}`;
    } else {
      const prefix = String(context.nationalPhonePrefix || '');
      const allowedLengths = context.nationalPhoneLengths || [];
      const prefixedLocal = prefix && raw.startsWith(prefix);
      const unprefixedNational = context.allowNationalWithoutPrefix === true;
      if (countryContext && callingCode && allowedLengths.includes(digits.length) && (prefixedLocal || unprefixedNational)) {
        status = prefixedLocal ? 'COUNTRY_CONTEXT_LOCAL_PREFIX' : 'COUNTRY_CONTEXT_NATIONAL';
        parseInput = raw;
        parseCountry = countryContext;
      }
    }

    const parsed = parseInput ? parseSafely(parseInput, parseCountry) : null;
    const normalizedE164 = parsed?.number || null;
    const compatibilityValue = normalizedE164 || (status === 'AMBIGUOUS_LOCAL' ? digits : `+${digits}`);
    return {
      raw_value: raw,
      normalized_e164: normalizedE164,
      compatibility_value: compatibilityValue,
      country: parsed?.country || (status === 'AMBIGUOUS_LOCAL' ? null : countryContext),
      is_possible: parsed ? parsed.isPossible() : false,
      is_valid: parsed ? parsed.isValid() : false,
      normalization_status: status,
      normalization_certainty: status
    };
  }
}

export const phoneService = new PhoneService();
