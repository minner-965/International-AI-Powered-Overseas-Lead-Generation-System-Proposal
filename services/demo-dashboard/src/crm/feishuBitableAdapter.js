import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Appends one row per CRM outbox item to a Feishu (Lark) Bitable table.
// Rows are never edited afterwards, so replays cannot overwrite manual edits.
const DEFAULT_BASE_URL='https://open.feishu.cn';
const TOKEN_REFRESH_MARGIN_MS=5*60_000;
// Feishu codes that mean "try again later" (rate limit, data busy, write conflict).
const RETRYABLE_CODES=new Set([99991400,1254290,1254291,1254607,1255040]);
// Codes that mean the tenant token is no longer valid.
const TOKEN_CODES=new Set([99991661,99991663,99991668]);

export function loadFeishuFieldMap({configDirectory}={}){
  const directory=configDirectory||process.env.CRM_CONFIG_DIR||[
    fileURLToPath(new URL('../../../../config/crm/',import.meta.url)),
    fileURLToPath(new URL('../../config/crm/',import.meta.url))
  ].find(path=>existsSync(resolve(path,'feishu-bitable-map.json')));
  if(!directory)throw new Error('CRM_FEISHU_MAP_MISSING');
  const map=JSON.parse(readFileSync(resolve(directory,'feishu-bitable-map.json'),'utf8'));
  if(!map.fields?.sync_key?.column)throw new Error('CRM_FEISHU_MAP_INVALID');
  return map;
}

export function feishuConfigured(env=process.env){
  return['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_BITABLE_APP_TOKEN','FEISHU_BITABLE_TABLE_ID']
    .every(key=>{const value=String(env[key]||'').trim();return value&&!/REPLACE_WITH|NOT_CONFIGURED/i.test(value);});
}

// Feishu client_token must look like a UUID v4; derive a stable one from the outbox key.
export function clientTokenFor(idempotencyKey){
  const hex=createHash('sha256').update(String(idempotencyKey)).digest('hex');
  return`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${((parseInt(hex[16],16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export function buildFeishuFields({outbox,payload,company},fieldMap){
  const values={
    sync_key:outbox.idempotency_key,
    operation:outbox.operation,
    company_name:company?.company_name||null,
    country_code:company?.country_code||null,
    event_type:payload.activity_type||payload.task_type||payload.suppression_type||null,
    stage:payload.stage||null,
    summary:payload.summary||payload.reason||null,
    owner:payload.owner||null,
    occurred_at:payload.occurred_at||payload.recorded_at||outbox.created_at||null,
    due_at:payload.due_at||null,
    source_reference:payload.source_reference||payload.task_id||null,
  };
  const fields={};
  for(const [key,spec] of Object.entries(fieldMap.fields||{})){
    const value=values[key];
    if(value===null||value===undefined||value==='')continue;
    if(spec.type==='date'){
      const time=new Date(value).getTime();
      if(!Number.isNaN(time))fields[spec.column]=time;
    }else fields[spec.column]=String(value);
  }
  return fields;
}

export class FeishuBitableAdapter{
  constructor({env=process.env,fetchImpl=globalThis.fetch,fieldMap=null,now=()=>Date.now()}={}){
    this.env=env;this.fetch=fetchImpl;this.now=now;
    this.fieldMap=fieldMap||loadFeishuFieldMap();
    this.baseUrl=String(env.FEISHU_BASE_URL||DEFAULT_BASE_URL).replace(/\/$/,'');
    this.timeoutMs=Number(env.CRM_TIMEOUT_MS||10000);
    this.token=null;this.tokenExpiresAt=0;this.calls=0;
  }

  async request(path,{method='POST',body,token}={}){
    this.calls+=1;
    const response=await this.fetch(`${this.baseUrl}${path}`,{method,
      headers:{'content-type':'application/json; charset=utf-8',...(token?{authorization:`Bearer ${token}`}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(this.timeoutMs)});
    let json=null;try{json=await response.json();}catch{json=null;}
    return{status:response.status,json,retryAfter:Number(response.headers?.get?.('retry-after'))||null};
  }

  async tenantToken({force=false}={}){
    if(!force&&this.token&&this.now()<this.tokenExpiresAt-TOKEN_REFRESH_MARGIN_MS)return this.token;
    const result=await this.request('/open-apis/auth/v3/tenant_access_token/internal',
      {body:{app_id:this.env.FEISHU_APP_ID,app_secret:this.env.FEISHU_APP_SECRET}});
    if(result.status!==200||result.json?.code!==0||!result.json?.tenant_access_token)
      return{error:{retryable:result.status===429||result.status>=500,code:`FEISHU_AUTH_${result.json?.code??result.status}`}};
    this.token=result.json.tenant_access_token;
    this.tokenExpiresAt=this.now()+Number(result.json.expire||7200)*1000;
    return this.token;
  }

  // Returns {status:'SYNCED',external_record_id} or {status:'FAILED',retryable,code,retry_after_seconds}.
  async sync({outbox,payload,company}){
    const fields=buildFeishuFields({outbox,payload,company},this.fieldMap);
    const startCalls=this.calls;const calls=()=>this.calls-startCalls;
    const path=`/open-apis/bitable/v1/apps/${encodeURIComponent(this.env.FEISHU_BITABLE_APP_TOKEN)}/tables/${encodeURIComponent(this.env.FEISHU_BITABLE_TABLE_ID)}/records?client_token=${clientTokenFor(outbox.idempotency_key)}`;
    for(let attempt=0;attempt<2;attempt+=1){
      const token=await this.tenantToken({force:attempt>0});
      if(token?.error)return{status:'FAILED',...token.error,network_calls:calls()};
      const result=await this.request(path,{body:{fields},token});
      const code=result.json?.code;
      if(result.status===200&&code===0)
        return{status:'SYNCED',external_record_id:result.json?.data?.record?.record_id||null,network_calls:calls()};
      if(TOKEN_CODES.has(code)&&attempt===0)continue;
      const retryable=result.status===429||result.status>=500||RETRYABLE_CODES.has(code);
      return{status:'FAILED',retryable,code:`FEISHU_${code??`HTTP_${result.status}`}`,retry_after_seconds:result.retryAfter||(retryable?300:3600),network_calls:calls()};
    }
    return{status:'FAILED',retryable:true,code:'FEISHU_TOKEN_REJECTED',retry_after_seconds:3600,network_calls:calls()};
  }
}
