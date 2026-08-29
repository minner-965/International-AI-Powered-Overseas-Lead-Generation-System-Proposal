const IMPORT_TYPES = ['HISTORICAL_CUSTOMERS','HISTORICAL_CONTACTS','HISTORICAL_ACTIVITIES'];

function assertBundle(bundle) {
  if (!bundle || bundle.batch_key !== 'phase5-v2.3.1-okki-history-001') throw new Error('The expected OKKI import bundle is required');
  if (bundle.source_system !== 'OKKI' || bundle.data_classification !== 'INTERNAL_BUSINESS') throw new Error('OKKI INTERNAL_BUSINESS classification is required');
  if (bundle.dry_run_passed !== true || bundle.errors?.length) throw new Error('OKKI source quality gates have not passed');
  if (!Array.isArray(bundle.source_files) || bundle.source_files.length !== 2) throw new Error('Exactly two OKKI source files are required');
  if (Object.values(bundle.safety || {}).some(value => Number(value || 0) !== 0)) throw new Error('OKKI source safety gate failed');
  for (const file of bundle.source_files) {
    if (!file.hash_verified || !file.source_sha256_before || file.source_sha256_before !== file.local_sha256 || file.source_sha256_before !== file.source_sha256_after) {
      throw new Error('OKKI source hash gate failed');
    }
  }
  const expected = { HISTORICAL_CUSTOMERS: 46, HISTORICAL_CONTACTS: 248, HISTORICAL_ACTIVITIES: 83 };
  for (const [type, count] of Object.entries(expected)) {
    if (!Array.isArray(bundle.entities?.[type]) || bundle.entities[type].length !== count) throw new Error(`${type} must contain ${count} records`);
  }
  const keys = new Set(bundle.entities.HISTORICAL_CUSTOMERS.map(row => row.source_customer_id_key));
  if (!keys.has('OKKI:int:1') || !keys.has("OKKI:text:'0001") || keys.size !== 46) throw new Error('OKKI typed customer identity gate failed');
}

function sourceFileForType(bundle, type) {
  return type === 'HISTORICAL_ACTIVITIES' ? bundle.source_files[1] : bundle.source_files[0];
}

function normalizedName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizedDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^live:(?:[a-z]{2}:)?/, '').replace(/^www\./, '').split('/')[0];
  }
}

function batchSelect() {
  return `SELECT id,import_batch_key,status,source_file_count,customer_count,contact_count,activity_count,
    order_count,product_count,followup_count,error_count,warning_count,created_at,updated_at,imported_at
    FROM leadgen.reference_data_import_batches WHERE import_batch_key=$1`;
}

export class OkkiHistoryService {
  constructor({ pool }) {
    if (!pool) throw new Error('OkkiHistoryService requires a PostgreSQL pool');
    this.pool = pool;
  }

