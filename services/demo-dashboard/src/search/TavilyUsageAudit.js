import { createHash } from 'node:crypto';

const PROVIDER = 'TAVILY';

function billingPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
}

function normalizedRequest(request = {}) {
  return {
    query:String(request.query || '').replace(/\s+/g,' ').trim(),
    count:Math.max(1,Math.min(20,Number(request.count) || 5)),
    country:String(request.country || '').trim().toUpperCase(),
    country_name:String(request.countryName || '').replace(/\s+/g,' ').trim()
  };
}

function stableFingerprint({researchJobId,companyId,purpose,endpoint,request}) {
  return createHash('sha256').update(JSON.stringify({
    research_job_id:String(researchJobId || ''),
    company_id:String(companyId || ''),
    purpose:String(purpose || '').trim().toUpperCase(),
    endpoint:String(endpoint || ''),
    request:normalizedRequest(request)
  })).digest('hex');
}

function safeEndpoint(provider) {
  try {
    const url = new URL(provider?.endpoint || 'https://api.tavily.com/search');
    return `${url.hostname}${url.pathname}`.slice(0,500);
  } catch {
    return 'api.tavily.com/search';
  }
}

function failureStatus(error) {
  return ['TIMEOUT','NETWORK_ERROR','RATE_LIMITED','TEMPORARY_ERROR'].includes(String(error?.code || '').toUpperCase())
    ? 'TEMPORARY_ERROR'
    : 'FAILED';
}

function usagePool(purpose,budgetPool=null){
  const explicit=String(budgetPool||'').trim().toUpperCase();
  if(['DISCOVERY','EVIDENCE'].includes(explicit))return explicit;
  return String(purpose||'').trim().toUpperCase()==='NEW_COMPANY_DISCOVERY'?'DISCOVERY':'EVIDENCE';
}

