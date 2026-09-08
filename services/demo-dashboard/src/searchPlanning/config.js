import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export function stableJson(value){
  if(value instanceof Date)return JSON.stringify(value.toISOString());
  if(Array.isArray(value))return `[${Array.from(value,item=>stableJson(item)??'null').join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).filter(key=>value[key]!==undefined&&!['function','symbol'].includes(typeof value[key])).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const planningDigest=value=>createHash('sha256').update(stableJson(value)).digest('hex');
export function loadSearchPlanningConfig({configDirectory}={}){
  const directory=configDirectory||process.env.SEARCH_PLANNING_CONFIG_DIR||[
    fileURLToPath(new URL('../../../../config/search/',import.meta.url)),
    fileURLToPath(new URL('../../config/search/',import.meta.url))
  ].find(path=>existsSync(resolve(path,'query-strategies.v2.json')));
  if(!directory)throw new Error('SEARCH_PLANNING_CONFIG_MISSING');
  const read=name=>JSON.parse(readFileSync(resolve(directory,name),'utf8'));
  const config={strategies:read('query-strategies.v2.json'),lanes:read('search-lanes.v1.json'),domainPolicy:read('domain-policy.v2.json')};
  if(!config.strategies.version||!Array.isArray(config.strategies.strategies)||!Array.isArray(config.lanes.lanes))throw new Error('SEARCH_PLANNING_CONFIG_INVALID');
  if(new Set(config.strategies.strategies.map(s=>s.id)).size!==config.strategies.strategies.length)throw new Error('SEARCH_STRATEGY_ID_DUPLICATE');
  for(const lane of config.lanes.lanes)if(!Number.isInteger(lane.weight)||lane.weight<1)throw new Error('SEARCH_LANE_WEIGHT_INVALID');
  return {...config,config_digest:planningDigest(config)};
}
