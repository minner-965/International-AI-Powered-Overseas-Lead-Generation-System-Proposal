import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { DEFAULT_FILE_LIMITS, IMPORT_SCHEMAS, PHASE7_SCHEMA_VERSION } from './constants.js';

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'text/plain']);
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/octet-stream',
]);
const FORMULA_PREFIX = /^[=+\-@]/;

export class DataExchangeContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DataExchangeContractError';
    this.code = code;
    this.details = details;
  }
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function escapeFormulaCell(value) {
  if (typeof value !== 'string') return value;
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

export function validateUploadMetadata(metadata, limits = DEFAULT_FILE_LIMITS, options = {}) {
  const allowHistoricalXlsm = options?.allowHistoricalXlsm === true;
  const filename = String(metadata?.filename ?? '');
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  const mimeType = String(metadata?.mimeType ?? '').toLowerCase();
  const byteLength = Number(metadata?.byteLength);

  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > limits.maximumFileBytes) {
    throw new DataExchangeContractError('FILE_SIZE_LIMIT', 'File size is outside the configured limit.');
  }
  if (!['.csv', '.xlsx', '.xlsm'].includes(extension)) {
    const code = extension === '.xls' || extension === '.xlsm'
      ? 'UNSUPPORTED_WORKBOOK_TYPE'
      : 'FILE_EXTENSION_NOT_ALLOWED';
    throw new DataExchangeContractError(code, 'Only CSV UTF-8 and XLSX uploads are accepted in the standard upload path.');
  }
  if (extension === '.xlsm' && !allowHistoricalXlsm) {
    throw new DataExchangeContractError('UNSUPPORTED_WORKBOOK_TYPE', 'Macro-enabled workbooks are accepted only from the read-only shared-folder path.');
  }
  const allowedMime = extension === '.csv' ? CSV_MIME_TYPES : XLSX_MIME_TYPES;
  if (!allowedMime.has(mimeType)) {
    throw new DataExchangeContractError('MIME_MISMATCH', 'File MIME type does not match the upload contract.');
  }
  if (metadata?.passwordProtected) {
    throw new DataExchangeContractError('PASSWORD_PROTECTED_WORKBOOK', 'Password-protected workbooks are rejected.');
  }
  const hasMacros = metadata?.hasMacros && !(allowHistoricalXlsm && extension === '.xlsm');
  if (hasMacros || metadata?.hasExternalLinks || metadata?.hasEmbeddedObjects) {
    throw new DataExchangeContractError('ACTIVE_CONTENT_NOT_ALLOWED', 'Macros, external links and embedded objects are rejected.');
  }
  return Object.freeze({ filename, extension, mimeType, byteLength, allowHistoricalXlsm });
}

export function validateWorkbookDescriptor(descriptor, limits = DEFAULT_FILE_LIMITS, options = {}) {
  const allowHistoricalXlsm = options?.allowHistoricalXlsm === true;
  const sheets = Array.isArray(descriptor?.worksheets) ? descriptor.worksheets : [];
  if (sheets.length < 1 || sheets.length > limits.maximumWorksheets) {
    throw new DataExchangeContractError('WORKSHEET_LIMIT', 'Workbook worksheet count is outside the configured limit.');
  }
  let formulaCells = 0;
  for (const sheet of sheets) {
    const rows = Number(sheet?.rowCount ?? 0);
    const columns = Number(sheet?.columnCount ?? 0);
    formulaCells += Number(sheet?.formulaCellCount ?? 0);
    if (!Number.isSafeInteger(rows) || rows < 0 || rows > limits.maximumRowsPerSheet) {
      throw new DataExchangeContractError('ROW_LIMIT', 'Worksheet row count exceeds the configured limit.');
    }
    if (!Number.isSafeInteger(columns) || columns < 0 || columns > limits.maximumColumns) {
      throw new DataExchangeContractError('COLUMN_LIMIT', 'Worksheet column count exceeds the configured limit.');
    }
    if (Number(sheet?.maximumCellLength ?? 0) > limits.maximumCellLength) {
      throw new DataExchangeContractError('CELL_LENGTH_LIMIT', 'A workbook cell exceeds the configured length limit.');
    }
  }
  if (formulaCells > limits.maximumFormulaCells) {
    throw new DataExchangeContractError('FORMULA_CELL_LIMIT', 'Formula cells are not accepted by the V1 import path.');
  }
  const hasMacros = descriptor?.hasMacros && !(allowHistoricalXlsm && descriptor?.extension === '.xlsm');
  if (descriptor?.passwordProtected || hasMacros || descriptor?.hasExternalLinks || descriptor?.hasEmbeddedObjects) {
    throw new DataExchangeContractError('ACTIVE_CONTENT_NOT_ALLOWED', 'Unsafe workbook features are rejected.');
  }
  return Object.freeze({ worksheetCount: sheets.length, formulaCellCount: formulaCells });
}

