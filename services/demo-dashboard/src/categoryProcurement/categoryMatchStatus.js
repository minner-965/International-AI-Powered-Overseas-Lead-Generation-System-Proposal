const upper=value=>String(value||'').trim().toUpperCase();

export const CATEGORY_MATCH_CONFIRMED_STATUSES=Object.freeze([
  'CATEGORY_MATCH_CONFIRMED',
  'CATEGORY_PROCUREMENT_MATCH',
  'CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE'
]);

export function isCategoryMatchConfirmed(value){
  return CATEGORY_MATCH_CONFIRMED_STATUSES.includes(upper(value));
}

export function projectCategoryMatchStatus(value){
  const status=upper(value);
  if(CATEGORY_MATCH_CONFIRMED_STATUSES.includes(status))return 'CATEGORY_MATCH_CONFIRMED';
  if(['NEEDS_PRODUCT_EVIDENCE','NEEDS_INTERNAL_CATALOG_EVIDENCE'].includes(status))return 'CATEGORY_CONFIRMATION_REQUIRED';
  if(status==='PRODUCT_MISMATCH')return 'CATEGORY_MISMATCH';
  return status||'CATEGORY_CONFIRMATION_REQUIRED';
}
