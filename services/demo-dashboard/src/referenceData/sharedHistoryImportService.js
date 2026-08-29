const IMPORT_ORDER = [
  'HISTORICAL_CUSTOMERS',
  'CUSTOMER_ALIASES',
  'HISTORICAL_ORDERS',
  'PRODUCT_MASTER',
  'ORDER_LINES',
  'HISTORICAL_CUSTOMER_CHANNELS',
  'HISTORICAL_LEAD_OUTCOMES'
];

function assertBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.batch_key) throw new Error('Shared-history bundle is required');
  if (bundle.data_classification !== 'INTERNAL_BUSINESS') throw new Error('Shared-history bundle must be INTERNAL_BUSINESS');
  if (bundle.dry_run_passed !== true || bundle.errors?.length) throw new Error('Shared-history quality gates have not passed');
  if (!Array.isArray(bundle.source_files) || !bundle.source_files.length) throw new Error('Shared-history source files are required');
  const safety = bundle.safety || {};
  if (Object.values(safety).some(value => Number(value || 0) !== 0)) throw new Error('Shared-folder source safety gate failed');
  for (const file of bundle.source_files) {
    if (!file.hash_verified || !file.source_sha256_before || file.source_sha256_before !== file.local_sha256 || file.source_sha256_before !== file.source_sha256_after) {
      throw new Error('Shared-history source hash gate failed');
    }
  }
}

function groupRows(bundle) {
  const grouped = new Map();
  const append = (importType, row, rowStatus = 'ACCEPTED') => {
    if (!row?.source_file_hash || !row?.source_identity_key) return;
    const key = `${row.source_file_hash.toLowerCase()}:${importType}`;
    if (!grouped.has(key)) grouped.set(key, { importType, sourceHash: row.source_file_hash.toLowerCase(), rows: [] });
    grouped.get(key).rows.push({ ...row, row_status: rowStatus });
  };
  for (const importType of IMPORT_ORDER) for (const row of bundle.entities?.[importType] || []) append(importType, row);
  for (const review of bundle.reviews || []) {
    const importType = IMPORT_ORDER.includes(review.entity_type) ? review.entity_type : null;
    if (importType) append(importType, review.normalized_payload ? { ...review.normalized_payload, ...review } : review, 'REVIEW');
  }
  return [...grouped.values()];
}

function fileClass(file) {
  const source = String(file.source_relative_path || file.source_unc_path || '').toUpperCase();
  if (source.includes('CAVANNA')) return { fileClass: 'PURCHASE_ORDER', productProfile: 'WOMENSWEAR' };
  if (/\bT?F1[-\s]*(?:PRE[-\s]*)?PEDIDO/.test(source)) return { fileClass: 'TF1_PRODUCT_ORDER_PRICE', productProfile: 'GENERAL_MERCHANDISE' };
  return { fileClass: 'UNKNOWN_BUSINESS', productProfile: 'UNKNOWN' };
}

async function batchSummary(client, batchId) {
  const result = await client.query(`SELECT id,import_batch_key,status,source_file_count,customer_count,order_count,
    product_count,followup_count,error_count,warning_count,created_at,updated_at,imported_at
    FROM leadgen.reference_data_import_batches WHERE id=$1`, [batchId]);
  return result.rows[0] || null;
}

export class SharedHistoryImportService {
  constructor({ pool }) {
    if (!pool) throw new Error('SharedHistoryImportService requires a PostgreSQL pool');
    this.pool = pool;
  }

