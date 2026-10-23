import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {loadPhase13EmailEligibilityFacts,createPhase13EmailEligibilityFactLoader} from '../src/outreach/Phase13EmailFactLoader.js';

const companyId='8b19d2b9-e7a7-4bd0-a57b-0f8a5f7da9db';
const reservationId='11111111-1111-4111-8111-111111111111';
const row={id:companyId,company_name:'Rizqé',company_type:'Importer VERIFIED / Wholesaler VERIFIED',country_code:'AE',
  verification_status:'VERIFIED',lifecycle_status:'ACTIVE',opportunity_pool_band:'PRECISION',is_active_business_opportunity:true,
  market_code:'AE',country_name:'United Arab Emirates',market_status:'ACTIVE',search_enabled:true,timezone:'Asia/Dubai',business_send_window:{days:[1,2,3,4,5],start:'09:00',end:'17:00'},
  recipient_id:'fc5ff893-9faa-47ff-90ad-fe2b87529fd1',normalized_recipient:'info@rizqe.co',recipient_verification_status:'VALID',verified_at:new Date(),recipient_lifecycle_status:'ACTIVE',recipient_type:'OFFICIAL_COMPANY_EMAIL',recipient_source_class:'VERIFIED_DECISION_MAKER_CONTACT',recipient_domain_verified:true,
  decision_maker_contact_id:'de2f85b3-3d62-48fc-b9db-08c7abebf70b',is_generic:true,category_id:'9bb2242c-8217-4869-8ce6-99767e762133',normalized_category:'TOPS',product_profile:'WOMENSWEAR',
  confirmed_existing_customer:false,company_suppressed:false,contact_suppressed:false,opted_out:false,hard_bounced:false,has_prior_first_touch:false,has_prior_company_contact:false,has_reply:false};

test('fact bridge is one read, excludes its current reservation, and exposes verified template fields only',async()=>{
  const calls=[];const queryable={async query(sql,values){calls.push({sql,values});return{rowCount:1,rows:[row]};}};
  const facts=await loadPhase13EmailEligibilityFacts(queryable,companyId,{reservationId,replyToEmail:'sales@dpv.example'});
  assert.equal(calls.length,1);assert.match(calls[0].sql,/first_touch_reservation_id IS DISTINCT FROM \$2/);
  assert.match(calls[0].sql,/reservation\.id<>\$2/);assert.deepEqual(calls[0].values,[companyId,reservationId,null]);// $3 = sender owner (NULL = SIM)
  assert.equal(facts.recipient.normalized_recipient,'info@rizqe.co');assert.equal(facts.recipient.official_source_verified,true);
  assert.equal(facts.category_id,row.category_id);assert.equal(facts.template_variables.matched_category,'Tops');
  assert.deepEqual(facts.company_types,['IMPORTER','WHOLESALER']);
  assert.ok(['company','market','category','target_category','matched_category','reply_to'].every(field=>facts.verified_template_fields.includes(field)));
  assert.equal(facts.verified_template_fields.includes('first_name'),false);
});

test('factory pins configured reply-to without changing transaction client',async()=>{
  const pool={query:async()=>({rowCount:0,rows:[]})};const client={query:async()=>({rowCount:1,rows:[row]})};
  const load=createPhase13EmailEligibilityFactLoader({pool,replyToEmail:'sales@dpv.example'});
  const facts=await load(companyId,{client});assert.equal(facts.template_variables.reply_to,'sales@dpv.example');
});

test('repository projections include both manual approval and automated reservation authorization',()=>{
  const source=readFileSync(new URL('../src/phase7/repository.js',import.meta.url),'utf8');
  assert.match(source,/JOIN leadgen\.phase13_first_touch_reservations reservation ON reservation\.id=m\.first_touch_reservation_id/);
  assert.match(source,/coalesce\(r\.normalized_recipient,reservation\.normalized_recipient\) normalized_recipient/);
  assert.match(source,/LEFT JOIN leadgen\.outreach_recipients r ON r\.id=m\.recipient_id/);
  assert.match(source,/lower\(coalesce\(r\.normalized_recipient,reservation\.normalized_recipient\)\)=lower\(\$5\)/);
  const service=readFileSync(new URL('../src/phase7/service.js',import.meta.url),'utf8');
  assert.match(service,/findInboundThread\(\{[^}]*normalizedSender:sender/);
});

test('fact bridge reads an isolated migrated PostgreSQL database without mutation',{
  skip:!process.env.PHASE13_MC07_TEST_DATABASE_URL
},async()=>{
  const pool=new pg.Pool({connectionString:process.env.PHASE13_MC07_TEST_DATABASE_URL,max:2});
  try{
    const candidate=(await pool.query(`SELECT r.company_id FROM leadgen.outreach_recipients r
      JOIN leadgen.opportunity_pool_current p ON p.company_id=r.company_id
      WHERE p.is_active_business_opportunity AND r.verification_status='VALID' LIMIT 1`)).rows[0];
    if(!candidate)return;
    const before=(await pool.query(`SELECT (SELECT count(*) FROM leadgen.outbound_messages) messages,
      (SELECT count(*) FROM leadgen.phase13_first_touch_reservations) reservations`)).rows[0];
    const facts=await loadPhase13EmailEligibilityFacts(pool,candidate.company_id,{replyToEmail:'sales@example.test'});
    assert.equal(facts.company.id,candidate.company_id);assert.ok(facts.recipient);
    const after=(await pool.query(`SELECT (SELECT count(*) FROM leadgen.outbound_messages) messages,
      (SELECT count(*) FROM leadgen.phase13_first_touch_reservations) reservations`)).rows[0];
    assert.deepEqual(after,before);
  }finally{await pool.end();}
});
