const PROFILES = Object.freeze({
  'Beauty & Personal Care': Object.freeze({
    category: 'Beauty & Personal Care',
    searchTerms: ['beauty products', 'cosmetics', 'personal care', 'skincare', 'hair care'],
    evidenceTerms: ['beauty', 'cosmetic', 'personal care', 'skin care', 'skincare', 'fragrance', 'perfume', 'hair care']
  }),
  "Women's Apparel": Object.freeze({
    category: "Women's Apparel",
    productScope: 'WOMENSWEAR',
    searchTerms: ["women's apparel", "women's clothing", 'ladies fashion', 'fashion garments', 'womenswear'],
    evidenceTerms: ['women apparel', "women's apparel", 'womenswear', 'ladies fashion', 'dress', 'skirt', 'garment', 'clothing']
  }),
  "Men's Apparel": Object.freeze({ category: "Men's Apparel", searchTerms: ["men's apparel", "men's clothing", 'menswear', 'fashion garments'], evidenceTerms: ["men's apparel", 'menswear', 'garment', 'clothing'] }),
  "Children's Apparel": Object.freeze({ category: "Children's Apparel", searchTerms: ["children's apparel", "children's clothing", 'kids fashion', 'childrenswear'], evidenceTerms: ["children's apparel", 'childrenswear', 'kids fashion', 'garment', 'clothing'] }),
  Bags: Object.freeze({ category: 'Bags', searchTerms: ['bags', 'handbags', 'fashion bags', 'travel bags', 'bag accessories'], evidenceTerms: ['bags', 'handbags', 'travel bags'] }),
  'Household Goods': Object.freeze({ category: 'Household Goods', productScope: 'GENERAL_MERCHANDISE', searchTerms: ['household goods', 'homeware', 'household products', 'home supplies'], evidenceTerms: ['household', 'homeware', 'home products'] }),
  'General Merchandise': Object.freeze({
    category: 'General Merchandise',
    productScope: 'GENERAL_MERCHANDISE',
    searchTerms: ['general merchandise', 'daily-use goods', 'household goods', 'home and living products', 'non-food products'],
    evidenceTerms: ['general merchandise', 'daily-use goods', 'household goods', 'homeware', 'home and living', 'non-food']
  })
});

export function getProductCategoryProfile(category = '') {
  const name = String(category).trim();
  return PROFILES[name] || Object.freeze({
    category: name,
    searchTerms: [name.toLowerCase(), `${name.toLowerCase()} products`].filter(Boolean),
    evidenceTerms: [name.toLowerCase()].filter(Boolean)
  });
}

export function productScopeForCategory(category = '') {
  const normalized = String(category || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (['WOMENSWEAR','WOMEN_S_APPAREL','WOMENS_APPAREL','DRESSES','TOPS','SKIRTS','TROUSERS','OUTERWEAR','KNITWEAR'].includes(normalized)) {
    return 'WOMENSWEAR';
  }
  if (['GENERAL_MERCHANDISE','HOUSEHOLD_GOODS','DAILY_USE_GOODS','HOMEWARE','HOME_AND_LIVING','NON_FOOD'].includes(normalized)) {
    return 'GENERAL_MERCHANDISE';
  }
  return PROFILES[String(category || '').trim()]?.productScope || null;
}
