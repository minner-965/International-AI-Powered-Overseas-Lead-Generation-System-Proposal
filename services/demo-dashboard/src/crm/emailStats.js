// 发信效果 / Email results (plan item 6): emails sent, replies, hard bounces and complaints per UTC day
// (last 30 days) or per month (last 12 months) for one owner (SIM = merchant_id NULL, or one merchant),
// plus a warning per sending mailbox. These warnings only inform; the automatic pause rules stay in
// src/outreach/senderHealth.js and are not changed by anything here. Transactional mail is not counted.
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export const EMAIL_STATS_RANGES=Object.freeze(['30d','12m']);
export const EMAIL_WARNING_THRESHOLDS=Object.freeze({bounceHigh:5,bounceWatch:2,lowReplySent:50,lowReplyRate:1,dailyVolume:40});

const pct=(part,whole)=>whole?Math.round(part/whole*1000)/10:null;

/** Warning level for one mailbox: HIGH (bounces ≥5%), WATCH (bounces ≥2%, 50+ sent with <1% replies, or a day with 40+ sent). */
export function mailboxWarnings(totals={},daily=[]){
  const t=EMAIL_WARNING_THRESHOLDS;
  const sent=Number(totals.sent)||0,bounced=Number(totals.bounced)||0,replied=Number(totals.replied)||0;
  const bounceRate=pct(bounced,sent),replyRate=pct(replied,sent);
  const maxDaily=Math.max(0,Number(totals.max_daily_sent)||0,...daily.map(row=>Number(row.sent)||0));
  const reasons=[];
  if(bounceRate!==null&&bounceRate>=t.bounceHigh)reasons.push('BOUNCE_HIGH');
  else if(bounceRate!==null&&bounceRate>=t.bounceWatch)reasons.push('BOUNCE_WATCH');
  if(sent>=t.lowReplySent&&replyRate<t.lowReplyRate)reasons.push('LOW_REPLIES');
  if(maxDaily>=t.dailyVolume)reasons.push('DAILY_VOLUME');
  if(Number(totals.complained)>0)reasons.push('COMPLAINTS');
  return{level:reasons.includes('BOUNCE_HIGH')?'HIGH':reasons.length?'WATCH':'OK',reasons,bounce_rate:bounceRate,reply_rate:replyRate,max_daily_sent:maxDaily};
}

export class EmailStatsService{
  constructor({pool,now=()=>new Date()}){Object.assign(this,{pool,now});}

