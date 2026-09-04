const pair = (zh, en) => [zh, en];
const normalized = value => String(value || '').trim().toUpperCase();

const bandLabels = Object.freeze({
  VERY_HIGH: pair('很高', 'Very high'),
  HIGH: pair('高', 'High'),
  MEDIUM: pair('中', 'Medium'),
  LOW: pair('低', 'Low'),
  VERY_LOW: pair('很低', 'Very low'),
  UNKNOWN: pair('类目资料待核验', 'Category evidence required')
});

const categoryProcurementStatusLabels = Object.freeze({
  CATEGORY_PROCUREMENT_MATCH: pair('品类采购匹配', 'Category procurement match'),
  CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE: pair('品类匹配，采购模式待确认', 'Category match; buying evidence required'),
  WEAK_CATEGORY_MATCH: pair('品类匹配较弱', 'Weak category match'),
  PRODUCT_MISMATCH: pair('已确认品类不匹配', 'Confirmed category mismatch'),
  NEEDS_PRODUCT_EVIDENCE: pair('需补充客户品类资料', 'Customer category evidence required'),
  NEEDS_INTERNAL_CATALOG_EVIDENCE: pair('历史状态（现按批准类目）', 'Legacy state (approved category now applies)'),
  INELIGIBLE_BUYER_MODEL: pair('客户模式不符合', 'Ineligible buyer model'),
  UNKNOWN: pair('品类采购关系待确认', 'Category procurement relationship to confirm')
});

const buyerBusinessModelLabels = Object.freeze({
  DIRECT_END_BUYER: pair('终端零售买家', 'Direct end buyer'),
  DISTRIBUTION_BUYER: pair('渠道采购客户', 'Distribution buyer'),
  UNCLEAR_INTERMEDIARY: pair('渠道模式待确认', 'Channel model to confirm'),
  EXCLUDED_INTERMEDIARY: pair('已排除中间人', 'Excluded intermediary'),
  UNKNOWN: pair('客户采购模式待确认', 'Buyer model to confirm')
});

const buyerSubtypeLabels = Object.freeze({
  CHAIN_RETAILER: pair('连锁零售商', 'Chain retailer'),
  DEPARTMENT_STORE: pair('百货商场', 'Department store'),
  SUPERMARKET_HYPERMARKET: pair('超市 / 大卖场', 'Supermarket / hypermarket'),
  LIFESTYLE_RETAILER: pair('生活方式零售商', 'Lifestyle retailer'),
  ORGANIZED_ECOM_RETAILER: pair('组织化电商零售商', 'Organized e-commerce retailer'),
  IMPORTER: pair('进口商', 'Importer'),
  WHOLESALER: pair('批发商', 'Wholesaler'),
  DISTRIBUTOR: pair('经销商', 'Distributor'),
  GENERAL_TRADING: pair('综合贸易商', 'General trading company'),
  SOURCING_AGENT: pair('采购代理', 'Sourcing agent'),
  BROKER: pair('经纪中间人', 'Broker'),
  OEM_ONLY: pair('仅承接代工', 'OEM only'),
  OTHER: pair('其他客户类型', 'Other buyer type'),
  UNKNOWN: pair('客户类型待确认', 'Buyer subtype to confirm')
});

