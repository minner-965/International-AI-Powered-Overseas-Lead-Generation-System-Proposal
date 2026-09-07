import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Phase 12 visual freeze: aggregate business facts only; no recipients, bodies or secrets.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const run=(command,args,input)=>execFileSync(command,args,{cwd:root,encoding:'utf8',input,timeout:60000,maxBuffer:4*1024*1024});
const snapshot=process.argv[2]||'before';
if(!['before','after','wp03-before','wp03-after','wp05-final','wp06-before','wp08-final','wp09-before','wp11-final','wp12-before','wp14-final','wp14-browser-before','wp14-browser-after','manual-ui-before','manual-ui-after','wp15-before','wp16-after'].includes(snapshot)) throw new Error('Expected a supported before or after snapshot.');
const output=join(root,'artifacts','phase12-ui-baseline',`business-${snapshot}.json`);
if(existsSync(output)) throw new Error('Baseline already exists; preserve the original freeze evidence.');
async function audit(){
  const {default:pg}=await import('pg');
  const client=new pg.Client({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
  await client.connect();
  const rows=async sql=>(await client.query(sql)).rows;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    const result={observed_at:(await rows('SELECT now() observed_at'))[0].observed_at,transaction_read_only:(await rows('SHOW transaction_read_only'))[0].transaction_read_only,counts:{},controlled_counts:{},crm_by_scope:{}};
    for(const table of ['companies','sources','contacts','lead_reviews','collection_runs','research_jobs','business_opportunity_current','outreach_drafts','outreach_approvals','outbound_messages','outbound_message_attempts','inbound_messages','reply_classifications','crm_sync_outbox','opportunity_activities','sales_tasks','contact_suppressions','company_suppressions','outreach_recipient_suppressions']) result.counts[table]=(await rows(`SELECT count(*)::int n FROM leadgen.${table}`))[0].n;
    for(const suffix of ['contexts','drafts','approvals','messages','attempts','inbound_messages','activities','suppressions']) result.controlled_counts[suffix]=(await rows(`SELECT count(*)::int n FROM leadgen.controlled_application_${suffix}`))[0].n;
    for(const table of ['crm_sync_outbox','opportunity_activities','sales_tasks']) result.crm_by_scope[table]=await rows(`SELECT record_scope,count(*)::int count FROM leadgen.${table} GROUP BY 1 ORDER BY 1`);
    result.opportunity_statuses=await rows('SELECT display_opportunity_status,count(*)::int count FROM leadgen.business_opportunity_current GROUP BY 1 ORDER BY 1');
    result.research_statuses=await rows('SELECT status,count(*)::int count FROM leadgen.research_jobs GROUP BY 1 ORDER BY 1');
    result.prospect_transport=await rows('SELECT transport_status,receipt_evidence_status,business_contact_status,count(*)::int count FROM leadgen.outbound_messages GROUP BY 1,2,3 ORDER BY 1,2,3');
    result.prospect_provider_attempts=(await rows('SELECT count(*)::int attempt_rows,count(provider_call_started_at)::int real_provider_calls FROM leadgen.outbound_message_attempts'))[0];
    result.controlled_provider_attempts=(await rows('SELECT count(*)::int attempt_rows,count(provider_call_started_at)::int real_provider_calls FROM leadgen.controlled_application_attempts'))[0];
    result.controlled_transport=await rows('SELECT send_status,count(*)::int count FROM leadgen.controlled_application_messages GROUP BY 1 ORDER BY 1');
    await client.query('ROLLBACK');
    return result;
  }finally{await client.end();}
}
const result={git_head:run('git',['rev-parse','HEAD']).trim(),database:JSON.parse(run('docker',['exec','-i','dpv-leadgen-demo-dashboard-1','node','--input-type=module'],`console.log(JSON.stringify(await (${audit.toString()})()));`)),runtime_flags:{}};
const flagScript=`const keys=['OUTREACH_SEND_SCOPE','OUTREACH_ENABLED','OUTREACH_MANUAL_SEND_ONLY','LIVE_PROSPECT_SEND_APPROVED','CONTROLLED_TEST_MODE','CONTROLLED_TEST_MAX_MESSAGES','SMTP_ENABLED','SMTP_IMAP_INBOUND_SYNC_ENABLED'];console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,process.env[k]??null]))));`;
for(const service of ['demo-dashboard','outreach-worker','category-worker','data-worker']) result.runtime_flags[service]=JSON.parse(run('docker',['exec',`dpv-leadgen-${service}-1`,'node','-e',flagScript]));
result.services=run('docker',['ps','--format','{{.Names}} {{.Status}}']).trim().split('\n');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,...result},null,2));
