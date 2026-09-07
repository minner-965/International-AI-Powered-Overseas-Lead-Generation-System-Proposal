import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { communicationViews, filterOpportunityCommunication, opportunityCommunicationRecord, paginateOpportunityItems } from '../public/ui/opportunity-workspace.js';

const opportunities = [
  { company_id:'one',product_profile:'WOMENSWEAR' },
  { company_id:'one',product_profile:'GENERAL_MERCHANDISE' },
  { company_id:'two',product_profile:'WOMENSWEAR' }
];
test('communication views join current company/profile, never infer from acceptance or opportunity approval',()=>{
  const workbench={items:[
    {...opportunities[0],business_contact_status:'SENT_NO_REPLY',send_status:'PROVIDER_ACCEPTED'},
    {...opportunities[1],business_contact_status:'REPLIED'},
    {...opportunities[2],business_contact_status:'NOT_SENT',send_status:'PROVIDER_ACCEPTED'}
  ]};
  assert.deepEqual(communicationViews,['SENT_NO_REPLY','REPLIED']);
  assert.deepEqual(filterOpportunityCommunication(opportunities,workbench,'SENT_NO_REPLY'),[opportunities[0]]);
  assert.deepEqual(filterOpportunityCommunication(opportunities,workbench,'REPLIED'),[opportunities[1]]);
  assert.equal(filterOpportunityCommunication(opportunities,workbench,'ALL'),opportunities);
  assert.equal(opportunityCommunicationRecord(opportunities[0],workbench),workbench.items[0]);
});
test('unknown, opted-out, automated and controlled replies never become prospect replies',()=>{
  for(const status of ['OPTED_OUT','BOUNCED','AUTO_REPLY','REPLIED_NEEDS_REVIEW',null]){
    assert.deepEqual(filterOpportunityCommunication(opportunities,{items:[{...opportunities[0],business_contact_status:status}]},'REPLIED'),[]);
  }
  assert.deepEqual(filterOpportunityCommunication(opportunities,{items:[{...opportunities[0],record_scope:'CONTROLLED',business_contact_status:'REPLIED'}]},'REPLIED'),[]);
  assert.deepEqual(filterOpportunityCommunication(opportunities,null,'REPLIED'),[]);
  assert.equal(opportunityCommunicationRecord(opportunities[0],null),null);
});
test('pagination clamps edge cases without mutation, duplication or lost records',()=>{
  const data=Array.from({length:23},(_,id)=>({id}));
  assert.deepEqual([1,2,3].flatMap(page=>paginateOpportunityItems(data,page).items),data);
  assert.deepEqual(paginateOpportunityItems(data,99),{items:data.slice(20),page:3,pages:3,total:23,pageSize:10});
  assert.equal(paginateOpportunityItems(data,-4).page,1);
  assert.deepEqual(paginateOpportunityItems([],5).items,[]);
  assert.equal(data.length,23);
});
test('V3 opportunity styling has no obsolete palette, hover lift, hidden English or desktop card substitution',async()=>{
  const css=await readFile(new URL('../public/ui/opportunity-workspace.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/#(?:5146e5|3730a3|eeedff)|--opw-purple|translateY|gradient|\[lang="en"\][^}]*display:\s*none/);
  assert.match(css,/--dpv-surface/);
  assert.match(css,/@media \(max-width: 767px\)/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/prefers-reduced-motion/);
});
test('all eight views retain form names and stable decision hooks, table is compact and paginated',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const region=html.split('id="view-opportunities"')[1].split('id="view-contact-queue"')[0];
  for(const status of ['RECOMMENDED','EVIDENCE_REQUIRED','MANAGEMENT_APPROVED','SENT_NO_REPLY','REPLIED','HOLD','NOT_SUITABLE','ALL'])assert.match(region,new RegExp(`data-opportunity-status="${status}"`));
  assert.equal((region.match(/<th class="op-col-/g)||[]).length,8);
  for(const hook of ['opportunity-table','opportunity-pagination','opportunity-advanced-filter-drawer','opportunity-status'])assert.match(region,new RegExp(`id="${hook}"`));
  assert.match(app,/status:presentationView \? 'ALL' : filters.status/);
  assert.match(app,/if \(presentationView && !communications\) throw/);
  assert.match(app,/setOpportunityResultSummary\(matching.length,selectedStatus\)/);
});
test('phone uses summary cards and moves the same filter controls into the drawer',async()=>{
  const css=await readFile(new URL('../public/ui/opportunity-workspace.css',import.meta.url),'utf8');
  const filters=await readFile(new URL('../public/ui/filters.js',import.meta.url),'utf8');
  const phone=css.slice(css.indexOf('@media (max-width: 767px)'));
  assert.match(phone,/\.opw-page-head h2 \{ font-size:18px/);
  assert.match(phone,/\.opw-kpi-grid \{ display:flex; overflow-x:auto/);
  assert.match(phone,/min-height:72px/);
  assert.match(phone,/\.op-col-action \{ grid-column:1 \/ -1/);
  assert.match(filters,/form.elements.namedItem\(name\)\?\.closest\('label'\)/);
  assert.match(filters,/compactScope.querySelector\('\.crm-filter-group-grid'\).append\(label\)/);
  assert.match(filters,/else primaryHost.insertBefore\(label,openButton\)/);
  assert.match(filters,/compactFilters.addEventListener\('change',arrangeCompactFilters\)/);
});
