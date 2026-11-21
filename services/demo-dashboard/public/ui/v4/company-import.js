// 导入表格 / Import companies from Excel or CSV, on the 手动添加企业 page (migration 080).
// Steps: choose the file and the product category -> match columns -> check (nothing is saved) ->
// import. API: POST /api/manual-companies/import/(preview|check|commit), GET .../import/runs.
import { bi, esc, stateBlock } from './crm.js';
import { tip } from './tooltips.js';
import { managementRequest } from '../../phase7-ui.js';
import { toast } from './toast.js';

const API = '/api/manual-companies/import';
const post = (path, body) => managementRequest(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const FIELD_NAMES = Object.freeze({ company_name: ['公司名称', 'Company name', true], website: ['官网 / 域名', 'Website', true], market: ['国家', 'Country', false],
  company_type: ['客户类型', 'Company type', false], contact_email: ['联系邮箱', 'Contact email', false], contact_name: ['联系人', 'Contact name', false],
  job_title: ['职位', 'Job title', false], notes: ['备注', 'Notes', false] });
export const REASONS = Object.freeze({
  COMPANY_NAME_MISSING: ['缺少公司名称', 'No company name'], WEBSITE_INVALID: ['官网格式不对', 'Website not valid'], MARKET_MISSING: ['缺少国家', 'No country'],
  MARKET_NOT_ACTIVE: ['国家不在已开放市场', 'Country not an active market'], COMPANY_TYPE_MISSING: ['缺少客户类型', 'No company type'], COMPANY_TYPE_UNKNOWN: ['客户类型看不懂', 'Company type not recognised'],
  DUPLICATE_IN_FILE: ['表格里重复', 'Repeated in the file'], ALREADY_IN_DIRECTORY: ['客户名录里已有', 'Already in the directory'],
  CONTACT_EMAIL_INVALID: ['邮箱格式不对，联系人不导入', 'Email not valid; contact left out'], CONTACT_NOT_ON_COMPANY_DOMAIN: ['邮箱不是公司域名，联系人不导入', 'Email not on the company domain; contact left out'],
  EMAIL_REPEATED_IN_FILE: ['邮箱在表格里重复', 'Email repeated in the file'], CONTACT_NOT_ADDED: ['联系人未导入', 'Contact not added']
});
const STATUS = Object.freeze({ OK: ['可导入', 'Ready', 'ok'], WARNING: ['可导入（有提示）', 'Ready, with a note', 'warn'], DUPLICATE: ['重复，跳过', 'Duplicate, skipped', ''], ERROR: ['有错，跳过', 'Error, skipped', 'bad'],
  CREATED: ['已导入', 'Imported', 'ok'], SKIPPED: ['已跳过', 'Skipped', ''], FAILED: ['未导入', 'Not imported', 'bad'] });
const reasonText = code => REASONS[code] ? bi(...REASONS[code]) : esc(code);
const state = { step: 'file', preview: null, mapping: {}, category: '', defaultMarket: '', defaultType: '', check: null, result: null, busy: false, error: null };

/** File as base64 (without the data: prefix). */
const readFile = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); });