function normalizedProfile(value){
  const profile=String(value||'').trim().toUpperCase();
  return ['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(profile)?profile:null;
}

function boundedResults(results) {
  return (Array.isArray(results)?results:[]).slice(0,20).map((item,index)=>({
    title:String(item?.title||'').replace(/\s+/g,' ').trim().slice(0,300),
    url:String(item?.url||'').trim().slice(0,2000),
    snippet:String(item?.snippet||'').replace(/\s+/g,' ').trim().slice(0,1000),
    provider_score:item?.provider_score!==null&&item?.provider_score!==undefined&&Number.isFinite(Number(item.provider_score))?Number(item.provider_score):null,
    rank:Number.isFinite(Number(item?.rank))?Number(item.rank):index+1
  }));
}

export class TavilyCreditBudget {
  constructor({pool=null,runCapUnits=5,dailyCapUnits=25,billingPeriodCapUnits=1000,reservationUnits=1,
    discoveryDailyCapUnits=15,evidenceDailyCapUnits=10,companyProfileCycleCapUnits=2,
    internalLimitsEnabled=true,now=()=>new Date()}={}) {
    this.pool=pool;
    this.runCapUnits=Math.max(0,Number(runCapUnits)||0);
    this.dailyCapUnits=Math.max(0,Number(dailyCapUnits)||0);
    this.billingPeriodCapUnits=Math.max(0,Number(billingPeriodCapUnits)||0);
    this.reservationUnits=Math.max(1,Number(reservationUnits)||1);
    this.discoveryDailyCapUnits=Math.max(0,Number(discoveryDailyCapUnits)||0);
    this.evidenceDailyCapUnits=Math.max(0,Number(evidenceDailyCapUnits)||0);
    this.companyProfileCycleCapUnits=Math.max(1,Math.min(2,Number(companyProfileCycleCapUnits)||2));
    this.internalLimitsEnabled=internalLimitsEnabled===true;
    this.now=now;
    this.localEvents=new Map();
    this.localUsed=0;
    this.localReserved=0;
  }

  async reserve({researchJobId,companyId=null,productProfile=null,purpose,budgetPool=null,endpoint,request}) {
    const requestFingerprint=stableFingerprint({researchJobId,companyId,purpose,endpoint,request});
    const period=billingPeriod(this.now());
    const poolName=usagePool(purpose,budgetPool);
    const profile=normalizedProfile(productProfile);
    const poolCap=poolName==='DISCOVERY'?this.discoveryDailyCapUnits:this.evidenceDailyCapUnits;
    const audit={purpose:String(purpose || '').trim().toUpperCase(),budget_pool:poolName,product_profile:profile};
    if(!this.pool) {
      const existing=this.localEvents.get(requestFingerprint);
      if(existing&&['COMPLETED','NOT_FOUND','FAILED'].includes(existing.status))return{...existing,replay:true};
      if(existing?.status==='RESERVED'&&existing.provider_request_id
        &&Object.hasOwn(existing.result_payload?.audit||{},'result_count')){
        const used=Number(existing.reserved_units||this.reservationUnits);this.localReserved-=used;this.localUsed+=used;
        const recovered={...existing,status:Number(existing.result_payload.audit.result_count)>0?'COMPLETED':'NOT_FOUND',
          reserved_units:0,used_units:used,completed_at:this.now()};
        this.localEvents.set(requestFingerprint,recovered);return{...recovered,replay:true,recovered:true};
      }
      if(existing?.status==='RESERVED')throw Object.assign(new Error('Tavily request is already in progress'),{
        code:'TAVILY_REQUEST_IN_PROGRESS',retryable:true});
      const runTotal=[...this.localEvents.values()].filter(item=>item.research_job_id===researchJobId)
        .reduce((sum,item)=>sum+Number(item.reserved_units||0)+Number(item.used_units||0),0);
      const day=this.now().toISOString().slice(0,10);
      const dailyTotal=[...this.localEvents.values()].filter(item=>new Date(item.created_at).toISOString().slice(0,10)===day)
        .reduce((sum,item)=>sum+Number(item.reserved_units||0)+Number(item.used_units||0),0);
      const poolTotal=[...this.localEvents.values()].filter(item=>item.budget_pool===poolName
        &&new Date(item.created_at).toISOString().slice(0,10)===day)
        .reduce((sum,item)=>sum+Number(item.reserved_units||0)+Number(item.used_units||0),0);
      const companyProfileTotal=poolName==='EVIDENCE'&&companyId&&profile?[...this.localEvents.values()].filter(item=>
        item.budget_pool===poolName&&item.company_id===companyId&&item.product_profile===profile
        &&new Date(item.created_at).toISOString().slice(0,10)===day)
        .reduce((sum,item)=>sum+Number(item.reserved_units||0)+Number(item.used_units||0),0):0;
      if(this.internalLimitsEnabled&&(runTotal+this.reservationUnits>this.runCapUnits
        ||dailyTotal+this.reservationUnits>this.dailyCapUnits
        ||poolTotal+this.reservationUnits>poolCap
        ||companyProfileTotal+this.reservationUnits>this.companyProfileCycleCapUnits
        ||this.localReserved+this.localUsed+this.reservationUnits>this.billingPeriodCapUnits)) {
        throw Object.assign(new Error('Tavily usage budget reached'),{code:'TAVILY_CREDIT_CAP',budget_pool:poolName});
      }
      const event={id:requestFingerprint,research_job_id:researchJobId,company_id:companyId,provider:PROVIDER,
        budget_pool:poolName,product_profile:profile,
        billing_period:period,endpoint,request_fingerprint:requestFingerprint,status:'RESERVED',
        reserved_units:this.reservationUnits,used_units:0,
        credits_before_units:this.internalLimitsEnabled?this.billingPeriodCapUnits-this.localUsed-this.localReserved:null,
        result_payload:{audit},created_at:this.now()};
      this.localEvents.set(requestFingerprint,event);this.localReserved+=this.reservationUnits;
      return{...event,replay:false};
    }
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO leadgen.provider_credit_ledger(provider,billing_period,credit_limit_units)
        VALUES ($1,$2,$3) ON CONFLICT(provider,billing_period) DO UPDATE SET
          credit_limit_units=CASE WHEN $3::integer IS NULL THEN NULL ELSE leadgen.provider_credit_ledger.credit_limit_units END,
          updated_at=CASE WHEN $3::integer IS NULL THEN now() ELSE leadgen.provider_credit_ledger.updated_at END`,
        [PROVIDER,period,this.internalLimitsEnabled?this.billingPeriodCapUnits:null]);
      const ledger=await client.query(`SELECT * FROM leadgen.provider_credit_ledger
        WHERE provider=$1 AND billing_period=$2 FOR UPDATE`,[PROVIDER,period]);
      const initialLedger=ledger.rows[0];
      const tightenedLimit=this.internalLimitsEnabled?Math.max(Number(initialLedger.reserved_units)+Number(initialLedger.used_units),
        Math.min(Number(initialLedger.credit_limit_units),this.billingPeriodCapUnits)):null;
      if(this.internalLimitsEnabled&&tightenedLimit<Number(initialLedger.credit_limit_units))await client.query(`UPDATE leadgen.provider_credit_ledger
        SET credit_limit_units=$3,updated_at=now() WHERE provider=$1 AND billing_period=$2`,[PROVIDER,period,tightenedLimit]);
      const stale=await client.query(`WITH stale_events AS (
          SELECT id,reserved_units FROM leadgen.provider_usage_events
          WHERE provider=$1 AND billing_period=$2 AND status='RESERVED'
            AND created_at<now()-interval '30 minutes' FOR UPDATE
        ),released AS (
          UPDATE leadgen.provider_usage_events e SET status='TEMPORARY_ERROR',reserved_units=0,
            released_units=e.released_units+s.reserved_units,
            error_code='STALE_RESERVATION_RELEASED',completed_at=now()
          FROM stale_events s WHERE e.id=s.id RETURNING s.reserved_units
        ) SELECT reserved_units FROM released`,[PROVIDER,period]);
      const released=stale.rows.reduce((sum,item)=>sum+Number(item.reserved_units||0),0);
      if(released)await client.query(`UPDATE leadgen.provider_credit_ledger
        SET reserved_units=greatest(0,reserved_units-$3),updated_at=now()
        WHERE provider=$1 AND billing_period=$2`,[PROVIDER,period,released]);
      const existing=await client.query(`SELECT * FROM leadgen.provider_usage_events
        WHERE provider=$1 AND request_fingerprint=$2 FOR UPDATE`,[PROVIDER,requestFingerprint]);
      const latest=existing.rows[0]||null;
      if(latest&&['COMPLETED','NOT_FOUND','FAILED'].includes(latest.status)){
        await client.query('COMMIT');return{...latest,replay:true};
      }
      const recoverable=['RESERVED','TEMPORARY_ERROR'].includes(latest?.status)&&latest.provider_request_id
        &&(!latest.error_code||latest.error_code==='STALE_RESERVATION_RELEASED')
        &&Object.hasOwn(latest.result_payload?.audit||{},'result_count');
      if(recoverable){const used=Number(latest.reserved_units||this.reservationUnits);const recoveredStatus=Number(latest.result_payload.audit.result_count)>0?'COMPLETED':'NOT_FOUND';
        await client.query(`UPDATE leadgen.provider_credit_ledger SET
          reserved_units=greatest(0,reserved_units-$3),used_units=used_units+$4,updated_at=now()
          WHERE provider=$1 AND billing_period=$2`,[PROVIDER,period,Number(latest.reserved_units||0),used]);
        const recovered=await client.query(`UPDATE leadgen.provider_usage_events SET status=$2,used_units=$3,
          reserved_units=0,released_units=greatest(0,released_units-$3),error_code=NULL,completed_at=now()
          WHERE id=$1 RETURNING *`,[latest.id,recoveredStatus,used]);
        await client.query('COMMIT');return{...recovered.rows[0],replay:true,recovered:true};}
      if(latest?.status==='RESERVED')throw Object.assign(new Error('Tavily request is already in progress'),{
        code:'TAVILY_REQUEST_IN_PROGRESS',retryable:true});
      const run=await client.query(`SELECT coalesce(sum(reserved_units+used_units),0)::integer total
        FROM leadgen.provider_usage_events WHERE research_job_id=$1 AND provider=$2`,[researchJobId,PROVIDER]);
      const daily=await client.query(`SELECT coalesce(sum(reserved_units+used_units),0)::integer total
        FROM leadgen.provider_usage_events WHERE provider=$1
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[PROVIDER]);
      const pooled=await client.query(`SELECT coalesce(sum(reserved_units+used_units),0)::integer total
        FROM leadgen.provider_usage_events WHERE provider=$1 AND budget_pool=$2
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[PROVIDER,poolName]);
      const scoped=poolName==='EVIDENCE'&&companyId&&profile?await client.query(`SELECT
        coalesce(sum(reserved_units+used_units),0)::integer total FROM leadgen.provider_usage_events
        WHERE provider=$1 AND budget_pool='EVIDENCE' AND company_id=$2 AND product_profile=$3
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[PROVIDER,companyId,profile]):{rows:[{total:0}]};
      const current=released?(await client.query(`SELECT * FROM leadgen.provider_credit_ledger
        WHERE provider=$1 AND billing_period=$2`,[PROVIDER,period])).rows[0]:ledger.rows[0];
      const effectiveLimit=this.internalLimitsEnabled?Math.min(Number(current.credit_limit_units),this.billingPeriodCapUnits):null;
      if(!current||(this.internalLimitsEnabled&&(Number(run.rows[0].total)+this.reservationUnits>this.runCapUnits
        ||Number(daily.rows[0].total)+this.reservationUnits>this.dailyCapUnits
        ||Number(pooled.rows[0].total)+this.reservationUnits>poolCap
        ||Number(scoped.rows[0].total)+this.reservationUnits>this.companyProfileCycleCapUnits
        ||Number(current.reserved_units)+Number(current.used_units)+this.reservationUnits>effectiveLimit))) {
        throw Object.assign(new Error('Tavily usage budget reached'),{code:'TAVILY_CREDIT_CAP',budget_pool:poolName});
      }
      await client.query(`UPDATE leadgen.provider_credit_ledger SET reserved_units=reserved_units+$3,updated_at=now()
        WHERE provider=$1 AND billing_period=$2`,[PROVIDER,period,this.reservationUnits]);
      const inserted=latest?.status==='TEMPORARY_ERROR'
        ?await client.query(`UPDATE leadgen.provider_usage_events SET status='RESERVED',reserved_units=$2,used_units=0,
          credits_before_units=$3,credits_after_units=NULL,provider_request_id=NULL,error_code=NULL,
          budget_pool=$4,product_profile=$5,result_payload=$6::jsonb,created_at=now(),completed_at=NULL
          WHERE id=$1 RETURNING *`,[latest.id,this.reservationUnits,
          this.internalLimitsEnabled?effectiveLimit-Number(current.used_units)-Number(current.reserved_units):null,poolName,profile,JSON.stringify({audit})])
        :await client.query(`INSERT INTO leadgen.provider_usage_events
        (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,budget_pool,product_profile,
         reserved_units,credits_before_units,result_payload)
        VALUES($1,$2,$3,$4,$5,$6,'RESERVED',$7,$8,$9,$10,$11::jsonb) RETURNING *`,[
        researchJobId,companyId,PROVIDER,period,endpoint,requestFingerprint,poolName,profile,
        this.reservationUnits,this.internalLimitsEnabled?effectiveLimit-Number(current.used_units)-Number(current.reserved_units):null,JSON.stringify({audit})]);
      await client.query('COMMIT');
      return{...inserted.rows[0],replay:false};
    } catch(error) {
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    } finally {client.release();}
  }

  async settle(event,{usedUnits=0,status='COMPLETED',providerRequestId=null,errorCode=null,resultCount=0,referenceIds=[]}={}) {
    if(event.replay)return event;
    const used=Math.max(0,Number(usedUnits)||0);
    if(used>Number(event.reserved_units)) {
      throw Object.assign(new Error('Tavily reported more credits than the reserved Basic Search cost'),{code:'TAVILY_USAGE_EXCEEDS_RESERVATION'});
    }
    const resultPayload={audit:{purpose:event.result_payload?.audit?.purpose||null,
      result_count:Math.max(0,Number(resultCount)||0),
      reference_ids:(Array.isArray(referenceIds)?referenceIds:[]).map(String).slice(0,20)}};
    if(!this.pool) {
      this.localReserved-=Number(event.reserved_units);this.localUsed+=used;
      const settled={...event,status,reserved_units:0,used_units:used,
        released_units:Number(event.released_units||0)+Math.max(0,Number(event.reserved_units)-used),provider_request_id:providerRequestId,
        error_code:errorCode,result_payload:resultPayload,
        credits_after_units:this.internalLimitsEnabled?this.billingPeriodCapUnits-this.localUsed:null,completed_at:this.now()};
      this.localEvents.set(event.request_fingerprint,settled);return settled;
    }
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked=await client.query(`SELECT * FROM leadgen.provider_usage_events WHERE id=$1 FOR UPDATE`,[event.id]);
      if(!locked.rowCount||locked.rows[0].status!=='RESERVED'){await client.query('COMMIT');return locked.rows[0]||event;}
      const current=locked.rows[0];
      const ledger=await client.query(`UPDATE leadgen.provider_credit_ledger
        SET reserved_units=greatest(0,reserved_units-$3),used_units=used_units+$4,updated_at=now()
        WHERE provider=$1 AND billing_period=$2 RETURNING *`,[PROVIDER,current.billing_period,current.reserved_units,used]);
      const after=ledger.rowCount&&this.internalLimitsEnabled
        ?Math.max(0,Math.min(Number(ledger.rows[0].credit_limit_units),this.billingPeriodCapUnits)-Number(ledger.rows[0].used_units)-Number(ledger.rows[0].reserved_units)):null;
      const result=await client.query(`UPDATE leadgen.provider_usage_events SET status=$2,reserved_units=0,
        used_units=$3,released_units=released_units+greatest(0,reserved_units-$3),credits_after_units=$4,provider_request_id=$5,error_code=$6,
        result_payload=$7::jsonb,completed_at=now() WHERE id=$1 RETURNING *`,[
        event.id,status,used,after,providerRequestId,errorCode,JSON.stringify(resultPayload)
      ]);
      await client.query('COMMIT');return result.rows[0];
    } catch(error) {
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    } finally {client.release();}
  }

  async attachReferences(event,{providerRequestId=null,resultCount=0,referenceIds=[]}={}) {
    if(event.replay)return event;
    const resultPayload={audit:{purpose:event.result_payload?.audit?.purpose||null,
      result_count:Math.max(0,Number(resultCount)||0),
      reference_ids:(Array.isArray(referenceIds)?referenceIds:[]).map(String).slice(0,20)}};
    if(!this.pool) {
      const updated={...event,provider_request_id:providerRequestId,result_payload:resultPayload};
      this.localEvents.set(event.request_fingerprint,updated);return updated;
    }
    const result=await this.pool.query(`UPDATE leadgen.provider_usage_events
      SET provider_request_id=$2,result_payload=$3::jsonb
      WHERE id=$1 AND status='RESERVED' RETURNING *`,[event.id,providerRequestId,JSON.stringify(resultPayload)]);
    return result.rows[0]||event;
  }
}

