import { createHash } from 'node:crypto';
import { emailService } from '../platform/EmailService.js';

export const HUNTER_MODES = Object.freeze({ DISABLED:'DISABLED', FREE_FIRST:'FREE_FIRST', TEST:'TEST' });
export const HUNTER_CREDIT_UNITS = Object.freeze({
  DOMAIN_SEARCH:1000,
  EMAIL_FINDER:1000,
  EMAIL_VERIFIER:500,
  ENRICHMENT:200
});

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g,' ').trim().slice(0,max);
}

function currentBillingPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
}

function fingerprint(jobId, endpoint, payload) {
  return createHash('sha256').update(JSON.stringify({ jobId,endpoint,payload })).digest('hex');
}

function safeUsageSummary(payload={}){
  const counts={};for(const[key,value]of Object.entries(payload.verification_status_counts||{})){
    const status=String(key||'').toUpperCase();if(['VALID','ACCEPT_ALL','INVALID','UNKNOWN','NOT_VERIFIED'].includes(status))counts[status]=Math.max(0,Number(value)||0);
  }
  return{result_type:clean(payload.result_type,80)||null,result_count:Math.max(0,Number(payload.result_count)||0),
    found:payload.found===true,verification_status_counts:counts,
    business_reference_ids:(Array.isArray(payload.business_reference_ids)?payload.business_reference_ids:[])
      .map(String).filter(value=>/^[0-9a-f-]{36}$/i.test(value)).slice(0,20)};
}

function usageSummary(endpoint,normalized={},businessReferenceIds=[]){
  const results=Array.isArray(normalized.results)?normalized.results:[];const verification_status_counts={};
  for(const item of results){const status=String(item?.verification_status||'NOT_VERIFIED').toUpperCase();verification_status_counts[status]=(verification_status_counts[status]||0)+1;}
  return safeUsageSummary({result_type:endpoint,result_count:results.length,found:normalized.found===true,
    verification_status_counts,business_reference_ids:businessReferenceIds});
}

function persistenceReferences(value){
  const references=Array.isArray(value)?value:Array.isArray(value?.referenceIds)?value.referenceIds:[];
  return references.map(String).filter(item=>/^[0-9a-f-]{36}$/i.test(item)).slice(0,20);
}

function persistenceResults(value){
  if(Array.isArray(value))return value;
  return Array.isArray(value?.results)?value.results:[];
}

export function mapHunterVerification(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'valid') return 'VALID';
  if (value === 'accept_all' || value === 'accept-all') return 'ACCEPT_ALL';
  if (['invalid','disposable'].includes(value)) return 'INVALID';
  if (['unknown','blocked'].includes(value)) return 'UNKNOWN';
  return 'NOT_VERIFIED';
}

export class HunterCreditBudget {
  constructor({ pool = null, runCapUnits = 20000, billingPeriodCapUnits = 20000,
    dailyCapUnits = 20000, maxTemporaryRetries = 2, now = () => new Date() } = {}) {
    this.pool = pool;
    this.runCapUnits = Math.max(0,Number(runCapUnits) || 0);
    this.billingPeriodCapUnits = Math.max(0,Number(billingPeriodCapUnits) || 0);
    this.dailyCapUnits = Math.max(0,Number(dailyCapUnits) || 0);
    this.now = now;
    this.maxTemporaryRetries = Math.max(0,Math.min(10,Number(maxTemporaryRetries) || 0));
    this.localEvents = new Map();
    this.localUsed = 0;
    this.localReserved = 0;
  }