const productOpportunityStatusLabels = Object.freeze({
  READY: pair('历史状态（现按商品类目评估）', 'Legacy state (category-level assessment now applies)'),
  SKU_READY: pair('历史状态（现按商品类目评估）', 'Legacy state (category-level assessment now applies)'),
  PARTIAL_INTERNAL_CATALOG: pair('历史状态（现按商品类目评估）', 'Legacy state (category-level assessment now applies)'),
  SKU_PARTIAL: pair('历史状态（现按商品类目评估）', 'Legacy state (category-level assessment now applies)'),
  NO_REAL_CANDIDATE: pair('历史状态（现按商品类目评估）', 'Legacy state (category-level assessment now applies)'),
  NO_EXACT_SKU: pair('按商品类目评估', 'Category-level assessment'),
  INTERNAL_CATALOG_UPLOAD_REQUIRED: pair('历史状态（无需商品补充任务）', 'Legacy state (no catalog task)'),
  NOT_REQUIRED: pair('按商品类目评估', 'Category-level assessment'),
  CATEGORY_SCOPE_QUALIFIED: pair('已符合批准类目', 'Approved category qualified'),
  OUT_OF_SCOPE: pair('不在公司类目范围', 'Out of scope'),
  NOT_RUN_GATE_FAILED: pair('品类采购门槛未通过', 'Category procurement gate not passed'),
  UNKNOWN: pair('商品类目机会待评估', 'Product category opportunity to assess')
});

const supplierAccessBandLabels = Object.freeze({
  HIGH: pair('供应商准入较高', 'High supplier access'),
  MEDIUM: pair('供应商准入中等', 'Medium supplier access'),
  LOW_MEDIUM: pair('供应商准入中低', 'Low-medium supplier access'),
  LOW: pair('供应商准入较低', 'Low supplier access'),
  UNKNOWN: pair('供应商准入待确认', 'Supplier access to confirm')
});

const typeLabels = Object.freeze({
  DIRECT_MATCH: pair('直接匹配', 'Direct match'),
  ADJACENT_MATCH: pair('相邻品类匹配', 'Adjacent match'),
  WEAK_MATCH: pair('弱匹配', 'Weak match'),
  NO_MATCH: pair('暂未匹配', 'No match'),
  UNKNOWN: pair('待确认', 'To confirm')
});

const gapLabels = Object.freeze({
  CONFIRMED_GAP: pair('已确认产品缺口', 'Confirmed product gap'),
  POSSIBLE_GAP: pair('可能存在产品缺口', 'Possible product gap'),
  UNKNOWN: pair('产品缺口待确认', 'Product gap to confirm')
});

const gapTypeLabels = Object.freeze({
  CATEGORY_GAP: pair('品类缺口', 'Category gap'),
  PRICE_POSITIONING_GAP: pair('价格定位缺口', 'Price-positioning gap'),
  ATTRIBUTE_GAP: pair('产品属性缺口', 'Product-attribute gap'),
  CERTIFICATION_GAP: pair('认证资料缺口', 'Certification gap'),
  MOQ_GAP: pair('起订量缺口', 'MOQ gap'),
  ORDER_FORMAT_GAP: pair('订单形式缺口', 'Order-format gap'),
  SOURCING_MODEL_GAP: pair('采购模式缺口', 'Sourcing-model gap')
});

const dimensionLabels = Object.freeze({
  TARGET_CATEGORY_PROCUREMENT_EVIDENCE: pair('目标品类采购依据', 'Target category procurement evidence'),
  BUYER_BUSINESS_MODEL_FIT: pair('客户采购模式匹配', 'Buyer business model fit'),
  ASSORTMENT_DEPTH_CATEGORY_IMPORTANCE: pair('产品组合深度与品类重要性', 'Assortment depth and category importance'),
  EXTERNAL_SOURCING_IMPORT_EVIDENCE: pair('外部采购与进口依据', 'External sourcing and import evidence'),
  RECENT_CATEGORY_ACTIVITY: pair('近期品类活动', 'Recent category activity'),
  CATEGORY_OVERLAP: pair('品类重合度', 'Category overlap'),
  ASSORTMENT_RELEVANCE: pair('产品组合相关性', 'Assortment relevance'),
  ASSORTMENT_DEPTH_RELEVANCE: pair('产品组合深度与相关性', 'Assortment depth and relevance'),
  ASSORTMENT_DEPTH: pair('产品组合深度与相关性', 'Assortment depth and relevance'),
  COMMERCIAL_POSITIONING_PRICE_BAND: pair('商业定位与价格区间', 'Commercial positioning and price band'),
  PRICE_BAND_FIT: pair('商业定位与价格区间', 'Commercial positioning and price band'),
  PRODUCT_ATTRIBUTE_SPECIFICATION_FIT: pair('产品属性与规格匹配', 'Product attribute and specification fit'),
  ATTRIBUTE_SPECIFICATION_FIT: pair('产品属性与规格匹配', 'Product attribute and specification fit'),
  ATTRIBUTE_FIT: pair('产品属性与规格匹配', 'Product attribute and specification fit'),
  MOQ_ORDER_FORMAT_COMPATIBILITY: pair('起订量与订单形式', 'MOQ and order-format compatibility'),
  MOQ_FIT: pair('起订量与订单形式', 'MOQ and order-format compatibility'),
  IMPORT_SOURCING_MODEL_FIT: pair('进口与采购模式', 'Import and sourcing model fit'),
  SOURCING_MODEL_FIT: pair('进口与采购模式', 'Import and sourcing model fit'),
  RECENT_PRODUCT_SIGNAL: pair('近期产品信号', 'Recent product signal'),
  RECENT_PRODUCT_BUYING_SIGNAL: pair('近期产品与采购信号', 'Recent product and buying signal')
});