export class TavilyUsageAudit {
  constructor({provider,pool=null,budget=null,runCapUnits=5,dailyCapUnits=25,billingPeriodCapUnits=1000,reservationUnits=1,
    discoveryDailyCapUnits=15,evidenceDailyCapUnits=10,companyProfileCycleCapUnits=2,internalLimitsEnabled=true,
    providerAccountState=null}={}) {
    this.provider=provider;
    this.endpoint=safeEndpoint(provider);
    this.budget=budget||new TavilyCreditBudget({pool,runCapUnits,dailyCapUnits,billingPeriodCapUnits,reservationUnits,
      discoveryDailyCapUnits,evidenceDailyCapUnits,companyProfileCycleCapUnits,internalLimitsEnabled});
    this.providerAccountState=providerAccountState;
  }

  async search({researchJobId,companyId=null,productProfile=null,purpose,budgetPool=null,request,persistResults=null,loadPersistedResults=null}) {
    if(String(this.provider?.name||'').toLowerCase()!=='tavily')return this.provider.search(request);
    if(this.providerAccountState)await this.providerAccountState.beforeSearch();
    let reservation=await this.budget.reserve({researchJobId,companyId,productProfile,purpose,budgetPool,endpoint:this.endpoint,request});
    if(reservation.replay) {
      if(reservation.status==='FAILED')throw Object.assign(new Error('Previous Tavily request failed permanently'),{
        code:reservation.error_code||'TAVILY_PREVIOUS_REQUEST_FAILED',usage_event:reservation});
      if(!['COMPLETED','NOT_FOUND'].includes(reservation.status))throw Object.assign(new Error('Tavily request requires retry'),{
        code:'TAVILY_RETRY_REQUIRED',retryable:true,usage_event:reservation});
      const referenceIds=reservation.result_payload?.audit?.reference_ids||[];
      const storedResultCount=Number(reservation.result_payload?.audit?.result_count||0);
      const persisted=typeof loadPersistedResults==='function'
        ? await loadPersistedResults({referenceIds,resultCount:storedResultCount})
        : [];
      const results=boundedResults(persisted);
      return{provider:'tavily',requestId:reservation.provider_request_id||null,
        credits:Number(reservation.used_units||0),results,
        result_count:Math.max(storedResultCount,results.length),
        replay:true,usage_event:reservation};
    }
    let response;
    try {
      response=await this.provider.search(request);
    } catch(error) {
      const usage=await this.budget.settle(reservation,{usedUnits:0,status:failureStatus(error),
        errorCode:String(error?.code||'SEARCH_ERROR').slice(0,120),resultCount:0});
      error.usage_event=usage;
      if(this.providerAccountState)await this.providerAccountState.observeSearchError(error);
      throw error;
    }
    const results=boundedResults(response.results);
    let persisted={referenceIds:[]};
    try {
      if(typeof persistResults==='function')persisted=await persistResults(results)||persisted;
    } catch(error) {
      const usage=await this.budget.settle(reservation,{usedUnits:Number(response.credits||0),status:'TEMPORARY_ERROR',
        providerRequestId:response.requestId||null,errorCode:'RESULT_PERSIST_FAILED',resultCount:results.length});
      error.usage_event=usage;
      throw error;
    }
    if(typeof this.budget.attachReferences==='function')reservation=await this.budget.attachReferences(reservation,{
      providerRequestId:response.requestId||null,resultCount:results.length,referenceIds:persisted.referenceIds});
    const status=results.length?'COMPLETED':'NOT_FOUND';
    const usage=await this.budget.settle(reservation,{usedUnits:Number(response.credits||0),status,
      providerRequestId:response.requestId||null,resultCount:results.length,referenceIds:persisted.referenceIds});
    if(this.providerAccountState)await this.providerAccountState.observeSearchSuccess(response.requestId||null);
    return{...response,results,result_count:results.length,usage_event:usage};
  }
}
