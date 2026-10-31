// Batch 2 B1/B2 without a database: recipient rules, template choice, router behaviour and the
// UI markup (bilingual labels, stable hooks). Zero external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFile} from 'node:fs/promises';
import {parseAllowlist,parseWebsite,recipientProblem,emailDomain} from '../src/companies/common.js';
import {manualTemplateKey,manualTemplateVariables} from '../src/outreach/manualFirstTouch.js';
import {FirstTouchTestSendService,SAMPLE_VARIABLES} from '../src/outreach/firstTouchTestSend.js';
import {createManualCompanyRouter} from '../src/companies/router.js';
import {rowMarkup,draftCell,reasonText} from '../public/ui/v4/manual-company.js';
import {historyMarkup,remainingMarkup} from '../public/ui/v4/first-touch-test.js';

test('website and recipient rules: company domain, published source page, or the test allowlist', () => {
  assert.deepEqual(parseWebsite('https://www.Gulf-Fashion.ae/about'),{hostname:'gulf-fashion.ae',domain:'gulf-fashion.ae',website_url:'https://www.gulf-fashion.ae/about'});
  assert.equal(parseWebsite('shop.example.co.uk').domain,'example.co.uk');
  assert.throws(()=>parseWebsite('127.0.0.1'),{code:'WEBSITE_INVALID'});
  assert.throws(()=>parseWebsite('ftp://x.com'),{code:'WEBSITE_INVALID'});
  assert.equal(emailDomain('a@mail.example.co.uk'),'example.co.uk');
  const allowlist=parseAllowlist(' Owner@QQ.com ; second@test.com,bad');
  assert.deepEqual([...allowlist],['owner@qq.com','second@test.com']);
  assert.equal(recipientProblem({email:'info@gulf-fashion.ae',companyDomain:'gulf-fashion.ae'}),null);
  assert.equal(recipientProblem({email:'buying@eu.gulf-fashion.ae',companyDomain:'www.gulf-fashion.ae'}),null);
  assert.equal(recipientProblem({email:'gulf@gmail.com',companyDomain:'gulf-fashion.ae'}),'RECIPIENT_DOMAIN_MISMATCH');
  assert.equal(recipientProblem({email:'gulf@gmail.com',companyDomain:'gulf-fashion.ae',sourceUrl:'https://gulf-fashion.ae/contact'}),null);
  assert.equal(recipientProblem({email:'info@gulf-fashion.ae',companyDomain:'gulf-fashion.ae',isTest:true,allowlist}),'TEST_RECIPIENT_NOT_ALLOWED');
  assert.equal(recipientProblem({email:'OWNER@qq.com',companyDomain:'gulf-fashion.ae',isTest:true,allowlist}),null);
});

test('manual template choice: any business mailbox works, a named decision maker is not required', () => {
  assert.equal(manualTemplateKey({contact:{email:'info@x.ae',contact_type:'GENERIC_BUSINESS_EMAIL',is_generic:true},companyType:'IMPORTER'}),'C_OFFICIAL_GENERIC_MAILBOX');
  assert.equal(manualTemplateKey({contact:{email:'wholesale.team@x.ae',contact_type:'DEPARTMENT_EMAIL'},companyType:'WHOLESALER'}),'B_IMPORTER_WHOLESALER_DISTRIBUTOR');
  assert.equal(manualTemplateKey({contact:{email:'buying@x.ae',contact_type:'DEPARTMENT_EMAIL'},companyType:'WHOLESALER'}),'C_OFFICIAL_GENERIC_MAILBOX'); // C8: buying@ is a shared mailbox
  assert.equal(manualTemplateKey({contact:{email:'buying@x.ae',contact_type:'DEPARTMENT_EMAIL'},companyType:'RETAIL_CHAIN'}),'C_OFFICIAL_GENERIC_MAILBOX');
  assert.equal(manualTemplateKey({contact:{email:'sara@x.ae',contact_type:'BUSINESS_EMAIL',person_name:'Sara Ahmed'},companyType:'RETAILER'}),'A_NAMED_BUYER');
  const {variables,verified_fields}=manualTemplateVariables({company:{company_name:'Gulf LLC',country_name:'United Arab Emirates',normalized_category:'DRESSES'},contact:{person_name:'Sara Ahmed'},replyTo:'s@sim.example'});
  assert.equal(variables.category,'Dresses');assert.equal(variables.first_name,'Sara');assert.ok(verified_fields.includes('first_name'));
});

test('test send preview uses the real template with [TEST] and sample values when no company is chosen', async () => {
  const provider={senderEmail:'simon@sim.example',replyToEmail:'simon@sim.example',messageIdDomain:'sim.example'};
  const pool={async query(){return{rows:[{count:3}]};}};
  const service=new FirstTouchTestSendService({pool,outboundProvider:provider,env:{TEST_RECIPIENT_ALLOWLIST:'owner@qq.com',FIRST_TOUCH_TEST_DAILY_LIMIT:'10'}});
  const preview=await service.preview({template_key:'C_OFFICIAL_GENERIC_MAILBOX'},{admin:true,merchantId:null,restrict:false});
  assert.equal(preview.subject,`[TEST] Dresses enquiry for ${SAMPLE_VARIABLES.company}`);
  assert.match(preview.body_text,/simon@sim\.example/);assert.equal(preview.variables_source,'SAMPLE');
  assert.deepEqual(preview.allowed_recipients.sort(),['owner@qq.com','simon@sim.example']);
  assert.equal(preview.remaining_today,7);
  await assert.rejects(service.send({recipient:'buyer@other.example'},'simon',{admin:true,merchantId:null,restrict:false}),{code:'TEST_RECIPIENT_NOT_ALLOWED'});
  await assert.rejects(service.preview({template_key:'Z'},{admin:true,merchantId:null,restrict:false}),{code:'TEMPLATE_INVALID'});
});