const taxonomyLabels = Object.freeze({
  WOMENSWEAR: pair('全品类女装', "Full-category Women's Apparel"),
  GENERAL_MERCHANDISE: pair('日用百货', 'General Merchandise'),
  TOPS: pair('上衣', 'Tops'), BLOUSE: pair('女式衬衫', 'Blouses'), BLOUSES: pair('女式衬衫', 'Blouses'),
  DRESSES: pair('连衣裙', 'Dresses'), SKIRTS: pair('半身裙', 'Skirts'), TROUSERS: pair('女裤', 'Trousers'),
  KNITWEAR: pair('针织女装', 'Knitwear'), OUTERWEAR: pair('女式外套', 'Outerwear'),
  SETS: pair('女装套装', 'Womenswear sets'), BASIC_APPAREL: pair('基础女装', 'Basic apparel'),
  HOUSEHOLD: pair('家居用品', 'Household'), HOME_LIVING: pair('家居生活', 'Home and living'),
  KITCHEN: pair('厨房用品', 'Kitchen'), BATH: pair('卫浴用品', 'Bath'), STORAGE: pair('收纳用品', 'Storage'),
  CLEANING: pair('清洁用品', 'Cleaning'), PET: pair('宠物用品', 'Pet'),
  PERSONAL_ACCESSORIES: pair('个人用品', 'Personal accessories'), DAILY_USE_GOODS: pair('日用商品', 'Daily-use goods')
});

