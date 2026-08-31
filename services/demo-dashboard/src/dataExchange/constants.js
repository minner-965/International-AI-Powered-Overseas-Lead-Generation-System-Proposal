export const IMPORT_TYPES = Object.freeze({
  PROSPECT_LEADS: 'PROSPECT_LEADS',
  PRODUCT_MASTER_UPDATE: 'PRODUCT_MASTER_UPDATE',
  CUSTOMER_DEALS: 'CUSTOMER_DEALS',
  CUSTOMER_DEAL_LINES: 'CUSTOMER_DEAL_LINES',
});

export const PHASE7_SCHEMA_VERSION = 'phase7-v1';

export const DATASET_ROLES = Object.freeze({
  PROSPECT_LEADS: 'PROSPECT_IMPORT',
  PRODUCT_MASTER_UPDATE: 'PRODUCT_CATALOG_UPDATE',
  CUSTOMER_DEALS: 'CONVERTED_ORDER_HISTORY',
  CUSTOMER_DEAL_LINES: 'CONVERTED_ORDER_HISTORY',
});

export const DEFAULT_FILE_LIMITS = Object.freeze({
  maximumFileBytes: 10 * 1024 * 1024,
  maximumWorksheets: 10,
  maximumRowsPerSheet: 25_000,
  maximumColumns: 100,
  maximumCellLength: 32_000,
  maximumFormulaCells: 0,
  maximumConcurrentImportJobs: 2,
});

export const TEMPLATE_FILENAMES = Object.freeze({
  PROSPECT_LEADS: 'DPV_Prospect_Leads_Import_Template_v1.xlsx',
  PRODUCT_MASTER_UPDATE: 'DPV_Product_Master_Import_Template_v1.xlsx',
  CUSTOMER_DEALS: 'DPV_Customer_Deals_Import_Template_v1.xlsx',
  CUSTOMER_DEAL_LINES: 'DPV_Customer_Deals_Import_Template_v1.xlsx',
});

export const IMPORT_RECORD_STATUSES = Object.freeze([
  'DRY_RUN_READY',
  'DRY_RUN_FAILED',
  'SUBMITTED',
  'APPROVED',
  'COMMITTED',
]);

export const OUTREACH_DRAFT_STATUSES = Object.freeze([
  'DRAFT',
  'INVALID_DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'EXPIRED',
]);

export const OUTREACH_RELATIONSHIP_STATUSES = Object.freeze([
  'NEW_PROSPECT',
  'EXISTING_CUSTOMER',
  'HISTORICAL_REVIEW',
  'SUPPRESSED',
  'UNKNOWN',
]);

export const CONTACT_VERIFICATION_DECISIONS = Object.freeze({
  VALID: 'APPROVAL_ALLOWED',
  ACCEPT_ALL: 'MANUAL_RISK_REVIEW',
  UNKNOWN: 'HOLD',
  TEMPORARY_ERROR: 'RETRY_LATER',
  INVALID: 'SUPPRESS',
  NOT_VERIFIED: 'BLOCKED',
  DOMAIN_MX_VERIFIED: 'MAILBOX_VERIFICATION_REQUIRED',
  PUBLICLY_OBSERVED: 'MAILBOX_VERIFICATION_REQUIRED',
});

export const IMPORT_ROW_STATUSES = Object.freeze([
  'ACCEPTED',
  'REVIEW',
  'REJECTED',
  'DUPLICATE',
  'COMMITTED',
]);

export const DEAL_CONFIRMED_STATUSES = Object.freeze([
  'WON',
  'CONFIRMED',
  'CONFIRMED_ORDER',
  'ORDER_CONFIRMED',
]);

export const EXPORT_FORMATS = Object.freeze(['CSV', 'XLSX']);

export const MARKETING_CONTEXT_STATUSES = Object.freeze([
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'EXPIRED',
]);

export const IMPORT_SCHEMAS = Object.freeze({
  PROSPECT_LEADS: Object.freeze({
    required: Object.freeze(['external_lead_id', 'company_name', 'country_code', 'source_reference']),
    allowed: Object.freeze([
      'external_lead_id', 'company_name', 'country_code', 'website_url', 'city',
      'company_type', 'contact_name', 'contact_title', 'business_email',
      'business_phone', 'product_profile', 'source_reference', 'owner', 'notes',
    ]),
  }),
  PRODUCT_MASTER_UPDATE: Object.freeze({
    required: Object.freeze(['external_product_id', 'product_name', 'product_profile', 'catalog_status']),
    allowed: Object.freeze([
      'external_product_id', 'sku', 'product_name', 'product_profile', 'category',
      'subcategory', 'material', 'size_spec', 'color', 'MOQ', 'packing',
      'certification', 'approved_sales_claim', 'catalog_status', 'effective_date',
    ]),
  }),
  CUSTOMER_DEALS: Object.freeze({
    required: Object.freeze([
      'external_customer_id', 'company_name', 'country_code',
      'external_deal_or_order_id', 'deal_status', 'source_reference',
    ]),
    allowed: Object.freeze([
      'external_customer_id', 'company_name', 'country_code',
      'external_deal_or_order_id', 'deal_status', 'order_date', 'currency',
      'incoterm', 'external_product_id', 'sku', 'product_name', 'quantity',
      'customer_sales_price', 'supplier_cost', 'owner', 'crosswalk_company_id',
      'crosswalk_historical_customer_id', 'crosswalk_status', 'crosswalk_method',
      'source_reference',
    ]),
  }),
  CUSTOMER_DEAL_LINES: Object.freeze({
    required: Object.freeze([
      'external_customer_id', 'company_name', 'country_code',
      'external_deal_or_order_id', 'deal_status', 'source_reference',
    ]),
    allowed: Object.freeze([
      'external_customer_id', 'company_name', 'country_code',
      'external_deal_or_order_id', 'deal_status', 'order_date', 'currency',
      'incoterm', 'external_product_id', 'sku', 'product_name', 'quantity',
      'customer_sales_price', 'supplier_cost', 'owner', 'external_line_id',
      'line_number', 'product_profile', 'crosswalk_company_id',
      'crosswalk_historical_customer_id', 'crosswalk_status', 'crosswalk_method',
      'source_reference',
    ]),
  }),
});

export const EXPORT_TYPES = Object.freeze([
  'LEAD_MASTER_INTERNAL',
  'SALES_OPPORTUNITY',
  'PRODUCT_CATALOG_INTERNAL',
  'CUSTOMER_DEAL_HISTORY',
  'IMPORT_ERROR_REPORT',
]);

export const EXPORT_MODES = Object.freeze([
  'CURRENT_FILTER',
  'SELECTED_ROWS',
  'FULL_AUTHORIZED_MASTER',
]);
