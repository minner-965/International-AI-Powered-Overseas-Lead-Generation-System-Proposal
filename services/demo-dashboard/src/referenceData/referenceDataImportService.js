import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

const IMPORT_TYPES = Object.freeze({
  HISTORICAL_CUSTOMERS: {
    required: ['external_customer_id','company_name','country_code'],
    duplicateKey: row => `${row.source_system}:${row.external_customer_id}`,
    normalize: row => ({
      external_customer_id: text(row.external_customer_id),
      source_system: text(row.source_system) || 'REFERENCE_IMPORT',
      company_name: text(row.company_name),
      normalized_company_name: normalizeName(row.company_name),
      country_code: country(row.country_code),
      buyer_type: upper(row.buyer_type),
      company_size: upper(row.company_size),
      address: text(row.address),
      website_domain: (text(row.website_domain) || '').toLowerCase() || null,
      first_order_date: date(row.first_order_date),
      last_order_date: date(row.last_order_date),
      repeat_order_count: integer(row.repeat_order_count)
    })
  },
  HISTORICAL_ORDERS: {
    required: ['external_order_id','external_customer_id','order_date'],
    duplicateKey: row => `${row.source_system}:${row.external_order_id}`,
    normalize: row => ({
      external_order_id: text(row.external_order_id),
      external_customer_id: text(row.external_customer_id),
      source_system: text(row.source_system) || 'REFERENCE_IMPORT',
      order_date: date(row.order_date),
      sku: text(row.sku),
      product_category: text(row.product_category),
      quantity: number(row.quantity),
      moq: number(row.moq),
      revenue: number(row.revenue),
      currency: upper(row.currency),
      incoterm: upper(row.incoterm),
      lead_time_days: integer(row.lead_time_days)
    })
  },
  HISTORICAL_LEAD_OUTCOMES: {
    required: ['external_lead_id','company_name','country_code','outcome'],
    duplicateKey: row => `${row.source_system}:${row.external_lead_id}`,
    normalize: row => ({
      external_lead_id: text(row.external_lead_id),
      source_system: text(row.source_system) || 'REFERENCE_IMPORT',
      company_name: text(row.company_name),
      country_code: country(row.country_code),
      source: text(row.source),
      qualification: upper(row.qualification),
      contactability: upper(row.contactability),
      outreach_status: upper(row.outreach_status),
      reply_status: upper(row.reply_status),
      quotation_status: upper(row.quotation_status),
      outcome: upper(row.outcome) || 'UNKNOWN',
      loss_reason: text(row.loss_reason),
      sales_cycle_days: integer(row.sales_cycle_days),
      outcome_date: date(row.outcome_date)
    })
  },
  HISTORICAL_CUSTOMER_CHANNELS: {
    required: ['external_customer_id','channel_type'],
    duplicateKey: row => `${row.source_system}:${row.external_customer_id}:${row.channel_type}:${row.channel_name || ''}`,
    normalize: row => ({
      external_customer_id: text(row.external_customer_id),
      channel_type: upper(row.channel_type),
      channel_name: text(row.channel_name),
      market_code: country(row.market_code),
      source_system: text(row.source_system) || 'REFERENCE_IMPORT'
    })
  }
});

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function upper(value) {
  return text(value)?.toUpperCase() || null;
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function country(value) {
  const normalized = upper(value);
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : normalized;
}

function date(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? `INVALID:${normalized}` : normalized;
}

function number(value) {
  if (value == null || String(value).trim() === '') return null;
  return Number(value);
}

function integer(value) {
  const parsed = number(value);
  return parsed == null ? null : Number(parsed);
}

function rowErrors(importType, row, normalized, required) {
  const errors = [];
  for (const key of required) if (!text(row[key])) errors.push(`REQUIRED_${key.toUpperCase()}`);
  for (const key of Object.keys(normalized)) {
    if (key.endsWith('_date') || key === 'order_date') {
      if (normalized[key] && !/^\d{4}-\d{2}-\d{2}$/.test(normalized[key])) errors.push(`INVALID_${key.toUpperCase()}`);
    }
  }
  for (const key of ['country_code','market_code']) {
    if (normalized[key] && !/^[A-Z]{2}$/.test(normalized[key])) errors.push(`INVALID_${key.toUpperCase()}`);
  }
  for (const key of ['quantity','moq','revenue','lead_time_days','repeat_order_count','sales_cycle_days']) {
    if (normalized[key] != null && (!Number.isFinite(normalized[key]) || normalized[key] < 0 || (key.endsWith('_days') || key.endsWith('_count')) && !Number.isInteger(normalized[key]))) {
      errors.push(`INVALID_${key.toUpperCase()}`);
    }
  }
  if (normalized.currency && !/^[A-Z]{3}$/.test(normalized.currency)) errors.push('INVALID_CURRENCY');
  if (importType === 'HISTORICAL_LEAD_OUTCOMES' && !['WIN','LOSS','OPEN','UNKNOWN'].includes(normalized.outcome)) errors.push('INVALID_OUTCOME');
  if (normalized.normalized_company_name === '') errors.push('INVALID_COMPANY_NAME');
  return [...new Set(errors)];
}

export function parseReferenceCsv({ importType, csvText, sourceFilename = 'reference.csv' }) {
  const schema = IMPORT_TYPES[importType];
  if (!schema) throw Object.assign(new Error(`Unsupported import type: ${importType}`), { code: 'UNSUPPORTED_IMPORT_TYPE' });
  if (!/\.csv$/i.test(sourceFilename)) throw Object.assign(new Error('CSV filename required'), { code: 'CSV_FILENAME_REQUIRED' });
  if (typeof csvText !== 'string' || Buffer.byteLength(csvText, 'utf8') > 10 * 1024 * 1024) {
    throw Object.assign(new Error('CSV input is missing or exceeds 10 MB'), { code: 'CSV_SIZE_INVALID' });
  }
  let headers;
  let records;
  try {
    headers = (parse(csvText, { to_line: 1, skip_empty_lines: true, bom: true })[0] || []).map(value => String(value).trim());
    records = parse(csvText, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: false });
  } catch (error) {
    throw Object.assign(new Error(`CSV parse failed: ${error.message}`), { code: 'CSV_PARSE_FAILED' });
  }
  const missingHeaders = schema.required.filter(header => !headers.includes(header));
  if (missingHeaders.length) {
    throw Object.assign(new Error(`Missing required columns: ${missingHeaders.join(', ')}`), {
      code: 'CSV_SCHEMA_INVALID', missing_headers: missingHeaders
    });
  }
  const seen = new Set();
  const rows = records.map((raw, index) => {
    const normalized = schema.normalize(raw);
    const errors = rowErrors(importType, raw, normalized, schema.required);
    const duplicateKey = schema.duplicateKey(normalized).toLowerCase();
    let status = errors.length ? 'REJECTED' : 'ACCEPTED';
    if (!errors.length && seen.has(duplicateKey)) status = 'DUPLICATE';
    seen.add(duplicateKey);
    return { row_number: index + 2, raw_payload: raw, normalized_payload: normalized, duplicate_key: duplicateKey, row_status: status, error_codes: errors };
  });
  return {
    import_type: importType,
    source_filename: sourceFilename,
    content_sha256: createHash('sha256').update(csvText).digest('hex'),
    headers,
    rows
  };
}

