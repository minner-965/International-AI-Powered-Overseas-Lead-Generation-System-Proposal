import {loadProductTaxonomyCatalog} from '../categoryProcurement/productTaxonomyCatalog.js';

// Display names for the merchant scope picker.
// Markets: country names from ICU (Intl.DisplayNames, built into Node) in zh-CN and en.
// Categories: SIM's reviewed Chinese names for the approved category codes (same wording as
// the export labels), otherwise the Shopify Standard Product Taxonomy zh-CN localization
// (vendored in rules/product-taxonomy/shopify, MIT), otherwise the English name only.
const REVIEWED_ZH=Object.freeze({
  TOPS:'上衣',DRESSES:'连衣裙',SKIRTS:'半身裙',PANTS:'裤装',TROUSERS:'裤装',SHORTS:'短裤',OUTERWEAR:'外套',KNITWEAR:'针织服装',
  WOMENSWEAR:'女装',ACTIVEWEAR:'运动服',SWIMWEAR:'泳装',UNDERWEAR:'内衣',SLEEPWEAR:'睡衣',LOUNGEWEAR:'家居服',
  GENERAL_MERCHANDISE:'百货',DAILY_USE_GOODS:'日用品',HOMEWARE:'家居用品',HOME_AND_LIVING:'家居生活',HOUSEHOLD_GOODS:'家庭用品',NON_FOOD:'非食品类商品'
});
const human=code=>String(code||'').toLowerCase().replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let byCode=null;
function taxonomyByCode(){
  if(byCode)return byCode;
  byCode=new Map();
  for(const row of loadProductTaxonomyCatalog().categories||[]){
    const code=row.suggested_category_code;
    // Keep the shallowest node for a code (the broader, more common name).
    if(code&&(!byCode.has(code)||byCode.get(code).depth>row.depth))byCode.set(code,row);
  }
  return byCode;
}
export function categoryNames(code){
  const key=String(code||'').toUpperCase();
  const node=taxonomyByCode().get(key);
  return{name_en:node?.names?.en||human(key),name_zh:REVIEWED_ZH[key]||node?.names?.zh||null,
    name_source:REVIEWED_ZH[key]?'SIM_REVIEWED':node?.names?.zh?'SHOPIFY_TAXONOMY_ZH_CN':'NONE'};
}
const regionZh=new Intl.DisplayNames(['zh-CN'],{type:'region'});const regionEn=new Intl.DisplayNames(['en'],{type:'region'});
export function marketNames(code,fallback=null){
  const key=String(code||'').toUpperCase();
  let zh=null,en=null;try{zh=regionZh.of(key);en=regionEn.of(key);}catch{}
  return{name_zh:zh&&zh!==key?zh:null,name_en:fallback||(en&&en!==key?en:key)};
}
