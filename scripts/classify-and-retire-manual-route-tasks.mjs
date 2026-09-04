import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const workspacePackage=new URL('../services/demo-dashboard/package.json',import.meta.url);
const runtimePackage=new URL('../package.json',import.meta.url);
const require=createRequire(existsSync(fileURLToPath(workspacePackage))?workspacePackage:runtimePackage);
const {Pool}=require('pg');
const hash=value=>crypto.createHash('sha256').update(String(value??'')).digest('hex');

function parseArgs(argv){
  const result={apply:false};
  for(const arg of argv){
    if(arg==='--apply')result.apply=true;
    else if(arg!=='--dry-run')throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

const businessCounts=async client=>(await client.query(`SELECT
  (SELECT count(*)::int FROM leadgen.companies) companies,
  (SELECT count(*)::int FROM leadgen.sources) sources,
  (SELECT count(*)::int FROM leadgen.decision_makers) decision_makers,
  (SELECT count(*)::int FROM leadgen.decision_maker_contacts) decision_maker_contacts,
  (SELECT count(*)::int FROM leadgen.business_opportunity_current) opportunities,
  (SELECT count(*)::int FROM leadgen.provider_usage_events) provider_usage_events,
  (SELECT count(*)::int FROM leadgen.outbound_messages) outbound_messages,
  (SELECT count(*)::int FROM leadgen.crm_sync_outbox) crm_sync_outbox`)).rows[0];

export class ManualRouteTaskRetirement{
  constructor({pool}){this.pool=pool;}

  async classify(client=this.pool){
    const rows=(await client.query(`WITH current_rows AS (
      SELECT c.*,count(*) OVER(PARTITION BY c.company_id,c.route_type,
        lower(coalesce(c.official_contact,c.official_url))) canonical_count,
        row_number() OVER(PARTITION BY c.company_id,c.route_type,
          lower(coalesce(c.official_contact,c.official_url))
          ORDER BY (c.owner_identity IS NOT NULL) DESC,c.revision DESC,c.created_at DESC,c.id DESC) canonical_rank,
        (SELECT count(*) FROM leadgen.official_route_manual_tasks h WHERE h.task_key=c.task_key) revision_count
      FROM leadgen.official_route_manual_task_current c)
      SELECT * FROM current_rows ORDER BY company_id,route_type,canonical_rank,created_at,id`)).rows;
    const items=rows.map(row=>{
      let classification='AMBIGUOUS';
      if(Number(row.revision_count)>1||row.owner_identity||row.outcome||row.manual_action_status!=='READY'){
        classification='HAS_REVIEW_AUDIT';
      }else if(Number(row.canonical_rank)>1){
        classification='DUPLICATE_COMPANY_ROUTE_TASK';
      }else if(['SYSTEM_RECONCILIATION','WP13_ACCEPTANCE','local-demo'].includes(row.created_by)){
        classification='EMPTY_AUTO_GENERATED_NO_ACTION';
      }
      return{
        task_key_hash:hash(row.task_key),company_id_hash:hash(row.company_id),route_type:row.route_type,
        revision:Number(row.revision),revision_count:Number(row.revision_count),manual_action_status:row.manual_action_status,
        classification,planned_action:classification==='HAS_REVIEW_AUDIT'?'APPEND_RETIRED_POLICY_AUDIT'
          :['EMPTY_AUTO_GENERATED_NO_ACTION','DUPLICATE_COMPANY_ROUTE_TASK'].includes(classification)?'DELETE_WRAPPER_ONLY':'PRESERVE'
      };
    });
    const names=['EMPTY_AUTO_GENERATED_NO_ACTION','DUPLICATE_COMPANY_ROUTE_TASK','HAS_REVIEW_AUDIT','HAS_DOWNSTREAM_ACTION','AMBIGUOUS'];
    return{items,summary:Object.fromEntries(names.map(name=>[name,items.filter(item=>item.classification===name).length]))};
  }

  async apply(){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('LOCK TABLE leadgen.official_route_manual_tasks IN SHARE ROW EXCLUSIVE MODE');
      const before=await businessCounts(client);
      const raw=(await client.query(`WITH current_rows AS (
        SELECT c.*,row_number() OVER(PARTITION BY c.company_id,c.route_type,
          lower(coalesce(c.official_contact,c.official_url))
          ORDER BY (c.owner_identity IS NOT NULL) DESC,c.revision DESC,c.created_at DESC,c.id DESC) canonical_rank,
          (SELECT count(*) FROM leadgen.official_route_manual_tasks h WHERE h.task_key=c.task_key) revision_count
        FROM leadgen.official_route_manual_task_current c)
        SELECT * FROM current_rows ORDER BY created_at,id`)).rows;
      const deletes=[];const audits=[];const preserved=[];
      for(const row of raw){
        const hasAudit=Number(row.revision_count)>1||row.owner_identity||row.outcome||row.manual_action_status!=='READY';
        if(hasAudit)audits.push(row);
        else if(Number(row.canonical_rank)>1||['SYSTEM_RECONCILIATION','WP13_ACCEPTANCE','local-demo'].includes(row.created_by))deletes.push(row);
        else preserved.push(row);
      }
      if(preserved.length)throw Object.assign(new Error('Ambiguous manual route wrappers detected; apply stopped'),{code:'AMBIGUOUS_ROUTE_TASKS'});
      for(const row of audits){
        if(row.manual_action_status==='DISMISSED'&&row.outcome==='RETIRED_POLICY')continue;
        const nextRevision=Number(row.revision)+1;
        await client.query(`INSERT INTO leadgen.official_route_manual_tasks
          (task_type,task_key,revision,previous_revision_id,company_id,product_profile,route_type,
           official_url,official_contact,source_id,verified_at,captured_at,owner_identity,
           manual_action_status,outcome,qualification_basis,created_by,idempotency_key)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DISMISSED','RETIRED_POLICY',$14,
            'phase10.1-wp-b06',$15)`,[
          row.task_type,row.task_key,nextRevision,row.id,row.company_id,row.product_profile,row.route_type,
          row.official_url,row.official_contact,row.source_id,row.verified_at,row.captured_at,row.owner_identity,
          JSON.stringify({...row.qualification_basis,retirement_reason:'POLICY_REMOVED_MANUAL_ROUTE_QUEUE'}),
          hash(`${row.task_key}:${nextRevision}:RETIRED_POLICY`)
        ]);
      }
      if(deletes.length){
        await client.query("SET LOCAL session_replication_role='replica'");
        await client.query('DELETE FROM leadgen.official_route_manual_tasks WHERE task_key=ANY($1::text[])',[
          deletes.map(row=>row.task_key)
        ]);
        await client.query("SET LOCAL session_replication_role='origin'");
      }
      const after=await businessCounts(client);
      if(JSON.stringify(before)!==JSON.stringify(after))throw Object.assign(new Error('Business preservation invariant failed'),{
        code:'BUSINESS_DATA_DELTA',before,after
      });
      await client.query('COMMIT');
      return{deleted_wrapper_task_keys:deletes.length,retired_audit_task_keys:audits.length,preserved_ambiguous:0,
        business_data_delta:Object.fromEntries(Object.keys(before).map(key=>[key,Number(after[key])-Number(before[key])]))};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const pool=new Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,max:4});
  try{
    const service=new ManualRouteTaskRetirement({pool});
    const result=args.apply?await service.apply():await service.classify();
    console.log(JSON.stringify({mode:args.apply?'APPLY':'DRY_RUN',...result},null,2));
  }finally{await pool.end();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
