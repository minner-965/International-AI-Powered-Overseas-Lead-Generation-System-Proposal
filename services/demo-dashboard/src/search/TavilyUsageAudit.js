import {createHash} from 'node:crypto';

const PROVIDER='TAVILY';

function billingPeriod(now=new Date()){
  return`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
}

function normalizedRequest(request={}){
  return{query:String(request.query||'').replace(/\s+/g,' ').trim(),count:Math.max(1,Math.min(20,Number(request.count)||5)),
    country:String(request.country||'').trim().toUpperCase(),country_name:String(request.countryName||'').replace(/\s+/g,' ').trim()};
}

function stableFingerprint({researchJobId,companyId,purpose,endpoint,request}){
  return createHash('sha256').update(JSON.stringify({research_job_id:String(researchJobId||''),company_id:String(companyId||''),
    purpose:String(purpose||'').trim().toUpperCase(),endpoint:String(endpoint||''),request:normalizedRequest(request)})).digest('hex');
}

function safeEndpoint(provider){
  try{const url=new URL(provider?.endpoint||'https://api.tavily.com/search');return`${url.hostname}${url.pathname}`.slice(0,500);}
  catch{return'api.tavily.com/search';}
}

function failureStatus(error){
  return['TIMEOUT','NETWORK_ERROR','RATE_LIMITED','TEMPORARY_ERROR'].includes(String(error?.code||'').toUpperCase())
    ?'TEMPORARY_ERROR':'FAILED';
}

function usageGroup(purpose,explicitGroup=null){
  const explicit=String(explicitGroup||'').trim().toUpperCase();
  if(['DISCOVERY','EVIDENCE'].includes(explicit))return explicit;
  return String(purpose||'').trim().toUpperCase()==='NEW_COMPANY_DISCOVERY'?'DISCOVERY':'EVIDENCE';
}

function normalizedProfile(value){
  const profile=String(value||'').trim().toUpperCase();
  return['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(profile)?profile:null;
}

function boundedResults(results){
  return(Array.isArray(results)?results:[]).slice(0,20).map((item,index)=>({
    title:String(item?.title||'').replace(/\s+/g,' ').trim().slice(0,300),url:String(item?.url||'').trim().slice(0,2000),
    snippet:String(item?.snippet||'').replace(/\s+/g,' ').trim().slice(0,1000),
    provider_score:item?.provider_score!==null&&item?.provider_score!==undefined&&Number.isFinite(Number(item.provider_score))
      ?Number(item.provider_score):null,rank:Number.isFinite(Number(item?.rank))?Number(item.rank):index+1}));
}

export class TavilyUsageLedger{
  constructor({pool=null,now=()=>new Date()}={}){this.pool=pool;this.now=now;this.localEvents=new Map();}

  async claim({researchJobId,companyId=null,productProfile=null,purpose,usageGroup:explicitGroup=null,endpoint,request}){
    const requestFingerprint=stableFingerprint({researchJobId,companyId,purpose,endpoint,request});
    const period=billingPeriod(this.now());const group=usageGroup(purpose,explicitGroup);const profile=normalizedProfile(productProfile);
    const audit={purpose:String(purpose||'').trim().toUpperCase(),usage_group:group,product_profile:profile};
    if(!this.pool){
      const existing=this.localEvents.get(requestFingerprint);
      if(existing&&['COMPLETED','NOT_FOUND','FAILED'].includes(existing.status))return{...existing,replay:true};
      if(existing?.status==='RESERVED'&&existing.provider_request_id&&Object.hasOwn(existing.result_payload?.audit||{},'result_count')){
        const used=Number(existing.result_payload.audit.provider_used_units??existing.used_units??existing.reserved_units??0);
        const recovered={...existing,status:Number(existing.result_payload.audit.result_count)>0?'COMPLETED':'NOT_FOUND',
          reserved_units:0,used_units:used,completed_at:this.now()};
        this.localEvents.set(requestFingerprint,recovered);return{...recovered,replay:true,recovered:true};
      }
      if(existing?.status==='RESERVED')throw Object.assign(new Error('Tavily request is already in progress'),{
        code:'TAVILY_REQUEST_IN_PROGRESS',retryable:true});
      const event={id:requestFingerprint,research_job_id:researchJobId,company_id:companyId,provider:PROVIDER,budget_pool:group,
        product_profile:profile,billing_period:period,endpoint,request_fingerprint:requestFingerprint,status:'RESERVED',
        reserved_units:0,used_units:0,credits_before_units:null,result_payload:{audit},created_at:this.now()};
      this.localEvents.set(requestFingerprint,event);return{...event,replay:false};
    }
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`UPDATE leadgen.provider_usage_events SET status='TEMPORARY_ERROR',reserved_units=0,
        error_code='STALE_REQUEST_CLAIM_RELEASED',completed_at=now()
        WHERE provider=$1 AND billing_period=$2 AND status='RESERVED' AND created_at<now()-interval '30 minutes'`,[PROVIDER,period]);
      const latest=(await client.query(`SELECT * FROM leadgen.provider_usage_events
        WHERE provider=$1 AND request_fingerprint=$2 FOR UPDATE`,[PROVIDER,requestFingerprint])).rows[0]||null;
      if(latest&&['COMPLETED','NOT_FOUND','FAILED'].includes(latest.status)){
        await client.query('COMMIT');return{...latest,replay:true};
      }
      const recoverable=['RESERVED','TEMPORARY_ERROR'].includes(latest?.status)&&latest.provider_request_id
        &&(!latest.error_code||latest.error_code==='STALE_REQUEST_CLAIM_RELEASED')
        &&Object.hasOwn(latest.result_payload?.audit||{},'result_count');
      if(recoverable){
        const used=Number(latest.result_payload.audit.provider_used_units??latest.used_units??latest.reserved_units??0);
        const status=Number(latest.result_payload.audit.result_count)>0?'COMPLETED':'NOT_FOUND';
        const recovered=await client.query(`UPDATE leadgen.provider_usage_events SET status=$2,used_units=$3,
          reserved_units=0,error_code=NULL,completed_at=now() WHERE id=$1 RETURNING *`,[latest.id,status,used]);
        await client.query('COMMIT');return{...recovered.rows[0],replay:true,recovered:true};
      }
      if(latest?.status==='RESERVED')throw Object.assign(new Error('Tavily request is already in progress'),{
        code:'TAVILY_REQUEST_IN_PROGRESS',retryable:true});
      const inserted=latest?.status==='TEMPORARY_ERROR'
        ?await client.query(`UPDATE leadgen.provider_usage_events SET status='RESERVED',reserved_units=0,used_units=0,
          credits_before_units=NULL,credits_after_units=NULL,provider_request_id=NULL,error_code=NULL,budget_pool=$2,
          product_profile=$3,result_payload=$4::jsonb,created_at=now(),completed_at=NULL WHERE id=$1 RETURNING *`,[
          latest.id,group,profile,JSON.stringify({audit})])
        :await client.query(`INSERT INTO leadgen.provider_usage_events
          (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,budget_pool,
           product_profile,reserved_units,credits_before_units,result_payload)
          VALUES($1,$2,$3,$4,$5,$6,'RESERVED',$7,$8,0,NULL,$9::jsonb) RETURNING *`,[
          researchJobId,companyId,PROVIDER,period,endpoint,requestFingerprint,group,profile,JSON.stringify({audit})]);
      await client.query('COMMIT');return{...inserted.rows[0],replay:false};
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  async settle(event,{usedUnits=0,status='COMPLETED',providerRequestId=null,errorCode=null,resultCount=0,referenceIds=[]}={}){
    if(event.replay)return event;
    const used=Math.max(0,Number(usedUnits)||0);
    const resultPayload={audit:{purpose:event.result_payload?.audit?.purpose||null,
      usage_group:event.result_payload?.audit?.usage_group||null,provider_used_units:used,
      result_count:Math.max(0,Number(resultCount)||0),reference_ids:(Array.isArray(referenceIds)?referenceIds:[]).map(String).slice(0,20)}};
    if(!this.pool){
      const settled={...event,status,reserved_units:0,used_units:used,released_units:0,provider_request_id:providerRequestId,
        error_code:errorCode,result_payload:resultPayload,credits_after_units:null,completed_at:this.now()};
      this.localEvents.set(event.request_fingerprint,settled);return settled;
    }
    const result=await this.pool.query(`UPDATE leadgen.provider_usage_events SET status=$2,reserved_units=0,
      used_units=$3,released_units=0,credits_after_units=NULL,provider_request_id=$4,error_code=$5,
      result_payload=$6::jsonb,completed_at=now() WHERE id=$1 AND status='RESERVED' RETURNING *`,[
      event.id,status,used,providerRequestId,errorCode,JSON.stringify(resultPayload)]);
    return result.rows[0]||event;
  }

  async attachReferences(event,{providerRequestId=null,usedUnits=0,resultCount=0,referenceIds=[]}={}){
    if(event.replay)return event;
    const resultPayload={audit:{purpose:event.result_payload?.audit?.purpose||null,
      usage_group:event.result_payload?.audit?.usage_group||null,provider_used_units:Math.max(0,Number(usedUnits)||0),
      result_count:Math.max(0,Number(resultCount)||0),reference_ids:(Array.isArray(referenceIds)?referenceIds:[]).map(String).slice(0,20)}};
    if(!this.pool){
      const updated={...event,provider_request_id:providerRequestId,result_payload:resultPayload};
      this.localEvents.set(event.request_fingerprint,updated);return updated;
    }
    const result=await this.pool.query(`UPDATE leadgen.provider_usage_events SET provider_request_id=$2,result_payload=$3::jsonb
      WHERE id=$1 AND status='RESERVED' RETURNING *`,[event.id,providerRequestId,JSON.stringify(resultPayload)]);
    return result.rows[0]||event;
  }
}

export class TavilyUsageAudit{
  constructor({provider,pool=null,ledger=null,providerAccountState=null}={}){
    this.provider=provider;this.endpoint=safeEndpoint(provider);this.ledger=ledger||new TavilyUsageLedger({pool});
    this.providerAccountState=providerAccountState;
  }

  async search({researchJobId,companyId=null,productProfile=null,purpose,budgetPool=null,request,persistResults=null,loadPersistedResults=null}){
    if(String(this.provider?.name||'').toLowerCase()!=='tavily')return this.provider.search(request);
    if(this.providerAccountState)await this.providerAccountState.beforeSearch();
    let claim=await this.ledger.claim({researchJobId,companyId,productProfile,purpose,usageGroup:budgetPool,
      endpoint:this.endpoint,request});
    if(claim.replay){
      if(claim.status==='FAILED')throw Object.assign(new Error('Previous Tavily request failed permanently'),{
        code:claim.error_code||'TAVILY_PREVIOUS_REQUEST_FAILED',usage_event:claim});
      if(!['COMPLETED','NOT_FOUND'].includes(claim.status))throw Object.assign(new Error('Tavily request requires retry'),{
        code:'TAVILY_RETRY_REQUIRED',retryable:true,usage_event:claim});
      const referenceIds=claim.result_payload?.audit?.reference_ids||[];
      const storedResultCount=Number(claim.result_payload?.audit?.result_count||0);
      const persisted=typeof loadPersistedResults==='function'?await loadPersistedResults({referenceIds,resultCount:storedResultCount}):[];
      const results=boundedResults(persisted);
      return{provider:'tavily',requestId:claim.provider_request_id||null,credits:Number(claim.used_units||0),results,
        result_count:Math.max(storedResultCount,results.length),replay:true,usage_event:claim};
    }
    let response;
    try{response=await this.provider.search(request);}
    catch(error){
      const usage=await this.ledger.settle(claim,{usedUnits:0,status:failureStatus(error),
        errorCode:String(error?.code||'SEARCH_ERROR').slice(0,120),resultCount:0});
      error.usage_event=usage;if(this.providerAccountState)await this.providerAccountState.observeSearchError(error);throw error;
    }
    const results=boundedResults(response.results);let persisted={referenceIds:[]};
    try{if(typeof persistResults==='function')persisted=await persistResults(results)||persisted;}
    catch(error){
      const usage=await this.ledger.settle(claim,{usedUnits:Number(response.credits||0),status:'TEMPORARY_ERROR',
        providerRequestId:response.requestId||null,errorCode:'RESULT_PERSIST_FAILED',resultCount:results.length});
      error.usage_event=usage;throw error;
    }
    claim=await this.ledger.attachReferences(claim,{providerRequestId:response.requestId||null,
      usedUnits:Number(response.credits||0),resultCount:results.length,referenceIds:persisted.referenceIds});
    const status=results.length?'COMPLETED':'NOT_FOUND';
    const usage=await this.ledger.settle(claim,{usedUnits:Number(response.credits||0),status,
      providerRequestId:response.requestId||null,resultCount:results.length,referenceIds:persisted.referenceIds});
    if(this.providerAccountState)await this.providerAccountState.observeSearchSuccess(response.requestId||null);
    return{...response,results,result_count:results.length,usage_event:usage};
  }
}
