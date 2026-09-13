import {readFile} from 'node:fs/promises';
import pg from 'pg';
const pool=new pg.Pool({host:process.env.POSTGRES_HOST,database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
const missing='11111111-1111-4111-8111-111111111111';
const companies=await pool.query("insert into leadgen.companies(company_name,normalized_domain,country_code,data_origin) values('CL15 HTTP fixture','cl15-http.invalid','AE','fixed_public_candidate') returning id");
const company=companies.rows[0].id;
await pool.query("update leadgen.companies set verification_status='VERIFIED',lifecycle_status='ACTIVE' where id=$1",[company]);
const {ScoringService}=await import('/app/src/scoring/scoringService.js');
await new ScoringService({pool}).scoreCompany({companyId:company,executionKey:'cl15-http-score'});
const profile=(await pool.query("insert into leadgen.icp_profiles(name,profile_type,version,calculation_version,product_scope) values('CL15 fixture','MANAGEMENT_BASELINE','cl15-fixture','cl15-fixture',ARRAY['WOMENSWEAR']) returning id")).rows[0].id;
const {CustomerMatchService}=await import('/app/src/matching/customerMatchService.js');
await new CustomerMatchService({pool}).evaluateAndPersist({companyId:company,profileId:profile,productScope:'WOMENSWEAR',executionKey:'cl15-http-match'});
const importId=(await pool.query("insert into leadgen.reference_data_imports(import_type,source_filename,content_sha256) values('HISTORICAL_CUSTOMERS','cl15-fixture.csv',repeat('a',64)) returning id")).rows[0].id;
const importRow=(await pool.query("insert into leadgen.reference_data_import_rows(import_id,row_number,raw_payload,row_status) values($1,2,'{}','ACCEPTED') returning id",[importId])).rows[0].id;
const crm=(await pool.query("insert into leadgen.historical_customers(source_import_id,source_import_row_id,external_customer_id,source_system,company_name,normalized_company_name,country_code,source_customer_id_raw,source_customer_id_type,source_customer_id_key,customer_role) values($1,$2,'cl15-crm','OKKI','CL15 CRM Fixture','cl15 crm fixture','AE','cl15-crm','text','OKKI:text:cl15-crm','HISTORICAL_CRM_LEAD') returning id",[importId,importRow])).rows[0].id;
const crmCompany=(await pool.query("insert into leadgen.companies(company_name,normalized_domain,country_code,data_origin) values('CL15 CRM linked','cl15-crm.invalid','AE','fixed_public_candidate') returning id")).rows[0].id;
await pool.query("insert into leadgen.historical_customer_company_links(historical_customer_id,company_id,link_status,match_method,confidence,confirmed_at) values($1,$2,'CONFIRMED','FIXTURE',1,now())",[crm,crmCompany]);
await pool.query("insert into leadgen.reference_data_import_batches(import_batch_key) values('phase5-v2.3.1-okki-history-001')");
const batch='cl15-http-batch';
await pool.query("insert into leadgen.data_cleanup_batches(cleanup_batch_id,backup_reference,created_by) values($1,'isolated-fixture','cl15')",[batch]);
const jobs=await pool.query("insert into leadgen.research_jobs(country,country_code,country_name,market_profile,product_category,max_results,status) values('AE','AE','United Arab Emirates','AE','Womenswear',1,'COMPLETED') returning id");
const job=jobs.rows[0].id;
const {SearchPlanService}=await import('/app/src/searchPlanning/searchPlanService.js');
await new SearchPlanService({pool}).store(pool,{jobId:job,snapshot:{version:1,scopes:[{market_code:'AE',country_name:'United Arab Emirates',category_scope_id:'cl15-womenswear',category_code:'WOMENSWEAR',product_profile:'WOMENSWEAR',languages:['en'],buyer_types:['importer','wholesaler']}]}});
const enrichment=(await pool.query("insert into leadgen.research_jobs(country,country_code,country_name,market_profile,product_category,max_results,status,job_type) values('AE','AE','United Arab Emirates','AE','Womenswear',1,'COMPLETED','DECISION_MAKER_ENRICHMENT') returning id")).rows[0].id;
const category=(await pool.query("insert into leadgen.research_jobs(country,country_code,country_name,market_profile,product_category,max_results,status,job_type) values('AE','AE','United Arab Emirates','AE','Womenswear',1,'COMPLETED','CATEGORY_PROCUREMENT_ENRICHMENT') returning id")).rows[0].id;
const queries=await pool.query("insert into leadgen.research_search_queries(research_job_id,query_text,query_type,country,product_category,provider) values($1,'fixture query','buyer_category','AE','Womenswear','exa') returning id",[job]);
const candidates=await pool.query("insert into leadgen.research_candidates(research_job_id,search_query_id,provider,title,url,normalized_url,root_domain,rank,candidate_type,captured_at) values($1,$2,'exa','Fixture','https://cl15-http.invalid','https://cl15-http.invalid','cl15-http.invalid',1,'OFFICIAL_SITE_CANDIDATE',now()) returning id",[job,queries.rows[0].id]);
const candidate=candidates.rows[0].id;
await pool.query("insert into leadgen.research_candidate_verifications(research_candidate_id,research_job_id,company_id,verification_status) values($1,$2,$3,'REVIEW')",[candidate,job,company]);
const source=await readFile('/app/src/server.js','utf8');
const routes=[...source.matchAll(/^app\.get\('([^']+)'/gm)].map(m=>m[1]);
const cases=[];
async function check(route,url,kind,headers={}){
 const res=await fetch('http://127.0.0.1:3000'+url,{headers});
 const text=await res.text();let body;try{body=JSON.parse(text);}catch{}
 cases.push({route,path:url,case:kind,status:res.status,code:body?.code??null,server_error:res.status>=500});
}
for(const route of routes){
 let id=missing;
 if(/^\/api\/(companies|leads)\//.test(route))id=company;
 if(/^\/api\/research\/jobs\//.test(route))id=job;
 if(/^\/api\/enrichment\/jobs\//.test(route))id=enrichment;
 if(/^\/api\/category-procurement\/jobs\//.test(route))id=category;
 if(route==='/api/icp/profiles/:id')id=profile;
 if(route==='/api/reference-data/imports/:id')id=importId;
 if(route==='/api/crm-history/:id')id=crm;
 if(route==='/api/companies/:id/crm-history')id=crmCompany;
 let url=route.replace(':id',id).replace(':candidateId',candidate).replace(':batchId',batch);
 const headers=route.startsWith('/api/internal/')||route.startsWith('/api/reference-data/')?{authorization:'Bearer cl15-internal-fixture'}:{};
 await check(route,url,route.includes(':')?'FIXTURE_OR_MISSING_DETAIL':'LIST_OR_CURRENT',headers);
 if(route.includes(':'))await check(route,route.replace(/:[^/]+/g,missing),'MISSING_RECORD',headers);
 if(route.includes(':'))await check(route,route.replace(/:[^/]+/g,'invalid-id'),'INVALID_ID',headers);
 if(route.startsWith('/api/internal/')||route.startsWith('/api/reference-data/'))await check(route,url,'NO_AUTH');
}
await pool.end();
console.log(JSON.stringify({routes:routes.length,cases,server_errors:cases.filter(c=>c.server_error),positive_http_200:cases.filter(c=>c.status===200).length,notes:'404 denotes explicit unavailable/missing evidence, not positive detail coverage; only fixture data inserted.'}));
if(cases.some(c=>c.server_error))process.exitCode=1;
