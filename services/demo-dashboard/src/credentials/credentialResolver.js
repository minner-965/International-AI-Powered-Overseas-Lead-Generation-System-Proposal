// Provider credentials (B9): encrypted storage, append-only history and the resolver every provider
// client should ask for its key.
//   getCredential({merchantId,provider,field}) -> merchant key, else SIM key, else environment variable.
// A merchant's key is used only when the merchant stored every required field of that provider, so a
// merchant login is never mixed with SIM's password. Plaintext never leaves this module except to the
// caller that needs it for the provider request; views carry configured / last4 / set_at only.
import {createSecretBox} from '../merchant/secretBox.js';
import {PROVIDERS,PROVIDER_KEYS,providerOf,fieldOf,requiredFields} from './providerCatalog.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const fail=(code,message,status=400,extra={})=>Object.assign(new Error(message),{code,status,...extra});
const PLACEHOLDER=/REPLACE_WITH|NOT_CONFIGURED|CHANGE_ME/i;
const usable=value=>{const text=String(value??'').trim();return text&&!PLACEHOLDER.test(text)?text:'';};
const aadFor=(scope,merchantId,provider,field)=>`provider-credential:${scope}:${merchantId||'-'}:${provider}:${field}`;
export const last4Of=value=>{const text=String(value||'');return text.length>=8?text.slice(-4):null;};

function merchantId(value){
  if(value===null||value===undefined||value==='')return null;
  const text=String(value).trim();
  if(!UUID.test(text))throw fail('MERCHANT_INVALID_ID','merchant_id must be a UUID');
  return text;
}

function privateHost(hostname){
  const host=String(hostname||'').toLowerCase().replace(/^\[|\]$/g,'');
  if(!host.includes('.')&&!host.includes(':'))return true; // single-label names (docker services, localhost)
  if(/(^|\.)localhost$|\.local$|\.internal$/.test(host))return true;
  if(/^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host))return true;
  if(host.includes(':'))return /^(::1?|f[cd]|fe80)/.test(host)||host.startsWith('::ffff:');
  return false;
}

/** Validate one value before it is encrypted. Merchant URLs must be public https addresses. */
export function validateValue({provider,field,value,ownerScope}){
  const spec=fieldOf(provider,field);
  if(!spec)throw fail('CREDENTIAL_FIELD_UNKNOWN',`Unknown field ${field} for ${provider}`);
  const text=String(value??'').trim();
  if(!text)throw fail('CREDENTIAL_VALUE_REQUIRED',`${field} is required`);
  if(text.length>4096)throw fail('CREDENTIAL_VALUE_TOO_LONG',`${field} is too long`);
  if(/[\u0000-\u001f\u007f]/.test(text))throw fail('CREDENTIAL_VALUE_INVALID',`${field} contains control characters`);
  if(field==='base_url'){
    let url;try{url=new URL(text);}catch{throw fail('CREDENTIAL_URL_INVALID','Enter a full address starting with http:// or https://');}
    if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw fail('CREDENTIAL_URL_INVALID','Enter a full address starting with http:// or https://');
    if(ownerScope==='MERCHANT'&&(url.protocol!=='https:'||privateHost(url.hostname)))
      throw fail('CREDENTIAL_URL_NOT_ALLOWED','Use a public https address');
  }
  if(field==='provider'&&!/^[a-z0-9][a-z0-9_.-]{1,39}$/i.test(text))throw fail('CREDENTIAL_VALUE_INVALID','Provider name may use letters, digits, - _ .');
  return text;
}

export class CredentialStore{
  constructor({pool,secretKey=process.env.MERCHANT_SECRET_KEY,secretBox=null,env=process.env,cacheTtlMs=30_000,now=()=>Date.now(),log=console}={}){
    this.pool=pool;this.box=secretBox||createSecretBox(secretKey);this.env=env;this.ttl=cacheTtlMs;this.now=now;this.log=log;
    this.cache=new Map();
  }

  // ---------- reads ----------
  async activeRows(merchant){
    const id=merchantId(merchant);
    const sql=id
      ?`SELECT * FROM leadgen.provider_credentials WHERE owner_scope='MERCHANT' AND merchant_id=$1 AND revoked_at IS NULL`
      :`SELECT * FROM leadgen.provider_credentials WHERE owner_scope='SIM' AND revoked_at IS NULL`;
    return (await this.pool.query(sql,id?[id]:[])).rows;
  }

