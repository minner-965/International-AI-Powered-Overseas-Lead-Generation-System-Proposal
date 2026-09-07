import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only production audit. Output contains identifiers and counts, never recipients or secrets.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const run=(command,args,input)=>execFileSync(command,args,{cwd:root,encoding:'utf8',input,maxBuffer:16*1024*1024,timeout:120000});
const git=(...args)=>run('git',args).trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-');
const evidenceRoot=join(root,'artifacts','phase11-controlled-outreach',stamp);
mkdirSync(evidenceRoot,{recursive:true});
const save=(name,value)=>writeFileSync(join(evidenceRoot,name),JSON.stringify(value,null,2)+'\n');
const baseline={observed_at:new Date().toISOString(),root:git('rev-parse','--show-toplevel'),
  branch:git('branch','--show-current'),head:git('rev-parse','HEAD'),
  status:git('status','--porcelain=v1'),diff_check:run('git',['diff','--check'])};
save('00-git.json',baseline);

async function productionAudit(){
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1});
  const client=await pool.connect();
  const rows=async sql=>(await client.query(sql)).rows;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    const result={observed_at:new Date().toISOString(),transaction_read_only:(await rows('SHOW transaction_read_only'))[0].transaction_read_only};
    result.ledger=await rows('SELECT migration_key,checksum_sha256,applied_at FROM leadgen.schema_migrations ORDER BY migration_key');
    result.counts={};
    for(const table of ['companies','sources','contacts','lead_reviews','collection_runs','research_jobs',
      'business_opportunity_current','decision_makers','decision_maker_contacts','company_contact_route_current',
      'auto_evidence_tasks','provider_usage_events','commercial_product_fit_results','official_route_manual_tasks']){
      result.counts[table]=(await rows(`SELECT count(*)::int n FROM leadgen.${table}`))[0].n;
    }
    result.side_effects={};
    for(const table of ['business_opportunity_management_events','marketing_context_approvals','outreach_drafts','outreach_approvals',
      'outbound_messages','outbound_message_attempts','email_message_events','email_webhook_inbox','inbound_messages',
      'reply_classifications','contact_suppressions','company_suppressions','crm_sync_outbox','sales_tasks','gmail_ambiguous_send_events','gmail_mailbox_checkpoints']){
      result.side_effects[table]=(await rows(`SELECT count(*)::int n FROM leadgen.${table}`))[0].n;
    }
    result.provider_usage=await rows('SELECT provider,endpoint,count(*)::int events,coalesce(sum(used_units),0) used_units FROM leadgen.provider_usage_events GROUP BY 1,2 ORDER BY 1,2');
    result.opportunity_statuses=await rows('SELECT display_opportunity_status,count(*)::int count FROM leadgen.business_opportunity_current GROUP BY 1 ORDER BY 1');
    result.route_statuses=await rows('SELECT contact_type,evidence_origin,verification_status,count(*)::int count FROM leadgen.company_contact_route_current GROUP BY 1,2,3 ORDER BY 1,2,3');
    result.legacy_contact_statuses=await rows("SELECT coalesce(contact_verification_status,email_verification_status,'UNKNOWN') verification_status,lifecycle_status,count(*)::int count FROM leadgen.contacts WHERE nullif(business_email,'') IS NOT NULL OR contact_type='EMAIL' GROUP BY 1,2 ORDER BY 1,2");
    result.rule_checks=(await rows(`SELECT
      (SELECT count(*)::int FROM leadgen.official_route_manual_task_current WHERE retired_policy=false) active_manual_routes,
      (SELECT count(*)::int FROM leadgen.official_route_manual_tasks WHERE created_at >=
        (SELECT applied_at FROM leadgen.schema_migrations WHERE migration_key='049_phase10_1_category_contact_simplification.sql')) manual_routes_created_since_049,
      (SELECT count(*)::int FROM leadgen.category_procurement_match_results WHERE match_status='CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE' AND created_at >=
        (SELECT applied_at FROM leadgen.schema_migrations WHERE migration_key='049_phase10_1_category_contact_simplification.sql')) legacy_buying_status_created_since_049,
      (SELECT count(*)::int FROM leadgen.auto_evidence_tasks WHERE task_status NOT IN ('COMPLETED','CANCELLED','EVIDENCE_EXHAUSTED')
        AND business_blocker ~ '(PRODUCT|SUPPLIER|PROCUREMENT)') active_legacy_hard_blockers,
      (SELECT count(*)::int FROM leadgen.business_opportunity_current WHERE reason_codes::text ~ '(PRODUCT_SCOPE_REQUIRED|SUPPLIER_ACCESS|EXACT_SKU|PROCUREMENT_ROUTE_REQUIRED|CATEGORY_MATCH_NEEDS_BUYING_EVIDENCE)') current_legacy_opportunity_blockers,
      (SELECT count(*)::int FROM leadgen.research_jobs WHERE status IN ('QUEUED','DISCOVERING','CRAWLING','QUALIFYING','SCORING')) active_research_jobs`))[0];
    const verifiers=await import('/app/src/phase7/migrationRunner.js');
    result.installed_schema={};
    for(const [key,name] of Object.entries({'049':'verifyPhase10CategoryContactSimplificationMigration','050':'verifyPhase10CategoryStatusCompatibilityMigration','051':'verifyPhase10CategoryReadinessCompatibilityMigration'})){
      result.installed_schema[key]=await verifiers[name](client);
    }
    result.opportunity_inventory=await rows(`SELECT o.id opportunity_id,o.company_id,o.product_profile,o.display_opportunity_status,
      o.relationship_status,o.policy_contact_status,c.verification_status company_verification,c.lifecycle_status,
      EXISTS(SELECT 1 FROM leadgen.company_suppressions s WHERE s.company_id=o.company_id AND s.lifted_at IS NULL) company_suppressed,
      EXISTS(SELECT 1 FROM leadgen.contact_suppressions s WHERE s.company_id=o.company_id AND s.lifted_at IS NULL) any_contact_suppressed,
      count(r.id)::int route_count,
      count(r.id) FILTER(WHERE r.contact_type IN ('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL'))::int email_routes,
      count(r.id) FILTER(WHERE r.contact_type IN ('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL') AND r.evidence_origin='OFFICIAL_SITE_OBSERVED' AND nullif(r.source_url,'') IS NOT NULL)::int official_source_email_routes,
      count(r.id) FILTER(WHERE r.contact_type IN ('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL') AND dm.person_name IS NOT NULL AND dm.verification_status='VERIFIED')::int verified_named_person_email_routes,
      count(r.id) FILTER(WHERE r.contact_type IN ('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL') AND r.verification_status='VALID' AND r.last_verified_at BETWEEN now()-interval '30 days' AND now())::int fresh_valid_email_routes,
      count(r.id) FILTER(WHERE r.contact_type IN ('BUSINESS_PHONE','BUSINESS_WHATSAPP','CONTACT_FORM'))::int manual_routes
      FROM leadgen.business_opportunity_current o JOIN leadgen.companies c ON c.id=o.company_id
      LEFT JOIN leadgen.company_contact_route_current r ON r.company_id=o.company_id
      LEFT JOIN leadgen.decision_makers dm ON dm.id=r.decision_maker_id
      GROUP BY o.id,o.company_id,o.product_profile,o.display_opportunity_status,o.relationship_status,o.policy_contact_status,c.verification_status,c.lifecycle_status ORDER BY o.id`);
    const items=result.opportunity_inventory;
    result.opportunity_classification={unit:'current company/category opportunity rows; contact columns may overlap',
      total:items.length,distinct_companies:new Set(items.map(i=>i.company_id)).size,
      recommended:items.filter(i=>i.display_opportunity_status==='RECOMMENDED').length,
      with_verified_named_person_email:items.filter(i=>i.verified_named_person_email_routes>0).length,
      with_official_source_email:items.filter(i=>i.official_source_email_routes>0).length,
      only_phone_whatsapp_form:items.filter(i=>i.email_routes===0&&i.manual_routes>0).length,
      no_current_contact_route:items.filter(i=>i.route_count===0).length,
      suppressed:items.filter(i=>i.company_suppressed||i.any_contact_suppressed||i.relationship_status==='SUPPRESSED').length,
      historical_customer:items.filter(i=>['EXISTING_CUSTOMER','INTERNAL_EXISTING_CUSTOMER'].includes(i.relationship_status)).length,
      historical_review:items.filter(i=>i.relationship_status==='HISTORICAL_REVIEW').length,
      recommended_with_official_source_email:items.filter(i=>i.display_opportunity_status==='RECOMMENDED'&&i.official_source_email_routes>0).length};
    // This audit proves zero eligible candidates only when every current email route lacks fresh mailbox verification.
    // A nonzero count requires recipient-level source/domain/role/suppression review in WP-P11-04; it is never auto-approved here.
    const validRouteCount=(await rows("SELECT count(*)::int n FROM leadgen.company_contact_route_current WHERE contact_type IN ('BUSINESS_EMAIL','GENERIC_BUSINESS_EMAIL','DEPARTMENT_EMAIL') AND verification_status='VALID' AND last_verified_at BETWEEN now()-interval '30 days' AND now()"))[0].n;
    result.email_send_eligible_candidates={count:validRouteCount===0?0:null,status:validRouteCount===0?'NO_FRESH_VALID_MAILBOX':'RECIPIENT_LEVEL_REVIEW_REQUIRED',
      fresh_valid_email_routes:validRouteCount,approval_created:false,eligibility_persisted:false};
    await client.query('ROLLBACK');
    return result;
  }finally{client.release();await pool.end();}
}
const audit=JSON.parse(run('docker',['exec','-i','dpv-leadgen-demo-dashboard-1','node','--input-type=module'],`console.log(JSON.stringify(await (${productionAudit.toString()})()));`));
save('01-database-readonly.json',audit);
const migrations=readdirSync(join(root,'database','migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort().map(name=>{
  const digest=hash(readFileSync(join(root,'database','migrations',name)));
  const committed=execFileSync('git',['show',`HEAD:database/migrations/${name}`],{cwd:root});
  const ledger=audit.ledger.find(r=>r.migration_key===name);
  return {name,sha256:digest,head_sha256:hash(committed),matches_head:digest===hash(committed),
    ledger_sha256:ledger?.checksum_sha256??null,ledger_status:ledger?(digest===ledger.checksum_sha256?'MATCH':'MISMATCH'):'LEGACY_PRE_LEDGER'};
});
save('02-migrations.json',migrations);
const flagScript=`const bool=value=>/^(1|true|yes|on)$/i.test(String(value||''));const present=value=>Boolean(String(value||'').trim());const keys=['MAIL_PROVIDER_VENDOR','OUTBOUND_EMAIL_PROVIDER','INBOUND_EMAIL_PROVIDER','GMAIL_API_ENABLED','GMAIL_INBOUND_SYNC_ENABLED','SMTP_ENABLED','SMTP_IMAP_INBOUND_SYNC_ENABLED','OUTREACH_ENABLED','LIVE_PROSPECT_SEND_APPROVED'];const flags=Object.fromEntries(keys.map(k=>[k,process.env[k]??null]));flags.safe_mail_config={smtp_configured:[process.env.SMTP_HOST,process.env.SMTP_USER,process.env.SMTP_PASSWORD,process.env.SMTP_FROM_EMAIL].every(present),imap_configured:[process.env.IMAP_HOST,process.env.IMAP_USER,process.env.IMAP_PASSWORD].every(present),smtp_port:Number(process.env.SMTP_PORT||0),imap_port:Number(process.env.IMAP_PORT||0),smtp_starttls:!bool(process.env.SMTP_SECURE)&&bool(process.env.SMTP_REQUIRE_TLS),imap_tls:bool(process.env.IMAP_TLS),controlled_recipient_configured:present(process.env.SMTP_CONTROLLED_RECIPIENT_ALLOWLIST)};console.log(JSON.stringify(flags));`;
const flags={};
for(const name of ['demo-dashboard','category-worker','outreach-worker','data-worker']) flags[name]=JSON.parse(run('docker',['exec',`dpv-leadgen-${name}-1`,'node','-e',flagScript]));
save('03-runtime-flags.json',flags);
const services=run('docker',['ps','--format','{{.Names}} {{.Status}}']);
save('04-services.json',{observed_at:new Date().toISOString(),services});
const health={};
for(const path of ['/api/health','/']){const response=await fetch(`http://localhost:3000${path}`);health[path]={status:response.status};await response.arrayBuffer();}
save('05-http-health.json',health);
async function runtimeSourceHashes(){
  const fs=await import('node:fs');const path=await import('node:path');const crypto=await import('node:crypto');
  const result={};
  const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const name=path.join(directory,entry.name);
    if(entry.isDirectory())walk(name);
    else if(/\.(js|mjs|html|css)$/.test(name))result[path.relative('/app',name)]=crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');
  }};
  walk('/app/src');walk('/app/public');return result;
}
const deployed=JSON.parse(run('docker',['exec','-i','dpv-leadgen-demo-dashboard-1','node','--input-type=module'],`console.log(JSON.stringify(await (${runtimeSourceHashes.toString()})()));`));
const mismatches=Object.entries(deployed).filter(([name,digest])=>hash(readFileSync(join(root,'services','demo-dashboard',name)))!==digest).map(([name])=>name);
save('06-deployed-source.json',{files_compared:Object.keys(deployed).length,mismatches});
console.log(JSON.stringify({evidence_root:evidenceRoot,counts:audit.counts,side_effects:audit.side_effects,
  rules:audit.rule_checks,opportunities:audit.opportunity_classification,email_candidates:audit.email_send_eligible_candidates,
  migration_files:migrations.length,head_mismatches:migrations.filter(m=>!m.matches_head).length,
  ledger_mismatches:migrations.filter(m=>m.ledger_status==='MISMATCH').length,
  pre_ledger_files:migrations.filter(m=>m.ledger_status==='LEGACY_PRE_LEDGER').length,flags,health,
  deployed_files_compared:Object.keys(deployed).length,deployed_mismatches:mismatches},null,2));