test('router maps business errors to 4xx JSON and passes the caller scope', async t => {
  const seen=[];
  const companies={options:async scope=>{seen.push(scope);return{is_admin:true};},list:async()=>({items:[]}),
    create:async()=>{throw Object.assign(new Error('dup'),{code:'COMPANY_ALREADY_LISTED',status:409});},
    get:async()=>({}),addContact:async()=>({}),setTestFlag:async()=>({}),assign:async()=>({}),addActivity:async()=>({crm_outbox_id:'x'}),setStage:async()=>({})};
  const firstTouch={listDrafts:async()=>({items:[]}),decide:async()=>{throw Object.assign(new Error('no'),{code:'FIRST_TOUCH_NOT_ALLOWED',status:409,details:{reason_codes:['SUPPRESSED']}});},
    createDraft:async()=>{throw Object.assign(new Error('bad'),{code:'FIRST_TOUCH_VERIFIED_VARIABLE_REQUIRED'});}};
  const testSends={status:async()=>({}),preview:async()=>({}),send:async()=>{throw Object.assign(new Error('limit'),{code:'TEST_SEND_DAILY_LIMIT',status:429});}};
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.workspaceScope={admin:false,merchantId:'m1',restrict:true};req.workspaceUser={email:'m@x.example'};next();});
  app.use(createManualCompanyRouter({companies,firstTouch,testSends}));
  app.use((error,_req,res,_next)=>res.status(500).json({code:'UNHANDLED'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const call=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('/api/manual-companies/options')).status,200);assert.equal(seen[0].merchantId,'m1');
  assert.deepEqual(await(await call('/api/manual-companies',{})).json(),{error:'dup',code:'COMPANY_ALREADY_LISTED'});
  const decided=await call('/api/manual-companies/first-touch-drafts/abc/decision',{decision:'APPROVE'});
  assert.equal(decided.status,409);assert.deepEqual((await decided.json()).details.reason_codes,['SUPPRESSED']);
  assert.equal((await call('/api/manual-companies/abc/first-touch-drafts',{})).status,422);
  assert.equal((await call('/api/first-touch/test-sends',{recipient:'x'})).status,429);
  assert.equal((await call('/api/manual-companies/abc/activities',{})).status,201);
});

test('UI: bilingual rows, stable hooks, business wording and the CSS block', async () => {
  const item={id:'c1',company_name:'Gulf <LLC>',normalized_domain:'gulf.ae',is_test:true,market:{name_zh:'阿联酋',name_en:'United Arab Emirates'},market_code:'AE',
    category:{name_zh:'连衣裙',name_en:'Dresses'},company_type:'IMPORTER',contacts:[{id:'k1',email:'info@gulf.ae',department_name:'Company mailbox'}],stage:'NEW',
    latest_draft:{id:'d1',draft_status:'PENDING_APPROVAL',normalized_recipient:'info@gulf.ae',created_at:'2026-10-26T10:00:00Z'}};
  const html=rowMarkup(item,{admin:true});
  assert.match(html,/data-manual-company="c1"/);assert.match(html,/Gulf &lt;LLC&gt;/);assert.match(html,/测试企业/);
  assert.match(html,/data-manual-action="review"/);assert.match(html,/data-manual-action="test"/);assert.match(html,/data-manual-action="assign"/);
  assert.doesNotMatch(rowMarkup(item,{admin:false}),/data-manual-action="(test|assign)"/);
  assert.match(html,/<span lang="zh-CN">待联系<\/span><span lang="en">New<\/span>/);
  assert.match(draftCell({latest_draft:null}),/还未写开发信/);
  assert.deepEqual(reasonText({details:{reason_codes:['SUPPRESSED','HARD_BOUNCED']}})[1],'The recipient opted out or is on the do-not-contact list; This address bounced before');
  assert.match(remainingMarkup({remaining_today:7,daily_limit:10}),/今日还可发 7 封/);
  assert.match(historyMarkup([{send_status:'PROVIDER_ACCEPTED',subject:'[TEST] X',recipient:'a@b.c',created_at:'2026-10-26T10:00:00Z'}]),/已发出/);
  const [manual,testUi,css]=await Promise.all(['manual-company.js','first-touch-test.js','app.css'].map(name=>readFile(new URL(`../public/ui/v4/${name}`,import.meta.url),'utf8')));
  for(const source of [manual,testUi])assert.doesNotMatch(source,/Demo|真实数据|抓取|采集|爬取|去重|规则评分|PostgreSQL|数据库/);
  assert.match(manual,/id="manual-companies-root"|#manual-companies-root/);assert.match(testUi,/data-first-touch-test-open/);
  assert.match(css,/Batch 2 B1\/B2[\s\S]*end Batch 2 B1\/B2/);assert.match(css,/min-height: 44px/);
});