  /** Decrypted active values for one owner: {provider:{field:value}}; cached for a short time. */
  async values(merchant){
    const id=merchantId(merchant);const key=id||'SIM';
    const hit=this.cache.get(key);
    if(hit&&hit.expires>this.now())return hit.values;
    const values={};
    if(this.pool){
      for(const row of await this.activeRows(id)){
        if(!this.box.configured){this.warn('PROVIDER_CREDENTIAL_KEY_MISSING',row);continue;}
        try{(values[row.provider]??={})[row.field]=this.box.decrypt(row.ciphertext,aadFor(row.owner_scope,row.merchant_id,row.provider,row.field));}
        catch{this.warn('PROVIDER_CREDENTIAL_UNREADABLE',row);}
      }
    }
    this.cache.set(key,{values,expires:this.now()+this.ttl});
    return values;
  }
  warn(event,row){this.log?.warn?.(JSON.stringify({event,provider:row.provider,field:row.field,owner_scope:row.owner_scope}));}
  invalidate(merchant){this.cache.delete(merchantId(merchant)||'SIM');}

  // ---------- resolver ----------
  /** {source:'MERCHANT'|'SIM'|'ENV'|'NONE', values:{field:value}, configured, merchant_billed}. */
  async resolveProvider({merchantId:merchant=null,provider}){
    const spec=providerOf(provider);
    if(!spec)throw fail('CREDENTIAL_PROVIDER_UNKNOWN',`Unknown provider ${provider}`);
    const id=merchantId(merchant);
    if(id&&spec.scope==='BOTH'){
      const own=(await this.values(id))[spec.key]||{};
      if(requiredFields(spec.key).every(item=>usable(own[item.name])))
        return{source:'MERCHANT',values:Object.fromEntries(spec.fields.map(item=>[item.name,usable(own[item.name])])),configured:true,merchant_billed:true};
    }
    const sim=(await this.values(null))[spec.key]||{};
    let fromDb=false;const values={};
    for(const item of spec.fields){
      const stored=usable(sim[item.name]);
      if(stored){values[item.name]=stored;fromDb=true;}else values[item.name]=usable(this.env[item.env]);
    }
    const configured=requiredFields(spec.key).every(item=>values[item.name]);
    const any=Object.values(values).some(Boolean);
    return{source:fromDb?'SIM':any?'ENV':'NONE',values,configured,merchant_billed:false};
  }

  async getCredential({merchantId:merchant=null,provider,field}){
    if(!fieldOf(provider,field))throw fail('CREDENTIAL_FIELD_UNKNOWN',`Unknown field ${field} for ${provider}`);
    return (await this.resolveProvider({merchantId:merchant,provider})).values[field]||'';
  }

  /** process.env-shaped object with every provider field overlaid (for adapters that read env.*). */
  async envFor({merchantId:merchant=null}={}){
    const out={...this.env};
    for(const key of PROVIDER_KEYS){
      const resolved=await this.resolveProvider({merchantId:merchant,provider:key});
      for(const item of PROVIDERS[key].fields)if(resolved.values[item.name])out[item.env]=resolved.values[item.name];
    }
    return out;
  }

  /** Refresh the synchronous SIM overlay used by liveEnv(). */
  async refreshLive(){
    const overlay={};
    for(const key of PROVIDER_KEYS){
      const resolved=await this.resolveProvider({merchantId:null,provider:key});
      for(const item of PROVIDERS[key].fields)if(resolved.values[item.name])overlay[item.env]=resolved.values[item.name];
    }
    this.liveOverlay=overlay;
    return overlay;
  }

  /**
   * process.env-shaped Proxy for SIM-level clients constructed once at startup (Feishu adapter,
   * CRM service, Phase 7 service): reads see keys saved on the API keys page within refreshMs,
   * without a restart. Values not set on the page fall back to the real environment.
   */
  liveEnv({refreshMs=this.ttl}={}){
    if(!this.liveProxy){
      this.liveOverlay||={};
      const refresh=()=>this.refreshLive().catch(error=>this.log?.warn?.(JSON.stringify({event:'PROVIDER_CREDENTIAL_REFRESH_FAILED',code:error?.code||null})));
      void refresh();
      this.liveTimer=setInterval(refresh,Math.max(1000,refreshMs));this.liveTimer.unref?.();
      const env=this.env;const self=this;
      this.liveProxy=new Proxy(env,{
        get:(target,prop)=>typeof prop==='string'&&Object.hasOwn(self.liveOverlay,prop)?self.liveOverlay[prop]:target[prop],
        has:(target,prop)=>(typeof prop==='string'&&Object.hasOwn(self.liveOverlay,prop))||prop in target,
        ownKeys:target=>[...new Set([...Reflect.ownKeys(target),...Object.keys(self.liveOverlay)])],
        getOwnPropertyDescriptor:(target,prop)=>typeof prop==='string'&&Object.hasOwn(self.liveOverlay,prop)
          ?{value:self.liveOverlay[prop],enumerable:true,configurable:true,writable:false}:Reflect.getOwnPropertyDescriptor(target,prop)
      });
    }
    return this.liveProxy;
  }
  stopLive(){if(this.liveTimer)clearInterval(this.liveTimer);this.liveTimer=null;}

