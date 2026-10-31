// Batch 3 (acceptance bugs 2026-10-27) against throwaway PostgreSQL databases with every migration (076 included).
// Zero external calls: the merchant mailbox is the real SMTP/IMAP adapter over an in-process mail server
// that rewrites Message-ID and drops X-DPV-Message-Key, like the live provider did.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/batch3-correlation-postgres.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {CategoryScopeService} from '../src/categoryProcurement/CategoryScopeService.js';
import {ManualCompanyService} from '../src/companies/manualCompanyService.js';
import {ManualFirstTouchService} from '../src/outreach/manualFirstTouch.js';
import {SmtpImapProviderAdapter} from '../src/outreach/smtpImapProvider.js';
import {Phase7Service} from '../src/phase7/service.js';
import {retryFailedCrmOutbox} from '../src/crm/outboxRepair.js';
import {recorrelateInboundReplies} from '../scripts/recorrelate-inbound-replies.mjs';
import {rewritingServer} from './batch3-correlation-mailserver.js';

const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const SECRET_KEY=crypto.randomBytes(32).toString('hex');
const ADMIN=Object.freeze({admin:true,merchantId:null,restrict:false});
const merchantScope=id=>Object.freeze({admin:false,merchantId:id,restrict:true});
const BUYER='buyer@gulf-fashion.example';

