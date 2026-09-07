import test from 'node:test';
import assert from 'node:assert/strict';
import {initialContactPending,contactProgressLabel,contactNextAction} from '../public/ui/contact-progress.js';
import {overviewModel} from '../public/ui/v3/overview.js';
import {groupContactCompanies} from '../public/ui/v3/companies.js';
test('sent history excludes first contact without removing category opportunity or changing assessment',()=>{
 const rows=[{company_id:'a',country_code:'AE',product_profile:'WOMENSWEAR',display_opportunity_status:'RECOMMENDED',contact_progress_status:'SENT_NO_REPLY',has_prior_company_contact:true,first_contact_pending:false},
 {company_id:'b',country_code:'AE',product_profile:'WOMENSWEAR',display_opportunity_status:'RECOMMENDED',contact_progress_status:'NOT_CONTACTED',first_contact_pending:true}];
 const model=overviewModel({opportunities:rows,getStatus:r=>r.display_opportunity_status});
 assert.equal(model.recommended,1);assert.equal(model.marketTotal,2);assert.equal(rows[0].display_opportunity_status,'RECOMMENDED');
 assert.deepEqual(groupContactCompanies(rows).map(r=>r.companyId),['b']);
 assert.equal(contactProgressLabel(rows[0])[0],'已发未回复');assert.equal(contactNextAction(rows[0])[0],'等待回复');
});
test('replies, optout, ambiguity and a sent different category never re-enter initial contact',()=>{
 for(const status of ['REPLIED','OPTED_OUT','DO_NOT_CONTACT','BOUNCED','SEND_AMBIGUOUS'])assert.equal(initialContactPending({contact_progress_status:status}),false);
 assert.equal(initialContactPending({contact_progress_status:'NOT_CONTACTED',has_prior_company_contact:true}),false);
 assert.equal(initialContactPending({first_contact_pending:false}),false);
});
