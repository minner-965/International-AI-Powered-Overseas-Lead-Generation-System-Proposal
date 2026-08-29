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

export function mapHunterVerification(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'valid') return 'VALID';
  if (value === 'accept_all' || value === 'accept-all') return 'ACCEPT_ALL';
  if (['invalid','disposable'].includes(value)) return 'INVALID';
  if (['unknown','blocked'].includes(value)) return 'UNKNOWN';
  return 'NOT_VERIFIED';
}

export class HunterCreditBudget {
  constructor({ pool = null, runCapUnits = 20000, billingPeriodCapUnits = 20000, now = () => new Date() } = {}) {
    this.pool = pool;
    this.runCapUnits = Math.max(0,Number(runCapUnits) || 0);
    this.billingPeriodCapUnits = Math.max(0,Number(billingPeriodCapUnits) || 0);
    this.now = now;
    this.localEvents = new Map();
    this.localUsed = 0;
    this.localReserved = 0;
  }

  async reserve({ researchJobId, companyId = null, endpoint, payload, units }) {
    const requestFingerprint = fingerprint(researchJobId,endpoint,payload);
    if (!this.pool) {
      const existing = this.localEvents.get(requestFingerprint);
      if (existing) return { ...existing,replay:true };
      const runTotal = [...this.localEvents.values()].filter(item=>item.research_job_id === researchJobId)
        .reduce((sum,item)=>sum+item.reserved_units+item.used_units,0);
      if (runTotal + units > this.runCapUnits || this.localReserved + this.localUsed + units > this.billingPeriodCapUnits) {
        const error = new Error('Hunter credit budget reached'); error.code='HUNTER_CREDIT_CAP'; throw error;
      }
      const event = { id:requestFingerprint,research_job_id:researchJobId,company_id:companyId,endpoint,
        request_fingerprint:requestFingerprint,reserved_units:units,used_units:0,status:'RESERVED',
        credits_before_units:this.billingPeriodCapUnits-this.localUsed-this.localReserved };
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
      const stale = await client.query(`WITH stale_events AS (
          SELECT id,reserved_units FROM leadgen.provider_usage_events
          WHERE provider='HUNTER' AND billing_period=$1 AND status='RESERVED'
            AND created_at < now() - interval '30 minutes' FOR UPDATE
        ), released AS (
          UPDATE leadgen.provider_usage_events e SET status='TEMPORARY_ERROR',reserved_units=0,
            error_code='STALE_RESERVATION_RELEASED',completed_at=now()
          FROM stale_events s WHERE e.id=s.id RETURNING s.reserved_units
        ) SELECT reserved_units FROM released`,[period]);
      const released = stale.rows.reduce((sum,item)=>sum+Number(item.reserved_units || 0),0);
      if (released) await client.query(`UPDATE leadgen.provider_credit_ledger SET reserved_units=greatest(0,reserved_units-$2),updated_at=now()
        WHERE provider='HUNTER' AND billing_period=$1`,[period,released]);
      const existing = await client.query(`SELECT * FROM leadgen.provider_usage_events WHERE provider='HUNTER' AND request_fingerprint=$1 FOR UPDATE`,[requestFingerprint]);
      if (existing.rowCount) { await client.query('COMMIT'); return { ...existing.rows[0],replay:true }; }
      const run = await client.query(`SELECT coalesce(sum(reserved_units+used_units),0)::integer AS total
        FROM leadgen.provider_usage_events WHERE research_job_id=$1 AND provider='HUNTER'`,[researchJobId]);
      const current = released
        ? (await client.query(`SELECT * FROM leadgen.provider_credit_ledger WHERE provider='HUNTER' AND billing_period=$1`,[period])).rows[0]
        : ledger.rows[0];
      if (Number(run.rows[0].total)+units > this.runCapUnits || Number(current.reserved_units)+Number(current.used_units)+units > Number(current.credit_limit_units)) {
        const error = new Error('Hunter credit budget reached'); error.code='HUNTER_CREDIT_CAP'; throw error;
      }
      await client.query(`UPDATE leadgen.provider_credit_ledger SET reserved_units=reserved_units+$2,updated_at=now()
        WHERE provider='HUNTER' AND billing_period=$1`,[period,units]);
      const inserted = await client.query(`INSERT INTO leadgen.provider_usage_events
        (research_job_id,company_id,provider,billing_period,endpoint,request_fingerprint,status,reserved_units,credits_before_units)
        VALUES ($1,$2,'HUNTER',$3,$4,$5,'RESERVED',$6,$7) RETURNING *`,[
        researchJobId,companyId,period,endpoint,requestFingerprint,units,
        Number(current.credit_limit_units)-Number(current.used_units)-Number(current.reserved_units)
      ]);
      await client.query('COMMIT');
      return { ...inserted.rows[0],replay:false,billing_period:period };
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
      const settled = { ...event,status,used_units:used,reserved_units:0,provider_request_id:providerRequestId,error_code:errorCode,result_payload:resultPayload,
        credits_after_units:this.billingPeriodCapUnits-this.localUsed };
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
      const after = ledger.rowCount ? Number(ledger.rows[0].credit_limit_units)-Number(ledger.rows[0].used_units)-Number(ledger.rows[0].reserved_units) : null;
      const result = await client.query(`UPDATE leadgen.provider_usage_events SET status=$2,reserved_units=0,used_units=$3,
        credits_after_units=$4,provider_request_id=$5,error_code=$6,result_payload=$7::jsonb,completed_at=now() WHERE id=$1 RETURNING *`,[
        event.id,status,used,after,providerRequestId,errorCode,JSON.stringify(resultPayload || {})
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
    fetchImpl = fetch, pool = null, runCapUnits = 20000, billingPeriodCapUnits = 20000, budget = null
  } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.mode = !this.apiKey ? HUNTER_MODES.DISABLED
      : String(mode || (this.apiKey === 'test-api-key' ? HUNTER_MODES.TEST : HUNTER_MODES.FREE_FIRST)).toUpperCase();
    this.endpoint = String(endpoint || 'https://api.hunter.io/v2').replace(/\/$/,'');
    this.timeoutMs = Math.max(1000,Number(timeoutMs) || 12000);
    this.fetchImpl = fetchImpl;
    this.budget = budget || new HunterCreditBudget({ pool,runCapUnits,billingPeriodCapUnits });
  }

  get capabilities() {
    return Object.freeze({ enabled:this.mode !== HUNTER_MODES.DISABLED,mode:this.mode,domain_search:true,email_finder:true,email_verifier:true });
  }

  async call({ researchJobId,companyId = null,endpoint,params,costUnits,usedUnits,normalize }) {
    if (this.mode === HUNTER_MODES.DISABLED) return { provider:'HUNTER',endpoint,status:'SKIPPED',error_code:'HUNTER_DISABLED',results:[],credits:{ reserved:0,used:0 } };
    const safeParams = Object.fromEntries(Object.entries(params).filter(([,value])=>value !== null && value !== undefined && value !== ''));
    const reservation = await this.budget.reserve({ researchJobId,companyId,endpoint,payload:safeParams,units:costUnits });
    if (reservation.replay) {
      const replayPayload = reservation.result_payload && typeof reservation.result_payload === 'object' ? reservation.result_payload : {};
      return { provider:'HUNTER',endpoint,status:'SKIPPED',replay_status:reservation.status || null,error_code:'IDEMPOTENT_REPLAY',
        results:Array.isArray(replayPayload.results) ? replayPayload.results : [],credits:{ reserved:0,used:Number(reservation.used_units || 0) },usage_event:reservation };
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
      const usage = await this.budget.settle(reservation,{ usedUnits:actualUnits,status:normalized.found?'COMPLETED':'NOT_FOUND',
        providerRequestId:payload?.meta?.request_id || null,resultPayload:{ results:normalized.results || [] } });
      return { provider:'HUNTER',endpoint,status:normalized.found?'COMPLETED':'NOT_FOUND',request_id:payload?.meta?.request_id || null,
        captured_at:new Date(),results:normalized.results || [],credits:{ reserved:costUnits,used:actualUnits,before:usage.credits_before_units,after:usage.credits_after_units },usage_event:usage };
    } catch (error) {
      const temporary = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      const usage = await this.budget.settle(reservation,{ usedUnits:0,status:'TEMPORARY_ERROR',errorCode:temporary?'TIMEOUT':'NETWORK_ERROR' });
      return { provider:'HUNTER',endpoint,status:'TEMPORARY_ERROR',error_code:temporary?'TIMEOUT':'NETWORK_ERROR',results:[],credits:{ reserved:costUnits,used:0 },usage_event:usage };
    }
  }

  async domainSearch({ researchJobId,companyId,domain,departments = ['purchasing'],seniorities = ['senior','executive'],limit = 10 } = {}) {
    const safeDomain = clean(domain,255).toLowerCase();
    if (!safeDomain || safeDomain.includes('/') || safeDomain.includes('@')) return { provider:'HUNTER',endpoint:'domain-search',status:'SKIPPED',error_code:'INVALID_DOMAIN',results:[] };
    return this.call({ researchJobId,companyId,endpoint:'domain-search',costUnits:HUNTER_CREDIT_UNITS.DOMAIN_SEARCH,
      params:{ domain:safeDomain,department:departments.slice(0,4),seniority:seniorities.slice(0,4),limit:Math.max(1,Math.min(10,limit)) },
      normalize:data=>({ found:Array.isArray(data.emails)&&data.emails.length>0,results:(data.emails||[]).map(item=>({
        person_name:clean(`${item.first_name || ''} ${item.last_name || ''}`,200) || null,raw_title:clean(item.position,300),
        email:clean(item.value,320).toLowerCase(),verification_status:mapHunterVerification(item.verification?.status),
        verification_score:Number.isFinite(Number(item.confidence))?Number(item.confidence):null,sources:item.sources || []
      })) }),usedUnits:normalized=>normalized.found?HUNTER_CREDIT_UNITS.DOMAIN_SEARCH:0 });
  }

  async findEmail({ researchJobId,companyId,domain,firstName,lastName,linkedinHandle = '' } = {}) {
    const safe = { domain:clean(domain,255).toLowerCase(),first_name:clean(firstName,120),last_name:clean(lastName,120),linkedin_handle:clean(linkedinHandle,500) };
    if (!safe.domain || ((!safe.first_name || !safe.last_name) && !safe.linkedin_handle)) return { provider:'HUNTER',endpoint:'email-finder',status:'SKIPPED',error_code:'VERIFIED_PERSON_REQUIRED',results:[] };
    return this.call({ researchJobId,companyId,endpoint:'email-finder',params:safe,costUnits:HUNTER_CREDIT_UNITS.EMAIL_FINDER,
      normalize:data=>({ found:Boolean(data.email),results:data.email?[{ email:clean(data.email,320).toLowerCase(),person_name:clean(`${data.first_name || ''} ${data.last_name || ''}`,200) || null,
        raw_title:clean(data.position,300),verification_status:mapHunterVerification(data.verification?.status),verification_score:Number.isFinite(Number(data.score))?Number(data.score):null,sources:data.sources || [] }]:[] }),
      usedUnits:normalized=>normalized.found?HUNTER_CREDIT_UNITS.EMAIL_FINDER:0 });
  }

  async verifyEmail({ researchJobId,companyId,email } = {}) {
    const normalizedEmail = emailService.normalize(email);
    if (!emailService.isValidSyntax(normalizedEmail)) return { provider:'HUNTER',endpoint:'email-verifier',status:'SKIPPED',error_code:'INVALID_EMAIL_SYNTAX',results:[] };
    return this.call({ researchJobId,companyId,endpoint:'email-verifier',params:{ email:normalizedEmail },costUnits:HUNTER_CREDIT_UNITS.EMAIL_VERIFIER,
      normalize:data=>({ found:Boolean(data.status),results:[{ email:normalizedEmail,verification_status:mapHunterVerification(data.status),verification_score:Number.isFinite(Number(data.score))?Number(data.score):null }] }),
      usedUnits:normalized=>normalized.results[0]?.verification_status === 'UNKNOWN' ? 0 : HUNTER_CREDIT_UNITS.EMAIL_VERIFIER });
  }
}