async function admin(sql){const client=new pg.Client({connectionString:adminUrl});await client.connect();try{return await client.query(sql);}finally{await client.end();}}
function dbUrl(name){const url=new URL(adminUrl);url.pathname=`/${name}`;return url.toString();}
async function withDatabase(run){
  const name=`batch3_corr_${crypto.randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  const pool=new pg.Pool({connectionString:dbUrl(name),max:8});
  try{
    for(const file of (await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort())
      await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool);
  }finally{await pool.end();await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}
}

async function approveCategory(pool){
  const scopes=new CategoryScopeService({pool});const candidates=await scopes.listCandidates();
  const picked=candidates.find(c=>`${c.product_profile}:${c.normalized_category}`==='WOMENSWEAR:DRESSES')||candidates[0];
  const draft=await scopes.createDraft({revision:1,source_type:'MANAGEMENT_APPROVED',source_reference:'test',source_digest:hex('d'),actor:'simon',
    scopes:[{client_key:'s0',product_profile:picked.product_profile,normalized_category:picked.normalized_category,source_fact_digest:picked.source_fact_digest}]});
  await scopes.approveRevision({draft_revision_id:draft.id,revision:2,source_reference:'test',source_digest:hex('a'),actor:'simon',actor_role:'MANAGEMENT'});
  for(let attempt=0;attempt<50;attempt++){
    const rows=(await pool.query(`SELECT id FROM leadgen.dpv_product_category_scope_current WHERE scope_status='ACTIVE' AND approval_status='APPROVED' LIMIT 1`)).rows;
    if(rows.length)return rows[0].id;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('approved category not current');
}

/** A merchant whose mailbox server rewrites Message-IDs; one manual first touch already sent to BUYER. */
async function setup(pool,{fallbackAtProcessing=true}={}){
  const category=await approveCategory(pool);
  const server=rewritingServer();
  const transporterFactory=options=>({...server.transporterFactory(options),async verify(){return true;}});
  const merchants=new MerchantService({pool,env:{MERCHANT_SECRET_KEY:SECRET_KEY},
    providerFactory:config=>new SmtpImapProviderAdapter({...config,transporterFactory,imapClientFactory:server.imapClientFactory})});
  const alpha=(await merchants.createMerchant({company_name:'Alpha',contact_name:'Alpha',login_email:'alpha@alpha.example',quotas:{monthly_searches:100,daily_emails:20}},'admin')).merchant.id;
  await merchants.saveMailbox(alpha,{preset_key:'gmail',username:'sales@alpha.example',password:'app-pass'},'admin');
  assert.equal((await merchants.testConnection(alpha)).verified,true);
  const queue={jobs:[],async enqueue(name,data){this.jobs.push({name,data});return 'job';}};
  const companies=new ManualCompanyService({pool,env:{},queue});
  const firstTouch=new ManualFirstTouchService({pool,outboundProvider:{senderEmail:'simon@sim.example'},merchantSending:merchants,companies,env:{},queue});
  const created=(await companies.create({company_name:'Gulf Fashion Trading LLC',website:'https://www.gulf-fashion.example/about',market_code:'AE',company_type:'IMPORTER',
    category_scope_id:category,contact:{email:BUYER,contact_kind:'PERSON',person_name:'Sara Ahmed'}},'alpha@alpha.example',merchantScope(alpha))).company;
  const draft=await firstTouch.createDraft(created.id,{contact_id:created.contacts[0].id},'alpha@alpha.example',merchantScope(alpha));
  const sent=await firstTouch.decide(draft.id,{decision:'APPROVE'},'alpha@alpha.example',merchantScope(alpha));
  assert.equal(sent.status,'SENT');assert.equal(server.sent.length,1);
  // Phase 7 service with an in-process queue that runs the reply steps like the worker does.
  const service=new Phase7Service({pool,env:{SENT_ALIAS_LOOKUP_BACKOFF_MINUTES:'0'},audit:()=>{}});
  const ran=[];
  service.queue={async enqueue(name,data){ran.push(name);
    if(name==='process-inbound-message'){await service.processInboundWork(data);return `job:${name}`;}
    if(name==='classify-inbound-reply'){await service.classifyInboundWork(data);return `job:${name}`;}
    if(name==='create-sales-followup'){await service.createSalesFollowupWork(data);return `job:${name}`;}
    return `job:${name}`;}};
  if(!fallbackAtProcessing){const original=service.replyCorrelation();original.findSubjectFallback=async()=>({match:null,candidates:0});}
  const out=(await pool.query('SELECT * FROM leadgen.outbound_messages WHERE id=$1',[sent.outbound_message_id])).rows[0];
  return{server,merchants,alpha,service,ran,draft,sent,out,companyId:created.id,companies,queue};
}

function reply(server,{inReplyTo,subject,body='Please send your catalogue and price list.'}){
  const uid=500+server.folders.INBOX.length;
  server.folders.INBOX.push({uid,envelope:{subject,from:[{address:BUYER}],to:[{address:'sales@alpha.example'}]},
    headers:Buffer.from(`Message-ID: <qq-${uid}@qq.example>\r\nFrom: Sara <${BUYER}>\r\nDate: ${new Date().toUTCString()}\r\nIn-Reply-To: ${inReplyTo}\r\nReferences: ${inReplyTo}\r\n`),
    bodyStructure:{type:'text/plain',part:'1'},body:Buffer.from(body)});
}
const sync=async s=>s.service.syncImapMailbox({provider:(await s.merchants.providerFor(s.alpha)).provider,mailbox:'sales@alpha.example',folder:'INBOX',merchantId:s.alpha});
const inbound=async pool=>(await pool.query(`SELECT i.*,t.thread_status,
    (SELECT count(*)::int FROM leadgen.opportunity_activities a WHERE a.inbound_message_id=i.id AND a.activity_type='REPLIED') replied_activities,
    (SELECT count(*)::int FROM leadgen.sales_tasks s WHERE s.inbound_message_id=i.id) tasks,
    (SELECT count(*)::int FROM leadgen.crm_sync_outbox o WHERE o.payload->>'source_reference' LIKE '%inbound='||i.id::text||'%') outboxes
  FROM leadgen.inbound_messages i LEFT JOIN leadgen.outreach_threads t ON t.id=i.thread_id ORDER BY i.received_at`)).rows;

test('rewritten Message-ID: the Sent copy is recorded as an alias and the reply correlates with all CRM effects',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    assert.match(s.out.rfc_message_id,/^<dpv-/);
    reply(s.server,{inReplyTo:'<srv-1@shimin.example>',subject:`Re: ${s.draft.subject}`});
    const result=await sync(s);
    assert.equal(result.sent_aliases.aliases,1);assert.equal(result.queued,1);
    const alias=(await pool.query('SELECT * FROM leadgen.outbound_message_id_aliases')).rows;
    assert.equal(alias.length,1);assert.equal(alias[0].outbound_message_id,s.out.id);assert.equal(alias[0].alias_message_id,'<srv-1@shimin.example>');
    assert.equal(alias[0].match_method,'ENVELOPE_SUBJECT_TIME_BODY');assert.equal(alias[0].merchant_id,s.alpha);
    assert.equal(s.server.sent.length,1,'no extra send');
    const [row]=await inbound(pool);
    assert.equal(row.correlation_status,'MATCHED');assert.equal(row.correlation_method,'IN_REPLY_TO_ALIAS');assert.equal(row.correlation_confidence,'HIGH');
    assert.equal(row.correlation_outbound_message_id,s.out.id);assert.equal(row.thread_id,s.sent.thread_id);assert.equal(row.merchant_id,s.alpha);
    assert.equal(row.thread_status,'REPLIED');assert.equal(row.replied_activities,1);assert.equal(row.tasks,1);assert.equal(row.outboxes,1);
    // The next sync does not look the message up again (alias known) and does not reprocess the reply.
    const again=await sync(s);assert.equal(again.sent_aliases.looked_up,0);assert.equal(again.queued,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outbound_sent_lookup_attempts')).rows[0].n,1);
    await assert.rejects(pool.query('DELETE FROM leadgen.outbound_message_id_aliases'),/APPEND_ONLY/);
    await assert.rejects(pool.query(`UPDATE leadgen.outbound_sent_lookup_attempts SET code='x'`),/APPEND_ONLY/);
  });
});

test('Sent copy missing: subject fallback correlates with LOW confidence at processing time; retries are logged',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool);
    s.server.folders['Sent Messages'].length=0;
    reply(s.server,{inReplyTo:'<srv-1@shimin.example>',subject:`回复：${s.draft.subject}`});
    const result=await sync(s);assert.equal(result.sent_aliases.status,'COMPLETED');assert.equal(result.sent_aliases.aliases,0);
    const [row]=await inbound(pool);
    assert.equal(row.correlation_status,'MATCHED');assert.equal(row.correlation_method,'SUBJECT_FALLBACK');assert.equal(row.correlation_confidence,'LOW');
    assert.equal(row.replied_activities,1);assert.equal(row.tasks,1);
    assert.deepEqual((await pool.query('SELECT lookup_status FROM leadgen.outbound_sent_lookup_attempts')).rows.map(r=>r.lookup_status),['NO_MATCH']);
    // A reply from another address or with another subject does not use the fallback.
    const fallback=s.service.replyCorrelation();
    const base={mailbox_identity_hash:hex('sales@alpha.example'),merchant_id:s.alpha,received_at:new Date().toISOString()};
    assert.equal((await fallback.findSubjectFallback({...base,subject:`Re: ${s.draft.subject}`,from_address_hash:hex('other@gulf-fashion.example')})).match,null);
    assert.equal((await fallback.findSubjectFallback({...base,subject:`Fwd: ${s.draft.subject}`,from_address_hash:hex(BUYER)})).match,null);
    assert.equal((await fallback.findSubjectFallback({...base,subject:`Re: ${s.draft.subject}`,from_address_hash:hex(BUYER),merchant_id:null})).match,null,'other owner');
    assert.equal((await fallback.findSubjectFallback({...base,subject:`Re: ${s.draft.subject}`,from_address_hash:hex(BUYER),mailbox_identity_hash:hex('other@alpha.example')})).match,null,'other mailbox');
    assert.equal((await fallback.findSubjectFallback({...base,subject:`Re: ${s.draft.subject}`,from_address_hash:hex(BUYER),received_at:new Date(Date.now()+61*86400000).toISOString()})).match,null,'older than 60 days');
  });
});

test('repair script: dry run changes nothing; --apply correlates REVIEW replies with the normal downstream steps; re-run is idempotent',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    // Reproduce the live state: no alias, no fallback when the reply was processed -> REVIEW.
    const s=await setup(pool,{fallbackAtProcessing:false});
    s.server.folders['Sent Messages'].length=0;
    reply(s.server,{inReplyTo:'<cd6f869e074be05eebb8f94f93da623f@shimin.example>',subject:`Re: ${s.draft.subject}`});
    await sync(s);
    let [row]=await inbound(pool);
    assert.equal(row.correlation_status,'REVIEW');assert.equal(row.replied_activities,0);
    assert.ok((await pool.query('SELECT 1 FROM leadgen.reply_classifications WHERE inbound_message_id=$1',[row.id])).rowCount,'classified already');
    const dry=await recorrelateInboundReplies({pool,inboundIds:[row.id]});
    assert.equal(dry.dry_run,true);assert.equal(dry.matched.length,1);assert.equal(dry.matched[0].correlation_method,'SUBJECT_FALLBACK');
    assert.equal((await inbound(pool))[0].correlation_status,'REVIEW');
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.inbound_correlation_events')).rows[0].n,0);
    const applied=await recorrelateInboundReplies({pool,apply:true});
    assert.equal(applied.matched[0].applied,true);assert.deepEqual(applied.steps,['create-sales-followup','sync-outreach-to-crm:deferred','sync-outreach-to-crm:deferred']);
    [row]=await inbound(pool);
    assert.equal(row.correlation_status,'MATCHED');assert.equal(row.correlation_method,'SUBJECT_FALLBACK');assert.equal(row.correlation_confidence,'LOW');
    assert.equal(row.thread_id,s.sent.thread_id);assert.equal(row.thread_status,'REPLIED');
    assert.equal(row.replied_activities,1);assert.equal(row.tasks,1);assert.equal(row.outboxes,1);
    const event=(await pool.query('SELECT * FROM leadgen.inbound_correlation_events')).rows;
    assert.equal(event.length,1);assert.equal(event[0].previous_status,'REVIEW');assert.equal(event[0].recorded_by,'REPAIR_SCRIPT');assert.equal(event[0].merchant_id,s.alpha);
    // Same as a normally correlated reply: the company shows as replied, no further follow-up drafts.
    const again=await recorrelateInboundReplies({pool,apply:true});
    assert.equal(again.reviewed,0);
    assert.equal((await inbound(pool))[0].replied_activities,1);
  });
});

test('repair via a later Sent-folder alias: the sync records the alias and re-correlates the waiting reply by header',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const s=await setup(pool,{fallbackAtProcessing:false});
    const copy=[...s.server.folders['Sent Messages']];s.server.folders['Sent Messages'].length=0;
    reply(s.server,{inReplyTo:'<srv-1@shimin.example>',subject:'Something else entirely'});
    await sync(s);
    assert.equal((await inbound(pool))[0].correlation_status,'REVIEW');
    s.server.folders['Sent Messages'].push(...copy);
    const later=await sync(s);
    assert.equal(later.sent_aliases.aliases,1);assert.equal(later.sent_aliases.recorrelated,1);
    const [row]=await inbound(pool);
    assert.equal(row.correlation_method,'IN_REPLY_TO_ALIAS');assert.equal(row.correlation_confidence,'HIGH');assert.equal(row.replied_activities,1);assert.equal(row.tasks,1);
    assert.equal((await pool.query(`SELECT recorded_by FROM leadgen.inbound_correlation_events`)).rows[0].recorded_by,'SENT_ALIAS_LOOKUP');
  });
});

test('CREATE_LEAD for a manual company is accepted; a failed row is retried by appending a new row',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const category=await approveCategory(pool);
    const queue={async enqueue(){return 'job';}};
    const companies=new ManualCompanyService({pool,env:{},queue});
    const created=(await companies.create({company_name:'SIM验收测试客户（飞书）',website:'https://example.com/about',market_code:'AE',company_type:'IMPORTER',category_scope_id:category},'minm138@outlook.com',ADMIN)).company;
    const lead=(await pool.query(`SELECT * FROM leadgen.crm_sync_outbox WHERE company_id=$1 AND operation='CREATE_LEAD'`,[created.id])).rows[0];
    assert.equal(lead.payload.website_url,'https://example.com');assert.equal(lead.payload.source_reference,`manual_company=${created.id}`);
    const service=new Phase7Service({pool,env:{},audit:()=>{}});
    // Without a configured CRM the row is retryable (payload accepted), not a permanent payload error.
    // The database clock may run ahead of the test clock; make the rows due now on both.
    const due=id=>pool.query(`UPDATE leadgen.crm_sync_outbox SET next_attempt_at=now()-interval '1 hour' WHERE id=$1`,[id]);
    await due(lead.id);
    const processed=await service.processCrmSyncWork({outbox_id:lead.id});
    assert.equal(processed.configuration_status,"ADAPTER_NOT_CONFIGURED",JSON.stringify(processed));
    // Reproduce the live failure (payload as stored before the fix) and repair it.
    const failed=(await pool.query(`INSERT INTO leadgen.crm_sync_outbox(company_id,operation,payload,idempotency_key,sync_status,last_error,attempt_count)
      VALUES($1,'CREATE_LEAD',$2::jsonb,$3,'PERMANENT_ERROR','CRM_PAYLOAD_PATH_FORBIDDEN',1) RETURNING *`,
      [created.id,JSON.stringify({owner:'minm138@outlook.com',website_url:'https://example.com',company_name:'SIM验收测试客户（飞书）',country_code:'AE',source_reference:`manual_company=${created.id}`}),
        `manual-company:${created.id}:lead:legacy`])).rows[0];
    const dry=await retryFailedCrmOutbox({pool});
    assert.equal(dry.dry_run,true);assert.equal(dry.planned.length,1);assert.equal(dry.planned[0].failed_outbox_id,failed.id);
    const applied=await retryFailedCrmOutbox({pool,apply:true});
    assert.equal(applied.planned[0].new_sync_status,'PENDING');
    const retry=(await pool.query('SELECT * FROM leadgen.crm_sync_outbox WHERE id=$1',[applied.planned[0].new_outbox_id])).rows[0];
    assert.equal(retry.idempotency_key,`manual-company:${created.id}:lead:legacy:retry:${failed.id}`);
    await due(retry.id);
    assert.equal((await service.processCrmSyncWork({outbox_id:retry.id})).configuration_status,'ADAPTER_NOT_CONFIGURED');
    assert.equal((await pool.query('SELECT sync_status FROM leadgen.crm_sync_outbox WHERE id=$1',[failed.id])).rows[0].sync_status,'PERMANENT_ERROR','history kept');
    assert.equal((await retryFailedCrmOutbox({pool,apply:true})).found,0,'idempotent');
  });
});
