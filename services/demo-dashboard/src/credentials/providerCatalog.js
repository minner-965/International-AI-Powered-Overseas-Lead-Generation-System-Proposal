// Providers whose credentials can be set on the API keys page (B9).
// scope: 'SIM' = only the SIM administrator sets it; 'BOTH' = a merchant may also add its own key,
// billed to the merchant's own provider account. env = the environment variable used before a key
// was stored in the database (still the last fallback). secret=false fields (URLs, ids, model
// names) are still stored encrypted and never returned in plaintext.
const field=(name,env,{secret=true,zh,en,optional=false}={})=>Object.freeze({name,env,secret,zh,en,optional});

export const PROVIDERS=Object.freeze({
  tavily:Object.freeze({key:'tavily',group:'search',scope:'BOTH',zh:'Tavily 搜索',en:'Tavily search',
    fields:[field('api_key','TAVILY_API_KEY',{zh:'API 密钥',en:'API key'})]}),
  exa:Object.freeze({key:'exa',group:'search',scope:'BOTH',zh:'Exa 搜索',en:'Exa search',
    fields:[field('api_key','EXA_API_KEY',{zh:'API 密钥',en:'API key'})]}),
  brave:Object.freeze({key:'brave',group:'search',scope:'BOTH',zh:'Brave 搜索',en:'Brave search',
    fields:[field('api_key','BRAVE_SEARCH_API_KEY',{zh:'API 密钥',en:'API key'})]}),
  dataforseo:Object.freeze({key:'dataforseo',group:'search',scope:'BOTH',zh:'DataForSEO 搜索',en:'DataForSEO search',
    fields:[field('login','DATAFORSEO_LOGIN',{secret:false,zh:'登录名',en:'Login'}),field('password','DATAFORSEO_PASSWORD',{zh:'密码',en:'Password'})]}),
  hunter:Object.freeze({key:'hunter',group:'email',scope:'BOTH',zh:'Hunter 邮箱核验',en:'Hunter email check',
    fields:[field('api_key','HUNTER_API_KEY',{zh:'API 密钥',en:'API key'})]}),
  feishu:Object.freeze({key:'feishu',group:'crm',scope:'SIM',zh:'飞书多维表',en:'Feishu Base',
    fields:[field('app_id','FEISHU_APP_ID',{secret:false,zh:'应用 ID',en:'App ID'}),field('app_secret','FEISHU_APP_SECRET',{zh:'应用密钥',en:'App secret'}),
      field('bitable_app_token','FEISHU_BITABLE_APP_TOKEN',{zh:'多维表 Token',en:'Base token'}),field('bitable_table_id','FEISHU_BITABLE_TABLE_ID',{secret:false,zh:'数据表 ID',en:'Table ID'})]}),
  translate:Object.freeze({key:'translate',group:'translate',scope:'SIM',zh:'翻译服务',en:'Translation service',
    fields:[field('base_url','LIBRETRANSLATE_URL',{secret:false,zh:'服务地址',en:'Service URL'}),field('api_key','LIBRETRANSLATE_API_KEY',{zh:'API 密钥（可选）',en:'API key (optional)',optional:true})]}),
  llm:Object.freeze({key:'llm',group:'llm',scope:'BOTH',zh:'低成本模型',en:'Low-cost model',
    fields:[field('provider','LLM_PROVIDER',{secret:false,zh:'服务商',en:'Provider'}),field('base_url','LLM_BASE_URL',{secret:false,zh:'接口地址',en:'Base URL',optional:true}),
      field('model','LLM_MODEL',{secret:false,zh:'模型名称',en:'Model'}),field('api_key','LLM_API_KEY',{zh:'API 密钥',en:'API key'})]})
});

export const PROVIDER_KEYS=Object.freeze(Object.keys(PROVIDERS));
export const MERCHANT_PROVIDER_KEYS=Object.freeze(PROVIDER_KEYS.filter(key=>PROVIDERS[key].scope==='BOTH'));
export const providerOf=key=>PROVIDERS[String(key||'').toLowerCase()]||null;
export const fieldOf=(provider,name)=>providerOf(provider)?.fields.find(item=>item.name===name)||null;
// Fields that must be present for the provider to count as configured.
export const requiredFields=provider=>providerOf(provider)?.fields.filter(item=>!item.optional)||[];