  async #batch(batchKey) {
    return (await this.pool.query(batchSelect(), [batchKey])).rows[0] || null;
  }

  async reconciliationPreview(bundle) {
    const [publicCompanies, convertedCustomers, publicContacts] = await Promise.all([
      this.pool.query('SELECT id,company_name,country_code,website_url,normalized_domain FROM leadgen.companies'),
      this.pool.query(`SELECT id,company_name,country_code,website_domain FROM leadgen.historical_customers
        WHERE customer_role='INTERNAL_EXISTING_CUSTOMER' AND identity_resolution_status='CONFIRMED'`),
      this.pool.query(`SELECT c.company_name,c.country_code,ct.business_email,ct.business_phone
        FROM leadgen.companies c JOIN leadgen.contacts ct ON ct.company_id=c.id`)
    ]);
    const publicByName = new Map();
    for (const row of publicCompanies.rows) publicByName.set(`${row.country_code}:${normalizedName(row.company_name)}`, row);
    const convertedByName = new Map();
    for (const row of convertedCustomers.rows) convertedByName.set(`${row.country_code}:${normalizedName(row.company_name)}`, row);
    const publicContactByName = new Map();
    for (const row of publicContacts.rows) {
      const key = `${row.country_code}:${normalizedName(row.company_name)}`;
      const values = publicContactByName.get(key) || { emails: new Set(), phones: new Set() };
      if (row.business_email) values.emails.add(String(row.business_email).toLowerCase());
      if (row.business_phone) values.phones.add(String(row.business_phone).replace(/\D/g, ''));
      publicContactByName.set(key, values);
    }
    const contactsByCustomer = new Map();
    for (const contact of bundle.entities.HISTORICAL_CONTACTS) {
      const values = contactsByCustomer.get(contact.source_customer_id_key) || { emails: new Set(), domains: new Set(), phones: new Set() };
      if (contact.business_email) {
        const email = String(contact.business_email).toLowerCase();
        values.emails.add(email);
        values.domains.add(email.split('@')[1] || '');
      }
      for (const phone of [contact.business_phone,contact.landline]) if (phone) values.phones.add(String(phone).replace(/\D/g, ''));
      contactsByCustomer.set(contact.source_customer_id_key, values);
    }
    const result = { public_strong: 0,public_review: 0,converted_strong: 0,converted_review: 0 };
    for (const customer of bundle.entities.HISTORICAL_CUSTOMERS) {
      const key = `${customer.country_code}:${normalizedName(customer.company_name)}`;
      const contacts = contactsByCustomer.get(customer.source_customer_id_key) || { emails:new Set(),domains:new Set(),phones:new Set() };
      const publicCompany = publicByName.get(key);
      if (publicCompany) {
        const companyDomain = normalizedDomain(publicCompany.website_url || publicCompany.normalized_domain);
        const sourceDomain = normalizedDomain(customer.website_url || customer.website_domain);
        const publicContact = publicContactByName.get(key) || { emails:new Set(),phones:new Set() };
        const emailMatch = [...contacts.emails].some(email => publicContact.emails.has(email));
        const phoneMatch = [...contacts.phones].some(phone => phone && publicContact.phones.has(phone));
        const domainMatch = Boolean(sourceDomain && companyDomain && sourceDomain === companyDomain);
        if (domainMatch || emailMatch || phoneMatch) result.public_strong += 1;
        else result.public_review += 1;
      }
      const converted = convertedByName.get(key);
      if (converted) {
        const domainMatch = Boolean(customer.website_domain && converted.website_domain && normalizedDomain(customer.website_domain) === normalizedDomain(converted.website_domain));
        if (domainMatch) result.converted_strong += 1;
        else result.converted_review += 1;
      }
    }
    return result;
  }

  async dryRun(bundle, { actor = 'phase5-v2.3.1-okki-import' } = {}) {
    assertBundle(bundle);
    const reconciliation = await this.reconciliationPreview(bundle);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`okki-import:${bundle.batch_key}`]);
      let batch = await client.query(batchSelect() + ' FOR UPDATE', [bundle.batch_key]);
      if (batch.rows[0]?.status === 'IMPORTED') {
        await client.query('COMMIT');
        return { ...batch.rows[0],idempotent_replay:true,reconciliation };
      }
      if (!batch.rowCount) {
        batch = await client.query(`INSERT INTO leadgen.reference_data_import_batches
          (import_batch_key,status,data_classification,created_by,safety_summary)
          VALUES ($1,'DISCOVERED','INTERNAL_BUSINESS',$2,$3::jsonb) RETURNING *`, [bundle.batch_key,actor,JSON.stringify(bundle.safety)]);
      }
      const batchId = batch.rows[0].id;
      const sourceIds = new Map();
      for (let index = 0; index < bundle.source_files.length; index += 1) {
        const file = bundle.source_files[index];
        let source = await client.query(`SELECT id FROM leadgen.reference_data_source_files
          WHERE import_batch_id=$1 AND lower(source_unc_path)=lower($2) AND lower(source_sha256)=lower($3)`,
        [batchId,file.source_unc_path,file.source_sha256_before]);
        if (!source.rowCount) {
          source = await client.query(`INSERT INTO leadgen.reference_data_source_files
            (import_batch_id,source_unc_path,source_filename,source_last_modified,source_size,source_sha256,
             local_staging_path,local_sha256,source_sha256_after,copied_at,hash_verified,source_file_status,file_class,product_profile)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'PARSED',$11,'UNKNOWN') RETURNING id`, [
            batchId,file.source_unc_path,file.source_filename,file.source_last_modified,file.source_size,file.source_sha256_before,
            file.local_staging_path,file.local_sha256,file.source_sha256_after,file.copied_at,
            index === 0 ? 'CRM_CUSTOMER_CONTACT_EXPORT' : 'CRM_ACTIVITY_EXPORT'
          ]);
        }
        sourceIds.set(file.source_sha256_before, source.rows[0].id);
      }
      for (const importType of IMPORT_TYPES) {
        const file = sourceFileForType(bundle, importType);
        const rows = bundle.entities[importType];
        let importRecord = await client.query(`SELECT * FROM leadgen.reference_data_imports
          WHERE import_batch_id=$1 AND import_type=$2 AND content_sha256=$3 FOR UPDATE`, [batchId,importType,file.source_sha256_before]);
        if (!importRecord.rowCount) {
          importRecord = await client.query(`INSERT INTO leadgen.reference_data_imports
            (import_type,source_filename,content_sha256,status,row_count,accepted_count,rejected_count,duplicate_count,
             error_report,validated_at,created_by,import_batch_id,source_file_id,dataset_role)
            VALUES ($1,$2,$3,'VALIDATED',$4,$4,0,0,'[]'::jsonb,now(),$5,$6,$7,$8) RETURNING *`, [
            importType,file.source_filename,file.source_sha256_before,rows.length,actor,batchId,sourceIds.get(file.source_sha256_before),
            importType === 'HISTORICAL_CUSTOMERS' ? 'CRM_LEAD_HISTORY' : importType === 'HISTORICAL_CONTACTS' ? 'CRM_CONTACT_HISTORY' : 'CRM_ACTIVITY_HISTORY'
          ]);
        }
        let sequence = 2;
        for (const row of rows) {
          const existing = await client.query('SELECT id,row_status FROM leadgen.reference_data_import_rows WHERE import_id=$1 AND source_identity_key=$2', [importRecord.rows[0].id,row.source_identity_key]);
          if (existing.rowCount) {
            if (existing.rows[0].row_status !== 'COMMITTED') await client.query(`UPDATE leadgen.reference_data_import_rows SET
              raw_payload=$2::jsonb,normalized_payload=$3::jsonb,row_status='ACCEPTED',error_codes='{}'::text[],captured_at=$4 WHERE id=$1`,
            [existing.rows[0].id,JSON.stringify({ data_classification:'INTERNAL_BUSINESS',source_value:row.raw_source_row }),JSON.stringify(row),row.captured_at]);
            continue;
          }
          await client.query(`INSERT INTO leadgen.reference_data_import_rows
            (import_id,row_number,raw_payload,normalized_payload,duplicate_key,row_status,error_codes,source_sheet,
             source_row,source_hash,source_identity_key,captured_at)
            VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,'ACCEPTED','{}'::text[],$6,$7,$8,$9,$10)`, [
            importRecord.rows[0].id,sequence,JSON.stringify({ data_classification:'INTERNAL_BUSINESS',source_value:row.raw_source_row }),
            JSON.stringify(row),row.source_identity_key,row.source_sheet,row.source_row,row.source_file_hash,row.source_identity_key,row.captured_at
          ]);
          sequence += 1;
        }
      }
      const summary = bundle.summary;
      await client.query(`UPDATE leadgen.reference_data_import_batches SET status='DRY_RUN_PASSED',source_file_count=2,
        customer_count=$2,contact_count=$3,activity_count=$4,order_count=0,product_count=0,followup_count=$5,
        error_count=0,warning_count=0,updated_at=now() WHERE id=$1`, [batchId,summary.customers_detected,summary.contacts,summary.activities,summary.followup_rows]);
      await client.query(`INSERT INTO leadgen.phase5_audit_events(event_type,entity_type,entity_id,actor,details)
        VALUES ('IMPORT_BATCH_STATUS_CHANGED','reference_data_import_batch',$1,$2,$3::jsonb)`, [batchId,actor,JSON.stringify({ status:'DRY_RUN_PASSED',summary,reconciliation })]);
      await client.query('COMMIT');
      return { ...(await this.#batch(bundle.batch_key)),dry_run_passed:true,summary,reconciliation };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commit(batchKey, { actor = 'phase5-v2.3.1-okki-import' } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`okki-import:${batchKey}`]);
      const batch = await client.query(batchSelect() + ' FOR UPDATE', [batchKey]);
      if (!batch.rowCount) throw new Error('OKKI import batch not found');
      if (batch.rows[0].status === 'IMPORTED') {
        await client.query('COMMIT');
        return { ...batch.rows[0],idempotent_replay:true };
      }
      if (batch.rows[0].status !== 'DRY_RUN_PASSED') throw new Error('Only a passed OKKI dry run can be committed');
      const rows = await client.query(`SELECT r.*,i.import_type,i.id AS source_import_id
        FROM leadgen.reference_data_import_rows r JOIN leadgen.reference_data_imports i ON i.id=r.import_id
        WHERE i.import_batch_id=$1 AND r.row_status='ACCEPTED'
        ORDER BY array_position($2::text[],i.import_type),r.source_row,r.id FOR UPDATE OF r`, [batch.rows[0].id,IMPORT_TYPES]);
      for (const row of rows.rows) {
        const canonical = await this.#commitRow(client,row);
        await client.query(`UPDATE leadgen.reference_data_import_rows SET row_status='COMMITTED',
          canonical_entity_type=$2,canonical_entity_id=$3 WHERE id=$1`, [row.id,row.import_type,canonical]);
      }
      await client.query(`INSERT INTO leadgen.historical_customer_company_links
        (historical_customer_id,company_id,import_batch_id,link_status,match_method,confidence,evidence,confirmed_by,confirmed_at)
        SELECT h.id,c.id,$1,
          CASE WHEN h.website_domain IS NOT NULL AND h.website_domain=regexp_replace(
            split_part(regexp_replace(lower(coalesce(c.website_url,'')),'^https?://','','i'),'/',1),'^www\\.','')
            THEN 'CONFIRMED' ELSE 'REVIEW' END,
          CASE WHEN h.website_domain IS NOT NULL AND h.website_domain=regexp_replace(
            split_part(regexp_replace(lower(coalesce(c.website_url,'')),'^https?://','','i'),'/',1),'^www\\.','')
            THEN 'EXACT_DOMAIN_AND_COMPANY' ELSE 'EXACT_NAME_AND_MARKET_REVIEW' END,
          CASE WHEN h.website_domain IS NOT NULL AND h.website_domain=regexp_replace(
            split_part(regexp_replace(lower(coalesce(c.website_url,'')),'^https?://','','i'),'/',1),'^www\\.','')
            THEN 1.000 ELSE 0.500 END,
          jsonb_build_object('country_code',h.country_code,'normalized_company_name',h.normalized_company_name),
          CASE WHEN h.website_domain IS NOT NULL AND h.website_domain=regexp_replace(
            split_part(regexp_replace(lower(coalesce(c.website_url,'')),'^https?://','','i'),'/',1),'^www\\.','')
            THEN $2 ELSE NULL END,
          CASE WHEN h.website_domain IS NOT NULL AND h.website_domain=regexp_replace(
            split_part(regexp_replace(lower(coalesce(c.website_url,'')),'^https?://','','i'),'/',1),'^www\\.','')
            THEN now() ELSE NULL END
        FROM leadgen.historical_customers h JOIN leadgen.companies c ON c.country_code=h.country_code
        WHERE h.source_system='OKKI' AND regexp_replace(lower(c.company_name),'[^[:alnum:]]+','','g')=
          regexp_replace(lower(h.company_name),'[^[:alnum:]]+','','g')
        ON CONFLICT (historical_customer_id,company_id) DO NOTHING`, [batch.rows[0].id,actor]);
      await client.query(`INSERT INTO leadgen.historical_customer_reconciliations
        (source_historical_customer_id,target_historical_customer_id,import_batch_id,link_status,match_method,confidence,evidence)
        SELECT source.id,target.id,$1,
          CASE WHEN source.website_domain IS NOT NULL AND target.website_domain IS NOT NULL
            AND source.website_domain=target.website_domain THEN 'CONFIRMED' ELSE 'REVIEW' END,
          CASE WHEN source.website_domain IS NOT NULL AND target.website_domain IS NOT NULL
            AND source.website_domain=target.website_domain THEN 'EXACT_DOMAIN_AND_COMPANY' ELSE 'EXACT_NAME_AND_MARKET_REVIEW' END,
          CASE WHEN source.website_domain IS NOT NULL AND target.website_domain IS NOT NULL
            AND source.website_domain=target.website_domain THEN 1.000 ELSE 0.500 END,
          jsonb_build_object('country_code',source.country_code,'normalized_company_name',source.normalized_company_name)
        FROM leadgen.historical_customers source JOIN leadgen.historical_customers target
          ON target.country_code=source.country_code AND target.customer_role='INTERNAL_EXISTING_CUSTOMER'
          AND regexp_replace(lower(target.company_name),'[^[:alnum:]]+','','g')=
            regexp_replace(lower(source.company_name),'[^[:alnum:]]+','','g')
        WHERE source.source_system='OKKI' AND target.source_system<>'OKKI'
        ON CONFLICT (source_historical_customer_id,target_historical_customer_id) DO NOTHING`, [batch.rows[0].id]);
      await client.query(`UPDATE leadgen.historical_customers source SET customer_role='INTERNAL_EXISTING_CUSTOMER',updated_at=now()
        WHERE source.source_system='OKKI' AND EXISTS (SELECT 1 FROM leadgen.historical_customer_reconciliations r
          WHERE r.source_historical_customer_id=source.id AND r.link_status='CONFIRMED')`);
      await client.query(`UPDATE leadgen.reference_data_imports SET status='COMMITTED',committed_at=now(),
        accepted_count=(SELECT count(*) FROM leadgen.reference_data_import_rows r WHERE r.import_id=reference_data_imports.id AND r.row_status='COMMITTED')
        WHERE import_batch_id=$1`, [batch.rows[0].id]);
      const actual = await client.query(`SELECT
        (SELECT count(*) FROM leadgen.historical_customers h JOIN leadgen.reference_data_imports i ON i.id=h.source_import_id WHERE i.import_batch_id=$1)::int AS customers,
        (SELECT count(*) FROM leadgen.historical_customer_contacts h JOIN leadgen.reference_data_imports i ON i.id=h.source_import_id WHERE i.import_batch_id=$1)::int AS contacts,
        (SELECT count(*) FROM leadgen.historical_customer_activities h JOIN leadgen.reference_data_imports i ON i.id=h.source_import_id WHERE i.import_batch_id=$1)::int AS activities,
        (SELECT count(*) FROM leadgen.historical_customer_activities h JOIN leadgen.reference_data_imports i ON i.id=h.source_import_id WHERE i.import_batch_id=$1 AND h.activity_type='MANUAL_FOLLOW_UP')::int AS followups`, [batch.rows[0].id]);
      await client.query(`UPDATE leadgen.reference_data_import_batches SET status='IMPORTED',customer_count=$2,
        contact_count=$3,activity_count=$4,followup_count=$5,updated_at=now(),imported_at=now() WHERE id=$1`, [
        batch.rows[0].id,actual.rows[0].customers,actual.rows[0].contacts,actual.rows[0].activities,actual.rows[0].followups
      ]);
      await client.query(`INSERT INTO leadgen.phase5_audit_events(event_type,entity_type,entity_id,actor,details)
        VALUES ('REFERENCE_IMPORT_COMMITTED','reference_data_import_batch',$1,$2,$3::jsonb)`, [batch.rows[0].id,actor,JSON.stringify(actual.rows[0])]);
      await client.query('COMMIT');
      return { ...(await this.#batch(batchKey)),committed:actual.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #commitRow(client,row) {
    const p = row.normalized_payload;
    if (row.import_type === 'HISTORICAL_CUSTOMERS') {
      const result = await client.query(`INSERT INTO leadgen.historical_customers
        (source_import_id,source_import_row_id,external_customer_id,source_system,company_name,normalized_company_name,
         country_code,buyer_type,company_size,address,website_domain,market_code,customer_role,customer_type,channel_type,
         product_profiles,identity_resolution_status,source_identity_key,record_digest,latest_source_import_row_id,
         source_customer_id_raw,source_customer_id_type,source_customer_id_key,crm_status_raw,crm_outcome_state,
         crm_stage_detail,crm_source_raw,crm_source_detail_raw,crm_owner_raw,crm_creator_raw,crm_last_editor_raw,
         short_name,city,province,website_url,crm_score_raw,customer_segment_raw,customer_tags,purchase_intent_raw,
         company_notes,annual_purchase_raw,first_order_amount_raw,source_created_at,profile_updated_at,last_contact_at,
         last_followup_at,last_edm_at,historical_contacted,latest_crm_activity_at,crm_profile,win_loss_coverage,dataset_role)
        VALUES ($1,$2,$3,'OKKI',$4,$5,$6,$7,$8,$9,$10,$6,$11,$12,$13,$14::text[],$15,$16,$17,$2,
          $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::text[],$36,$37,$38,$39,
          $40,$41,$42,$43,$44,$45,$46,$47::jsonb,$48,$49)
        ON CONFLICT (source_system,external_customer_id) DO UPDATE SET
          company_name=excluded.company_name,normalized_company_name=excluded.normalized_company_name,
          country_code=excluded.country_code,buyer_type=excluded.buyer_type,company_size=excluded.company_size,
          address=excluded.address,website_domain=excluded.website_domain,customer_role=excluded.customer_role,
          crm_status_raw=excluded.crm_status_raw,crm_outcome_state=excluded.crm_outcome_state,
          crm_stage_detail=excluded.crm_stage_detail,crm_owner_raw=excluded.crm_owner_raw,
          customer_tags=excluded.customer_tags,last_contact_at=excluded.last_contact_at,
          last_followup_at=excluded.last_followup_at,last_edm_at=excluded.last_edm_at,
          latest_source_import_row_id=excluded.source_import_row_id,record_digest=excluded.record_digest,updated_at=now()
        RETURNING id`, [row.source_import_id,row.id,p.external_customer_id,p.company_name,p.normalized_company_name,p.country_code,
        p.buyer_type,p.company_size,p.address,p.website_domain,p.customer_role,p.customer_type,p.channel_type,p.product_profiles,
        p.identity_resolution_status,p.source_identity_key,p.record_digest,p.source_customer_id_raw,p.source_customer_id_type,
        p.source_customer_id_key,p.crm_status_raw,p.crm_outcome_state,p.crm_stage_detail,p.crm_source_raw,p.crm_source_detail_raw,
        p.crm_owner_raw,p.crm_creator_raw,p.crm_last_editor_raw,p.short_name,p.city,p.province,p.website_url,p.crm_score_raw,
        p.customer_segment_raw,p.customer_tags,p.purchase_intent_raw,p.company_notes,p.annual_purchase_raw,p.first_order_amount_raw,
        p.source_created_at,p.profile_updated_at,p.last_contact_at,p.last_followup_at,p.last_edm_at,
        p.historical_contacted,p.latest_crm_activity_at,JSON.stringify(p.crm_profile || {}),p.win_loss_coverage,p.dataset_role]);
      return result.rows[0].id;
    }
    const customer = await client.query(`SELECT id FROM leadgen.historical_customers
      WHERE source_system='OKKI' AND source_customer_id_key=$1`, [p.source_customer_id_key]);
    if (!customer.rowCount) throw new Error(`OKKI historical customer missing for ${p.source_customer_id_key}`);
    if (row.import_type === 'HISTORICAL_CONTACTS') {
      const result = await client.query(`INSERT INTO leadgen.historical_customer_contacts
        (historical_customer_id,source_import_id,source_import_row_id,source_system,source_customer_id_raw,
         source_customer_id_type,source_customer_id_key,contact_name,job_title,job_level,business_email,business_phone,
         landline,contact_notes,is_primary,is_generic_mailbox,social_profiles,source_identity_key,record_digest)
        VALUES ($1,$2,$3,'OKKI',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
        ON CONFLICT (source_identity_key) DO UPDATE SET contact_name=excluded.contact_name,job_title=excluded.job_title,
          job_level=excluded.job_level,business_email=excluded.business_email,business_phone=excluded.business_phone,
          landline=excluded.landline,contact_notes=excluded.contact_notes,is_primary=excluded.is_primary,
          is_generic_mailbox=excluded.is_generic_mailbox,social_profiles=excluded.social_profiles,
          record_digest=excluded.record_digest,updated_at=now() RETURNING id`, [customer.rows[0].id,row.source_import_id,row.id,
        p.source_customer_id_raw,p.source_customer_id_type,p.source_customer_id_key,p.contact_name,p.job_title,p.job_level,
        p.business_email,p.business_phone,p.landline,p.contact_notes,p.is_primary,p.is_generic_mailbox,JSON.stringify(p.social_profiles || {}),
        p.source_identity_key,p.record_digest]);
      return result.rows[0].id;
    }
    if (row.import_type === 'HISTORICAL_ACTIVITIES') {
      const result = await client.query(`INSERT INTO leadgen.historical_customer_activities
        (historical_customer_id,source_import_id,source_import_row_id,source_system,source_customer_id_raw,
         source_customer_id_type,source_customer_id_key,company_name_raw,source_contact_name,source_contact_email,
         activity_type_raw,activity_title_raw,activity_content_raw,activity_type,activity_topic,channel,owner_raw,
         activity_at,source_created_at,internal_related_link,internal_attachment_reference,source_identity_key,record_digest)
        VALUES ($1,$2,$3,'OKKI',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT (source_identity_key) DO UPDATE SET activity_content_raw=excluded.activity_content_raw,
          owner_raw=excluded.owner_raw,activity_at=excluded.activity_at,record_digest=excluded.record_digest RETURNING id`, [
        customer.rows[0].id,row.source_import_id,row.id,p.source_customer_id_raw,p.source_customer_id_type,
        p.source_customer_id_key,p.company_name_raw,p.source_contact_name,p.source_contact_email,p.activity_type_raw,
        p.activity_title_raw,p.activity_content_raw,p.activity_type,p.activity_topic,p.channel,p.owner_raw,p.activity_at,
        p.source_created_at,p.internal_related_link,p.internal_attachment_reference,p.source_identity_key,p.record_digest]);
      return result.rows[0].id;
    }
    throw new Error(`Unsupported OKKI import type ${row.import_type}`);
  }

  async list({ limit = 50,offset = 0,search = '',country = '',status = '' } = {}) {
    const params = [];
    const clauses = ["h.source_system='OKKI'"];
    if (search) { params.push(`%${String(search).trim()}%`); clauses.push(`(h.company_name ILIKE $${params.length} OR h.source_customer_id_key ILIKE $${params.length})`); }
    if (country) { params.push(String(country).toUpperCase()); clauses.push(`h.country_code=$${params.length}`); }
    if (status) { params.push(String(status).toUpperCase()); clauses.push(`h.customer_role=$${params.length}`); }
    params.push(Math.max(1,Math.min(200,Number(limit)||50)),Math.max(0,Number(offset)||0));
    const result = await this.pool.query(`SELECT h.id,h.company_name,h.country_code,h.crm_status_raw,h.crm_outcome_state,
      h.crm_stage_detail,h.customer_role,h.crm_owner_raw,h.crm_source_raw,h.last_contact_at,h.last_followup_at,
      h.source_customer_id_key,
      (SELECT count(*) FROM leadgen.historical_customer_contacts c WHERE c.historical_customer_id=h.id)::int AS contact_count,
      (SELECT count(*) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id)::int AS activity_count,
      (SELECT count(*) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id AND a.activity_type='OUTBOUND_MARKETING_EMAIL_SENT')::int AS marketing_email_count,
      (SELECT count(*) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id AND a.activity_type='MANUAL_FOLLOW_UP')::int AS followup_count,
      (SELECT max(a.activity_at) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id) AS latest_activity_at,
      count(*) OVER()::int AS total_count
      FROM leadgen.historical_customers h WHERE ${clauses.join(' AND ')}
      ORDER BY coalesce((SELECT max(a.activity_at) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id),h.last_contact_at) DESC NULLS LAST,h.company_name
      LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    return { items:result.rows,total:result.rows[0]?.total_count || 0,limit:params.at(-2),offset:params.at(-1) };
  }

  async get(id) {
    const customer = await this.pool.query(`SELECT h.id,h.company_name,h.short_name,h.country_code,h.city,h.province,h.address,
      h.website_url,h.crm_status_raw,h.crm_outcome_state,h.crm_stage_detail,h.customer_role,h.crm_source_raw,
      h.crm_source_detail_raw,h.crm_owner_raw,h.crm_creator_raw,h.crm_score_raw,h.customer_segment_raw,h.customer_tags,
      h.purchase_intent_raw,h.company_notes,h.annual_purchase_raw,h.first_order_amount_raw,h.source_created_at,
      h.profile_updated_at,h.last_contact_at,h.last_followup_at,h.last_edm_at,h.win_loss_coverage,h.dataset_role,
      h.source_customer_id_key,h.source_customer_id_raw,h.source_customer_id_type,h.latest_crm_activity_at,
      (SELECT count(*) FROM leadgen.historical_customer_contacts c WHERE c.historical_customer_id=h.id)::int AS contact_count,
      (SELECT count(*) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id)::int AS activity_count,
      (SELECT count(*) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id AND a.activity_type='OUTBOUND_MARKETING_EMAIL_SENT')::int AS marketing_email_count,
      (SELECT count(*) FROM leadgen.historical_customer_activities a WHERE a.historical_customer_id=h.id AND a.activity_type='MANUAL_FOLLOW_UP')::int AS followup_count
      FROM leadgen.historical_customers h WHERE h.id=$1 AND h.source_system='OKKI'`, [id]);
    if (!customer.rowCount) return null;
    const [contacts,activities,links] = await Promise.all([
      this.pool.query(`SELECT id,contact_name,job_title,job_level,business_email,business_phone,landline,
        contact_notes,is_primary,is_generic_mailbox,social_profiles FROM leadgen.historical_customer_contacts
        WHERE historical_customer_id=$1 ORDER BY is_primary DESC NULLS LAST,contact_name NULLS LAST,business_email`, [id]),
      this.pool.query(`SELECT id,source_contact_name,source_contact_email,activity_type,activity_topic,channel,
        activity_title_raw,activity_content_raw,owner_raw,activity_at,source_created_at
        FROM leadgen.historical_customer_activities WHERE historical_customer_id=$1 ORDER BY activity_at DESC,id DESC`, [id]),
      this.pool.query(`SELECT l.link_status,l.match_method,l.confidence,c.id AS company_id,c.company_name
        FROM leadgen.historical_customer_company_links l JOIN leadgen.companies c ON c.id=l.company_id
        WHERE l.historical_customer_id=$1 ORDER BY l.link_status,l.confidence DESC`, [id])
    ]);
    return { ...customer.rows[0],contacts:contacts.rows,activities:activities.rows,public_company_links:links.rows };
  }

  async getForCompany(companyId) {
    const result = await this.pool.query(`SELECT h.id FROM leadgen.historical_customer_company_links l
      JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
      WHERE l.company_id=$1 AND l.link_status='CONFIRMED' AND h.source_system='OKKI'
      ORDER BY l.confidence DESC,h.updated_at DESC LIMIT 1`, [companyId]);
    return result.rowCount ? this.get(result.rows[0].id) : null;
  }

  async importSummary() {
    const batch = await this.#batch('phase5-v2.3.1-okki-history-001');
    if (!batch) return null;
    const distribution = await this.pool.query(`SELECT activity_type,count(*)::int AS count
      FROM leadgen.historical_customer_activities WHERE source_system='OKKI' GROUP BY activity_type ORDER BY activity_type`);
    const links = await this.pool.query(`SELECT
      count(*) FILTER (WHERE l.link_status='CONFIRMED')::int AS public_confirmed,
      count(*) FILTER (WHERE l.link_status='REVIEW')::int AS public_review
      FROM leadgen.historical_customer_company_links l JOIN leadgen.historical_customers h ON h.id=l.historical_customer_id
      WHERE h.source_system='OKKI'`);
    return { ...batch,win_loss_coverage:'NONE',outcome_count:0,
      activity_distribution:Object.fromEntries(distribution.rows.map(row=>[row.activity_type,row.count])),...links.rows[0] };
  }
}
