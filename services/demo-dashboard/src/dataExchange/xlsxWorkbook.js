import {
  DEFAULT_FILE_LIMITS,
  IMPORT_SCHEMAS,
  PHASE7_SCHEMA_VERSION,
  TEMPLATE_FILENAMES,
} from './constants.js';
import {
  DataExchangeContractError,
  escapeFormulaCell,
  normalizeHeader,
  validateHeaders,
  validateUploadMetadata,
  validateWorkbookDescriptor,
} from './fileContract.js';

let excelJsPromise;

function workbookMime(extension) {
  return extension === '.xlsm'
    ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

async function loadExcelJs() {
  if (!excelJsPromise) {
    excelJsPromise = import('exceljs')
      .then((module) => module.default ?? module)
      .catch((error) => {
        throw new DataExchangeContractError(
          'EXCELJS_MISSING',
          'ExcelJS is required for the Phase 7 XLSX path.',
          { cause: error.message }
        );
      });
  }
  return excelJsPromise;
}

function inspectBinaryWorkbookFeatures(buffer) {
  const text = buffer.toString('latin1');
  return Object.freeze({
    passwordProtected: text.includes('EncryptedPackage') || text.includes('EncryptionInfo'),
    hasMacros: text.includes('xl/vbaProject.bin'),
    hasExternalLinks: text.includes('xl/externalLinks/'),
    hasEmbeddedObjects: text.includes('xl/embeddings/') || text.includes('oleObject'),
  });
}

function coerceCellValue(cell, { allowFormulaCachedValues = false } = {}) {
  const value = cell?.value;
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part?.text ?? '')).join('');
    }
    if ('formula' in value) {
      if (!allowFormulaCachedValues) {
        throw new DataExchangeContractError('FORMULA_CELL_LIMIT', 'Formula cells are not accepted by the V1 import path.');
      }
      return value.result == null ? '' : String(value.result);
    }
    if ('text' in value) return String(value.text ?? '');
    if ('hyperlink' in value) return String(value.text ?? value.hyperlink ?? '');
    if ('result' in value) return value.result == null ? '' : String(value.result);
  }
  return String(value);
}

async function loadWorkbookBuffer(buffer, extension) {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    const code = extension === '.xlsm'
      ? 'XLSM_PARSE_FAILED'
      : 'WORKBOOK_PARSE_FAILED';
    throw new DataExchangeContractError(code, 'Workbook could not be parsed.', { cause: error.message });
  }
  return workbook;
}

export async function inspectWorkbookBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');
  const limits = options?.limits ?? DEFAULT_FILE_LIMITS;
  const extension = String(options?.extension ?? '.xlsx').toLowerCase();
  const allowHistoricalXlsm = options?.allowHistoricalXlsm === true;
  const metadata = inspectBinaryWorkbookFeatures(buffer);
  validateUploadMetadata({
    filename: `phase7${extension}`,
    mimeType: workbookMime(extension),
    byteLength: buffer.length,
    ...metadata,
  }, limits, { allowHistoricalXlsm });
  const workbook = await loadWorkbookBuffer(buffer, extension);
  const worksheets = workbook.worksheets.map((worksheet) => {
    let formulaCellCount = 0;
    let maximumCellLength = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const value = cell?.value;
        if (value && typeof value === 'object' && 'formula' in value) formulaCellCount += 1;
        maximumCellLength = Math.max(
          maximumCellLength,
          String(coerceCellValue(cell, { allowFormulaCachedValues: allowHistoricalXlsm })).length
        );
      });
    });
    return Object.freeze({
      name: worksheet.name,
      rowCount: worksheet.actualRowCount,
      columnCount: worksheet.actualColumnCount,
      formulaCellCount,
      maximumCellLength,
    });
  });
  return Object.freeze({
    extension,
    ...metadata,
    worksheets,
    validation: validateWorkbookDescriptor({
      extension,
      ...metadata,
      worksheets,
    }, limits, { allowHistoricalXlsm }),
  });
}