export class PostgresReferenceDataRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findExistingDuplicateKeys(importType, keys) {
    if (!keys.length) return new Set();
    const queries = {
      HISTORICAL_CUSTOMERS: `SELECT lower(source_system||':'||external_customer_id) AS key FROM leadgen.historical_customers WHERE lower(source_system||':'||external_customer_id)=ANY($1::text[])`,
      HISTORICAL_ORDERS: `SELECT lower(source_system||':'||external_order_id) AS key FROM leadgen.historical_orders WHERE lower(source_system||':'||external_order_id)=ANY($1::text[])`,
      HISTORICAL_LEAD_OUTCOMES: `SELECT lower(source_system||':'||external_lead_id) AS key FROM leadgen.historical_lead_outcomes WHERE lower(source_system||':'||external_lead_id)=ANY($1::text[])`,
      HISTORICAL_CUSTOMER_CHANNELS: `SELECT lower(source_system||':'||external_customer_id||':'||channel_type||':'||coalesce(channel_name,'')) AS key FROM leadgen.historical_customer_channels WHERE lower(source_system||':'||external_customer_id||':'||channel_type||':'||coalesce(channel_name,''))=ANY($1::text[])`
    };
    const result = await this.pool.query(queries[importType], [keys]);
    return new Set(result.rows.map(row => row.key));
  }

  async saveDryRun(parsed, { createdBy = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT * FROM leadgen.reference_data_imports
        WHERE import_type=$1 AND content_sha256=$2`, [parsed.import_type, parsed.content_sha256]);
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return this.getImport(existing.rows[0].id);
      }
      const accepted = parsed.rows.filter(row => row.row_status === 'ACCEPTED').length;
      const rejected = parsed.rows.filter(row => row.row_status === 'REJECTED').length;
      const duplicates = parsed.rows.filter(row => row.row_status === 'DUPLICATE').length;
      const status = accepted > 0 ? 'VALIDATED' : 'VALIDATION_FAILED';
      const errorReport = parsed.rows.filter(row => row.error_codes.length).map(row => ({ row_number: row.row_number, error_codes: row.error_codes }));
      const saved = await client.query(`
        INSERT INTO leadgen.reference_data_imports
          (import_type,source_filename,content_sha256,status,row_count,accepted_count,rejected_count,duplicate_count,error_report,validated_at,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now(),$10) RETURNING *`, [
        parsed.import_type, parsed.source_filename, parsed.content_sha256, status, parsed.rows.length,
        accepted, rejected, duplicates, JSON.stringify(errorReport), createdBy
      ]);
      for (const row of parsed.rows) {
        await client.query(`INSERT INTO leadgen.reference_data_import_rows
          (import_id,row_number,raw_payload,normalized_payload,duplicate_key,row_status,error_codes)
          VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7::text[])`, [saved.rows[0].id, row.row_number,
          JSON.stringify(row.raw_payload), JSON.stringify(row.normalized_payload), row.duplicate_key, row.row_status, row.error_codes]);
      }
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('REFERENCE_IMPORT_VALIDATED','reference_data_import',$1,$2,$3::jsonb)`, [saved.rows[0].id, createdBy,
        JSON.stringify({ accepted, rejected, duplicates })]);
      await client.query('COMMIT');
      return this.getImport(saved.rows[0].id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getImport(importId) {
    const [record, rows] = await Promise.all([
      this.pool.query('SELECT * FROM leadgen.reference_data_imports WHERE id=$1', [importId]),
      this.pool.query('SELECT * FROM leadgen.reference_data_import_rows WHERE import_id=$1 ORDER BY row_number', [importId])
    ]);
    return record.rowCount ? { ...record.rows[0], rows: rows.rows } : null;
  }

  async insertCommittedRow(client, importRecord, row) {
    const p = row.normalized_payload;
    if (importRecord.import_type === 'HISTORICAL_CUSTOMERS') {
      return client.query(`INSERT INTO leadgen.historical_customers
        (source_import_id,source_import_row_id,external_customer_id,source_system,company_name,normalized_company_name,
         country_code,buyer_type,company_size,address,website_domain,first_order_date,last_order_date,repeat_order_count)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (source_system,external_customer_id) DO NOTHING RETURNING id`, [importRecord.id, row.id,
        p.external_customer_id,p.source_system,p.company_name,p.normalized_company_name,p.country_code,p.buyer_type,p.company_size,
        p.address,p.website_domain,p.first_order_date,p.last_order_date,p.repeat_order_count]);
    }
    if (importRecord.import_type === 'HISTORICAL_ORDERS') {
      return client.query(`INSERT INTO leadgen.historical_orders
        (source_import_id,source_import_row_id,external_order_id,external_customer_id,source_system,order_date,sku,product_category,
         quantity,moq,revenue,currency,incoterm,lead_time_days)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (source_system,external_order_id) DO NOTHING RETURNING id`, [importRecord.id,row.id,p.external_order_id,
        p.external_customer_id,p.source_system,p.order_date,p.sku,p.product_category,p.quantity,p.moq,p.revenue,p.currency,p.incoterm,p.lead_time_days]);
    }
    if (importRecord.import_type === 'HISTORICAL_LEAD_OUTCOMES') {
      return client.query(`INSERT INTO leadgen.historical_lead_outcomes
        (source_import_id,source_import_row_id,external_lead_id,source_system,company_name,country_code,source,qualification,
         contactability,outreach_status,reply_status,quotation_status,outcome,loss_reason,sales_cycle_days,outcome_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (source_system,external_lead_id) DO NOTHING RETURNING id`, [importRecord.id,row.id,p.external_lead_id,
        p.source_system,p.company_name,p.country_code,p.source,p.qualification,p.contactability,p.outreach_status,
        p.reply_status,p.quotation_status,p.outcome,p.loss_reason,p.sales_cycle_days,p.outcome_date]);
    }
    return client.query(`INSERT INTO leadgen.historical_customer_channels
      (source_import_id,source_import_row_id,external_customer_id,channel_type,channel_name,market_code,source_system)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING RETURNING id`, [importRecord.id,row.id,p.external_customer_id,p.channel_type,p.channel_name,p.market_code,p.source_system]);
  }

  async commit(importId, { actor = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const recordResult = await client.query('SELECT * FROM leadgen.reference_data_imports WHERE id=$1 FOR UPDATE', [importId]);
      if (!recordResult.rowCount) throw Object.assign(new Error('Reference import not found'), { code: 'IMPORT_NOT_FOUND' });
      const record = recordResult.rows[0];
      if (record.status === 'COMMITTED') {
        await client.query('COMMIT');
        return this.getImport(importId);
      }
      if (record.status !== 'VALIDATED') throw Object.assign(new Error('Only a validated dry run can be committed'), { code: 'IMPORT_NOT_VALIDATED' });
      await client.query("UPDATE leadgen.reference_data_imports SET status='COMMITTING' WHERE id=$1", [importId]);
      const rows = await client.query(`SELECT * FROM leadgen.reference_data_import_rows
        WHERE import_id=$1 AND row_status='ACCEPTED' ORDER BY row_number FOR UPDATE`, [importId]);
      let committed = 0;
      let concurrentDuplicates = 0;
      for (const row of rows.rows) {
        const inserted = await this.insertCommittedRow(client, record, row);
        const nextStatus = inserted.rowCount ? 'COMMITTED' : 'DUPLICATE';
        if (inserted.rowCount) committed += 1;
        else concurrentDuplicates += 1;
        await client.query('UPDATE leadgen.reference_data_import_rows SET row_status=$2 WHERE id=$1', [row.id, nextStatus]);
      }
      const saved = await client.query(`UPDATE leadgen.reference_data_imports SET
        status='COMMITTED',accepted_count=$2,duplicate_count=duplicate_count+$3,committed_at=now()
        WHERE id=$1 RETURNING *`, [importId, committed, concurrentDuplicates]);
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('REFERENCE_IMPORT_COMMITTED','reference_data_import',$1,$2,$3::jsonb)`, [importId, actor,
        JSON.stringify({ committed, concurrent_duplicates: concurrentDuplicates })]);
      await client.query('COMMIT');
      return { ...saved.rows[0], rows: (await this.pool.query('SELECT * FROM leadgen.reference_data_import_rows WHERE import_id=$1 ORDER BY row_number', [importId])).rows };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class ReferenceDataImportService {
  constructor({ repository }) {
    if (!repository) throw new Error('ReferenceDataImportService requires a repository');
    this.repository = repository;
  }

  async dryRun({ importType, sourceFilename, csvText, createdBy = null }) {
    const parsed = parseReferenceCsv({ importType, sourceFilename, csvText });
    const acceptedKeys = parsed.rows.filter(row => row.row_status === 'ACCEPTED').map(row => row.duplicate_key);
    const existing = await this.repository.findExistingDuplicateKeys(importType, acceptedKeys);
    for (const row of parsed.rows) if (row.row_status === 'ACCEPTED' && existing.has(row.duplicate_key)) row.row_status = 'DUPLICATE';
    return this.repository.saveDryRun(parsed, { createdBy });
  }

  commit(importId, options = {}) {
    return this.repository.commit(importId, options);
  }

  getImport(importId) {
    return this.repository.getImport(importId);
  }
}

export function createReferenceDataImportService({ pool }) {
  return new ReferenceDataImportService({ repository: new PostgresReferenceDataRepository(pool) });
}

export { IMPORT_TYPES };