const reasonLabels = Object.freeze({
  EXACT_CATEGORY_OVERLAP: pair('与现有产品品类直接重合', 'Direct overlap with current product categories'),
  EXACT_SUBCATEGORY_OVERLAP: pair('与现有产品子品类直接重合', 'Direct overlap with current product subcategories'),
  PARENT_CATEGORY_OVERLAP: pair('与现有产品上级品类重合', 'Overlap with a current parent category'),
  ADJACENT_CATEGORY_OVERLAP: pair('与现有产品属于相邻品类', 'Adjacent to a current product category'),
  NO_CATEGORY_OVERLAP: pair('暂未发现品类重合', 'No category overlap found'),
  ASSORTMENT_DEPTH_SUPPORTED: pair('公开产品组合支持该匹配', 'Published assortment supports this match'),
  PRICE_BAND_SUPPORTED: pair('公开价格信息支持该匹配', 'Published price information supports this match'),
  PRICE_BAND_UNKNOWN: pair('公开价格信息待补充', 'Published price information required'),
  ATTRIBUTE_FIT_SUPPORTED: pair('产品属性与规格存在重合', 'Product attributes and specifications overlap'),
  MOQ_COMPATIBLE: pair('订单形式具备兼容依据', 'Order format has compatibility evidence'),
  MOQ_UNKNOWN: pair('起订量与订单形式待确认', 'MOQ and order format require confirmation'),
  IMPORT_SOURCING_SUPPORTED: pair('公开资料支持外部采购模式', 'Published sources support external sourcing'),
  RECENT_PRODUCT_SIGNAL: pair('发现近期产品信息', 'Recent product information found'),
  ASSORTMENT_RELEVANCE_SUPPORTED: pair('公开产品组合与批准类目相关', 'Published assortment is relevant to the approved category'),
  ASSORTMENT_RELEVANCE_MISMATCH: pair('公开产品组合与批准类目不匹配', 'Published assortment does not match the approved category'),
  IMPORT_SOURCING_MODEL_SUPPORTED: pair('公开资料支持进口或外部采购模式', 'Published sources support an import or external-sourcing model'),
  RECENT_PRODUCT_BUYING_SIGNAL_SUPPORTED: pair('公开资料显示近期产品或采购活动', 'Published sources show recent product or buying activity'),
  ASSORTMENT_RELEVANCE_UNKNOWN: pair('公开产品组合相关性待确认', 'Assortment relevance requires confirmation'),
  COMMERCIAL_POSITIONING_PRICE_BAND_UNKNOWN: pair('价格定位兼容性待确认', 'Price-positioning compatibility requires confirmation'),
  ATTRIBUTE_SPECIFICATION_FIT_UNKNOWN: pair('产品属性与规格兼容性待确认', 'Attribute and specification compatibility requires confirmation'),
  MOQ_ORDER_FORMAT_COMPATIBILITY_UNKNOWN: pair('起订量与订单形式兼容性待确认', 'MOQ and order-format compatibility requires confirmation'),
  COMMERCIAL_POSITIONING_PRICE_BAND_OPTIONAL_UNTIL_INTEREST: pair('已有公开资料时参考；无资料则跳过，意向后由老板沟通', 'Use existing public facts when available; otherwise skip until management discusses it after interest'),
  ATTRIBUTE_SPECIFICATION_FIT_OPTIONAL_UNTIL_INTEREST: pair('无需前期补充；客户有意向后由老板沟通', 'No pre-contact enrichment required; management discusses it after interest'),
  MOQ_ORDER_FORMAT_OPTIONAL_UNTIL_INTEREST: pair('无需前期补充；客户有意向后由老板沟通', 'No pre-contact enrichment required; management discusses it after interest'),
  IMPORT_SOURCING_MODEL_FIT_UNKNOWN: pair('进口与采购模式兼容性待确认', 'Import and sourcing model compatibility requires confirmation'),
  RECENT_PRODUCT_BUYING_SIGNAL_UNKNOWN: pair('近期产品与采购信号待确认', 'Recent product and buying signals require confirmation'),
  PRODUCT_EVIDENCE_MISSING: pair('公开产品资料待补充', 'Public product evidence required')
});

const catalogStatusLabels = Object.freeze({
  CURRENT_CONFIRMED: pair('当前商品已确认', 'Current product confirmed'),
  HISTORICAL_ORDER_SUPPORTED: pair('历史订单资料支持', 'Supported by historical order records'),
  REFERENCE_ONLY: pair('仅供产品参考', 'Product reference only'),
  REVIEW: pair('商品状态待复核', 'Product status under review'),
  UNKNOWN: pair('商品状态待确认', 'Product status to confirm')
});

const sourceClassificationLabels = Object.freeze({
  CURRENT_CATALOG: pair('当前商品目录', 'Current product catalog'),
  HISTORICAL_ORDER: pair('历史订单资料', 'Historical order record'),
  PRODUCT_MASTER: pair('公司商品库', 'Company product catalog'),
  REFERENCE_ONLY: pair('参考商品资料', 'Reference product record'),
  UNKNOWN: pair('商品来源待确认', 'Product source to confirm')
});

