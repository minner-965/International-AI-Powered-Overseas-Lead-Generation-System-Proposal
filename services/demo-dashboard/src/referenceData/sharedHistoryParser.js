import { createHash } from 'node:crypto';

const text = value => String(value ?? '').normalize('NFKC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const upper = value => text(value).toUpperCase();
const finite = value => {
  if (value === null || value === undefined || text(value) === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeHistoricalName(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function recognizeTf1Filename(filename) {
  const name = upper(filename).replace(/[（]/g, '(').replace(/[）]/g, ')');
  const matched = /(?:^|[^A-Z0-9])(?:TENT\s+)?T?F1[-\s]*(?:PRE[-\s]*)?PEDIDO(?=\d|[^A-Z0-9]|$)/i.test(name);
  if (!matched) return null;
  return {
    record_type: 'TF1_PRODUCT_ORDER_PRICE',
    container_sequence: parseContainerSequence(name),
    is_pre_order: /PRE[-\s]*PEDIDO/i.test(name)
  };
}

export function parseContainerSequence(value) {
  const normalized = upper(value).replace(/[（]/g, '(').replace(/[）]/g, ')');
  const match = normalized.match(/(?:\(|^|[^0-9])(\d{1,3})(?:ST|ND|RD|TH|T)?(?:\)|[-\s])/i);
  return match ? Number(match[1]) : null;
}

export function sourceIdentity({ entityType = 'SOURCE_ROW', sourceHash, sourceSheet, sourceRow, rowKey = '' }) {
  const material = [upper(entityType), upper(sourceHash), text(sourceSheet), Number(sourceRow), normalizeHistoricalName(rowKey)].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function resolveHistoricalCustomerAlias({ rawName, marketCode, evidence = [], confidence = 0 }) {
  const normalizedName = normalizeHistoricalName(rawName);
  const market = upper(marketCode);
  const signals = new Set((Array.isArray(evidence) ? evidence : []).map(upper));
  const supportedMarket = /^[A-Z]{2}$/.test(market) && signals.has('EXPLICIT_MARKET');
  const supportedIdentity = signals.has('EXPLICIT_CLIENT_LABEL') || signals.has('EXPLICIT_BUYER_COMPANY') || signals.has('STABLE_CLIENT_CODE');
  const resolvedConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
  const resolutionStatus = normalizedName && supportedMarket && supportedIdentity && resolvedConfidence >= 0.85 ? 'CONFIRMED' : 'REVIEW';
  return {
    raw_name: text(rawName) || null,
    normalized_name: normalizedName || null,
    market_code: /^[A-Z]{2}$/.test(market) ? market : null,
    confidence: resolvedConfidence,
    resolution_status: resolutionStatus,
    evidence: [...signals]
  };
}

export function normalizeSharedProductProfile({ sourcePath = '', values = [] } = {}) {
  const haystack = upper([sourcePath, ...(Array.isArray(values) ? values : [values])].join(' | '));
  const womenswear = /服装|女装|WOMEN(?:'S)?\s*(?:APPAREL|CLOTHING)|WOMENSWEAR|DRESS|SKIRT|BLOUSE|TOP|TROUSER|KNITWEAR|GARMENT|LINGERIE/.test(haystack);
  const general = /义乌|GENERAL\s+MERCHANDISE|HOUSEHOLD|HOMEWARE|DAILY[-\s]?USE|NON[-\s]?FOOD|TENT|PET\s*PAD|ICE\s*BUCKET/.test(haystack);
  if (womenswear && !general) return 'WOMENSWEAR';
  if (general && !womenswear) return 'GENERAL_MERCHANDISE';
  return 'UNKNOWN';
}

export function classifyCommercialPrice(header) {
  const label = upper(header);
  const currency = /USD/.test(label) ? 'USD' : /MXN/.test(label) ? 'MXN' : /RMB|CNY/.test(label) ? 'CNY' : null;
  const incoterm = /\bFOB\b/.test(label) ? 'FOB' : null;
  let priceType = 'UNKNOWN';
  if (/FACTORY|SUPPLIER|采购|工厂|含税|COSTO\s*RMB|COSTO\s*MXN/.test(label)) priceType = 'SUPPLIER_PRICE';
  if (/CUSTOMER\s*PRICE|客户价|USD\s*FOB/.test(label)) priceType = 'CUSTOMER_SALES_PRICE';
  if (/PRECIO\s*VENTA|RETAIL/.test(label)) priceType = 'DOWNSTREAM_RETAIL_PRICE';
  return { price_type: priceType, currency, incoterm };
}

export function preserveOrderAndDeliveryDates({ orderDate, deliveryDate }) {
  return {
    order_date: dateOnly(orderDate),
    delivery_date: dateOnly(deliveryDate),
    order_date_inferred_from_delivery: false
  };
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const normalized = text(value);
  if (!normalized) return null;
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function columnMap(headers = []) {
  const entries = headers.map((header, index) => [upper(header), index]).filter(([header]) => header);
  const first = patterns => entries.find(([header]) => patterns.some(pattern => pattern.test(header)))?.[1] ?? -1;
  return {
    serial: first([/SERIAL\s*NUMBER/, /^序号$/]),
    quantity: first([/ORDER\s*VOLUME/, /OC\s*QUANTITY/, /^QUANTITY$/, /^QTY$/, /QUNATITY/]),
    unitsPerCarton: first([/PC\/SET/, /PCS\/CTN/, /每箱/]),
    productName: first([/PRODUCT\s*NAME/, /^DESCRIPTION$/, /DESCCRIPCION/, /^STYLE$/]),
    productDetails: first([/PRODUCT\s*DETAIL/, /FABRIC\s*COMPOSITION/]),
    sku: first([/STYLE\s*REFERENCE/, /^STYLE$/, /REFERENCE\s*NUMBER/]),
    hsCode: first([/HS\s*CODE/]),
    color: first([/^COLOR$/, /^颜色$/]),
    size: first([/^SIZES?$/, /SIZE\/RATIO/]),
    individualPacking: first([/INDIVIDUAL\s*PACK/]),
    outerPacking: first([/OUTER\s*CARTON/, /^PKG$/, /^MASTER$/]),
    totalCbm: first([/TOTAL\s*CBM/]),
    cartons: first([/NUMBER\s*OF\s*BOX/, /^箱数$/]),
    totalNetWeight: first([/TOTAL\s*N\.W/]),
    totalGrossWeight: first([/TOTAL\s*G\.W/]),
    deliveryDate: first([/DELIVERY\s*DATE/, /FECHA\s*INICIAL\s*DE\s*ENTREGA/]),
    customerPrice: first([/CUSTOMER\s*PRICE/, /USD\s*FOB/]),
    supplierPrice: first([/FACTORY\s*PRICE/, /COSTO\s*RMB/, /COSTO\s*MXN/]),
    downstreamRetailPrice: first([/PRECIO\s*VENTA/, /RETAIL\s*PRICE/])
  };
}

const at = (row, index) => index >= 0 && index < row.length ? row[index] : null;

export function mapTf1Row({ filename, sourceHash, sourceSheet, sourceRow, headers, row }) {
  const tf1 = recognizeTf1Filename(filename);
  if (!tf1) throw new Error('TF1 filename is required');
  const columns = columnMap(headers);
  const productName = text(at(row, columns.productName));
  const productDetails = text(at(row, columns.productDetails));
  const serial = text(at(row, columns.serial));
  const rowKey = [serial, productName, productDetails].filter(Boolean).join('|');
  const customerPriceHeader = headers[columns.customerPrice] || '';
  const supplierPriceHeader = headers[columns.supplierPrice] || '';
  const customerPriceClass = classifyCommercialPrice(customerPriceHeader);
  const supplierPriceClass = classifyCommercialPrice(supplierPriceHeader);
  return {
    source_identity_key: sourceIdentity({ entityType: 'PRODUCT_MASTER', sourceHash, sourceSheet, sourceRow, rowKey }),
    source_sheet: text(sourceSheet),
    source_row: Number(sourceRow),
    source_hash: upper(sourceHash),
    container_sequence: tf1.container_sequence,
    shipment_batch: tf1.container_sequence ? `${tf1.container_sequence}TH` : null,
    external_customer_id: null,
    external_order_id: null,
    source_product_id: serial || null,
    sku: null,
    product_name: productName || productDetails || null,
    product_details: productDetails || null,
    product_profile: normalizeSharedProductProfile({ sourcePath: filename, values: [productName, productDetails] }),
    quantity: finite(at(row, columns.quantity)),
    units_per_carton: finite(at(row, columns.unitsPerCarton)),
    hs_code: text(at(row, columns.hsCode)),
    color: text(at(row, columns.color)),
    size_spec: text(at(row, columns.size)),
    packing: [text(at(row, columns.individualPacking)), text(at(row, columns.outerPacking))].filter(Boolean).join(' | ') || null,
    volume_cbm: finite(at(row, columns.totalCbm)),
    carton_count: finite(at(row, columns.cartons)),
    net_weight: finite(at(row, columns.totalNetWeight)),
    gross_weight: finite(at(row, columns.totalGrossWeight)),
    supplier_price: finite(at(row, columns.supplierPrice)),
    supplier_price_type: supplierPriceClass.price_type,
    supplier_currency: supplierPriceClass.currency,
    customer_sales_price: finite(at(row, columns.customerPrice)),
    customer_price_type: customerPriceClass.price_type,
    customer_currency: customerPriceClass.currency,
    currency: customerPriceClass.currency || supplierPriceClass.currency,
    incoterm: customerPriceClass.incoterm,
    order_date: null,
    delivery_date: null,
    identity_status: 'REVIEW'
  };
}

export function mapCavannaPurchaseOrder({ filename, sourceHash, sourceSheet, labels = {}, headers = [], rows = [] }) {
  const client = text(labels.client);
  const market = upper(labels.market);
  const po = text(labels.po);
  const cancelled = /CANCEL/i.test(filename) || rows.some(source => {
    const values = Array.isArray(source) ? source : source?.values || [];
    return values.some(value=>/\bCANCEL(?:LED|ADO|ACION)?\b/i.test(text(value)));
  });
  const alias = resolveHistoricalCustomerAlias({
    rawName: client,
    marketCode: market === 'MEXICO' ? 'MX' : market,
    evidence: ['EXPLICIT_CLIENT_LABEL','EXPLICIT_MARKET'],
    confidence: client && market ? 0.95 : 0.5
  });
  const columns = columnMap(headers);
  const dates = preserveOrderAndDeliveryDates({ orderDate: labels.date, deliveryDate: null });
  const sourceSystem = 'SHARED_CAVANNA_PO';
  const externalCustomerId = alias.resolution_status === 'CONFIRMED' ? `MX:${alias.normalized_name}` : null;
  const order = {
    source_system: sourceSystem,
    external_order_id: po,
    external_customer_id: externalCustomerId,
    order_date: dates.order_date,
    delivery_date: null,
    order_status: cancelled ? 'CANCELLED' : 'CONFIRMED',
    product_profile: 'WOMENSWEAR',
    container_sequence: parseContainerSequence(filename),
    source_identity_key: sourceIdentity({ entityType: 'HISTORICAL_ORDER', sourceHash, sourceSheet, sourceRow: 1, rowKey: po || filename })
  };
  const lines = rows.map((source, index) => {
    const row = Array.isArray(source) ? source : source?.values || [];
    const actualSourceRow = Number(Array.isArray(source) ? index + 1 : source?.source_row || index + 1);
    const productName = text(at(row, columns.productName));
    const productDetails = text(at(row, columns.productDetails));
    const sku = text(at(row, columns.sku));
    const quantity = finite(at(row, columns.quantity));
    const deliveryDate = dateOnly(at(row, columns.deliveryDate));
    const salesPrice = finite(at(row, columns.customerPrice));
    const supplierPrice = finite(at(row, columns.supplierPrice));
    const downstreamRetailPrice = finite(at(row, columns.downstreamRetailPrice));
    const customerPriceClass = classifyCommercialPrice(headers[columns.customerPrice] || '');
    const supplierPriceClass = classifyCommercialPrice(headers[columns.supplierPrice] || '');
    const downstreamPriceClass = classifyCommercialPrice(headers[columns.downstreamRetailPrice] || '');
    if (!productName && !sku && quantity == null) return null;
    return {
      source_system: sourceSystem,
      source_sheet: text(sourceSheet),
      source_row: actualSourceRow,
      source_hash: upper(sourceHash),
      source_identity_key: sourceIdentity({ entityType: 'ORDER_LINE', sourceHash, sourceSheet, sourceRow: actualSourceRow, rowKey: [po,sku,productName].join('|') }),
      external_order_id: po,
      external_customer_id: externalCustomerId,
      sku,
      product_name: productName || productDetails || null,
      product_details: productDetails || null,
      product_profile: 'WOMENSWEAR',
      color: text(at(row, columns.color)) || null,
      size_spec: text(at(row, columns.size)) || null,
      quantity,
      delivery_date: deliveryDate,
      unit_price: salesPrice,
      order_value: salesPrice != null && quantity != null ? Number((salesPrice * quantity).toFixed(2)) : null,
      price_type: customerPriceClass.price_type,
      customer_currency: customerPriceClass.currency,
      supplier_price: supplierPrice,
      supplier_price_type: supplierPriceClass.price_type,
      supplier_currency: supplierPriceClass.currency,
      downstream_retail_price: downstreamRetailPrice,
      downstream_retail_currency: downstreamPriceClass.currency,
      currency: customerPriceClass.currency,
      incoterm: customerPriceClass.incoterm
    };
  }).filter(Boolean);
  return { customer_alias: alias, external_customer_id: externalCustomerId, order, lines };
}
