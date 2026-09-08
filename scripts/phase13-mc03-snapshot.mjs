import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const out=join(root,'artifacts','phase13-mc03',new Date().toISOString().replace(/[:.]/g,'-'),'snapshot.json');
execFileSync('git',['check-ignore','--quiet',out],{cwd:root});
if(existsSync(out))throw Error('Snapshot path already exists');
async function collect(){
 const {default:pg}=await import('pg');
 const c=new pg.Client({host:process.env.POSTGRES_HOST||'postgres',database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,options:'-c default_transaction_read_only=on'});
 await c.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SET LOCAL statement_timeout='30s'");
  const q=async(sql)=>(await c.query(sql)).rows;
  const data={observed_at:(await q('SELECT now() value'))[0].value,transaction_read_only:(await q('SHOW transaction_read_only'))[0].transaction_read_only,transaction_isolation:(await q('SHOW transaction_isolation'))[0].transaction_isolation,tables:{},table_mapping:{company_contact_routes:'company_contact_route_current'},columns:{}};
  const names=['companies','sources','prospect_category_observations','prospect_category_sources','business_opportunity_current','company_contact_route_current','contacts','company_suppressions','contact_suppressions','outreach_recipient_suppressions','outbound_messages','buyer_business_model_results','buyer_business_model_evidence','category_procurement_match_results','category_procurement_match_evidence','category_procurement_match_scope_links','dpv_product_category_scope_current','company_verification_evidence','dpv_product_category_scope_aliases','dpv_product_category_scope_revisions','decision_makers','decision_maker_contacts','outreach_recipients'];
  for(const name of names){
   if(!/^[a-z_]+$/.test(name))throw Error('Invalid table name');
   const key=name==='company_contact_route_current'?'company_contact_routes':name;
   data.tables[key]=await q(`SELECT * FROM leadgen.${name}`);
   data.columns[key]=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='leadgen' AND table_name=$1 ORDER BY ordinal_position",[name])).rows.map(row=>row.column_name);
  }
  // Approval linkage only: no message subject/body, mailbox headers, password or provider credentials.
  data.tables.outreach_approvals=await q('SELECT id,company_id,opportunity_snapshot_id,draft_id,decision,approved_at FROM leadgen.outreach_approvals');
  data.tables.outreach_drafts=await q('SELECT id,company_id,recipient_id,eligibility_snapshot_id,draft_status,version,created_at,updated_at FROM leadgen.outreach_drafts');
  data.absent_requested_tables=['company_verifications'];
  data.business_table_hashes={};data.runtime_table_hashes={};
  const baseTables=await q("SELECT tablename FROM pg_tables WHERE schemaname='leadgen' ORDER BY tablename");
  for(const {tablename} of baseTables){
    if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw Error('Invalid ledger table name');
    const digest=(await q(`SELECT count(*)::int count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) content_md5 FROM (SELECT md5(row_to_json(t)::text) row_hash FROM leadgen.${tablename} t) s`))[0];
    const target=/checkpoint|heartbeat/.test(tablename)?data.runtime_table_hashes:data.business_table_hashes;
    target[tablename]=digest;
  }
  await c.query('ROLLBACK');return data;
 }finally{await c.end();}
}
const raw=execFileSync('docker',['exec','-i','dpv-leadgen-demo-dashboard-1','node','--input-type=module'],{cwd:root,input:`console.log(JSON.stringify(await (${collect.toString()})()));`,encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});
const data=JSON.parse(raw);
// Evidence payloads are preserved except any unexpectedly embedded credential-named fields.
function sanitize(value){if(Array.isArray(value))return value.map(sanitize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|private[_-]?key)/i.test(key)).map(([key,v])=>[key,sanitize(v)]));return value;}
const snapshot=sanitize(data);snapshot.schema_version='MC03_READONLY_V1';snapshot.provider_calls=0;snapshot.business_writes=0;
mkdirSync(dirname(out),{recursive:true});const text=JSON.stringify(snapshot,null,2);writeFileSync(out,text+'\n');
console.log(JSON.stringify({path:out,sha256:createHash('sha256').update(text+'\n').digest('hex'),observed_at:snapshot.observed_at,transaction_read_only:snapshot.transaction_read_only,transaction_isolation:snapshot.transaction_isolation,counts:Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,rows.length])),schema_version:snapshot.schema_version}));
if(process.argv[2]){
 const before=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const compare=key=>[...new Set([...Object.keys(before[key]||{}),...Object.keys(snapshot[key]||{})])].sort().map(table=>({table,before:before[key]?.[table]||null,after:snapshot[key]?.[table]||null})).filter(row=>JSON.stringify(row.before)!==JSON.stringify(row.after));
 const result={before_observed_at:before.observed_at,after_observed_at:snapshot.observed_at,business_tables_checked:Object.keys(snapshot.business_table_hashes).length,runtime_tables_checked:Object.keys(snapshot.runtime_table_hashes).length,business_changes:compare('business_table_hashes'),runtime_changes:compare('runtime_table_hashes'),task_provider_calls:0,task_email_sends:0,task_business_writes:0};
 const verification=join(dirname(out),'verification.json');writeFileSync(verification,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({verification,...result}));
}
