// Provider spend policy shared by the discovery executor, contact research and category evidence.
// FREE_ONLY (stored historically as NO_NEW_PAID_SPEND) never calls a provider with a unit price
// above zero; ALLOW_PAID lets the configured order fall back to paid providers. Whether an empty
// free answer may be retried on a paid provider is a separate opt-in (paid_fallback_on_empty).
export const SPEND_MODES=Object.freeze({FREE_ONLY:'FREE_ONLY',ALLOW_PAID:'ALLOW_PAID'});
export const LEGACY_FREE_ONLY='NO_NEW_PAID_SPEND';
// Providers that cost nothing per query even when no unit price is configured.
export const FREE_PROVIDERS=Object.freeze(['searxng']);
// Paid providers known to the router; any unknown provider is treated as paid too.
export const PAID_PROVIDERS=Object.freeze(['exa','tavily','brave','dataforseo']);
export const FREE_PROVIDER_UNAVAILABLE='PAUSED_FREE_PROVIDER_UNAVAILABLE';

const upper=value=>String(value??'').trim().toUpperCase();
const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});

// Stored settings: anything unknown or missing reads as FREE_ONLY (fail closed).
export function normalizeSpendMode(value){
  return upper(value)===SPEND_MODES.ALLOW_PAID?SPEND_MODES.ALLOW_PAID:SPEND_MODES.FREE_ONLY;
}

// Operator input: only the documented values are accepted.
export function parseSpendModeInput(value){
  const mode=upper(value);
  if(mode===SPEND_MODES.ALLOW_PAID)return SPEND_MODES.ALLOW_PAID;
  if(mode===SPEND_MODES.FREE_ONLY||mode===LEGACY_FREE_ONLY)return SPEND_MODES.FREE_ONLY;
  throw fail('PROVIDER_SPEND_MODE_INVALID');
}

export function spendPolicyFromSettings(settings={}){
  return Object.freeze({provider_spend_mode:normalizeSpendMode(settings?.provider_spend_mode),
    paid_fallback_on_empty:settings?.paid_fallback_on_empty===true});
}

// A provider is paid when its configured unit price is above zero; a provider without a
// configured price is paid unless it is a known free provider.
export function isPaidProvider(provider,unitPrices={}){
  const name=String(provider??'').trim().toLowerCase();
  const key=name.toUpperCase();
  if(unitPrices&&Object.hasOwn(unitPrices,key))return Number(unitPrices[key])>0;
  return !FREE_PROVIDERS.includes(name);
}

// Which reason (if any) forbids paid providers for the next selection.
export function paidBlockReason(policy,{afterEmpty=false}={}){
  if(!policy)return null;
  if(normalizeSpendMode(policy.provider_spend_mode)===SPEND_MODES.FREE_ONLY)return 'FREE_ONLY';
  if(afterEmpty&&policy.paid_fallback_on_empty!==true)return 'EMPTY_RESULT';
  return null;
}

export function searchPauseError(code,details={}){
  return Object.assign(new Error(code),{code,searchPause:true,retryable:false,...details});
}