const productAccessMatrixLabels = Object.freeze({
  DIRECT_BUYER_HIGH_PRODUCT_HIGH_ACCESS: pair('终端买家 · 高类目评分 · 高准入', 'Direct buyer · high category score · high access'),
  DIRECT_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS: pair('终端买家 · 高类目评分 · 中等准入', 'Direct buyer · high category score · medium access'),
  DIRECT_BUYER_HIGH_PRODUCT_LOW_ACCESS: pair('终端买家 · 高类目评分 · 低准入', 'Direct buyer · high category score · low access'),
  DISTRIBUTION_BUYER_HIGH_PRODUCT_HIGH_ACCESS: pair('渠道买家 · 高类目评分 · 高准入', 'Distribution buyer · high category score · high access'),
  DISTRIBUTION_BUYER_HIGH_PRODUCT_MEDIUM_ACCESS: pair('渠道买家 · 高类目评分 · 中等准入', 'Distribution buyer · high category score · medium access'),
  DISTRIBUTION_BUYER_HIGH_PRODUCT_LOW_ACCESS: pair('渠道买家 · 高类目评分 · 低准入', 'Distribution buyer · high category score · low access'),
  HIGH_PRODUCT_HIGH_ACCESS: pair('类目评分高且易进入', 'High category score, high access'),
  HIGH_PRODUCT_MEDIUM_ACCESS: pair('类目评分高且进入条件一般', 'High category score, medium access'),
  HIGH_PRODUCT_LOW_ACCESS: pair('类目评分高但较难进入', 'High category score, low access'),
  MEDIUM_PRODUCT_HIGH_ACCESS: pair('类目评分中等且易进入', 'Medium category score, high access'),
  MEDIUM_PRODUCT_MEDIUM_ACCESS: pair('类目评分中等且进入条件一般', 'Medium category score, medium access'),
  LOW_PRODUCT: pair('类目评分较低', 'Low category score'),
  UNKNOWN_PRODUCT: pair('类目资料待核验', 'Category evidence required'),
  INELIGIBLE_BUYER_MODEL: pair('客户模式不符合', 'Ineligible buyer model')
});

const label = (map, value, fallback = pair('待确认', 'To confirm')) => map[normalized(value)] || fallback;

export const productMatchBandLabel = value => label(bandLabels, value, bandLabels.UNKNOWN);
export const categoryProcurementBandLabel = productMatchBandLabel;
export const categoryProcurementStatusLabel = value => label(categoryProcurementStatusLabels, value, categoryProcurementStatusLabels.UNKNOWN);
export const buyerBusinessModelLabel = value => label(buyerBusinessModelLabels, value, buyerBusinessModelLabels.UNKNOWN);
export const buyerSubtypeLabel = value => label(buyerSubtypeLabels, value, buyerSubtypeLabels.UNKNOWN);
export const productOpportunityStatusLabel = value => label(productOpportunityStatusLabels, value, productOpportunityStatusLabels.UNKNOWN);
export const supplierAccessBandLabel = value => label(supplierAccessBandLabels, value, supplierAccessBandLabels.UNKNOWN);
export const productMatchTypeLabel = value => label(typeLabels, value, typeLabels.UNKNOWN);
export const productGapStatusLabel = value => label(gapLabels, value, gapLabels.UNKNOWN);
export const productGapTypeLabel = value => label(gapTypeLabels, value, pair('其他产品缺口', 'Other product gap'));
export const productMatchDimensionLabel = value => label(dimensionLabels, value, pair('其他产品评估项', 'Other product assessment'));
export const productTaxonomyLabel = value => label(taxonomyLabels, value);
export const productMatchReasonLabel = value => label(reasonLabels, value, pair('评估依据待确认', 'Assessment reason to confirm'));
export const productCatalogStatusLabel = value => label(catalogStatusLabels, value, catalogStatusLabels.UNKNOWN);
export const productSourceClassificationLabel = value => label(sourceClassificationLabels, value, sourceClassificationLabels.UNKNOWN);
export const productAccessMatrixLabel = value => label(productAccessMatrixLabels, value);

