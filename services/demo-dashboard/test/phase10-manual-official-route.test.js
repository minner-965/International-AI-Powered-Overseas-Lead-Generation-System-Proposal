import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Phase7Repository} from '../src/phase7/repository.js';
import {Phase7Service} from '../src/phase7/service.js';

const U='11111111-1111-4111-8111-111111111111';

test('manual official-route reconciliation is retired and creates no task',async()=>{
  let calls=0;
  const pool={query:async()=>{calls+=1;return{rows:[],rowCount:0};}};
  const result=await new Phase7Repository({pool}).syncManualOfficialRoutes();
  assert.deepEqual(result,{created:0,items:[],retired_policy:true});
  assert.equal(calls,0);
});

test('manual official-route actions return the explicit retired policy boundary',async()=>{
  const repository=new Phase7Repository({pool:{query:async()=>({rows:[],rowCount:0})}});
  await assert.rejects(()=>repository.recordManualOfficialRouteAction(U,{status:'IN_PROGRESS'}),
    error=>error.code==='RETIRED_POLICY'&&error.status===410);
});

test('service reconciliation also returns 410 without provider, send, or approval activity',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})}});
  await assert.rejects(()=>service.reconcileManualOfficialRoutes({identity:'data.owner'}),
    error=>error.code==='RETIRED_POLICY'&&error.status===410);
});

test('Contact-ready Companies UI has no official-route review panel or action endpoint',async()=>{
  const [html,ui]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/ui/contact-queue.js',import.meta.url),'utf8')
  ]);
  assert.match(html,/待联系公司/);assert.match(html,/Contact-ready Companies/);
  assert.match(ui,/\/api\/workspace\/contact-queue/);
  assert.match(ui,/matched_categories/);assert.match(ui,/named_buyers/);assert.match(ui,/contact_routes/);
  assert.match(ui,/查看公司/);assert.match(ui,/View company/);
  assert.doesNotMatch(`${html}\n${ui}`,/manual-official-route|Start review|开始审核|Official Procurement Route|官方采购路径/);
});

test('workspace Contact Queue exposes only company-level aggregated contact facts',async()=>{
  const service=new Phase7Service({pool:{query:async()=>({rows:[],rowCount:0})}});
  service.repository={listContactQueue:async()=>[{opportunity_id:U,company_id:U,queue_status:'CONTACT_READY',
    company_name:'Example',country_code:'AE',website_url:'https://example.com',matched_categories:['WOMENSWEAR','GENERAL_MERCHANDISE'],
    opportunity_status:'RECOMMENDED',named_buyers:['Buyer One'],contact_routes:[{route_type:'CONTACT_FORM',value:'https://example.com/contact'}],
    named_buyer_ready:true,official_email_route:false,official_phone_route:false,official_whatsapp_route:false,official_form_route:true,
    input_digest:'secret',reason_codes:['INTERNAL']} ]};
  const contact=(await service.listWorkspaceContactQueue())[0];
  assert.deepEqual(contact.matched_categories,['WOMENSWEAR','GENERAL_MERCHANDISE']);
  assert.equal(contact.contact_routes.length,1);
  assert.equal(contact.input_digest,undefined);assert.equal(contact.reason_codes,undefined);
});