export function validateHeaders(importType, headers) {
  const schema = IMPORT_SCHEMAS[importType];
  if (!schema) throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown import type.');
  const normalized = headers.map(normalizeHeader);
  const duplicates = normalized.filter((header, index) => header && normalized.indexOf(header) !== index);
  if (duplicates.length) {
    throw new DataExchangeContractError('DUPLICATE_HEADERS', 'Duplicate headers are not allowed.', { headers: [...new Set(duplicates)] });
  }
  const missing = schema.required.filter((header) => !normalized.includes(header));
  const unknown = normalized.filter((header) => header && !schema.allowed.includes(header));
  if (missing.length || unknown.length) {
    throw new DataExchangeContractError('HEADER_SCHEMA_MISMATCH', 'Headers do not match the selected import schema.', { missing, unknown });
  }
  return Object.freeze({ headers: normalized, missing: [], unknown: [] });
}

export function parseCsvUtf8(buffer, { importType, limits = DEFAULT_FILE_LIMITS } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');
  if (buffer.length > limits.maximumFileBytes) {
    throw new DataExchangeContractError('FILE_SIZE_LIMIT', 'CSV exceeds the configured file limit.');
  }
  const text = buffer.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(buffer) !== 0) {
    throw new DataExchangeContractError('CSV_NOT_UTF8', 'CSV must be valid UTF-8.');
  }
  const records = parse(text, {
    bom: true,
    columns: (headers) => validateHeaders(importType, headers).headers,
    relax_column_count: false,
    skip_empty_lines: true,
    trim: false,
    max_record_size: limits.maximumCellLength * limits.maximumColumns,
  });
  if (records.length > limits.maximumRowsPerSheet - 1) {
    throw new DataExchangeContractError('ROW_LIMIT', 'CSV row count exceeds the configured limit.');
  }
  for (const record of records) {
    if (Object.keys(record).length > limits.maximumColumns) {
      throw new DataExchangeContractError('COLUMN_LIMIT', 'CSV column count exceeds the configured limit.');
    }
    if (Object.values(record).some((value) => String(value ?? '').length > limits.maximumCellLength)) {
      throw new DataExchangeContractError('CELL_LENGTH_LIMIT', 'A CSV cell exceeds the configured length limit.');
    }
  }
  return records;
}

function csvField(value) {
  const safe = String(escapeFormulaCell(value ?? ''));
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function serializeCsv(headers, rows) {
  const cleanHeaders = headers.map(normalizeHeader);
  const lines = [cleanHeaders.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(cleanHeaders.map((header) => csvField(row?.[header])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildTemplateContract(importType) {
  const schema = IMPORT_SCHEMAS[importType];
  if (!schema) throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown import type.');
  return Object.freeze({
    importType,
    schemaVersion: PHASE7_SCHEMA_VERSION,
    headers: [...schema.allowed],
    requiredHeaders: [...schema.required],
    controlledCrosswalk: ['CUSTOMER_DEALS', 'CUSTOMER_DEAL_LINES'].includes(importType)
      ? Object.freeze({
        companyIdField: 'crosswalk_company_id',
        historicalCustomerIdField: 'crosswalk_historical_customer_id',
        statusField: 'crosswalk_status',
        methodField: 'crosswalk_method',
        acceptedStatus: 'CONFIRMED',
        policy: 'The company UUID must resolve to an existing company; uncertain links remain REVIEW.',
      })
      : null,
    csv: serializeCsv(schema.allowed, []),
    xlsx: Object.freeze({
      worksheetName: 'Import',
      columns: schema.allowed.map((key) => Object.freeze({ key, header: key, type: 'string' })),
      formulasAllowed: false,
      externalLinksAllowed: false,
      macrosAllowed: false,
    }),
  });
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildDigest(value) {
  return sha256Bytes(stableJson(value));
}