export const productMatchBandTone = value => ({
  VERY_HIGH:'active', HIGH:'active', MEDIUM:'review', LOW:'aging', VERY_LOW:'rejected', UNKNOWN:'unknown'
}[normalized(value)] || 'unknown');

export const productGapTone = value => ({
  CONFIRMED_GAP:'rejected', POSSIBLE_GAP:'review', UNKNOWN:'unknown'
}[normalized(value)] || 'unknown');

export const categoryProcurementStatusTone = value => ({
  CATEGORY_PROCUREMENT_MATCH:'active', CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE:'review',
  WEAK_CATEGORY_MATCH:'aging', PRODUCT_MISMATCH:'rejected', NEEDS_PRODUCT_EVIDENCE:'unknown',
  NEEDS_INTERNAL_CATALOG_EVIDENCE:'review', INELIGIBLE_BUYER_MODEL:'rejected', UNKNOWN:'unknown'
}[normalized(value)] || 'unknown');

export const buyerBusinessModelTone = value => ({
  DIRECT_END_BUYER:'active', DISTRIBUTION_BUYER:'review', UNCLEAR_INTERMEDIARY:'unknown',
  EXCLUDED_INTERMEDIARY:'rejected', UNKNOWN:'unknown'
}[normalized(value)] || 'unknown');

export const productOpportunityStatusTone = value => ({
  READY:'active', SKU_READY:'active', PARTIAL_INTERNAL_CATALOG:'review', SKU_PARTIAL:'review',
  NO_REAL_CANDIDATE:'active', NO_EXACT_SKU:'active', INTERNAL_CATALOG_UPLOAD_REQUIRED:'active',
  NOT_REQUIRED:'active',CATEGORY_SCOPE_QUALIFIED:'active',
  OUT_OF_SCOPE:'rejected', NOT_RUN_GATE_FAILED:'unknown', UNKNOWN:'unknown'
}[normalized(value)] || 'unknown');

export const supplierAccessBandTone = value => ({
  HIGH:'active', MEDIUM:'review', LOW_MEDIUM:'aging', LOW:'rejected', UNKNOWN:'unknown'
}[normalized(value)] || 'unknown');

export const productMatchScore = result => {
  const value = result?.category_procurement_match_score ?? result?.score ?? result?.product_match_score;
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
};

export const categoryProcurementScore = productMatchScore;

export const productMatchResultId = result => result?.category_procurement_match_result_id || result?.result_id || result?.id || result?.product_match_result_id || '';

export const productMatchProfile = result => normalized(result?.product_profile || result?.profile);

export const categoryProcurementProfile = productMatchProfile;

export function productMatchItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.items, payload?.results, payload?.product_matches, payload?.profiles]) if (Array.isArray(value)) return value;
  for (const value of [payload?.result, payload?.product_match]) if (value && typeof value === 'object') return [value];
  return payload && typeof payload === 'object' && productMatchProfile(payload) ? [payload] : [];
}

export function categoryProcurementItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.items, payload?.results, payload?.result, payload?.category_procurement_matches, payload?.matches, payload?.profiles]) if (Array.isArray(value)) return value;
  for (const value of [payload?.result, payload?.category_procurement_match]) if (value && typeof value === 'object') return [value];
  return payload && typeof payload === 'object' && productMatchProfile(payload) ? [payload] : [];
}

export function buyerBusinessModelItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.items, payload?.results, payload?.result, payload?.buyer_business_models, payload?.models]) if (Array.isArray(value)) return value;
  for (const value of [payload?.result, payload?.buyer_business_model]) if (value && typeof value === 'object') return [value];
  return payload && typeof payload === 'object' ? [payload] : [];
}

export function productOpportunityItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.items, payload?.results, payload?.result, payload?.product_opportunities, payload?.profiles]) if (Array.isArray(value)) return value;
  for (const value of [payload?.result, payload?.product_opportunity]) if (value && typeof value === 'object') return [value];
  return payload && typeof payload === 'object' && productMatchProfile(payload) ? [payload] : [];
}