function stepsBar() {
  const steps = [['file', '选文件', 'File'], ['map', '对应列', 'Columns'], ['check', '检查', 'Check'], ['done', '完成', 'Done']];
  const index = steps.findIndex(([key]) => key === state.step);
  return `<ol class="v4-import-steps">${steps.map(([key, zh, en], i) => `<li class="${i < index ? 'is-done' : i === index ? 'is-now' : ''}"><span class="n">${i + 1}</span>${bi(zh, en)}</li>`).join('')}</ol>`;
}
function select(name, value, options, { empty = ['不导入', 'Not imported'] } = {}) {
  return `<select name="${name}"><option value="">${empty[0]} / ${empty[1]}</option>${options.map(([key, label]) => `<option value="${esc(key)}"${String(value) === String(key) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}

/** Panel markup for the current step (exported for tests). */
export function importPanelMarkup(s = state) {
  const options = s.preview?.options || {};
  let body = '';
  if (s.step === 'file') {
    body = `<div class="form-grid"><div class="field wide"><label for="import-file">${bi('Excel 或 CSV 表格', 'Excel or CSV file')}</label><input id="import-file" name="file" type="file" accept=".xlsx,.csv"${s.busy ? ' disabled' : ''}${tip('第一行是列标题，每行一家公司，最多 500 行、2 MB', 'First row holds the column titles, one company per row, up to 500 rows / 2 MB')}></div></div>
      <p class="meta">${bi('至少要有“公司名称”和“官网”两列；国家、客户类型、联系邮箱、联系人、备注可选。', 'Company name and website are required; country, type, email, contact and notes are optional.')}</p>`;
  } else if (s.step === 'map') {
    const headers = s.preview.headers.map((header, index) => [index, header]);
    const sample = s.preview.rows.slice(0, 3);
    body = `<p class="meta">${bi(`共 ${s.preview.row_count} 行。请确认每一项对应表格里的哪一列：`, `${s.preview.row_count} rows. Match each field to a column:`)}</p>
      <div class="form-grid">${Object.entries(FIELD_NAMES).map(([field, [zh, en, required]]) => `<div class="field"><label>${bi(zh + (required ? ' *' : ''), en + (required ? ' *' : ''))}${select(`map_${field}`, s.mapping[field] ?? '', headers)}</label></div>`).join('')}</div>
      <div class="form-grid">
        <div class="field"><label for="import-category">${bi('商品类目 *', 'Product category *')}</label><select id="import-category" name="category_scope_id"><option value="">—</option>${(options.categories || []).map(item => `<option value="${esc(item.id)}"${s.category === item.id ? ' selected' : ''}>${esc(item.name_zh || item.name_en || item.code)} · ${esc(item.name_en || item.code)}</option>`).join('')}</select></div>
        <div class="field"><label for="import-default-market">${bi('没写国家时用', 'Country when missing')}</label>${select('default_market_code', s.defaultMarket, (options.markets || []).map(item => [item.code, `${item.name_zh || item.code} · ${item.name_en || ''}`]), { empty: ['不填', 'None'] }).replace('<select', '<select id="import-default-market"')}</div>
        <div class="field"><label for="import-default-type">${bi('没写类型时用', 'Type when missing')}</label>${select('default_company_type', s.defaultType, (options.company_types || []).map(type => [type, type]), { empty: ['不填', 'None'] }).replace('<select', '<select id="import-default-type"')}</div>
      </div>
      <div class="v4-table-wrap"><table class="v4-report-table"><caption class="meta">${bi('前 3 行预览', 'First 3 rows')}</caption><thead><tr>${s.preview.headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${sample.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  } else if (s.step === 'check' || s.step === 'done') {
    const rows = s.step === 'done' ? s.result.results : s.check.rows;
    const summary = s.step === 'done' ? s.result.summary : s.check.summary;
    body = `<div class="v4-key-chips">${s.step === 'done'
      ? `<span class="pill ok">${bi(`已导入 ${summary.created}`, `Imported ${summary.created}`)}</span><span class="pill">${bi(`跳过 ${summary.skipped}`, `Skipped ${summary.skipped}`)}</span>${summary.failed ? `<span class="pill bad">${bi(`未导入 ${summary.failed}`, `Not imported ${summary.failed}`)}</span>` : ''}`
      : `<span class="pill ok">${bi(`可导入 ${summary.importable}`, `Ready ${summary.importable}`)}</span><span class="pill">${bi(`重复 ${summary.duplicate}`, `Duplicates ${summary.duplicate}`)}</span><span class="pill${summary.error ? ' bad' : ''}">${bi(`有错 ${summary.error}`, `Errors ${summary.error}`)}</span>`}</div>
      <ul class="v4-import-rows">${rows.map(row => { const [zh, en, tone] = STATUS[row.status] || [row.status, row.status, '']; const notes = [...(row.reasons || (row.reason ? [row.reason] : [])), ...(row.warnings || [])];
        return `<li><span class="r">${bi(`第 ${row.row} 行`, `Row ${row.row}`)}</span><span class="t"><b>${esc(row.company_name || '—')}</b>${notes.length ? `<small>${notes.map(reasonText).join(' · ')}</small>` : ''}</span><span class="pill ${tone}">${bi(zh, en)}</span></li>`; }).join('')}</ul>`;
  }
  const actions = s.step === 'file' ? '' : s.step === 'map'
    ? `<button class="btn" type="button" data-import-back${tip('换一个文件', 'Choose another file')}>${bi('换文件', 'Other file')}</button><button class="btn btn-primary" type="submit" data-import-check${s.busy ? ' disabled' : ''}${tip('逐行检查，不会保存任何数据', 'Check every row; nothing is saved')}>${bi('检查', 'Check')}</button>`
    : s.step === 'check'
      ? `<button class="btn" type="button" data-import-remap${tip('回去调整列的对应', 'Go back and change the columns')}>${bi('改对应', 'Change columns')}</button><button class="btn btn-primary" type="button" data-import-commit${s.busy || !s.check.summary.importable ? ' disabled' : ''}${tip('导入可导入的行；重复和有错的行会跳过', 'Import the ready rows; duplicates and errors are skipped')}>${bi(`导入 ${s.check.summary.importable} 家`, `Import ${s.check.summary.importable}`)}</button>`
      : `<button class="btn btn-primary" type="button" data-import-again${tip('再导入一个表格', 'Import another file')}>${bi('再导入一个', 'Import another')}</button>`;
  return `<section class="card v4-import-panel" aria-labelledby="import-title" data-import-panel><div class="ph"><div><h3 id="import-title">${bi('导入表格', 'Import a spreadsheet')}</h3><p>${bi('展会名单、老客户表等一次导入，规则和逐个添加相同', 'Import a fair list or an existing customer sheet; the same rules as adding one by one')}</p></div><button class="btn btn-icon" type="button" data-import-close aria-label="关闭 Close"${tip('关闭导入', 'Close the import')}><i class="ti ti-x" aria-hidden="true"></i></button></div>
    <form class="pb" data-import-form novalidate>${stepsBar()}${body}<p class="v4-form-status" role="status" aria-live="polite">${s.error ? bi(...s.error) : s.busy ? bi('正在处理', 'Working') : ''}</p><div class="btns">${actions}</div></form></section>`;
}

function host() {
  const root = document.getElementById('manual-companies-root');
  if (!root) return null;
  let panel = document.getElementById('company-import-host');
  if (!panel) { panel = document.createElement('div'); panel.id = 'company-import-host'; root.prepend(panel); }
  return panel;
}
function render() { const panel = host(); if (panel) panel.innerHTML = importPanelMarkup(); }
const errorPair = error => REASONS[error?.code] || ({ IMPORT_FILE_TYPE: ['请上传 .xlsx 或 .csv 文件', 'Upload a .xlsx or .csv file'], IMPORT_FILE_EMPTY: ['表格是空的，或只有标题行', 'The file is empty or has only titles'],
  IMPORT_FILE_TOO_LARGE: ['文件超过 2 MB', 'The file is larger than 2 MB'], IMPORT_TOO_MANY_ROWS: ['一次最多导入 500 行', 'Import at most 500 rows at a time'],
  IMPORT_FILE_UNREADABLE: ['Excel 读不出来，请另存为 .xlsx 再试', 'The Excel file cannot be read; save it as .xlsx'], IMPORT_MAPPING_REQUIRED: ['请选择“公司名称”和“官网”对应的列', 'Choose the columns for company name and website'],
  IMPORT_CATEGORY_REQUIRED: ['请选择商品类目', 'Choose the product category'] })[error?.code] || ['未能完成，请重试', 'Could not complete; please retry'];

function readMapping(form) {
  state.mapping = Object.fromEntries(Object.keys(FIELD_NAMES).map(field => [field, form[`map_${field}`]?.value]).filter(([, value]) => value !== '' && value !== undefined).map(([field, value]) => [field, Number(value)]));
  state.category = form.category_scope_id?.value || ''; state.defaultMarket = form.default_market_code?.value || ''; state.defaultType = form.default_company_type?.value || '';
}
const requestBody = () => ({ file_name: state.preview.file_name, rows: state.preview.rows, mapping: state.mapping, category_scope_id: state.category,
  default_market_code: state.defaultMarket || undefined, default_company_type: state.defaultType || undefined });

async function run(work) {
  state.busy = true; state.error = null; render();
  try { await work(); } catch (error) { state.error = errorPair(error); } finally { state.busy = false; render(); }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', event => {
    if (event.target.closest('[data-import-open]')) { Object.assign(state, { step: 'file', preview: null, check: null, result: null, error: null }); render(); host()?.scrollIntoView({ block: 'start' }); document.getElementById('import-file')?.focus(); return; }
    if (!event.target.closest('[data-import-panel]')) return;
    if (event.target.closest('[data-import-close]')) { host()?.replaceChildren(); return; }
    if (event.target.closest('[data-import-back]') || event.target.closest('[data-import-again]')) { Object.assign(state, { step: 'file', preview: null, check: null, result: null, error: null }); render(); return; }
    if (event.target.closest('[data-import-remap]')) { state.step = 'map'; state.error = null; render(); return; }
    if (event.target.closest('[data-import-commit]')) void run(async () => {
      state.result = await post('commit', requestBody()); state.step = 'done';
      toast(`已导入 ${state.result.summary.created} 家企业`, `Imported ${state.result.summary.created} companies`);
      document.dispatchEvent(new CustomEvent('crm:viewchange', { detail: { view: 'manual-companies' } }));
    });
  });
  document.addEventListener('change', event => {
    if (event.target.id !== 'import-file' || !event.target.files?.[0]) return;
    const file = event.target.files[0];
    void run(async () => {
      state.preview = await post('preview', { file_name: file.name, content_base64: await readFile(file) });
      state.mapping = { ...state.preview.suggested_mapping }; state.step = 'map';
      const categories = state.preview.options?.categories || []; if (!state.category && categories.length === 1) state.category = categories[0].id;
    });
  });
  document.addEventListener('submit', event => {
    if (!event.target.matches?.('[data-import-form]')) return;
    event.preventDefault();
    if (state.step !== 'map') return;
    readMapping(event.target);
    void run(async () => { state.check = await post('check', requestBody()); state.step = 'check'; });
  });
}
