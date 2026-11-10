// Sending health and pacing for each mailbox (optimization plan batch 4, D3/D4; migration 077).
// A sender is SIM's own mailbox (merchantId null) or one merchant's mailbox.
// D3 pause: among the sender's last SENDER_HEALTH_WINDOW messages sent since its latest resume, a
//   complaint, or a hard-bounce rate above SENDER_BOUNCE_PAUSE_RATE (with at least
//   SENDER_BOUNCE_MIN_COUNT bounces, so one bad address cannot pause a new mailbox), pauses it.
//   A person resumes it; the window then restarts. SIM pauses through the email switch
//   (automationControl.pauseEmail); a merchant through its mailbox hold (only that merchant).
// D4 pacing (automatic first touches): a mailbox sends at most SENDER_WARMUP_START_PER_DAY a day
//   in its first SENDER_WARMUP_DAYS days, then one more each day (the daily quota still applies),
//   and at least SENDER_MIN_INTERVAL_MINUTES apart.
const DAY=86_400_000;
export const DELIVERABILITY_HOLD_REASONS=Object.freeze(['BOUNCE_RATE_HIGH','COMPLAINT_RECEIVED']);
export const SIM_PAUSE_PREFIX='SENDER_';
const SENT_STATUSES=`('QUEUED','SENDING','PROVIDER_ACCEPTED','DELIVERED','AMBIGUOUS','SOFT_BOUNCED','HARD_BOUNCED','COMPLAINED','OPTED_OUT')`;
const num=(value,fallback,{min=0,max=Infinity}={})=>{const n=Number(value);return Number.isFinite(n)&&value!==''&&value!==null&&value!==undefined?Math.min(max,Math.max(min,n)):fallback;};
const bool=(value,fallback)=>value===undefined||value===null||value===''?fallback:/^(1|true|yes|on)$/i.test(String(value));
const iso=value=>value?new Date(value).toISOString():null;

export function senderHealthConfig(env=process.env){
  return{
    window:num(env.SENDER_HEALTH_WINDOW,100,{min:10,max:1000}),
    pauseRate:num(env.SENDER_BOUNCE_PAUSE_RATE,0.03,{min:0.001,max:1}),
    minBounces:num(env.SENDER_BOUNCE_MIN_COUNT,2,{min:1,max:100}),
    warmupEnabled:bool(env.SENDER_WARMUP_ENABLED,true),
    warmupStart:num(env.SENDER_WARMUP_START_PER_DAY,10,{min:1,max:1000}),
    warmupDays:num(env.SENDER_WARMUP_DAYS,7,{min:0,max:365}),
    warmupIncrease:num(env.SENDER_WARMUP_DAILY_INCREASE,1,{min:0,max:1000}),
    minIntervalMinutes:num(env.SENDER_MIN_INTERVAL_MINUTES,15,{min:0,max:1440})
  };
}

// Pure decisions (unit-tested without a database).
export function healthDecision(metrics,config){
  const sent=Number(metrics.sent)||0,bounces=Number(metrics.hard_bounces)||0,complaints=Number(metrics.complaints)||0;
  const rate=sent?bounces/sent:0;
  if(complaints>0)return{healthy:false,reason:'COMPLAINT_RECEIVED',bounce_rate:rate};
  if(bounces>=config.minBounces&&rate>config.pauseRate)return{healthy:false,reason:'BOUNCE_RATE_HIGH',bounce_rate:rate};
  return{healthy:true,reason:null,bounce_rate:rate};
}
export function warmupCap(firstSentAt,now,config){
  if(!firstSentAt)return config.warmupStart;
  const days=Math.max(0,Math.floor((now.getTime()-new Date(firstSentAt).getTime())/DAY));
  return days<config.warmupDays?config.warmupStart:config.warmupStart+(days-config.warmupDays+1)*config.warmupIncrease;
}
export function pacingDecision(pacing,now,config){
  const cap=warmupCap(pacing.first_sent_at,now,config);
  const nextAllowed=pacing.last_sent_at?new Date(new Date(pacing.last_sent_at).getTime()+config.minIntervalMinutes*60_000):null;
  if(config.warmupEnabled&&Number(pacing.sent_today)>=cap)return{ok:false,code:'SENDER_WARMUP_DAY_LIMIT',warmup_cap:cap,next_allowed_at:null};
  if(nextAllowed&&nextAllowed>now)return{ok:false,code:'SENDER_MIN_INTERVAL',warmup_cap:cap,next_allowed_at:nextAllowed.toISOString()};
  return{ok:true,code:null,warmup_cap:cap,next_allowed_at:null};
}

