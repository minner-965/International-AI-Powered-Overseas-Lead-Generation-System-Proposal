import {planningDigest,loadSearchPlanningConfig} from './config.js';
const text=value=>String(value??'').trim();
const unique=values=>[...new Set(values)].sort();
const lower=value=>text(value).normalize('NFKC').toLowerCase();
const term=value=>text(value).normalize('NFKC').replace(/[_\s]+/g,' ').replace(/["“”„«»]/g,'').trim();
const codeError=code=>Object.assign(new Error(code),{code,status:422});

export function normalizeSearchQuery(query){
  const display=String(query??'').normalize('NFKC').replace(/[“”„«»]/g,'"').replace(/[‘’]/g,"'").trim().replace(/\s+/gu,' ');
  // Only adjacent identical tokens/quoted phrases are redundant safely. Do not
  // strip arbitrary repeated words inside phrases, negations or operator syntax.
  const tokens=display.match(/"[^"]*"|\S+/gu)||[];
  return tokens.filter((value,index)=>index===0||lower(value)!==lower(tokens[index-1])).join(' ');
}
export function queryFingerprint(query){
  const fields=['strategy_version','strategy_id','lane','market_id','category_id','language','normalized_query','provider_purpose'];
  if(fields.some(field=>!text(query[field])))throw codeError('QUERY_FINGERPRINT_FIELD_REQUIRED');
  return planningDigest(Object.fromEntries(fields.map(field=>[field,field==='normalized_query'?lower(query[field]):query[field]])));
}

// A work-conserving weighted round robin: an empty lane consumes no quota and
// the nonempty lane continues. This iterator is not a provider spend cap.
export function* fairQueryIterator(queries,lanes){
  const definitions=(lanes?.lanes||lanes||[]).filter(lane=>lane.enabled).map(lane=>({...lane}));
  const queues=new Map(definitions.map(lane=>[lane.id,queries.filter(query=>query.lane===lane.id)]));
  const positions=new Map(definitions.map(lane=>[lane.id,0]));
  let remaining=[...queues.values()].reduce((sum,queue)=>sum+queue.length,0);
  while(remaining){
    for(const lane of definitions){
      if(!Number.isInteger(lane.weight)||lane.weight<1)throw codeError('SEARCH_LANE_WEIGHT_INVALID');
      const queue=queues.get(lane.id);
      for(let unit=0;unit<lane.weight&&positions.get(lane.id)<queue.length;unit++){
        const position=positions.get(lane.id);positions.set(lane.id,position+1);remaining--;yield queue[position];
      }
    }
  }
}

function frozenScopes(snapshot){
  if(!snapshot||!Array.isArray(snapshot.scopes)||!snapshot.scopes.length)throw codeError('FROZEN_RESEARCH_SCOPE_REQUIRED');
  return snapshot.scopes.map(scope=>{
    if(!text(scope.market_code||scope.country_code)||!text(scope.category_scope_id||scope.category_id)||
      !text(scope.category_code||scope.product_category)||!text(scope.country_name)||
      !Array.isArray(scope.languages)||!scope.languages.length||!Array.isArray(scope.buyer_types)||!scope.buyer_types.length)
      throw codeError('FROZEN_RESEARCH_SCOPE_INCOMPLETE');
    return scope;
  }).sort((a,b)=>text(a.market_code||a.country_code).localeCompare(text(b.market_code||b.country_code))||
    text(a.category_scope_id||a.category_id).localeCompare(text(b.category_scope_id||b.category_id)));
}
function approvedAliases(scope,language){
  return (Array.isArray(scope.approved_aliases)?scope.approved_aliases:[])
    .filter(alias=>['EXACT','SYNONYM','STRONG'].includes(String(alias.alias_type||'').toUpperCase())
      &&(!alias.language||['und',language].includes(lower(alias.language)))
      &&(!alias.market_code||String(alias.market_code).toUpperCase()===String(scope.market_code||scope.country_code).toUpperCase())
      &&(!alias.status||alias.status==='ACTIVE'))
    .map(alias=>term(alias.raw_alias||alias.normalized_alias)).filter(Boolean);
}
function render(template,values){return template.replace(/\{([a-z_]+)\}/g,(_match,key)=>values[key]??'');}

export function planSearchQueries(snapshot,{config=loadSearchPlanningConfig(),providerPurpose='COMPANY_DISCOVERY'}={}){
  if(!text(providerPurpose))throw codeError('SEARCH_PROVIDER_PURPOSE_REQUIRED');
  const scopes=frozenScopes(snapshot);
  const enabledLanes=new Set(config.lanes.lanes.filter(lane=>lane.enabled).map(lane=>lane.id));
  const strategies=config.strategies.strategies.filter(strategy=>strategy.enabled&&enabledLanes.has(strategy.lane))
    .sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  const queries=[];const skipped=[];const seen=new Set();
  for(const scope of scopes){
    const marketId=text(scope.market_code||scope.country_code);
    const categoryId=text(scope.category_scope_id||scope.category_id);
    const languages=unique(scope.languages.map(lower).filter(Boolean));
    for(const language of languages){
      const dictionary=config.strategies.locales[language];
      for(const strategy of strategies){
        const note={market_id:marketId,category_id:categoryId,language,strategy_id:strategy.id,lane:strategy.lane};
        if(!dictionary){skipped.push({...note,reason:'LANGUAGE_VOCABULARY_NOT_CONFIGURED'});continue;}
        const matchedBuyers=unique(scope.buyer_types.filter(buyer=>(strategy.applicable_buyer_types||[strategy.buyer_type]).some(allowed=>lower(buyer)===lower(allowed))));
        if(!matchedBuyers.length){skipped.push({...note,reason:'BUYER_TYPE_NOT_SELECTED'});continue;}
        const parent=typeof scope.parent_category==='object'?scope.parent_category?.normalized_category||scope.parent_category?.category_code:scope.parent_category;
        if(strategy.category_mode==='PARENT'&&!text(parent)){skipped.push({...note,reason:'FROZEN_PARENT_CATEGORY_MISSING'});continue;}
        const lexicalKey=strategy.term_key==='fashion_or_lifestyle'?
          (scope.product_profile==='WOMENSWEAR'?'fashion_group':'lifestyle_group'):strategy.term_key;
        const buyerTerm=dictionary[lexicalKey];
        if(!buyerTerm){skipped.push({...note,reason:'STRATEGY_VOCABULARY_MISSING'});continue;}
        const categoryCode=text(scope.category_code||scope.product_category);
        const categoryLabel=dictionary.category_terms?.[categoryCode]||categoryCode;
        const parentLabel=dictionary.category_terms?.[text(parent)]||parent;
        const categoryTerms=strategy.category_mode==='EXACT_AND_APPROVED_ALIAS'?
          unique([term(categoryLabel),...approvedAliases(scope,language)]):[''];
        const market=term(scope.country_terms?.[language]||scope.country_name);
        const locality=strategy.city_mode==='CITY_OR_MARKET'?term(scope.city||scope.region||market):market;
        for(const category of categoryTerms){
          const original=render(strategy.template,{category,parent_category:term(parentLabel),buyer_term:buyerTerm,market,city_or_market:locality});
          const query={...note,strategy_version:config.strategies.version,provider_purpose:providerPurpose,
            buyer_type:strategy.buyer_type,selected_buyer_types:matchedBuyers,original_query:original,
            normalized_query:normalizeSearchQuery(original),status:'PLANNED',priority:strategy.priority,
            domain_policy_version:config.domainPolicy.version};
          query.fingerprint=queryFingerprint(query);
          if(!seen.has(query.fingerprint)){seen.add(query.fingerprint);queries.push(query);}
        }
      }
    }
  }
  const scheduled=[...fairQueryIterator(queries,config.lanes)];
  const precision=scheduled.filter(query=>query.lane==='PRECISION_LANE');
  const coverage=scheduled.filter(query=>query.lane==='COVERAGE_LANE');
  return {status:'PLANNED',strategy_version:config.strategies.version,domain_policy_version:config.domainPolicy.version,
    lane_version:config.lanes.version,config_digest:planningDigest({strategies:config.strategies,lanes:config.lanes,domainPolicy:config.domainPolicy}),scope_digest:planningDigest(snapshot),
    summary:{scopes:new Set(scopes.map(scope=>`${scope.market_code||scope.country_code}:${scope.category_scope_id||scope.category_id}`)).size,
      precision_strategies:new Set(precision.map(q=>q.strategy_id)).size,coverage_strategies:new Set(coverage.map(q=>q.strategy_id)).size,
      configured_precision_strategies:strategies.filter(s=>s.lane==='PRECISION_LANE').length,
      configured_coverage_strategies:strategies.filter(s=>s.lane==='COVERAGE_LANE').length,
      languages:unique(scopes.flatMap(scope=>scope.languages.map(lower))),planned_query_count:scheduled.length,
      precision_planned:precision.length,coverage_planned:coverage.length,skipped_count:skipped.length},
    samples:{PRECISION_LANE:precision.slice(0,5),COVERAGE_LANE:coverage.slice(0,5)},queries:scheduled,skipped};
}
