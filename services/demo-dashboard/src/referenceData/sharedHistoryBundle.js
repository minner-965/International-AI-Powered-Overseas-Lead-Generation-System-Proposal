import { createHash } from 'node:crypto';
import {
  mapCavannaPurchaseOrder,
  mapTf1Row,
  normalizeHistoricalName,
  sourceIdentity
} from './sharedHistoryParser.js';

const text = value => String(value ?? '').normalize('NFKC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isoDate = value => {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
};
const filePo = filename => text(filename).toUpperCase().match(/\bSB[-\s]*(\d{2,4})[-\s]*(20\d{2})\b/)?.[0]?.replace(/\s/g, '') || null;
const unique = values => [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
const nonNegative = value => value === null || value === undefined || text(value) === ''
  ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const sum = values => {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? Number(numbers.reduce((total, value) => total + value, 0).toFixed(2)) : null;
};

function entityIdentity(entityType, sourceHash, sourceSheet, sourceRow, rowKey) {
  return sourceIdentity({ entityType, sourceHash, sourceSheet, sourceRow, rowKey });
}

function priceType({ customerSalesPrice, supplierPrice, downstreamRetailPrice }) {
  const present = [customerSalesPrice != null, supplierPrice != null, downstreamRetailPrice != null].filter(Boolean).length;
  if (present > 1) return 'MULTIPLE_EXPLICIT';
  if (customerSalesPrice != null) return 'CUSTOMER_SALES_PRICE';
  if (supplierPrice != null) return 'SUPPLIER_PRICE';
  if (downstreamRetailPrice != null) return 'DOWNSTREAM_RETAIL_PRICE';
  return 'UNKNOWN';
}

function productFromTf1(mapped, workbook, sheet, sourceFile) {
  const customerSalesPrice = mapped.customer_price_type === 'CUSTOMER_SALES_PRICE' ? nonNegative(mapped.customer_sales_price) : null;
  const supplierPrice = mapped.supplier_price_type === 'SUPPLIER_PRICE' ? nonNegative(mapped.supplier_price) : null;
  return {
    entity_type: 'PRODUCT_MASTER',
    source_file_hash: workbook.source_sha256,
    source_sheet: sheet.source_sheet,
    source_row: mapped.source_row,
    captured_at: sourceFile.source_last_modified || null,
    source_identity_key: mapped.source_identity_key,
    source_system: 'SHARED_TF1',
    source_product_id: `${workbook.source_sha256.slice(0, 12)}:${sheet.source_sheet}:${mapped.source_row}:${mapped.source_product_id || 'ROW'}`,
    sku: mapped.sku,
    product_name: mapped.product_name,
    product_profile: mapped.product_profile,
    category: null,
    material: mapped.product_details,
    size_spec: mapped.size_spec,
    color: mapped.color,
    // Order/follow-up quantity is not evidence of a supplier MOQ.
    moq: null,
    customer_sales_price: customerSalesPrice,
    customer_sales_currency: mapped.customer_price_type === 'CUSTOMER_SALES_PRICE' ? mapped.customer_currency : null,
    supplier_price: supplierPrice,
    supplier_currency: mapped.supplier_price_type === 'SUPPLIER_PRICE' ? mapped.supplier_currency : null,
    downstream_retail_price: null,
    downstream_retail_currency: null,
    unclassified_price: mapped.customer_price_type === 'UNKNOWN' ? nonNegative(mapped.customer_sales_price) : null,
    unclassified_currency: mapped.customer_price_type === 'UNKNOWN' ? mapped.currency : null,
    price_type: priceType({
      customerSalesPrice,
      supplierPrice,
      downstreamRetailPrice: null
    }),
    currency: mapped.currency,
    incoterm: mapped.incoterm,
    packing: mapped.packing,
    net_weight: nonNegative(mapped.net_weight),
    gross_weight: nonNegative(mapped.gross_weight),
    volume_cbm: nonNegative(mapped.volume_cbm),
    record_digest: digest(mapped)
  };
}

function productFromOrderLine(line, workbook, sheet, sourceFile) {
  const productIdentity = entityIdentity(
    'PRODUCT_MASTER', workbook.source_sha256, sheet.source_sheet, line.source_row,
    [line.external_order_id, line.sku, line.product_name].join('|')
  );
  const explicitCustomerPrice = line.price_type === 'CUSTOMER_SALES_PRICE' ? nonNegative(line.unit_price) : null;
  const explicitSupplierPrice = line.supplier_price_type === 'SUPPLIER_PRICE' ? nonNegative(line.supplier_price) : null;
  const downstreamRetailPrice = nonNegative(line.downstream_retail_price);
  return {
    entity_type: 'PRODUCT_MASTER',
    source_file_hash: workbook.source_sha256,
    source_sheet: sheet.source_sheet,
    source_row: line.source_row,
    captured_at: sourceFile.source_last_modified || null,
    source_identity_key: productIdentity,
    source_system: 'SHARED_CAVANNA_PO',
    source_product_id: `${workbook.source_sha256.slice(0, 12)}:${sheet.source_sheet}:${line.source_row}:${line.sku || line.external_order_id || 'ROW'}`,
    sku: line.sku,
    product_name: line.product_name,
    product_profile: 'WOMENSWEAR',
    category: null,
    material: line.product_details,
    size_spec: line.size_spec,
    color: line.color,
    // A purchase-order line quantity describes this order, not a minimum order quantity.
    moq: null,
    customer_sales_price: explicitCustomerPrice,
    customer_sales_currency: explicitCustomerPrice != null ? line.customer_currency : null,
    supplier_price: explicitSupplierPrice,
    supplier_currency: explicitSupplierPrice != null ? line.supplier_currency : null,
    downstream_retail_price: downstreamRetailPrice,
    downstream_retail_currency: line.downstream_retail_currency,
    unclassified_price: line.price_type === 'UNKNOWN' ? line.unit_price : null,
    unclassified_currency: line.price_type === 'UNKNOWN' ? line.currency : null,
    price_type: priceType({
      customerSalesPrice: explicitCustomerPrice,
      supplierPrice: explicitSupplierPrice,
      downstreamRetailPrice
    }),
    currency: line.currency,
    incoterm: line.incoterm,
    record_digest: digest(line)
  };
}

function acceptedOrder(mapped, workbook, sheet, sourceFile) {
  const values = mapped.lines.map(line => line.order_value).filter(Number.isFinite);
  const currencies = unique(mapped.lines.filter(line => line.order_value != null).map(line => line.customer_currency));
  const deliveryDates = unique(mapped.lines.map(line => line.delivery_date));
  return {
    entity_type: 'HISTORICAL_ORDERS',
    source_file_hash: workbook.source_sha256,
    source_sheet: sheet.source_sheet,
    source_row: sheet.header_row || 1,
    captured_at: sourceFile.source_last_modified || null,
    source_identity_key: mapped.order.source_identity_key,
    source_system: mapped.order.source_system,
    external_order_id: mapped.order.external_order_id,
    external_customer_id: mapped.order.external_customer_id,
    order_date: mapped.order.order_date,
    delivery_date: deliveryDates.length === 1 ? deliveryDates[0] : null,
    order_date_source: mapped.order.order_date ? 'WORKBOOK_DATE_LABEL' : null,
    order_status: mapped.order.order_status,
    customer_resolution_status: 'RESOLVED',
    quantity: sum(mapped.lines.map(line => line.quantity)),
    unit: 'PCS',
    unit_price: null,
    order_value: values.length && currencies.length === 1 ? sum(values) : null,
    commercial_value_type: values.length && currencies.length === 1 ? 'CUSTOMER_SALES_REVENUE' : 'UNKNOWN',
    currency: currencies.length === 1 ? currencies[0] : null,
    incoterm: unique(mapped.lines.map(line => line.incoterm)).length === 1 ? unique(mapped.lines.map(line => line.incoterm))[0] : null,
    product_profile: 'WOMENSWEAR',
    container_sequence: mapped.order.container_sequence,
    record_digest: digest({ order: mapped.order, lines: mapped.lines })
  };
}

function withSourceVersion(orders) {
  const groups = new Map();
  for (const order of orders) {
    const key = `${order.source_system}:${order.external_order_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  for (const versions of groups.values()) {
    versions.sort((a, b) => String(a.order_date || '').localeCompare(String(b.order_date || ''))
      || String(a.captured_at || '').localeCompare(String(b.captured_at || ''))
      || a.source_identity_key.localeCompare(b.source_identity_key));
    versions.forEach((order, index) => {
      order.source_version = index + 1;
      order.supersedes_source_identity_key = index ? versions[index - 1].source_identity_key : null;
    });
  }
}

export function buildSharedHistoryBundle({ batchKey, manifest, parsedWorkbooks, safety }) {
  const sourceByHash = new Map(manifest.map(file => [String(file.source_sha256_before || file.local_sha256).toLowerCase(), file]));
  const products = [];
  const orders = [];
  const orderLines = [];
  const aliasRows = [];
  const reviews = [];
  const warnings = [];
  let tf1RowsParsed = 0;
  let parsedSheets = 0;
  let reviewSheets = 0;

  for (const workbook of parsedWorkbooks) {
    const sourceFile = sourceByHash.get(String(workbook.source_sha256).toLowerCase());
    if (!sourceFile) throw new Error(`Missing manifest entry for ${workbook.source_filename}`);
    for (const sheet of workbook.sheets || []) {
      if (sheet.parse_status !== 'PARSED') {
        reviewSheets += 1;
        continue;
      }
      parsedSheets += 1;
      if (workbook.family === 'TF1') {
        for (const source of sheet.rows || []) {
          const mapped = mapTf1Row({
            filename: workbook.source_filename,
            sourceHash: workbook.source_sha256,
            sourceSheet: sheet.source_sheet,
            sourceRow: source.source_row,
            headers: sheet.headers || [],
            row: source.values || []
          });
          tf1RowsParsed += 1;
          if (!mapped.product_name || (!mapped.source_product_id && mapped.quantity == null)) {
            reviews.push({
              entity_type: 'PRODUCT_MASTER', reason: 'TF1_NON_BUSINESS_OR_INCOMPLETE_ROW',
              source_file_hash: workbook.source_sha256, captured_at: sourceFile.source_last_modified || null, ...mapped
            });
            continue;
          }
          products.push(productFromTf1(mapped, workbook, sheet, sourceFile));
          if ([mapped.quantity,mapped.customer_sales_price,mapped.supplier_price,mapped.net_weight,mapped.gross_weight,mapped.volume_cbm]
            .some(value => Number.isFinite(Number(value)) && Number(value) < 0)) {
            warnings.push({ code: 'NEGATIVE_NUMERIC_VALUE_SKIPPED', source_hash: workbook.source_sha256, source_sheet: sheet.source_sheet, source_row: source.source_row });
          }
          if ((mapped.customer_sales_price != null || mapped.supplier_price != null) && !mapped.currency) {
            warnings.push({ code: 'PRICE_CURRENCY_UNAVAILABLE', source_hash: workbook.source_sha256, source_sheet: sheet.source_sheet, source_row: source.source_row });
          }
        }
        continue;
      }
      if (workbook.family !== 'CAVANNA_PO') continue;
      const mapped = mapCavannaPurchaseOrder({
        filename: workbook.source_filename,
        sourceHash: workbook.source_sha256,
        sourceSheet: sheet.source_sheet,
        labels: sheet.labels || {},
        headers: sheet.headers || [],
        rows: sheet.rows || []
      });
      for (const line of mapped.lines) products.push(productFromOrderLine(line, workbook, sheet, sourceFile));
      const labelPo = text(mapped.order.external_order_id).toUpperCase();
      const filenameOrder = filePo(workbook.source_filename);
      const poMismatch = filenameOrder && labelPo && filenameOrder !== labelPo;
      if (poMismatch) warnings.push({ code: 'FILENAME_WORKBOOK_PO_MISMATCH', source_hash: workbook.source_sha256, filename_po: filenameOrder, workbook_po: labelPo });
      const orderAccepted = mapped.customer_alias.resolution_status === 'CONFIRMED' && Boolean(mapped.order.external_order_id) && !poMismatch;
      const aliasIdentity = entityIdentity('CUSTOMER_ALIAS', workbook.source_sha256, sheet.source_sheet, sheet.header_row || 1, mapped.customer_alias.normalized_name || workbook.source_filename);
      aliasRows.push({
        entity_type: 'CUSTOMER_ALIASES', source_file_hash: workbook.source_sha256, source_sheet: sheet.source_sheet,
        source_row: sheet.header_row || 1, captured_at: sourceFile.source_last_modified || null,
        source_identity_key: aliasIdentity, external_customer_id: mapped.external_customer_id,
        ...mapped.customer_alias
      });
      if (!orderAccepted) {
        reviews.push({
          entity_type: 'HISTORICAL_ORDERS', source_file_hash: workbook.source_sha256, source_sheet: sheet.source_sheet,
          source_row: sheet.header_row || 1, captured_at: sourceFile.source_last_modified || null,
          source_identity_key: mapped.order.source_identity_key,
          reason: poMismatch ? 'FILENAME_WORKBOOK_PO_MISMATCH' : 'CUSTOMER_OR_PO_REVIEW',
          normalized_payload: mapped.order
        });
        continue;
      }
      const order = acceptedOrder(mapped, workbook, sheet, sourceFile);
      orders.push(order);
      for (const line of mapped.lines) {
        const productSourceIdentity = entityIdentity('PRODUCT_MASTER', workbook.source_sha256, sheet.source_sheet, line.source_row, [line.external_order_id, line.sku, line.product_name].join('|'));
        orderLines.push({
          entity_type: 'ORDER_LINES', source_file_hash: workbook.source_sha256, source_sheet: sheet.source_sheet,
          source_row: line.source_row, captured_at: sourceFile.source_last_modified || null,
          source_identity_key: line.source_identity_key, order_source_identity_key: order.source_identity_key,
          product_source_identity_key: productSourceIdentity, external_order_id: line.external_order_id,
          external_customer_id: line.external_customer_id, line_number: line.source_row,
          sku: line.sku, product_name: line.product_name, product_profile: line.product_profile,
          quantity: nonNegative(line.quantity), unit: 'PCS', customer_unit_price: line.price_type === 'CUSTOMER_SALES_PRICE' ? nonNegative(line.unit_price) : null,
          customer_sales_currency: line.customer_currency,
          customer_sales_value: line.price_type === 'CUSTOMER_SALES_PRICE' ? line.order_value : null,
          supplier_unit_price: line.supplier_price_type === 'SUPPLIER_PRICE' ? nonNegative(line.supplier_price) : null,
          supplier_currency: line.supplier_currency,
          supplier_cost_value: line.supplier_price_type === 'SUPPLIER_PRICE' && line.supplier_price != null && line.quantity != null
            ? Number((line.supplier_price * line.quantity).toFixed(2)) : null,
          downstream_retail_price: nonNegative(line.downstream_retail_price),
          downstream_retail_currency: line.downstream_retail_currency,
          price_type: priceType({ customerSalesPrice: line.price_type === 'CUSTOMER_SALES_PRICE' ? line.unit_price : null,
            supplierPrice: line.supplier_price_type === 'SUPPLIER_PRICE' ? line.supplier_price : null,
            downstreamRetailPrice: line.downstream_retail_price }),
          currency: line.currency, incoterm: line.incoterm, delivery_date: line.delivery_date,
          record_digest: digest(line)
        });
      }
    }
  }

  withSourceVersion(orders);
  const customerOccurrences = new Map();
  for (const alias of aliasRows.filter(row => row.resolution_status === 'CONFIRMED' && row.external_customer_id)) {
    if (!customerOccurrences.has(alias.external_customer_id)) customerOccurrences.set(alias.external_customer_id, []);
    customerOccurrences.get(alias.external_customer_id).push(alias);
  }
  const customers = [];
  for (const [externalCustomerId, aliases] of customerOccurrences) {
    const customerOrders = orders.filter(order => order.external_customer_id === externalCustomerId && order.order_status === 'CONFIRMED');
    const dates = customerOrders.map(order => order.order_date).filter(Boolean).sort();
    const origin = [...aliases].sort((a, b) => String(a.captured_at || '').localeCompare(String(b.captured_at || '')))[0];
    customers.push({
      entity_type: 'HISTORICAL_CUSTOMERS', source_file_hash: origin.source_file_hash, source_sheet: origin.source_sheet,
      source_row: origin.source_row, captured_at: origin.captured_at,
      source_identity_key: entityIdentity('HISTORICAL_CUSTOMER', origin.source_file_hash, origin.source_sheet, origin.source_row, externalCustomerId),
      external_customer_id: externalCustomerId, source_system: 'SHARED_CAVANNA_PO', company_name: origin.raw_name,
      normalized_company_name: normalizeHistoricalName(origin.raw_name), country_code: 'MX', market_code: 'MX',
      buyer_type: 'BUYER', company_size: null, customer_role: 'INTERNAL_EXISTING_CUSTOMER', customer_type: 'CUSTOMER',
      channel_type: null, product_profiles: ['WOMENSWEAR'], identity_resolution_status: 'CONFIRMED',
      first_order_date: dates[0] || null, last_order_date: dates.at(-1) || null,
      repeat_order_count: Math.max(0, new Set(customerOrders.map(order => order.external_order_id)).size - 1),
      record_digest: digest({ externalCustomerId, aliases: aliases.map(alias => alias.source_identity_key), dates })
    });
  }

  const dedupe = rows => {
    const seen = new Set();
    return rows.filter(row => !seen.has(row.source_identity_key) && seen.add(row.source_identity_key));
  };
  const entities = {
    HISTORICAL_CUSTOMERS: dedupe(customers),
    CUSTOMER_ALIASES: dedupe(aliasRows.filter(row => row.resolution_status === 'CONFIRMED' && row.external_customer_id)),
    HISTORICAL_ORDERS: dedupe(orders),
    PRODUCT_MASTER: dedupe(products),
    ORDER_LINES: dedupe(orderLines),
    HISTORICAL_LEAD_OUTCOMES: [],
    HISTORICAL_CUSTOMER_CHANNELS: []
  };
  const sourcePaths = manifest.map(file => text(file.source_relative_path || file.source_unc_path));
  const sensitiveSourceCount = sourcePaths.filter(value => /(?:^|[\\/])(?:7\.HR-|8\.财务)(?:[\\/]|$)/i.test(value)).length;
  const safetySummary = {
    source_files_modified: Number(safety?.source_files_modified || 0),
    source_files_deleted: Number(safety?.source_files_deleted || 0),
    source_files_created: Number(safety?.source_files_created || 0),
    source_files_renamed: Number(safety?.source_files_renamed || 0),
    source_files_moved: Number(safety?.source_files_moved || 0)
  };
  const errors = [];
  if (manifest.some(file => !file.hash_verified || String(file.source_sha256_before).toLowerCase() !== String(file.local_sha256).toLowerCase() || String(file.source_sha256_before).toLowerCase() !== String(file.source_sha256_after).toLowerCase())) errors.push('SOURCE_HASH_GATE_FAILED');
  if (Object.values(safetySummary).some(Boolean)) errors.push('SHARED_SOURCE_CHANGED');
  if (sensitiveSourceCount) errors.push('SENSITIVE_SOURCE_SELECTED');
  if (Object.values(entities).flat().some(row => !row.source_file_hash || !row.source_sheet || !row.source_row || !row.source_identity_key)) errors.push('MISSING_ROW_PROVENANCE');
  if (orders.some(order => order.order_value != null && order.commercial_value_type !== 'CUSTOMER_SALES_REVENUE')) errors.push('AMBIGUOUS_VALUE_MAPPED_TO_REVENUE');
  if (orders.some(order => order.order_date && order.order_date_source === 'DELIVERY_DATE')) errors.push('DELIVERY_DATE_USED_AS_ORDER_DATE');
  const summary = {
    files_staged: manifest.length,
    files_parsed: parsedWorkbooks.length,
    parsed_sheets: parsedSheets,
    review_sheets: reviewSheets,
    tf1_files: parsedWorkbooks.filter(file => file.family === 'TF1' && /TF1/i.test(file.source_filename)).length,
    tf1_family_files: parsedWorkbooks.filter(file => file.family === 'TF1').length,
    tf1_rows_parsed: tf1RowsParsed,
    customers_detected: entities.HISTORICAL_CUSTOMERS.length,
    customer_aliases: entities.CUSTOMER_ALIASES.length,
    ambiguous_customers: aliasRows.filter(row => row.resolution_status !== 'CONFIRMED').length,
    orders: entities.HISTORICAL_ORDERS.length,
    order_lines: entities.ORDER_LINES.length,
    products: entities.PRODUCT_MASTER.length,
    followup_rows: 0,
    mx_records: entities.HISTORICAL_CUSTOMERS.length + entities.HISTORICAL_ORDERS.length,
    ae_historical_records: 0,
    unknown_market_records: reviews.filter(row => !row.market_code).length,
    duplicate_rows: products.length - entities.PRODUCT_MASTER.length + orders.length - entities.HISTORICAL_ORDERS.length,
    invalid_rows: errors.length,
    review_rows: reviews.length,
    currency_ambiguities: warnings.filter(row => row.code === 'PRICE_CURRENCY_UNAVAILABLE').length,
    price_type_ambiguities: products.filter(row => row.unclassified_price != null).length,
    warning_count: warnings.length + reviews.length,
    error_count: errors.length
  };
  return {
    schema_version: 'phase5-v2.3-shared-history-v1', batch_key: batchKey, generated_at: new Date().toISOString(),
    data_classification: 'INTERNAL_BUSINESS', safety: safetySummary, source_files: manifest,
    entities, reviews, warnings, errors, summary, dry_run_passed: errors.length === 0
  };
}