export class SenderHealth{
  // merchants: MerchantService (holdMailbox); automationControl: Phase13AutomationFacade (pauseEmail).
  constructor({pool,env=process.env,merchants=null,automationControl=null,now=()=>new Date()}={}){
    Object.assign(this,{pool,merchants,automationControl,now,config:senderHealthConfig(env)});
  }
  senderKey(merchantId){return merchantId?String(merchantId).toLowerCase():'SIM';}
  owner(merchantId,param){return merchantId?`m.merchant_id=${param}::uuid`:'m.merchant_id IS NULL';}

  async lastEvent(merchantId,queryable=this.pool){
    return(await queryable.query(`SELECT event_type,reason,metrics,actor,recorded_at FROM leadgen.sender_health_events
      WHERE sender_key=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1`,[this.senderKey(merchantId)])).rows[0]||null;
  }
  async metrics(merchantId,queryable=this.pool){
    const params=[this.senderKey(merchantId),this.config.window];if(merchantId)params.push(merchantId);
    const row=(await queryable.query(`WITH since AS(SELECT max(recorded_at) at FROM leadgen.sender_health_events WHERE sender_key=$1 AND event_type='RESUMED'),
      recent AS(SELECT m.id,m.send_status FROM leadgen.outbound_messages m
        WHERE ${this.owner(merchantId,'$3')} AND m.sent_at IS NOT NULL AND coalesce(m.provider_purpose,'COLD_OUTREACH')<>'TRANSACTIONAL'
          AND m.sent_at>coalesce((SELECT at FROM since),'-infinity'::timestamptz)
        ORDER BY m.sent_at DESC LIMIT $2)
      SELECT (SELECT count(*)::int FROM recent) sent,
        (SELECT count(*)::int FROM recent r WHERE r.send_status='HARD_BOUNCED'
          OR EXISTS(SELECT 1 FROM leadgen.email_message_events e WHERE e.outbound_message_id=r.id AND e.event_type='HARD_BOUNCED')) hard_bounces,
        (SELECT count(DISTINCT e.outbound_message_id)::int FROM leadgen.email_message_events e
          WHERE e.event_type='COMPLAINED' AND e.outbound_message_id IN(SELECT id FROM recent)) complaints,
        (SELECT at FROM since) since`,params)).rows[0]||{};
    return{sent:Number(row.sent)||0,hard_bounces:Number(row.hard_bounces)||0,complaints:Number(row.complaints)||0,
      window:this.config.window,since:iso(row.since)};
  }
  async pacing(merchantId,queryable=this.pool){
    const params=merchantId?[merchantId]:[];
    const owner=this.owner(merchantId,'$1');
    const row=(await queryable.query(`SELECT
        (SELECT min(coalesce(m.sent_at,m.send_reserved_at,m.queued_at)) FROM leadgen.outbound_messages m
          WHERE ${owner} AND coalesce(m.provider_purpose,'COLD_OUTREACH')<>'TRANSACTIONAL' AND m.send_status IN ${SENT_STATUSES}) first_sent_at,
        (SELECT count(*)::int FROM leadgen.outbound_messages m
          WHERE ${owner} AND coalesce(m.provider_purpose,'COLD_OUTREACH')<>'TRANSACTIONAL' AND m.send_status IN ${SENT_STATUSES}
            AND coalesce(m.sent_at,m.send_reserved_at,m.queued_at)>=date_trunc('day',now())) sent_today,
        (SELECT max(coalesce(m.sent_at,m.send_reserved_at,m.queued_at)) FROM leadgen.outbound_messages m
          WHERE ${owner} AND coalesce(m.provider_purpose,'COLD_OUTREACH')<>'TRANSACTIONAL' AND m.send_status IN ${SENT_STATUSES}) last_sent_at`,params)).rows[0]||{};
    return{first_sent_at:iso(row.first_sent_at),sent_today:Number(row.sent_today)||0,last_sent_at:iso(row.last_sent_at)};
  }

