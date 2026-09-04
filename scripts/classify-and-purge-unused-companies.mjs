import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const workspacePackage=new URL('../services/demo-dashboard/package.json',import.meta.url);
const runtimePackage=new URL('../package.json',import.meta.url);
const require=createRequire(existsSync(fileURLToPath(workspacePackage))?workspacePackage:runtimePackage);
const {Pool}=require('pg');
const hash=value=>crypto.createHash('sha256').update(String(value??'')).digest('hex');
const quote=value=>`"${String(value).replaceAll('"','""')}"`;

function parseArgs(argv){
  const result={apply:false};
  for(const arg of argv){if(arg==='--apply')result.apply=true;else if(arg!=='--dry-run')throw new Error(`Unknown argument: ${arg}`);}
  return result;
}

export class UnusedCompanyPurge{
  constructor({pool}){this.pool=pool;}

  async companyReferenceColumns(client=this.pool){
    return (await client.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='leadgen' AND column_name='company_id' AND table_name<>'companies' ORDER BY table_name`)).rows;
  }

  async referenceCount(companyId,columns,client=this.pool){
    let count=0;const byTable={};
    for(const ref of columns){
      const found=Number((await client.query(`SELECT count(*)::int count FROM leadgen.${quote(ref.table_name)}
        WHERE ${quote(ref.column_name)}=$1`,[companyId])).rows[0].count);
      if(found){byTable[ref.table_name]=found;count+=found;}
    }
    return{count,byTable};
  }

  async classify(client=this.pool){
    const columns=await this.companyReferenceColumns(client);
    const companies=(await client.query(`SELECT * FROM leadgen.companies ORDER BY created_at,id`)).rows;
    const items=[];
    for(const company of companies){
      const refs=await this.referenceCount(company.id,columns,client);
      const fake=/(^|\b)(test|demo|fixture|sample|fake)(\b|$)/i.test(`${company.company_name||''} ${company.data_origin||''}`);
      const merged=company.lifecycle_status==='DUPLICATE'&&Boolean(company.replaced_by_company_id);
      const unverified=company.verification_status!=='VERIFIED';
      const noDomain=!company.official_root_domain&&!company.normalized_domain;
      const eligible=(fake||merged)&&unverified&&noDomain&&refs.count===0;
      const negative=['INVALID','ARCHIVED'].includes(company.lifecycle_status)||company.verification_status==='REJECTED';
      items.push({company_id_hash:hash(company.id),classification:eligible?'SAFE_UNUSED_TEST_OR_MERGED_DUPLICATE'
        :negative?'REAL_NEGATIVE_PRESERVE_HISTORY':'BUSINESS_COMPANY_PRESERVE',reference_count:refs.count,
        hard_delete_eligible:eligible});
    }
    return{items,summary:{SAFE_UNUSED_TEST_OR_MERGED_DUPLICATE:items.filter(item=>item.hard_delete_eligible).length,
      REAL_NEGATIVE_PRESERVE_HISTORY:items.filter(item=>item.classification==='REAL_NEGATIVE_PRESERVE_HISTORY').length,
      BUSINESS_COMPANY_PRESERVE:items.filter(item=>item.classification==='BUSINESS_COMPANY_PRESERVE').length}};
  }

  async apply(){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('LOCK TABLE leadgen.companies IN SHARE ROW EXCLUSIVE MODE');
      const columns=await this.companyReferenceColumns(client);
      const companies=(await client.query(`SELECT * FROM leadgen.companies ORDER BY created_at,id FOR UPDATE`)).rows;
      const eligible=[];
      for(const company of companies){
        const refs=await this.referenceCount(company.id,columns,client);
        const fake=/(^|\b)(test|demo|fixture|sample|fake)(\b|$)/i.test(`${company.company_name||''} ${company.data_origin||''}`);
        const merged=company.lifecycle_status==='DUPLICATE'&&Boolean(company.replaced_by_company_id);
        if((fake||merged)&&company.verification_status!=='VERIFIED'&&!company.official_root_domain&&!company.normalized_domain&&refs.count===0)eligible.push(company);
      }
      const deleted=eligible.length?(await client.query('DELETE FROM leadgen.companies WHERE id=ANY($1::uuid[])',[eligible.map(row=>row.id)])).rowCount:0;
      await client.query('COMMIT');
      return{deleted_companies:deleted,preservation_rule:'REAL_NEGATIVES_AND_ALL_REFERENCED_COMPANIES_RETAINED'};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const pool=new Pool({host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),
    database:process.env.POSTGRES_DB||'leadgen',user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,max:4});
  try{
    const service=new UnusedCompanyPurge({pool});
    const result=args.apply?await service.apply():await service.classify();
    console.log(JSON.stringify({mode:args.apply?'APPLY':'DRY_RUN',...result},null,2));
  }finally{await pool.end();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
