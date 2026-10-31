#!/usr/bin/env node
// Appends a retry row for CRM outbox items that failed permanently because of the website-address
// false positive (CRM_PAYLOAD_PATH_FORBIDDEN, acceptance bug 2026-10-27).
//   node scripts/retry-failed-crm-outbox.mjs [--database-url <url>] [--outbox <id>[,<id>...]] [--apply] [--json]
// Dry run by default. With --apply a NEW PENDING row (idempotency key "<old key>:retry:<old id>") is added per
// failed row; the failed row stays unchanged as history. The regular CRM outbox dispatch (every 10 minutes)
// sends it; merchant rows are held by the database exactly like new merchant rows. Re-running adds nothing.
// Database: --database-url, else CRM_RETRY_DATABASE_URL, else DATABASE_URL.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {retryFailedCrmOutbox} from '../src/crm/outboxRepair.js';

export function parseArgs(argv){
  const values=name=>argv.flatMap((item,index)=>item===name?[argv[index+1]]:[]).filter(Boolean);
  return{apply:argv.includes('--apply'),json:argv.includes('--json'),
    ids:values('--outbox').flatMap(value=>String(value).split(',')).map(value=>value.trim()).filter(Boolean),
    databaseUrl:values('--database-url')[0]||process.env.CRM_RETRY_DATABASE_URL||process.env.DATABASE_URL||''};
}

async function main(){
  const options=parseArgs(process.argv.slice(2));
  if(!options.databaseUrl)throw new Error('Database URL required: --database-url <url> (or CRM_RETRY_DATABASE_URL / DATABASE_URL)');
  const pool=new pg.Pool({connectionString:options.databaseUrl,max:2});
  try{
    const result=await retryFailedCrmOutbox({pool,apply:options.apply,ids:options.ids});
    if(options.json)console.log(JSON.stringify(result,null,1));
    else{
      console.log(`${result.dry_run?'预览（未写入）Dry run':'已追加 Applied'} · 失败记录 ${result.found} 条 · 可重试 ${result.planned.length} 条 · 仍不合规 ${result.rejected.length} 条`);
      for(const item of result.planned)console.log(`- ${item.failed_outbox_id} ${item.operation} → ${item.new_outbox_id||'(待追加)'} ${item.new_sync_status||''}`);
      for(const item of result.rejected)console.log(`- ${item.outbox_id} ${item.operation} 仍不合规：${item.code}`);
      if(result.dry_run&&result.planned.length)console.log('\n加 --apply 才会追加重试记录（原失败记录保留）。');
    }
  }finally{await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