  // Health only: used before any send from this mailbox (follow-ups included).
  async healthGate(merchantId){
    const metrics=await this.metrics(merchantId);
    const decision=healthDecision(metrics,this.config);
    if(decision.healthy)return{ok:true,metrics:{...metrics,bounce_rate:decision.bounce_rate}};
    await this.pause(merchantId,decision.reason,{...metrics,bounce_rate:decision.bounce_rate});
    return{ok:false,code:`SENDER_${decision.reason}`,reason:decision.reason,metrics:{...metrics,bounce_rate:decision.bounce_rate}};
  }
  // Health and pacing: used before an automatic first touch.
  async firstTouchGate(merchantId){
    const health=await this.healthGate(merchantId);
    if(!health.ok)return health;
    const pacing=await this.pacing(merchantId);
    const decision=pacingDecision(pacing,this.now(),this.config);
    return{...decision,pacing,metrics:health.metrics};
  }

  async pause(merchantId,reason,metrics={}){
    const last=await this.lastEvent(merchantId);
    if(merchantId)await this.merchants?.holdMailbox?.(merchantId,reason);
    else await this.automationControl?.pauseEmail?.(`${SIM_PAUSE_PREFIX}${reason}`);
    if(last?.event_type==='PAUSED')return{paused:true,recorded:false};
    await this.pool.query(`INSERT INTO leadgen.sender_health_events(sender_key,merchant_id,event_type,reason,metrics,actor)
      VALUES($1,$2,'PAUSED',$3,$4::jsonb,'sender-health')`,[this.senderKey(merchantId),merchantId||null,reason,JSON.stringify(metrics)]);
    return{paused:true,recorded:true};
  }
  // A person resumes a paused sender: the health window restarts now. For a merchant this also
  // lifts a deliverability hold (other holds keep their own rules). SIM's email switch is turned
  // back on in settings, which calls this through the automation facade.
  async resume(merchantId,{actor,note=null}={}){
    const metrics=await this.metrics(merchantId);
    if(merchantId)await this.pool.query(`UPDATE leadgen.merchant_mailboxes SET sending_hold_reason=NULL,sending_hold_at=NULL,updated_at=now()
      WHERE merchant_id=$1 AND sending_hold_reason=ANY($2::text[])`,[merchantId,[...DELIVERABILITY_HOLD_REASONS]]);
    await this.pool.query(`INSERT INTO leadgen.sender_health_events(sender_key,merchant_id,event_type,reason,metrics,actor)
      VALUES($1,$2,'RESUMED',$3,$4::jsonb,$5)`,[this.senderKey(merchantId),merchantId||null,String(note||'RESUMED_BY_PERSON').slice(0,160),
      JSON.stringify(metrics),String(actor||'workspace').slice(0,160)]);
    return this.status(merchantId);
  }

  async status(merchantId){
    const [metrics,pacing,last]=await Promise.all([this.metrics(merchantId),this.pacing(merchantId),this.lastEvent(merchantId)]);
    const health=healthDecision(metrics,this.config);
    const pace=pacingDecision(pacing,this.now(),this.config);
    return{sender:merchantId?'MERCHANT':'SIM',healthy:health.healthy,
      metrics:{...metrics,bounce_rate:Number(health.bounce_rate.toFixed(4))},
      paused:last?.event_type==='PAUSED'?{reason:last.reason,at:iso(last.recorded_at),metrics:last.metrics}:null,
      last_resumed_at:metrics.since,
      pacing:{...pacing,warmup_enabled:this.config.warmupEnabled,warmup_cap_today:pace.warmup_cap,
        min_interval_minutes:this.config.minIntervalMinutes,next_allowed_at:pace.next_allowed_at,blocked_code:pace.ok?null:pace.code},
      thresholds:{window:this.config.window,pause_rate:this.config.pauseRate,min_bounces:this.config.minBounces}};
  }
}
