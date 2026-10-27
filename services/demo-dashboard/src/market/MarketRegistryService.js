import {isMarketVisible} from '../../public/market-visibility.js';

const codeError=(code,status)=>Object.assign(new Error(code),{code,status});
const MARKET_CODE=/^[A-Z]{2}$/;
const HHMM=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const minutes=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};

/** Email send window of a market in its own time zone: days 1 (Mon) ... 7 (Sun), start < end ("HH:MM"). */
export function normalizeSendWindow(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw codeError('MARKET_SEND_WINDOW_INVALID',400);
  const days=Array.isArray(input.days)?[...new Set(input.days.map(Number))].sort((a,b)=>a-b):[];
  if(!days.length||days.some(day=>!Number.isInteger(day)||day<1||day>7))throw codeError('MARKET_SEND_WINDOW_DAYS_INVALID',400);
  const start=String(input.start||'').trim(),end=String(input.end||'').trim();
  if(!HHMM.test(start)||!HHMM.test(end))throw codeError('MARKET_SEND_WINDOW_TIME_INVALID',400);
  if(minutes(start)>=minutes(end))throw codeError('MARKET_SEND_WINDOW_ORDER_INVALID',400);
  return{days,start,end};
}
const sameWindow=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
const COLUMNS=`market_code,country_name,status,search_enabled,market_profile,languages,buyer_types,timezone,
  business_send_window,country_terms,source_reference,updated_at`;

// Management control of which registry markets research may search. Enabling a market makes it
// ACTIVE and search-enabled; disabling only stops new searches (existing prospects keep their
// ACTIVE market for follow-up). Every change is appended to research_market_registry_events.
export class MarketRegistryService {
  constructor({pool}={}){if(!pool)throw new Error('MarketRegistryService requires a PostgreSQL pool');this.pool=pool;}
  async list(){
    const result=await this.pool.query(`SELECT ${COLUMNS} FROM leadgen.research_market_registry
      WHERE status<>'HIDDEN' ORDER BY search_enabled DESC,status,market_code`);
    return result.rows.filter(row=>isMarketVisible(row.market_code));
  }
  async activeMarketCodes(queryable=this.pool){
    const result=await queryable.query(`SELECT market_code FROM leadgen.research_market_registry WHERE status='ACTIVE' ORDER BY market_code`);
    return result.rows.map(row=>row.market_code).filter(code=>isMarketVisible(code));
  }
  async setSearchEnabled(code,{search_enabled:enabled,actor,role,reason}={}){
    const marketCode=String(code||'').trim().toUpperCase();
    if(!MARKET_CODE.test(marketCode))throw codeError('MARKET_CODE_INVALID',400);
    if(typeof enabled!=='boolean')throw codeError('MARKET_SEARCH_ENABLED_REQUIRED',400);
    if(!String(actor||'').trim())throw codeError('MARKET_ACTOR_REQUIRED',403);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const current=(await client.query(`SELECT ${COLUMNS} FROM leadgen.research_market_registry WHERE market_code=$1 FOR UPDATE`,[marketCode])).rows[0];
      if(!current)throw codeError('MARKET_NOT_FOUND',404);
      if(current.status==='HIDDEN'||!isMarketVisible(marketCode))throw codeError('MARKET_HIDDEN',409);
      const status=enabled?'ACTIVE':current.status;
      if(current.status===status&&current.search_enabled===enabled){
        await client.query('COMMIT');
        return {...current,changed:false};
      }
      const updated=(await client.query(`UPDATE leadgen.research_market_registry SET status=$2,search_enabled=$3,updated_at=now()
        WHERE market_code=$1 RETURNING ${COLUMNS}`,[marketCode,status,enabled])).rows[0];
      const event=(await client.query(`INSERT INTO leadgen.research_market_registry_events
        (market_code,previous_status,previous_search_enabled,status,search_enabled,actor,actor_role,change_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at`,[marketCode,current.status,current.search_enabled,status,enabled,
        String(actor).trim(),String(role||'UNKNOWN').trim(),
        String(reason||'').trim()||(enabled?'Management enabled market search':'Management disabled market search')])).rows[0];
      await client.query('COMMIT');
      return {...updated,changed:true,event_id:event.id,changed_at:event.created_at};
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
    finally{client.release();}
  }
  // D1: change a market's email send window. The registry row keeps the current window; the previous and
  // the new window are appended to research_market_registry_events (migration 072 columns).
  async setSendWindow(code,{business_send_window:input,actor,role,reason}={}){
    const marketCode=String(code||'').trim().toUpperCase();
    if(!MARKET_CODE.test(marketCode))throw codeError('MARKET_CODE_INVALID',400);
    const window=normalizeSendWindow(input);
    if(!String(actor||'').trim())throw codeError('MARKET_ACTOR_REQUIRED',403);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const current=(await client.query(`SELECT ${COLUMNS} FROM leadgen.research_market_registry WHERE market_code=$1 FOR UPDATE`,[marketCode])).rows[0];
      if(!current)throw codeError('MARKET_NOT_FOUND',404);
      if(current.status==='HIDDEN'||!isMarketVisible(marketCode))throw codeError('MARKET_HIDDEN',409);
      const previous=current.business_send_window?{days:[...(current.business_send_window.days||[])].map(Number).sort((a,b)=>a-b),
        start:current.business_send_window.start,end:current.business_send_window.end}:null;
      if(sameWindow(previous,window)){await client.query('COMMIT');return{...current,changed:false};}
      const updated=(await client.query(`UPDATE leadgen.research_market_registry SET business_send_window=$2::jsonb,updated_at=now()
        WHERE market_code=$1 RETURNING ${COLUMNS}`,[marketCode,JSON.stringify(window)])).rows[0];
      const event=(await client.query(`INSERT INTO leadgen.research_market_registry_events
        (market_code,previous_status,previous_search_enabled,status,search_enabled,actor,actor_role,change_reason,
         previous_business_send_window,business_send_window)
        VALUES($1,$2,$3,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING id,created_at`,[marketCode,current.status,current.search_enabled,
        String(actor).trim(),String(role||'UNKNOWN').trim(),String(reason||'').trim()||'Management changed the email send window',
        previous?JSON.stringify(current.business_send_window):null,JSON.stringify(window)])).rows[0];
      await client.query('COMMIT');
      return{...updated,changed:true,event_id:event.id,changed_at:event.created_at};
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
    finally{client.release();}
  }
  async events(code,{limit=50}={}){
    const result=await this.pool.query(`SELECT * FROM leadgen.research_market_registry_events WHERE market_code=$1
      ORDER BY created_at DESC,id DESC LIMIT $2`,[String(code||'').trim().toUpperCase(),Math.max(1,Math.min(200,Number(limit)||50))]);
    return result.rows;
  }
}
