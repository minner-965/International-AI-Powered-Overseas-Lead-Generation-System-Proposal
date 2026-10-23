// Central data scope for every list/detail endpoint that a merchant may reach.
//
//   ADMIN (or AUTH_REQUIRED=false):  {admin:true, merchantId:null, restrict:false}  all rows; CRM state = SIM's own
//   ADMIN with ?merchant_id=<uuid>:  {admin:true, merchantId:<uuid>, restrict:true}  that merchant's rows
//   MERCHANT:                        {admin:false, merchantId:<own>, restrict:true}   own rows only
//
// `merchantId` is also the owner of CRM state, tasks and messages written by the caller
// (NULL = SIM). Lists filter with the helpers below; details call assertCompanyVisible.
export const ADMIN_SCOPE=Object.freeze({admin:true,merchantId:null,restrict:false});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestScope(req){return req?.workspaceScope||ADMIN_SCOPE;}
export function scopeFromUser(user,query={}){
  if(user?.role==='MERCHANT')return Object.freeze({admin:false,merchantId:user.merchant_id,restrict:true});
  const filter=String(query?.merchant_id||'').trim();
  if(filter&&UUID.test(filter))return Object.freeze({admin:true,merchantId:filter,restrict:true});
  return ADMIN_SCOPE;
}
const notFound=(label='Company')=>Object.assign(new Error(`${label} not found`),{code:`${label.toUpperCase().replace(/\s+/g,'_')}_NOT_FOUND`,status:404});

// `alias.id` must be a company id.
export function companyScopeSql(scope,alias,params,column='id'){
  if(!scope?.restrict)return 'TRUE';
  params.push(scope.merchantId);
  return `EXISTS(SELECT 1 FROM leadgen.merchant_companies mc_scope WHERE mc_scope.company_id=${alias}.${column} AND mc_scope.merchant_id=$${params.length}::uuid)`;
}
// Rows carrying merchant_id. Unrestricted admin sees every owner.
export function ownerScopeSql(scope,alias,params){
  if(!scope?.restrict)return 'TRUE';
  params.push(scope.merchantId);
  return `${alias}.merchant_id=$${params.length}::uuid`;
}
// The caller's own CRM state owner (SIM = NULL); used for per-owner pipeline state.
export function stateOwnerSql(scope,alias,params){
  params.push(scope?.merchantId??null);
  return `${alias}.merchant_id IS NOT DISTINCT FROM $${params.length}::uuid`;
}

export async function companyVisible(queryable,scope,companyId){
  if(!scope?.restrict)return true;
  if(!UUID.test(String(companyId||'')))return false;
  return (await queryable.query('SELECT 1 FROM leadgen.merchant_companies WHERE merchant_id=$1 AND company_id=$2',[scope.merchantId,companyId])).rowCount>0;
}
export async function assertCompanyVisible(queryable,scope,companyId,label='Company'){
  if(!await companyVisible(queryable,scope,companyId))throw notFound(label);
}
export async function visibleCompanyIds(queryable,scope){
  if(!scope?.restrict)return null;
  return new Set((await queryable.query('SELECT company_id::text FROM leadgen.merchant_companies WHERE merchant_id=$1',[scope.merchantId])).rows.map(row=>row.company_id));
}
export async function filterRowsByCompany(queryable,scope,rows,key='company_id'){
  const ids=await visibleCompanyIds(queryable,scope);
  return ids?rows.filter(row=>ids.has(String(row?.[key]??row?.id))):rows;
}
// Research jobs a merchant may read: created by, or part of, one of its batches.
export function researchJobScopeSql(scope,alias,params){
  if(!scope?.restrict)return 'TRUE';
  params.push(scope.merchantId);
  const p=`$${params.length}::uuid`;
  return `(${alias}.merchant_id=${p} OR EXISTS(SELECT 1 FROM leadgen.research_batch_children ch_scope JOIN leadgen.research_batches b_scope ON b_scope.id=ch_scope.batch_id
    WHERE ch_scope.research_job_id=${alias}.id AND b_scope.merchant_id=${p}))`;
}
export async function assertResearchJobVisible(queryable,scope,jobId){
  if(!scope?.restrict)return;
  const params=[jobId];const clause=researchJobScopeSql(scope,'j',params);
  if(!(await queryable.query(`SELECT 1 FROM leadgen.research_jobs j WHERE j.id=$1 AND ${clause}`,params)).rowCount)throw notFound('Research job');
}
