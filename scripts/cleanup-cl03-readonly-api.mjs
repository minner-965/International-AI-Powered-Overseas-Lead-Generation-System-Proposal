import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {queryCategoryProcurementOpportunities} from '../services/demo-dashboard/src/categoryProcurement/opportunitiesRoute.js';
import {HISTORICAL_BUSINESS_FIELDS} from '../services/demo-dashboard/src/opportunityPool/currentBusinessProjection.js';
const literal=v=>v===null||v===undefined?'NULL':Array.isArray(v)?`ARRAY[${v.map(literal).join(',')}]::text[]`:
  typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
// psql transport avoids opening the stopped application or exposing DB credentials.
const pool={async query(sql,params=[]){
 if(!/^\s*SELECT\b/i.test(sql))throw Error('Read-only acceptance permits SELECT only');
 const bound=sql.replace(/\$(\d+)/g,(_,n)=>literal(params[Number(n)-1]));
 const wrapped=`BEGIN READ ONLY; SELECT coalesce(json_agg(row_to_json(q)),'[]') FROM (${bound}) q; COMMIT;`;
 const output=execFileSync('docker',['compose','exec','-T','postgres','psql','-X','-q','-U','leadgen_app','-d','lead_generation','-At','-v','ON_ERROR_STOP=1','-c',wrapped],{encoding:'utf8',maxBuffer:32*1024*1024});
 const rows=JSON.parse(output);return{rows,rowCount:rows.length};
}};
const options={pool,publicDataOriginSql:"'public_web'",companyMarketVisibleSql:()=> 'TRUE',excludesConfirmedExistingCustomerSql:()=> 'TRUE'};
const all=await queryCategoryProcurementOpportunities({...options,query:{status:'ALL',limit:5000}});
const active=await queryCategoryProcurementOpportunities({...options,query:{status:'ACTIVE',limit:5000,product_access_matrix:'UNKNOWN_PRODUCT',readiness:'NEEDS_PRODUCT_EVIDENCE'}});
assert.equal(active.length,all.filter(r=>r.is_active_business_opportunity).length);
for(const row of all){
 assert.equal(row.display_opportunity_status,row.opportunity_pool_band);
 for(const key of HISTORICAL_BUSINESS_FIELDS)assert.equal(Object.hasOwn(row,key),false,key);
 assert.ok(Array.isArray(row.contact_readiness_labels));assert.equal(typeof row.email_send_eligibility,'object');
}
console.log(JSON.stringify({status:'PASS',all:all.length,active:active.length,
  bands:Object.fromEntries(['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE'].map(b=>[b,all.filter(r=>r.opportunity_pool_band===b).length])),
  current_fields:'PASS',retired_filter_nonblocking:'PASS',database_writes:0,provider_calls:0}));