  // ---------- writes ----------
  scopeCheck(provider,merchant){
    const spec=providerOf(provider);
    if(!spec)throw fail('CREDENTIAL_PROVIDER_UNKNOWN',`Unknown provider ${provider}`,404);
    if(merchant&&spec.scope!=='BOTH')throw fail('CREDENTIAL_SIM_ONLY','This service is set up by SIM for every account',403);
    return spec;
  }

  /** Replace the given fields (blank fields are left unchanged). Returns the owner's view. */
  async set({merchantId:merchant=null,provider,values={},actor}){
    const id=merchantId(merchant);const spec=this.scopeCheck(provider,id);
    if(!this.box.configured)throw fail('MERCHANT_SECRET_KEY_MISSING','Encryption key is not configured on the server',503);
    const ownerScope=id?'MERCHANT':'SIM';
    const entries=Object.entries(values||{}).filter(([,value])=>String(value??'').trim()!=='');
    if(!entries.length)throw fail('CREDENTIAL_VALUE_REQUIRED','Enter at least one value');
    const clean=entries.map(([field,value])=>[field,validateValue({provider:spec.key,field,value,ownerScope})]);
    const who=String(actor||'unknown').slice(0,320);
    if(id&&!(await this.pool.query('SELECT 1 FROM leadgen.merchants WHERE id=$1',[id])).rowCount)throw fail('MERCHANT_NOT_FOUND','Merchant not found',404);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      for(const [field,value] of clean){
        await client.query(`UPDATE leadgen.provider_credentials SET revoked_at=now(),revoked_by=$4
          WHERE owner_scope=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid AND provider=$3 AND field=$5 AND revoked_at IS NULL`,[ownerScope,id,spec.key,who,field]);
        await client.query(`INSERT INTO leadgen.provider_credentials(owner_scope,merchant_id,provider,field,ciphertext,last4,set_by)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[ownerScope,id,spec.key,field,this.box.encrypt(value,aadFor(ownerScope,id,spec.key,field)),last4Of(value),who]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
    this.invalidate(id);
    if(!id&&this.liveProxy)await this.refreshLive();
    return this.view({merchantId:id});
  }

  /** Revoke one field or every field of a provider (history rows stay). */
  async revoke({merchantId:merchant=null,provider,field=null,actor}){
    const id=merchantId(merchant);const spec=this.scopeCheck(provider,id);
    if(field&&!fieldOf(spec.key,field))throw fail('CREDENTIAL_FIELD_UNKNOWN',`Unknown field ${field} for ${provider}`);
    await this.pool.query(`UPDATE leadgen.provider_credentials SET revoked_at=now(),revoked_by=$4
      WHERE owner_scope=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid AND provider=$3 AND revoked_at IS NULL AND ($5::text IS NULL OR field=$5)`,
      [id?'MERCHANT':'SIM',id,spec.key,String(actor||'unknown').slice(0,320),field]);
    this.invalidate(id);
    if(!id&&this.liveProxy)await this.refreshLive();
    return this.view({merchantId:id});
  }

  async recordTest({merchantId:merchant=null,provider,source,ok,code,actor}){
    const id=merchantId(merchant);
    await this.pool.query(`INSERT INTO leadgen.provider_credential_tests(owner_scope,merchant_id,provider,credential_source,ok,result_code,tested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[id?'MERCHANT':'SIM',id,provider,source,Boolean(ok),String(code||'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,80),String(actor||'unknown').slice(0,320)]);
  }

  // ---------- views (never plaintext) ----------
  async view({merchantId:merchant=null}={}){
    const id=merchantId(merchant);
    const rows=await this.activeRows(id);
    const tests=(await this.pool.query(`SELECT DISTINCT ON (provider) provider,ok,result_code,tested_at,credential_source FROM leadgen.provider_credential_tests
      WHERE owner_scope=$1 AND merchant_id IS NOT DISTINCT FROM $2::uuid ORDER BY provider,tested_at DESC`,[id?'MERCHANT':'SIM',id])).rows;
    const keys=id?PROVIDER_KEYS.filter(key=>PROVIDERS[key].scope==='BOTH'):PROVIDER_KEYS;
    const items=[];
    for(const key of keys){
      const spec=PROVIDERS[key];const resolved=await this.resolveProvider({merchantId:id,provider:key});
      const test=tests.find(item=>item.provider===key);
      items.push({provider:key,group:spec.group,scope:spec.scope,label:{zh:spec.zh,en:spec.en},
        // A merchant only learns whether its own key is used or SIM provides the service.
        in_use:id?(resolved.merchant_billed?'MERCHANT':resolved.configured?'SIM_PROVIDED':'NONE'):resolved.source,
        configured:id?resolved.merchant_billed:resolved.configured,merchant_billed:resolved.merchant_billed,
        fields:spec.fields.map(item=>{
          const row=rows.find(entry=>entry.provider===key&&entry.field===item.name);
          return{field:item.name,label:{zh:item.zh,en:item.en},secret:item.secret,optional:item.optional,
            configured:Boolean(row),last4:row?.last4||null,set_at:row?.set_at||null,set_by:id?undefined:row?.set_by||null,
            env_fallback:!id&&!row?Boolean(usable(this.env[item.env])):undefined};
        }),
        usage:id?undefined:providerUsage(key,this.env),
        last_test:test?{ok:test.ok,code:test.result_code,tested_at:test.tested_at,source:test.credential_source}:null});
    }
    return{owner:id?'MERCHANT':'SIM',merchant_id:id,encryption_ready:this.box.configured,items};
  }
}

/** Whether the system currently uses a provider at all (B8), from the server settings that switch it.
 *  Read-only here: these come from the server environment, the search spending choice is on Settings. */
export function providerUsage(key,env=process.env){
  const order=String(env.SEARCH_PROVIDER_ORDER||'searxng,exa,tavily').toLowerCase().split(',').map(item=>item.trim()).filter(Boolean);
  const on=value=>/^(1|true|yes|on)$/i.test(String(value||''));
  switch(key){
    case 'tavily':return{enabled:order.includes('tavily'),code:order.includes('tavily')?'IN_SEARCH_ORDER':'NOT_IN_SEARCH_ORDER',paid:true};
    case 'exa':return{enabled:order.includes('exa')&&on(env.EXA_ENABLED),code:!order.includes('exa')?'NOT_IN_SEARCH_ORDER':on(env.EXA_ENABLED)?'IN_SEARCH_ORDER':'EXA_DISABLED',paid:true};
    case 'brave':case 'dataforseo':return{enabled:order.includes(key),code:order.includes(key)?'IN_SEARCH_ORDER':'NOT_IN_SEARCH_ORDER',paid:true};
    case 'hunter':{const mode=String(env.HUNTER_MODE||'').toUpperCase();return{enabled:Boolean(mode)&&mode!=='DISABLED',code:mode?`HUNTER_${mode.replace(/[^A-Z_]/g,'')}`:'HUNTER_MODE_UNSET',paid:true};}
    case 'feishu':return{enabled:String(env.CRM_PROVIDER||'').toUpperCase()==='FEISHU',code:String(env.CRM_PROVIDER||'').toUpperCase()==='FEISHU'?'CRM_PROVIDER_FEISHU':'CRM_PROVIDER_OTHER',paid:false};
    case 'translate':return{enabled:true,code:'ON_DEMAND',paid:false};
    case 'llm':return{enabled:true,code:'ON_DEMAND',paid:true};
    default:return{enabled:false,code:'UNKNOWN',paid:false};
  }
}

/** Factory used by server.js and workers. */
export const createCredentialResolver=options=>new CredentialStore(options);

/** Migration 071 verification for the migration runner. */
export async function verifyProviderCredentialsMigration(client){
  const tables=(await client.query(`SELECT to_regclass('leadgen.provider_credentials') credentials,to_regclass('leadgen.provider_credential_tests') tests`)).rows[0];
  const triggers=(await client.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('provider_credentials_history_guard','provider_credential_tests_history_guard') AND NOT tgisinternal`)).rows[0].n;
  const ok=Boolean(tables.credentials&&tables.tests)&&triggers===2;
  if(!ok)throw new Error('Migration 071 verification failed: provider credential tables or guards are missing');
  return{provider_credentials:true,provider_credential_tests:true,guards:triggers};
}