  async reserve({ researchJobId, companyId = null, endpoint, payload, units }) {
    const logicalFingerprint = fingerprint(researchJobId,endpoint,payload);
    if (!this.pool) {
      const attempts = [...this.localEvents.values()].filter(item=>item.logical_request_fingerprint === logicalFingerprint
        || item.request_fingerprint === logicalFingerprint).sort((a,b)=>Number(a.retry_number||0)-Number(b.retry_number||0));
      const existing = attempts.at(-1);
      if(existing?.status==='RESERVED')throw Object.assign(new Error('Hunter request is already in progress'),{
        code:'HUNTER_REQUEST_IN_PROGRESS',retryable:true});
      if (existing && existing.status !== 'TEMPORARY_ERROR') return { ...existing,replay:true };
      const retryNumber = existing ? Number(existing.retry_number || 0) + 1 : 0;
      if (retryNumber > this.maxTemporaryRetries) throw Object.assign(new Error('Hunter temporary retries exhausted'),{
        code:'HUNTER_TEMPORARY_RETRIES_EXHAUSTED',usage_event:existing});
      const requestFingerprint = retryNumber ? fingerprint(researchJobId,endpoint,{ logicalFingerprint,retryNumber }) : logicalFingerprint;
      const runTotal = [...this.localEvents.values()].filter(item=>item.research_job_id === researchJobId)
        .reduce((sum,item)=>sum+item.reserved_units+item.used_units,0);
      const dayKey=this.now().toISOString().slice(0,10);
      const dailyTotal=[...this.localEvents.values()].filter(item=>new Date(item.created_at||this.now()).toISOString().slice(0,10)===dayKey)
        .reduce((sum,item)=>sum+Number(item.reserved_units||0)+Number(item.used_units||0),0);
      if (runTotal + units > this.runCapUnits || this.localReserved + this.localUsed + units > this.billingPeriodCapUnits) {
        const error = new Error('Hunter credit budget reached'); error.code='HUNTER_CREDIT_CAP'; throw error;
      }
      if(dailyTotal+units>this.dailyCapUnits){
        const error = new Error('Hunter daily credit budget reached'); error.code='HUNTER_DAILY_CREDIT_CAP'; throw error;
      }
      const event = { id:requestFingerprint,research_job_id:researchJobId,company_id:companyId,endpoint,
        request_fingerprint:requestFingerprint,reserved_units:units,used_units:0,status:'RESERVED',
        credits_before_units:this.billingPeriodCapUnits-this.localUsed-this.localReserved,
        logical_request_fingerprint:logicalFingerprint,retry_number:retryNumber,
        result_payload:{logical_request_fingerprint:logicalFingerprint,retry_number:retryNumber},created_at:this.now() };
      this.localEvents.set(requestFingerprint,event); this.localReserved += units;
      return { ...event,replay:false };
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const period = currentBillingPeriod(this.now());
      await client.query(`INSERT INTO leadgen.provider_credit_ledger(provider,billing_period,credit_limit_units)
        VALUES ('HUNTER',$1,$2) ON CONFLICT (provider,billing_period) DO NOTHING`,[period,this.billingPeriodCapUnits]);
      const ledger = await client.query(`SELECT * FROM leadgen.provider_credit_ledger WHERE provider='HUNTER' AND billing_period=$1 FOR UPDATE`,[period]);
      const initialLedger=ledger.rows[0];
      const tightenedLimit=Math.max(Number(initialLedger.reserved_units)+Number(initialLedger.used_units),
        Math.min(Number(initialLedger.credit_limit_units),this.billingPeriodCapUnits));
      if(tightenedLimit<Number(initialLedger.credit_limit_units))await client.query(`UPDATE leadgen.provider_credit_ledger
        SET credit_limit_units=$2,updated_at=now() WHERE provider='HUNTER' AND billing_period=$1`,[period,tightenedLimit]);
      const stale = await client.query(`WITH stale_events AS (
          SELECT id,reserved_units FROM leadgen.provider_usage_events
          WHERE provider='HUNTER' AND billing_period=$1 AND status='RESERVED'
            AND created_at < now() - interval '30 minutes' FOR UPDATE
        ), released AS (
          UPDATE leadgen.provider_usage_events e SET status='TEMPORARY_ERROR',reserved_units=0,
            released_units=e.released_units+s.reserved_units,
            error_code='STALE_RESERVATION_RELEASED',completed_at=now()
          FROM stale_events s WHERE e.id=s.id RETURNING s.reserved_units
        ) SELECT reserved_units FROM released`,[period]);
      const released = stale.rows.reduce((sum,item)=>sum+Number(item.reserved_units || 0),0);
      if (released) await client.query(`UPDATE leadgen.provider_credit_ledger SET reserved_units=greatest(0,reserved_units-$2),updated_at=now()
        WHERE provider='HUNTER' AND billing_period=$1`,[period,released]);
      const existing = await client.query(`SELECT * FROM leadgen.provider_usage_events
        WHERE provider='HUNTER' AND (request_fingerprint=$1 OR result_payload->>'logical_request_fingerprint'=$1)
        ORDER BY created_at,id FOR UPDATE`,[logicalFingerprint]);
      const latest = existing.rows.at(-1);
      if(latest?.status==='RESERVED')throw Object.assign(new Error('Hunter request is already in progress'),{
        code:'HUNTER_REQUEST_IN_PROGRESS',retryable:true});
      if (latest && latest.status !== 'TEMPORARY_ERROR') {
        await client.query('COMMIT'); return { ...latest,replay:true };
      }
      const retryNumber = latest ? Number(latest.result_payload?.retry_number || 0) + 1 : 0;
      if (retryNumber > this.maxTemporaryRetries) {
        throw Object.assign(new Error('Hunter temporary retries exhausted'),{
          code:'HUNTER_TEMPORARY_RETRIES_EXHAUSTED',usage_event:latest});
      }
      const requestFingerprint = retryNumber ? fingerprint(researchJobId,endpoint,{ logicalFingerprint,retryNumber }) : logicalFingerprint;
      const run = await client.query(`SELECT coalesce(sum(reserved_units+used_units),0)::integer AS total
        FROM leadgen.provider_usage_events WHERE research_job_id=$1 AND provider='HUNTER'`,[researchJobId]);
      const daily = await client.query(`SELECT coalesce(sum(reserved_units+used_units),0)::integer AS total
        FROM leadgen.provider_usage_events WHERE provider='HUNTER'
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
      const current = released
        ? (await client.query(`SELECT * FROM leadgen.provider_credit_ledger WHERE provider='HUNTER' AND billing_period=$1`,[period])).rows[0]
        : ledger.rows[0];
      const effectiveLimit=Math.min(Number(current.credit_limit_units),this.billingPeriodCapUnits);
      if (Number(run.rows[0].total)+units > this.runCapUnits || Number(current.reserved_units)+Number(current.used_units)+units > effectiveLimit) {
        const error = new Error('Hunter credit budget reached'); error.code='HUNTER_CREDIT_CAP'; throw error;
      }
      if(Number(daily.rows[0].total)+units>this.dailyCapUnits){
        const error = new Error('Hunter daily credit budget reached'); error.code='HUNTER_DAILY_CREDIT_CAP'; throw error;
      }
      await client.query(`UPDATE leadgen.provider_credit_ledger SET reserved_units=reserved_units+$2,updated_at=now()
        WHERE provider='HUNTER' AND billing_period=$1`,[period,units]);
      const inserted = await client.query(`INSERT INTO leadgen.provider_usage_events
        (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,reserved_units,credits_before_units,result_payload)
        VALUES ($1,$2,'HUNTER',$3,$4,$5,'RESERVED',$6,$7,$8::jsonb) RETURNING *`,[
        researchJobId,companyId,period,endpoint,requestFingerprint,units,
        effectiveLimit-Number(current.used_units)-Number(current.reserved_units),
        JSON.stringify({logical_request_fingerprint:logicalFingerprint,retry_number:retryNumber})
      ]);
      await client.query('COMMIT');
      return { ...inserted.rows[0],replay:false,billing_period:period,
        logical_request_fingerprint:logicalFingerprint,retry_number:retryNumber };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }

  async settle(event, { usedUnits = 0, status = 'COMPLETED', providerRequestId = null, errorCode = null, resultPayload = {} } = {}) {
    if (event.replay) return event;
    const used = Math.max(0,Math.min(Number(event.reserved_units),Number(usedUnits) || 0));
    if (!this.pool) {
      this.localReserved -= Number(event.reserved_units);
      this.localUsed += used;
      const settledPayload={logical_request_fingerprint:event.logical_request_fingerprint,
        retry_number:Number(event.retry_number||0),...safeUsageSummary(resultPayload)};
      const settled = { ...event,status,used_units:used,reserved_units:0,
        released_units:Number(event.released_units||0)+Math.max(0,Number(event.reserved_units)-used),provider_request_id:providerRequestId,error_code:errorCode,result_payload:settledPayload,
        credits_after_units:Math.max(0,this.billingPeriodCapUnits-this.localUsed) };
      this.localEvents.set(event.request_fingerprint,settled);
      return settled;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT * FROM leadgen.provider_usage_events WHERE id=$1 FOR UPDATE`,[event.id]);
      if (!locked.rowCount || locked.rows[0].status !== 'RESERVED') { await client.query('COMMIT'); return locked.rows[0] || event; }
      const period = event.billing_period || currentBillingPeriod(this.now());
      const ledger = await client.query(`UPDATE leadgen.provider_credit_ledger
        SET reserved_units=greatest(0,reserved_units-$2),used_units=used_units+$3,updated_at=now()
        WHERE provider='HUNTER' AND billing_period=$1 RETURNING *`,[period,event.reserved_units,used]);
      const after = ledger.rowCount ? Math.max(0,Math.min(Number(ledger.rows[0].credit_limit_units),this.billingPeriodCapUnits)-Number(ledger.rows[0].used_units)-Number(ledger.rows[0].reserved_units)) : null;
      const settledPayload={logical_request_fingerprint:event.logical_request_fingerprint || locked.rows[0].result_payload?.logical_request_fingerprint,
        retry_number:Number(event.retry_number ?? locked.rows[0].result_payload?.retry_number ?? 0),...safeUsageSummary(resultPayload)};
      const result = await client.query(`UPDATE leadgen.provider_usage_events SET status=$2,reserved_units=0,used_units=$3,
        released_units=released_units+greatest(0,reserved_units-$3),credits_after_units=$4,provider_request_id=$5,error_code=$6,
        result_payload=$7::jsonb,completed_at=now() WHERE id=$1 RETURNING *`,[
        event.id,status,used,after,providerRequestId,errorCode,JSON.stringify(settledPayload)
      ]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }
}

export class HunterProvider {
  constructor({
    apiKey = '', mode = '', endpoint = 'https://api.hunter.io/v2', timeoutMs = 12000,
    fetchImpl = fetch, pool = null, runCapUnits = 20000, dailyCapUnits = 20000,
    billingPeriodCapUnits = 20000, budget = null
  } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.mode = !this.apiKey ? HUNTER_MODES.DISABLED
      : String(mode || (this.apiKey === 'test-api-key' ? HUNTER_MODES.TEST : HUNTER_MODES.FREE_FIRST)).toUpperCase();
    this.endpoint = String(endpoint || 'https://api.hunter.io/v2').replace(/\/$/,'');
    this.timeoutMs = Math.max(1000,Number(timeoutMs) || 12000);
    this.fetchImpl = fetchImpl;
    this.budget = budget || new HunterCreditBudget({ pool,runCapUnits,dailyCapUnits,billingPeriodCapUnits });
  }

  get capabilities() {
    return Object.freeze({ enabled:this.mode !== HUNTER_MODES.DISABLED,mode:this.mode,domain_search:true,email_finder:true,email_verifier:true });
  }

  async call({ researchJobId,companyId = null,endpoint,params,costUnits,usedUnits,normalize,
    persistResults=null,loadPersistedResults=null }) {
    if (this.mode === HUNTER_MODES.DISABLED) return { provider:'HUNTER',endpoint,status:'SKIPPED',error_code:'HUNTER_DISABLED',results:[],credits:{ reserved:0,used:0 } };
    const safeParams = Object.fromEntries(Object.entries(params).filter(([,value])=>value !== null && value !== undefined && value !== ''));
    const reservation = await this.budget.reserve({ researchJobId,companyId,endpoint,payload:safeParams,units:costUnits });
    if (reservation.replay) {
      if (reservation.status === 'TEMPORARY_ERROR') {
        throw Object.assign(new Error('Hunter request requires retry'),{code:'HUNTER_RETRY_REQUIRED',
          retryable:true,usage_event:reservation});
      }
      if(reservation.status==='FAILED')return{provider:'HUNTER',endpoint,status:'FAILED',replay_status:'FAILED',
        error_code:reservation.error_code||'PREVIOUS_REQUEST_FAILED',results:[],credits:{reserved:0,used:0},usage_event:reservation};
      if(reservation.status==='NOT_FOUND')return{provider:'HUNTER',endpoint,status:'SKIPPED',replay_status:'NOT_FOUND',
        error_code:'IDEMPOTENT_REPLAY',results:[],credits:{reserved:0,used:0,previously_used:Number(reservation.used_units||0)},usage_event:reservation};
      const referenceIds=persistenceReferences(reservation.result_payload?.business_reference_ids||[]);
      const restored=typeof loadPersistedResults==='function'
        ? persistenceResults(await loadPersistedResults({referenceIds,usageEvent:reservation,endpoint,researchJobId,companyId}))
        : [];
      if(!restored.length)return{provider:'HUNTER',endpoint,status:'REPLAY_LOOKUP_REQUIRED',replay_status:reservation.status,
        error_code:'BUSINESS_RESULT_LOOKUP_REQUIRED',results:[],credits:{reserved:0,used:0},usage_event:reservation};
      return { provider:'HUNTER',endpoint,status:'SKIPPED',replay_status:reservation.status || null,error_code:'IDEMPOTENT_REPLAY',
        captured_at:reservation.completed_at||reservation.created_at||null,results:restored,
        credits:{ reserved:0,used:0,previously_used:Number(reservation.used_units || 0) },usage_event:reservation };
    }
    const url = new URL(`${this.endpoint}/${endpoint}`);
    for (const [key,value] of Object.entries(safeParams)) {
      if (Array.isArray(value)) value.forEach(item=>url.searchParams.append(key,item));
      else url.searchParams.set(key,String(value));
    }
    let response;
    let payload;
    try {
      response = await this.fetchImpl(url,{ headers:{ accept:'application/json','X-API-KEY':this.apiKey },signal:AbortSignal.timeout(this.timeoutMs) });
      payload = await response.json();
      if (!response.ok) {
        const temporary = response.status === 429 || response.status >= 500;
        const code = temporary ? 'TEMPORARY_ERROR' : response.status === 401 || response.status === 403 ? 'AUTHENTICATION_FAILED' : 'HTTP_ERROR';
        const usage = await this.budget.settle(reservation,{ usedUnits:0,status:temporary?'TEMPORARY_ERROR':'FAILED',errorCode:code });
        return { provider:'HUNTER',endpoint,status:temporary?'TEMPORARY_ERROR':'FAILED',error_code:code,results:[],credits:{ reserved:costUnits,used:0 },usage_event:usage };
      }
      const normalized = normalize(payload?.data || {},payload) || { results:[],found:false };
      const actualUnits = typeof usedUnits === 'function' ? usedUnits(normalized,payload) : Number(usedUnits || 0);
      const capturedAt=new Date();
      const persisted=normalized.found&&typeof persistResults==='function'
        ? await persistResults(normalized.results||[],{usageEvent:reservation,endpoint,researchJobId,companyId,
          providerRequestId:payload?.meta?.request_id||null,capturedAt})
        : null;
      const referenceIds=persistenceReferences(persisted);
      const usage = await this.budget.settle(reservation,{ usedUnits:actualUnits,status:normalized.found?'COMPLETED':'NOT_FOUND',
        providerRequestId:payload?.meta?.request_id || null,resultPayload:usageSummary(endpoint,normalized,referenceIds) });
      return { provider:'HUNTER',endpoint,status:normalized.found?'COMPLETED':'NOT_FOUND',request_id:payload?.meta?.request_id || null,
        captured_at:capturedAt,results:normalized.results || [],credits:{ reserved:costUnits,used:actualUnits,before:usage.credits_before_units,after:usage.credits_after_units },usage_event:usage };
    } catch (error) {
      const temporary = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      const usage = await this.budget.settle(reservation,{ usedUnits:0,status:'TEMPORARY_ERROR',errorCode:temporary?'TIMEOUT':'NETWORK_ERROR' });
      return { provider:'HUNTER',endpoint,status:'TEMPORARY_ERROR',error_code:temporary?'TIMEOUT':'NETWORK_ERROR',results:[],credits:{ reserved:costUnits,used:0 },usage_event:usage };
    }
  }

  async domainSearch({ researchJobId,companyId,domain,departments = ['purchasing'],seniorities = ['senior','executive'],limit = 10,
    persistResults=null,loadPersistedResults=null } = {}) {
    const safeDomain = clean(domain,255).toLowerCase();
    if (!safeDomain || safeDomain.includes('/') || safeDomain.includes('@')) return { provider:'HUNTER',endpoint:'domain-search',status:'SKIPPED',error_code:'INVALID_DOMAIN',results:[] };
    return this.call({ researchJobId,companyId,endpoint:'domain-search',costUnits:HUNTER_CREDIT_UNITS.DOMAIN_SEARCH,
      params:{ domain:safeDomain,department:departments.slice(0,4),seniority:seniorities.slice(0,4),limit:Math.max(1,Math.min(10,limit)) },
      normalize:data=>({ found:Array.isArray(data.emails)&&data.emails.length>0,results:(data.emails||[]).map(item=>({
        person_name:clean(`${item.first_name || ''} ${item.last_name || ''}`,200) || null,raw_title:clean(item.position,300),
        email:clean(item.value,320).toLowerCase(),verification_status:mapHunterVerification(item.verification?.status),
        verification_score:Number.isFinite(Number(item.confidence))?Number(item.confidence):null,sources:item.sources || []
      })) }),usedUnits:normalized=>normalized.found?HUNTER_CREDIT_UNITS.DOMAIN_SEARCH:0,persistResults,loadPersistedResults });
  }

  async findEmail({ researchJobId,companyId,domain,firstName,lastName,linkedinHandle = '',persistResults=null,loadPersistedResults=null } = {}) {
    const safe = { domain:clean(domain,255).toLowerCase(),first_name:clean(firstName,120),last_name:clean(lastName,120),linkedin_handle:clean(linkedinHandle,500) };
    if (!safe.domain || ((!safe.first_name || !safe.last_name) && !safe.linkedin_handle)) return { provider:'HUNTER',endpoint:'email-finder',status:'SKIPPED',error_code:'VERIFIED_PERSON_REQUIRED',results:[] };
    return this.call({ researchJobId,companyId,endpoint:'email-finder',params:safe,costUnits:HUNTER_CREDIT_UNITS.EMAIL_FINDER,
      normalize:data=>({ found:Boolean(data.email),results:data.email?[{ email:clean(data.email,320).toLowerCase(),person_name:clean(`${data.first_name || ''} ${data.last_name || ''}`,200) || null,
        raw_title:clean(data.position,300),verification_status:mapHunterVerification(data.verification?.status),verification_score:Number.isFinite(Number(data.score))?Number(data.score):null,sources:data.sources || [] }]:[] }),
      usedUnits:normalized=>normalized.found?HUNTER_CREDIT_UNITS.EMAIL_FINDER:0,persistResults,loadPersistedResults });
  }

  async verifyEmail({ researchJobId,companyId,email,persistResults=null,loadPersistedResults=null } = {}) {
    const normalizedEmail = emailService.normalize(email);
    if (!emailService.isValidSyntax(normalizedEmail)) return { provider:'HUNTER',endpoint:'email-verifier',status:'SKIPPED',error_code:'INVALID_EMAIL_SYNTAX',results:[] };
    return this.call({ researchJobId,companyId,endpoint:'email-verifier',params:{ email:normalizedEmail },costUnits:HUNTER_CREDIT_UNITS.EMAIL_VERIFIER,
      normalize:data=>({ found:Boolean(data.status),results:[{ email:normalizedEmail,verification_status:mapHunterVerification(data.status),verification_score:Number.isFinite(Number(data.score))?Number(data.score):null }] }),
      usedUnits:normalized=>normalized.results[0]?.verification_status === 'UNKNOWN' ? 0 : HUNTER_CREDIT_UNITS.EMAIL_VERIFIER,
      persistResults,loadPersistedResults });
  }
}