export async function parseXlsxImportBuffer(buffer, { importType, sheetName = 'Import', limits = DEFAULT_FILE_LIMITS, extension = '.xlsx', allowHistoricalXlsm = false } = {}) {
  if (!IMPORT_SCHEMAS[importType]) {
    throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown import type.');
  }
  await inspectWorkbookBuffer(buffer, { extension, limits, allowHistoricalXlsm });
  const workbook = await loadWorkbookBuffer(buffer, extension);
  const worksheet = workbook.getWorksheet(sheetName) ?? workbook.worksheets[0];
  if (!worksheet) {
    throw new DataExchangeContractError('WORKSHEET_MISSING', 'Workbook does not contain an import worksheet.');
  }
  const headerRow = worksheet.getRow(1);
  const headers = [];
  for (let columnIndex = 1; columnIndex <= worksheet.actualColumnCount; columnIndex += 1) {
    headers.push(normalizeHeader(coerceCellValue(headerRow.getCell(columnIndex), { allowFormulaCachedValues: allowHistoricalXlsm })));
  }
  const { headers: normalizedHeaders } = validateHeaders(importType, headers);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const payload = {};
    let hasValue = false;
    for (let columnIndex = 1; columnIndex <= normalizedHeaders.length; columnIndex += 1) {
      const cellValue = coerceCellValue(row.getCell(columnIndex), { allowFormulaCachedValues: allowHistoricalXlsm });
      if (cellValue !== '') hasValue = true;
      payload[normalizedHeaders[columnIndex - 1]] = cellValue;
    }
    if (hasValue) rows.push(payload);
  }
  return Object.freeze({
    importType,
    schemaVersion: PHASE7_SCHEMA_VERSION,
    worksheetName: worksheet.name,
    rows,
  });
}

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.value = String(cell.value ?? '');
    cell.protection = { locked: true };
    cell.alignment = { vertical: 'middle' };
  });
}

function styleDataCells(worksheet, rowNumber, headers) {
  for (let columnIndex = 1; columnIndex <= headers.length; columnIndex += 1) {
    const cell = worksheet.getRow(rowNumber).getCell(columnIndex);
    cell.numFmt = '@';
    if (cell.value == null) cell.value = '';
    else cell.value = String(cell.value);
  }
}

export async function buildTemplateWorkbook(importType) {
  const schema = IMPORT_SCHEMAS[importType];
  if (!schema) throw new DataExchangeContractError('IMPORT_TYPE_UNKNOWN', 'Unknown import type.');
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex';
  workbook.created = new Date('2026-08-31T00:00:00Z');
  const sheet = workbook.addWorksheet('Import', {
    properties: { defaultColWidth: 24, tabColor: { argb: '1F5B83' } },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = schema.allowed.map((key) => ({
    header: key,
    key,
    width: Math.max(18, Math.min(36, key.length + 4)),
    style: { numFmt: '@' },
  }));
  styleHeaderRow(sheet.getRow(1));

  const contract = workbook.addWorksheet('_contract');
  contract.state = 'veryHidden';
  contract.addRows([
    ['schema_version', PHASE7_SCHEMA_VERSION],
    ['import_type', importType],
    ['template_filename', TEMPLATE_FILENAMES[importType]],
    ['worksheet_name', 'Import'],
    ['formulas_allowed', 'false'],
    ['external_links_allowed', 'false'],
    ['macros_allowed', 'false'],
  ]);
  contract.eachRow({ includeEmpty: false }, (row) => styleDataCells(contract, row.number, [1, 2]));

  const buffer = await workbook.xlsx.writeBuffer();
  return Object.freeze({
    importType,
    filename: TEMPLATE_FILENAMES[importType],
    schemaVersion: PHASE7_SCHEMA_VERSION,
    buffer: Buffer.from(buffer),
  });
}

export async function buildXlsxExportBuffer({ worksheetName = 'Export', headers, rows }) {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex';
  const worksheet = workbook.addWorksheet(worksheetName, {
    properties: { defaultColWidth: 24 },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(18, Math.min(40, String(header).length + 4)),
    style: { numFmt: '@' },
  }));
  styleHeaderRow(worksheet.getRow(1));
  for (const row of rows) {
    const nextRow = worksheet.addRow(Object.fromEntries(headers.map((header) => [header, escapeFormulaCell(row?.[header] ?? '')])));
    styleDataCells(worksheet, nextRow.number, headers);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
