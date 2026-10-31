#!/usr/bin/env node
// Re-correlates replies that are waiting in REVIEW (acceptance bug 2026-10-27: the mail server rewrote
// the Message-ID, so the reply's In-Reply-To matched no sent email).
//   node scripts/recorrelate-inbound-replies.mjs [--database-url <url>] [--inbound <id>[,<id>...]] [--no-subject-fallback] [--limit N] [--apply] [--json]
// Dry run by default: only lists which replies would match which sent email and how. With --apply each match
// is written (inbound_messages correlation + inbound_correlation_events history row) and the reply then takes
// the normal steps of a correlated reply: classification if missing, then the same CRM effects work
// (timeline activity, CRM state, follow-up task, CRM outbox row; the outbox is sent by the regular CRM dispatch).
// Matching: In-Reply-To/References against the Message-ID SIM set and the Sent-folder aliases (migration 076);
// then, unless --no-subject-fallback, "Re:/RE:/回复:/答复:" + exact sent subject from the exact recipient to the
// same mailbox within 60 days with exactly one candidate (SUBJECT_FALLBACK, LOW confidence).
// Idempotent: replies already MATCHED are not touched; re-running finds nothing new. Never sends email.
// Database: --database-url, else RECORRELATE_DATABASE_URL, else DATABASE_URL.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {Phase7Service} from '../src/phase7/service.js';
import {inlineReplyQueue} from '../src/phase7/replyCorrelation.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv){
  const values=name=>argv.flatMap((item,index)=>item===name?[argv[index+1]]:[]).filter(Boolean);
  const inboundIds=values('--inbound').flatMap(value=>String(value).split(',')).map(value=>value.trim()).filter(Boolean);
  const bad=inboundIds.filter(value=>!UUID.test(value));
  if(bad.length)throw new Error(`--inbound must be UUIDs: ${bad.join(', ')}`);
  return{apply:argv.includes('--apply'),json:argv.includes('--json'),subjectFallback:!argv.includes('--no-subject-fallback'),inboundIds,
    limit:Number(values('--limit')[0])||200,
    databaseUrl:values('--database-url')[0]||process.env.RECORRELATE_DATABASE_URL||process.env.DATABASE_URL||''};
}

/** env: the app's environment (only used to build the service; no provider is called). */
export async function recorrelateInboundReplies({pool,apply=false,inboundIds=[],subjectFallback=true,limit=200,env={}}){
  const service=new Phase7Service({pool,env,audit:()=>{}});
  const queue=inlineReplyQueue(service);service.queue=queue;
  const result=await service.replyCorrelation().recorrelateReviewReplies({apply,inboundIds,subjectFallback,limit,recordedBy:'REPAIR_SCRIPT'});
  if(apply){
    const ids=result.matched.filter(item=>item.applied).map(item=>item.inbound_message_id);
    const effects=ids.length?(await pool.query(`SELECT i.id inbound_message_id,i.correlation_status,i.correlation_method,i.correlation_confidence,t.thread_status,
        (SELECT count(*)::int FROM leadgen.opportunity_activities a WHERE a.inbound_message_id=i.id) activities,
        (SELECT count(*)::int FROM leadgen.sales_tasks s WHERE s.inbound_message_id=i.id) tasks
      FROM leadgen.inbound_messages i LEFT JOIN leadgen.outreach_threads t ON t.id=i.thread_id WHERE i.id=ANY($1::uuid[])`,[ids])).rows:[];
    result.effects=effects;result.steps=queue.ran;
  }
  return result;
}

const METHOD_ZH={IN_REPLY_TO:'回复头',IN_REPLY_TO_ALIAS:'回复头（服务器改写的邮件编号）',REFERENCES:'引用头',REFERENCES_ALIAS:'引用头（服务器改写的邮件编号）',
  MESSAGE_KEY:'邮件标识头',PROVIDER_THREAD:'会话编号',SUBJECT_FALLBACK:'主题兜底（低置信度）'};
export function renderSummary(result){
  const lines=[`${result.dry_run?'预览（未写入）Dry run':'已写入 Applied'} · 待核对回复 ${result.reviewed} 封 · 可关联 ${result.matched.length} 封 · 仍待人工 ${result.unmatched.length} 封`];
  for(const item of result.matched)lines.push(`- ${item.inbound_message_id} → 发出邮件 ${item.outbound_message_id}（${METHOD_ZH[item.correlation_method]||item.correlation_method}）${item.applied===false?' 已跳过':''}${item.step?` · ${item.step}`:''}${item.downstream_error?` · 后续步骤失败：${item.downstream_error}`:''}`);
  for(const item of result.effects||[])lines.push(`  ${item.inbound_message_id}: ${item.correlation_status}/${item.correlation_method} 会话 ${item.thread_status} · 活动 ${item.activities} · 任务 ${item.tasks}`);
  return lines.join('\n');
}

async function main(){
  const options=parseArgs(process.argv.slice(2));
  if(!options.databaseUrl)throw new Error('Database URL required: --database-url <url> (or RECORRELATE_DATABASE_URL / DATABASE_URL)');
  const pool=new pg.Pool({connectionString:options.databaseUrl,max:2});
  try{
    const result=await recorrelateInboundReplies({pool,...options,env:process.env});
    console.log(options.json?JSON.stringify(result,null,1):renderSummary(result));
    if(result.dry_run&&result.matched.length)console.log('\n加 --apply 才会写入以上关联并执行后续步骤（只追加历史，不发邮件）。');
  }finally{await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