  async dryRun(bundle, { actor = 'phase5-v2.3-import' } = {}) {
    assertBundle(bundle);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`shared-import:${bundle.batch_key}`]);
      let batch = await client.query('SELECT * FROM leadgen.reference_data_import_batches WHERE import_batch_key=$1 FOR UPDATE', [bundle.batch_key]);
      if (!batch.rowCount) {
        batch = await client.query(`INSERT INTO leadgen.reference_data_import_batches
          (import_batch_key,status,data_classification,created_by,safety_summary)
          VALUES ($1,'DISCOVERED','INTERNAL_BUSINESS',$2,$3::jsonb) RETURNING *`, [bundle.batch_key, actor,
          JSON.stringify({
            source_files_modified: 0, source_files_deleted: 0, source_files_renamed: 0,
            source_files_moved: 0, files_created_inside_share: 0
          })]);
      }
      const batchRecord = batch.rows[0];
      if (batchRecord.status === 'IMPORTED') {
        await client.query('COMMIT');
        return { ...(await batchSummary(this.pool, batchRecord.id)), idempotent_replay: true };
      }
      const sourceIds = new Map();
      for (const file of bundle.source_files) {
        const sourceHash = String(file.source_sha256_before).toLowerCase();
        let existing = await client.query(`SELECT id FROM leadgen.reference_data_source_files
          WHERE import_batch_id=$1 AND lower(source_unc_path)=lower($2) AND lower(source_sha256)=lower($3)`,
        [batchRecord.id, file.source_unc_path, sourceHash]);
        if (!existing.rowCount) {
          const classification = fileClass(file);
          existing = await client.query(`INSERT INTO leadgen.reference_data_source_files
            (import_batch_id,source_unc_path,source_filename,source_last_modified,source_size,source_sha256,
             local_staging_path,local_sha256,source_sha256_after,copied_at,hash_verified,source_file_status,file_class,product_profile)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'PARSED',$11,$12) RETURNING id`, [
            batchRecord.id,file.source_unc_path,file.source_filename,file.source_last_modified,file.source_size,sourceHash,
            file.local_staging_path,file.local_sha256,file.source_sha256_after,file.copied_at,
            classification.fileClass,classification.productProfile
          ]);
        }
        sourceIds.set(sourceHash, existing.rows[0].id);
      }
      for (const group of groupRows(bundle)) {
        const sourceFileId = sourceIds.get(group.sourceHash);
        const sourceFile = bundle.source_files.find(file => String(file.source_sha256_before).toLowerCase() === group.sourceHash);
        let importRecord = await client.query(`SELECT * FROM leadgen.reference_data_imports
          WHERE import_batch_id=$1 AND import_type=$2 AND content_sha256=$3 FOR UPDATE`,
        [batchRecord.id, group.importType, group.sourceHash]);
        if (!importRecord.rowCount) {
          const prior = await client.query(`SELECT i.* FROM leadgen.reference_data_imports i
            JOIN leadgen.reference_data_source_files sf ON sf.id=i.source_file_id
            WHERE i.import_type=$1 AND lower(sf.source_unc_path)=lower($2) AND i.import_batch_id<>$3
            ORDER BY i.import_version DESC,i.uploaded_at DESC,i.id DESC LIMIT 1 FOR UPDATE OF i`,
          [group.importType, sourceFile.source_unc_path, batchRecord.id]);
          const priorRecord = prior.rows[0] || null;
          const changedSource = priorRecord && String(priorRecord.content_sha256).toLowerCase() !== group.sourceHash;
          const importVersion = priorRecord ? Number(priorRecord.import_version || 1) + (changedSource ? 1 : 0) : 1;
          importRecord = await client.query(`INSERT INTO leadgen.reference_data_imports
            (import_type,source_filename,content_sha256,status,row_count,accepted_count,rejected_count,
             duplicate_count,error_report,validated_at,created_by,import_batch_id,source_file_id,
             import_version,supersedes_import_id)
            VALUES ($1,$2,$3,'VALIDATED',$4,$5,0,0,'[]'::jsonb,now(),$6,$7,$8,$9,$10) RETURNING *`, [
            group.importType,sourceFile.source_filename,group.sourceHash,group.rows.length,
            group.rows.filter(row => row.row_status === 'ACCEPTED').length,actor,batchRecord.id,sourceFileId,
            importVersion,changedSource ? priorRecord.id : null
          ]);
        }
        const maximumRow = await client.query('SELECT coalesce(max(row_number),1) AS maximum FROM leadgen.reference_data_import_rows WHERE import_id=$1', [importRecord.rows[0].id]);
        let sequence = Number(maximumRow.rows[0].maximum) + 1;
        for (const row of group.rows.sort((a, b) => Number(a.source_row || 0) - Number(b.source_row || 0) || a.source_identity_key.localeCompare(b.source_identity_key))) {
          const current = await client.query(`SELECT id,row_status FROM leadgen.reference_data_import_rows
            WHERE import_id=$1 AND source_identity_key=$2`, [importRecord.rows[0].id,row.source_identity_key]);
          if (current.rowCount) {
            await client.query(`UPDATE leadgen.reference_data_import_rows SET
              raw_payload=$2::jsonb,normalized_payload=$3::jsonb,duplicate_key=$4,
              row_status=CASE WHEN row_status='COMMITTED' THEN row_status ELSE $5 END,
              error_codes=$6::text[],captured_at=$7
              WHERE id=$1`, [current.rows[0].id,{ data_classification: 'INTERNAL_BUSINESS', source_value: row },row,
              row.source_identity_key,row.row_status,row.reason ? [row.reason] : [],row.captured_at]);
          } else {
            const replay = await client.query(`SELECT id,canonical_entity_type,canonical_entity_id
              FROM leadgen.reference_data_import_rows
              WHERE source_identity_key=$1 AND import_id<>$2
              ORDER BY (row_status='COMMITTED') DESC,created_at,id LIMIT 1`,
            [row.source_identity_key,importRecord.rows[0].id]);
            const rowStatus = replay.rowCount ? 'DUPLICATE' : row.row_status;
            await client.query(`INSERT INTO leadgen.reference_data_import_rows
              (import_id,row_number,raw_payload,normalized_payload,duplicate_key,row_status,error_codes,
               source_sheet,source_row,source_hash,source_identity_key,captured_at,replays_import_row_id,
               canonical_entity_type,canonical_entity_id)
              VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14,$15)`, [
              importRecord.rows[0].id,sequence,{ data_classification: 'INTERNAL_BUSINESS', source_value: row },row,
              row.source_identity_key,rowStatus,row.reason ? [row.reason] : [],row.source_sheet,row.source_row,
              group.sourceHash,row.source_identity_key,row.captured_at,replay.rows[0]?.id || null,
              replay.rows[0]?.canonical_entity_type || null,replay.rows[0]?.canonical_entity_id || null
            ]);
            sequence += 1;
          }
        }
        await client.query(`UPDATE leadgen.reference_data_imports SET
          row_count=(SELECT count(*) FROM leadgen.reference_data_import_rows WHERE import_id=$1),
          accepted_count=(SELECT count(*) FROM leadgen.reference_data_import_rows WHERE import_id=$1 AND row_status='ACCEPTED'),
          duplicate_count=(SELECT count(*) FROM leadgen.reference_data_import_rows WHERE import_id=$1 AND row_status='DUPLICATE')
          WHERE id=$1`, [importRecord.rows[0].id]);
      }
      const counts = bundle.summary || {};
      await client.query(`UPDATE leadgen.reference_data_import_batches SET status='DRY_RUN_PASSED',
        source_file_count=$2,customer_count=$3,order_count=$4,product_count=$5,followup_count=$6,
        error_count=$7,warning_count=$8,updated_at=now() WHERE id=$1`, [
        batchRecord.id,bundle.source_files.length,counts.customers_detected || 0,counts.orders || 0,
        counts.products || 0,counts.followup_rows || 0,counts.error_count || 0,counts.warning_count || 0
      ]);
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('IMPORT_BATCH_STATUS_CHANGED','reference_data_import_batch',$1,$2,$3::jsonb)`, [
        batchRecord.id,actor,JSON.stringify({ status: 'DRY_RUN_PASSED', summary: counts })
      ]);
      await client.query('COMMIT');
      return { ...(await batchSummary(this.pool, batchRecord.id)), dry_run_passed: true, summary: counts };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commit(batchKey, { actor = 'phase5-v2.3-import' } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`shared-import:${batchKey}`]);
      const batch = await client.query('SELECT * FROM leadgen.reference_data_import_batches WHERE import_batch_key=$1 FOR UPDATE', [batchKey]);
      if (!batch.rowCount) throw new Error('Import batch not found');
      if (batch.rows[0].status === 'IMPORTED') {
        await client.query('COMMIT');
        return { ...(await batchSummary(this.pool, batch.rows[0].id)), idempotent_replay: true };
      }
      if (batch.rows[0].status !== 'DRY_RUN_PASSED') throw new Error('Only a passed dry run can be committed');
      const importRows = await client.query(`SELECT r.*,i.import_type,i.id AS source_import_id
        FROM leadgen.reference_data_import_rows r JOIN leadgen.reference_data_imports i ON i.id=r.import_id
        WHERE i.import_batch_id=$1 AND r.row_status='ACCEPTED'
        ORDER BY array_position($2::text[],i.import_type),
          coalesce((r.normalized_payload->>'source_version')::integer,1),r.source_row,r.id FOR UPDATE OF r`,
      [batch.rows[0].id, IMPORT_ORDER]);
      for (const row of importRows.rows) {
        const canonical = await this.#commitRow(client, row);
        await client.query(`UPDATE leadgen.reference_data_import_rows SET row_status='COMMITTED',
          canonical_entity_type=$2,canonical_entity_id=$3 WHERE id=$1`, [row.id, row.import_type, canonical]);
      }
      const existingLinks = await client.query(`INSERT INTO leadgen.historical_customer_company_links
        (historical_customer_id,company_id,import_batch_id,link_status,match_method,confidence,evidence,confirmed_by,confirmed_at)
        SELECT h.id,c.id,$1,'CONFIRMED',matched.match_method,1.000,matched.evidence,
          'phase5-v2.3-exact-match',now()
        FROM leadgen.historical_customers h JOIN leadgen.companies c ON c.country_code=h.market_code
        JOIN LATERAL (
          SELECT candidate.match_method,candidate.evidence
          FROM (
            SELECT 1 AS priority,'EXACT_DOMAIN_AND_MARKET'::text AS match_method,
              jsonb_build_object('country_code',c.country_code,'domain',lower(h.website_domain)) AS evidence
            WHERE nullif(lower(h.website_domain),'') IS NOT NULL
              AND regexp_replace(lower(coalesce(c.normalized_domain,'')),'^www\\.','')=regexp_replace(lower(h.website_domain),'^www\\.','')
            UNION ALL
            SELECT 2,'EXACT_NORMALIZED_NAME_AND_MARKET',
              jsonb_build_object('country_code',c.country_code,'normalized_name',h.normalized_company_name)
            WHERE regexp_replace(lower(coalesce(c.company_name,'')),'[^[:alnum:]]+','','g')=
              regexp_replace(lower(coalesce(h.normalized_company_name,'')),'[^[:alnum:]]+','','g')
            UNION ALL
            SELECT 3,'EXACT_CONFIRMED_ALIAS_AND_MARKET',
              jsonb_build_object('country_code',c.country_code,'normalized_alias',a.normalized_name)
            FROM leadgen.historical_customer_aliases a
            WHERE a.historical_customer_id=h.id AND a.resolution_status='CONFIRMED'
              AND regexp_replace(lower(coalesce(c.company_name,'')),'[^[:alnum:]]+','','g')=
                regexp_replace(lower(coalesce(a.normalized_name,'')),'[^[:alnum:]]+','','g')
          ) candidate ORDER BY candidate.priority LIMIT 1
        ) matched ON true
        WHERE h.market_code='MX' AND h.identity_resolution_status='CONFIRMED'
          AND h.customer_role='INTERNAL_EXISTING_CUSTOMER'
        ON CONFLICT (historical_customer_id,company_id) DO NOTHING RETURNING id`, [batch.rows[0].id]);
      await client.query(`UPDATE leadgen.reference_data_imports SET status='COMMITTED',committed_at=now(),
        accepted_count=(SELECT count(*) FROM leadgen.reference_data_import_rows r WHERE r.import_id=reference_data_imports.id AND r.row_status='COMMITTED'),
        duplicate_count=(SELECT count(*) FROM leadgen.reference_data_import_rows r WHERE r.import_id=reference_data_imports.id AND r.row_status='DUPLICATE')
        WHERE import_batch_id=$1`, [batch.rows[0].id]);
      const actual = await client.query(`SELECT
        (SELECT count(DISTINCT sf.id) FROM leadgen.reference_data_source_files sf WHERE sf.import_batch_id=$1)::int AS files,
        (SELECT count(DISTINCT h.id) FROM leadgen.historical_customers h JOIN leadgen.reference_data_imports i ON i.id=h.source_import_id WHERE i.import_batch_id=$1)::int AS customers,
        (SELECT count(DISTINCT h.id) FROM leadgen.historical_orders h JOIN leadgen.reference_data_imports i ON i.id=h.source_import_id WHERE i.import_batch_id=$1)::int AS orders,
        (SELECT count(DISTINCT p.id) FROM leadgen.product_master p JOIN leadgen.reference_data_imports i ON i.id=p.source_import_id WHERE i.import_batch_id=$1)::int AS products,
        (SELECT count(DISTINCT o.id) FROM leadgen.historical_lead_outcomes o JOIN leadgen.reference_data_imports i ON i.id=o.source_import_id WHERE i.import_batch_id=$1)::int AS followups`, [batch.rows[0].id]);
      const counts = actual.rows[0];
      await client.query(`UPDATE leadgen.reference_data_import_batches SET status='IMPORTED',source_file_count=$2,
        customer_count=$3,order_count=$4,product_count=$5,followup_count=$6,updated_at=now(),imported_at=now()
        WHERE id=$1`, [batch.rows[0].id,counts.files,counts.customers,counts.orders,counts.products,counts.followups]);
      await client.query(`INSERT INTO leadgen.phase5_audit_events
        (event_type,entity_type,entity_id,actor,details)
        VALUES ('REFERENCE_IMPORT_COMMITTED','reference_data_import_batch',$1,$2,$3::jsonb)`, [
        batch.rows[0].id,actor,JSON.stringify({ ...counts, existing_customer_links: existingLinks.rowCount })
      ]);
      await client.query('COMMIT');
      return { ...(await batchSummary(this.pool, batch.rows[0].id)), committed: counts };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #commitRow(client, row) {
    const p = row.normalized_payload;
    if (row.import_type === 'HISTORICAL_CUSTOMERS') {
      const saved = await client.query(`INSERT INTO leadgen.historical_customers
        (source_import_id,source_import_row_id,external_customer_id,source_system,company_name,normalized_company_name,
         country_code,buyer_type,company_size,first_order_date,last_order_date,repeat_order_count,market_code,
         customer_role,customer_type,channel_type,product_profiles,identity_resolution_status,source_identity_key,
         record_digest,latest_source_import_row_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::text[],$18,$19,$20,$2)
        ON CONFLICT (source_system,external_customer_id) DO UPDATE SET
          company_name=excluded.company_name,normalized_company_name=excluded.normalized_company_name,
          first_order_date=excluded.first_order_date,last_order_date=excluded.last_order_date,
          repeat_order_count=excluded.repeat_order_count,product_profiles=excluded.product_profiles,
          identity_resolution_status=excluded.identity_resolution_status,latest_source_import_row_id=excluded.source_import_row_id,
          record_digest=excluded.record_digest,updated_at=now() RETURNING id`, [
        row.source_import_id,row.id,p.external_customer_id,p.source_system,p.company_name,p.normalized_company_name,
        p.country_code,p.buyer_type,p.company_size,p.first_order_date,p.last_order_date,p.repeat_order_count,p.market_code,
        p.customer_role,p.customer_type,p.channel_type,p.product_profiles,p.identity_resolution_status,p.source_identity_key,p.record_digest
      ]);
      return saved.rows[0].id;
    }
    if (row.import_type === 'CUSTOMER_ALIASES') {
      const customer = await client.query('SELECT id FROM leadgen.historical_customers WHERE source_system=$1 AND external_customer_id=$2', ['SHARED_CAVANNA_PO',p.external_customer_id]);
      if (!customer.rowCount) throw new Error(`Historical customer missing for alias ${p.external_customer_id}`);
      const saved = await client.query(`INSERT INTO leadgen.historical_customer_aliases
        (historical_customer_id,source_import_id,source_import_row_id,raw_name,normalized_name,confidence,resolution_status,evidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [
        customer.rows[0].id,row.source_import_id,row.id,p.raw_name,p.normalized_name,p.confidence,p.resolution_status,JSON.stringify(p.evidence || [])
      ]);
      if (saved.rowCount) return saved.rows[0].id;
      const existing = await client.query('SELECT id FROM leadgen.historical_customer_aliases WHERE source_import_row_id=$1', [row.id]);
      return existing.rows[0].id;
    }
    if (row.import_type === 'HISTORICAL_ORDERS') {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`historical-order:${p.source_system}:${p.external_order_id}`]);
      const customer = await client.query('SELECT id FROM leadgen.historical_customers WHERE source_system=$1 AND external_customer_id=$2', [p.source_system,p.external_customer_id]);
      if (!customer.rowCount) throw new Error(`Historical customer missing for order ${p.external_order_id}`);
      const exact = await client.query('SELECT id FROM leadgen.historical_orders WHERE source_identity_key=$1', [p.source_identity_key]);
      if (exact.rowCount) return exact.rows[0].id;
      const latest = await client.query(`SELECT id,source_version FROM leadgen.historical_orders
        WHERE source_system=$1 AND external_order_id=$2
        ORDER BY source_version DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [p.source_system,p.external_order_id]);
      const sourceVersion = latest.rowCount ? Number(latest.rows[0].source_version) + 1 : 1;
      const supersedesId = latest.rows[0]?.id || null;
      const saved = await client.query(`INSERT INTO leadgen.historical_orders
        (source_import_id,source_import_row_id,external_order_id,external_customer_id,source_system,order_date,
         historical_customer_id,customer_resolution_status,order_status,delivery_date,order_date_source,quantity,unit,
         unit_price,order_value,commercial_value_type,currency,incoterm,container_sequence,product_profile,
         source_identity_key,source_version,supersedes_historical_order_id,record_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        ON CONFLICT DO NOTHING RETURNING id`, [
        row.source_import_id,row.id,p.external_order_id,p.external_customer_id,p.source_system,p.order_date,
        customer.rows[0].id,p.customer_resolution_status,p.order_status,p.delivery_date,p.order_date_source,p.quantity,p.unit,
        p.unit_price,p.order_value,p.commercial_value_type,p.currency,p.incoterm,p.container_sequence,p.product_profile,
        p.source_identity_key,sourceVersion,supersedesId,p.record_digest
      ]);
      if (saved.rowCount) return saved.rows[0].id;
      const existing = await client.query('SELECT id FROM leadgen.historical_orders WHERE source_identity_key=$1', [p.source_identity_key]);
      return existing.rows[0].id;
    }
    if (row.import_type === 'PRODUCT_MASTER') {
      const saved = await client.query(`INSERT INTO leadgen.product_master
        (source_import_id,source_import_row_id,source_system,source_product_id,source_identity_key,sku,product_name,
         product_profile,category,material,size_spec,color,moq,customer_sales_price,customer_sales_currency,
         supplier_price,supplier_currency,downstream_retail_price,downstream_retail_currency,unclassified_price,
         unclassified_currency,price_type,currency,incoterm,packing,net_weight,gross_weight,volume_cbm,record_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15,'UNKNOWN'),$16,coalesce($17,'UNKNOWN'),
          $18,coalesce($19,'UNKNOWN'),$20,coalesce($21,'UNKNOWN'),$22,$23,$24,$25,$26,$27,$28,$29)
        ON CONFLICT DO NOTHING RETURNING id`, [
        row.source_import_id,row.id,p.source_system,p.source_product_id,p.source_identity_key,p.sku,p.product_name,
        p.product_profile,p.category,p.material,p.size_spec,p.color,p.moq,p.customer_sales_price,p.customer_sales_currency,
        p.supplier_price,p.supplier_currency,p.downstream_retail_price,p.downstream_retail_currency,p.unclassified_price,
        p.unclassified_currency,p.price_type,p.currency,p.incoterm,p.packing,p.net_weight,p.gross_weight,p.volume_cbm,p.record_digest
      ]);
      if (saved.rowCount) return saved.rows[0].id;
      const existing = await client.query('SELECT id FROM leadgen.product_master WHERE source_identity_key=$1', [p.source_identity_key]);
      return existing.rows[0].id;
    }
    if (row.import_type === 'ORDER_LINES') {
      const [order, product] = await Promise.all([
        client.query('SELECT id FROM leadgen.historical_orders WHERE source_identity_key=$1', [p.order_source_identity_key]),
        client.query('SELECT id FROM leadgen.product_master WHERE source_identity_key=$1', [p.product_source_identity_key])
      ]);
      if (!order.rowCount) throw new Error(`Historical order missing for line ${p.source_identity_key}`);
      const saved = await client.query(`INSERT INTO leadgen.historical_order_lines
        (historical_order_id,product_id,source_import_id,source_import_row_id,source_identity_key,line_number,
         sku,product_name,product_profile,quantity,unit,customer_unit_price,customer_sales_currency,
         supplier_unit_price,supplier_currency,downstream_retail_price,downstream_retail_currency,
         customer_sales_value,supplier_cost_value,price_type,currency,incoterm,record_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,'UNKNOWN'),$14,coalesce($15,'UNKNOWN'),
          $16,coalesce($17,'UNKNOWN'),$18,$19,$20,$21,$22,$23) ON CONFLICT DO NOTHING RETURNING id`, [
        order.rows[0].id,product.rows[0]?.id || null,row.source_import_id,row.id,p.source_identity_key,p.line_number,
        p.sku,p.product_name,p.product_profile,p.quantity,p.unit,p.customer_unit_price,p.customer_sales_currency,
        p.supplier_unit_price,p.supplier_currency,p.downstream_retail_price,p.downstream_retail_currency,
        p.customer_sales_value,p.supplier_cost_value,p.price_type,p.currency,p.incoterm,p.record_digest
      ]);
      if (saved.rowCount) return saved.rows[0].id;
      const existing = await client.query('SELECT id FROM leadgen.historical_order_lines WHERE source_identity_key=$1', [p.source_identity_key]);
      return existing.rows[0].id;
    }
    throw new Error(`Production adapter not available for ${row.import_type}`);
  }

  async listBatches({ limit = 50 } = {}) {
    const result = await this.pool.query(`SELECT import_batch_key,status,source_file_count,customer_count,order_count,
      product_count,contact_count,activity_count,followup_count,error_count,warning_count,created_at,imported_at
      FROM leadgen.reference_data_import_batches ORDER BY created_at DESC LIMIT $1`, [Math.max(1, Math.min(200, Number(limit) || 50))]);
    return result.rows;
  }
}
