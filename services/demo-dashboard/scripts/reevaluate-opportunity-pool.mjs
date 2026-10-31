#!/usr/bin/env node
// Opportunity-pool re-evaluation with the live rule v2_MC08 (Simon's decision 2026-10-27 #1).
//   node scripts/reevaluate-opportunity-pool.mjs [--database-url <url>] [--apply] [--json]
// Dry run by default: a READ ONLY transaction that only lists what would change. With --apply it appends a
// new v2 decision to leadgen.opportunity_pool_decisions ONLY for companies whose band or inputs changed
// (companies whose stored decision has the same band and the same business inputs are left as they are -- contact
// readiness is recomputed live on every read and is not compared -- they get
// a v2 decision on their next evidence refresh). Stored decisions are never updated or deleted.
// Database: --database-url, else POOL_REEVALUATE_DATABASE_URL, else DATABASE_URL.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {OpportunityPoolService} from '../src/opportunityPool/OpportunityPoolService.js';

export const BAND_ZH={PRECISION:'精准',RELEVANT:'相关',GENERAL_RELEVANT:'泛相关',EXPLORATORY:'待研究',NOT_SUITABLE:'不合适'};
const CHANGE_ZH={NEW:'新增决策',BAND_CHANGED:'档位变化',INPUTS_CHANGED:'证据或联系资料有更新'};

export function parseArgs(argv){
  const arg=name=>{const index=argv.indexOf(name);return index>=0?argv[index+1]:null;};
  return{apply:argv.includes('--apply'),json:argv.includes('--json'),
    databaseUrl:arg('--database-url')||process.env.POOL_REEVALUATE_DATABASE_URL||process.env.DATABASE_URL||''};
}

export async function reevaluateOpportunityPool({pool,apply=false}){
  return new OpportunityPoolService({pool}).reevaluate({apply});
}

export function renderSummary(result){
  const lines=[`${result.dry_run?'预览（未写入）Dry run':'已追加 Applied'} · 规则 ${result.rule_version} · 企业 ${result.total} 家`,
    `不变 ${result.counts.UNCHANGED} · 档位变化 ${result.counts.BAND_CHANGED} · 资料更新 ${result.counts.INPUTS_CHANGED} · 新增 ${result.counts.NEW}`+
      (result.dry_run?` · 将追加 ${result.changes.length} 条`:` · 已追加 ${result.appended} 条`)];
  for(const row of result.changes)lines.push(`- ${row.company_name||row.company_id}：${BAND_ZH[row.from_band]||'—'} → ${BAND_ZH[row.to_band]}（${CHANGE_ZH[row.change]}）`);
  return lines.join('\n');
}

async function main(){
  const options=parseArgs(process.argv.slice(2));
  if(!options.databaseUrl)throw new Error('Database URL required: --database-url <url> (or POOL_REEVALUATE_DATABASE_URL / DATABASE_URL)');
  const pool=new pg.Pool({connectionString:options.databaseUrl,max:2});
  try{
    const result=await reevaluateOpportunityPool({pool,apply:options.apply});
    console.log(options.json?JSON.stringify(result,null,1):renderSummary(result));
    if(result.dry_run&&result.changes.length)console.log('\n加 --apply 才会追加以上新版决策（只追加，不改历史）。');
  }finally{await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