  /** Buckets for one owner; `owner` is a merchant id or null for SIM. */
  async series(owner,range){
    const unit=range==='12m'?'month':'day';
    const span=range==='12m'?'11 months':'29 days';
    const rows=(await this.pool.query(`WITH buckets AS(
        SELECT generate_series(date_trunc('${unit}',($2::timestamptz AT TIME ZONE 'UTC'))-interval '${span}',date_trunc('${unit}',($2::timestamptz AT TIME ZONE 'UTC')),interval '1 ${unit}') b),
      mail AS(SELECT m.id,m.sent_at,m.send_status FROM leadgen.outbound_messages m
        WHERE m.merchant_id IS NOT DISTINCT FROM $1::uuid AND m.sent_at IS NOT NULL AND coalesce(m.provider_purpose,'COLD_OUTREACH')<>'TRANSACTIONAL'),
      bounces AS(SELECT m.id,coalesce((SELECT min(e.occurred_at) FROM leadgen.email_message_events e WHERE e.outbound_message_id=m.id AND e.event_type='HARD_BOUNCED'),m.sent_at) at
        FROM mail m WHERE m.send_status='HARD_BOUNCED' OR EXISTS(SELECT 1 FROM leadgen.email_message_events e WHERE e.outbound_message_id=m.id AND e.event_type='HARD_BOUNCED')),
      complaints AS(SELECT e.outbound_message_id id,min(e.occurred_at) at FROM leadgen.email_message_events e JOIN mail m ON m.id=e.outbound_message_id
        WHERE e.event_type='COMPLAINED' GROUP BY e.outbound_message_id),
      replies AS(SELECT coalesce(i.received_at,i.created_at) at FROM leadgen.inbound_messages i JOIN leadgen.outreach_threads t ON t.id=i.thread_id
        WHERE t.merchant_id IS NOT DISTINCT FROM $1::uuid)
      SELECT to_char(b.b,'${unit==='month'?'YYYY-MM':'YYYY-MM-DD'}') period,
        (SELECT count(*)::int FROM mail WHERE date_trunc('${unit}',sent_at AT TIME ZONE 'UTC')=b.b) sent,
        (SELECT count(*)::int FROM replies WHERE date_trunc('${unit}',at AT TIME ZONE 'UTC')=b.b) replied,
        (SELECT count(*)::int FROM bounces WHERE date_trunc('${unit}',at AT TIME ZONE 'UTC')=b.b) bounced,
        (SELECT count(*)::int FROM complaints WHERE date_trunc('${unit}',at AT TIME ZONE 'UTC')=b.b) complained
      FROM buckets b ORDER BY b.b`,[owner,this.now().toISOString()])).rows;
    const maxDaily=(await this.pool.query(`SELECT coalesce(max(n),0)::int n FROM(SELECT count(*) n FROM leadgen.outbound_messages m
        WHERE m.merchant_id IS NOT DISTINCT FROM $1::uuid AND m.sent_at IS NOT NULL AND coalesce(m.provider_purpose,'COLD_OUTREACH')<>'TRANSACTIONAL'
          AND m.sent_at>$2::timestamptz-interval '${range==='12m'?'12 months':'30 days'}' GROUP BY date_trunc('day',m.sent_at AT TIME ZONE 'UTC')) d`,
      [owner,this.now().toISOString()])).rows[0].n;
    const totals=rows.reduce((acc,row)=>{for(const key of ['sent','replied','bounced','complained'])acc[key]+=row[key];return acc;},{sent:0,replied:0,bounced:0,complained:0});
    totals.max_daily_sent=maxDaily;totals.reply_rate=pct(totals.replied,totals.sent);totals.bounce_rate=pct(totals.bounced,totals.sent);
    return{rows,totals};
  }

  async mailboxLabel(owner){
    if(!owner)return'SIM';
    return(await this.pool.query(`SELECT from_email FROM leadgen.merchant_mailboxes WHERE merchant_id=$1`,[owner])).rows[0]?.from_email||null;
  }

  /** The owner's series and mailbox warning; the SIM administrator also gets one line per active merchant mailbox. */
  async stats(scope=null,range='30d'){
    if(!EMAIL_STATS_RANGES.includes(range))throw fail('CRM_VALUE_INVALID','Range must be 30d or 12m');
    const owner=scope?.merchantId??null;
    const own=await this.series(owner,range);
    const mailboxes=[{sender_key:owner?String(owner).toLowerCase():'SIM',label:await this.mailboxLabel(owner),merchant_name:null,totals:own.totals,...mailboxWarnings(own.totals,range==='30d'?own.rows:[])}];
    if(!scope?.restrict){
      const merchants=(await this.pool.query(`SELECT m.id,m.company_name,b.from_email FROM leadgen.merchants_current m
        JOIN leadgen.merchant_mailboxes b ON b.merchant_id=m.id WHERE m.effective_status IN('TRIAL','ACTIVE') ORDER BY m.created_at`)).rows;
      for(const merchant of merchants){
        const series=await this.series(merchant.id,range);
        if(!series.totals.sent)continue;
        mailboxes.push({sender_key:String(merchant.id).toLowerCase(),label:merchant.from_email,merchant_name:merchant.company_name,totals:series.totals,...mailboxWarnings(series.totals,range==='30d'?series.rows:[])});
      }
    }
    return{range,unit:range==='12m'?'month':'day',generated_at:this.now().toISOString(),rows:own.rows,totals:own.totals,mailboxes,thresholds:EMAIL_WARNING_THRESHOLDS};
  }
}
