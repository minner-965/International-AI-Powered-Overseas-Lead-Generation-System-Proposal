import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTemplateWorkbook,
  inspectWorkbookBuffer,
  parseXlsxImportBuffer,
} from '../src/dataExchange/index.js';

test('XLSX template round-trip works with ExcelJS when the dependency is installed', async (t) => {
  let excelJs;
  try {
    excelJs = (await import('exceljs')).default ?? await import('exceljs');
  } catch {
    t.skip('ExcelJS is not installed in this workspace yet.');
    return;
  }

  const template = await buildTemplateWorkbook('PROSPECT_LEADS');
  assert.equal(template.filename, 'DPV_Prospect_Leads_Import_Template_v1.xlsx');

  const workbook = new excelJs.Workbook();
  await workbook.xlsx.load(template.buffer);
  const sheet = workbook.getWorksheet('Import');
  sheet.addRow([
    'L-100',
    'DPV Buyer',
    'AE',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'https://source.example',
    '',
    '',
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const descriptor = await inspectWorkbookBuffer(buffer, { extension: '.xlsx' });
  assert.equal(descriptor.validation.worksheetCount >= 1, true);

  const parsed = await parseXlsxImportBuffer(buffer, { importType: 'PROSPECT_LEADS' });
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    external_lead_id: 'L-100',
    company_name: 'DPV Buyer',
    country_code: 'AE',
    website_url: '',
    city: '',
    company_type: '',
    contact_name: '',
    contact_title: '',
    business_email: '',
    business_phone: '',
    product_profile: '',
    source_reference: 'https://source.example',
    owner: '',
    notes: '',
  });
});
