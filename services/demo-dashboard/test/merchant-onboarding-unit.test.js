// Trial applications and payment records (migration 082): input checks, provider placeholder and the
// admin / apply page markup. No database, no external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applicationInput,looksAutomated} from '../src/merchant/applications.js';
import {PaymentProvider,paymentInput,paymentProviderFrom} from '../src/merchant/payments/index.js';
import {applicationBody,applicationErrorText,applicationProblem} from '../public/ui/v4/apply.js';
import {applicationsMarkup,paymentHistoryMarkup,paymentProblem} from '../public/ui/v4/merchants-admin.js';

test('application fields are cleaned and checked; the hidden field marks automated senders',()=>{
  assert.deepEqual(applicationInput({company_name:'  Alpha  Textiles ',contact_name:'Anna',email:' Anna@Alpha.Example ',phone:'+86 138-0000-0000',message:'Dresses\nfor UAE'}),
    {company_name:'Alpha Textiles',contact_name:'Anna',email:'anna@alpha.example',phone:'+86 138-0000-0000',country:null,referrer:null,message:'Dresses\nfor UAE'});
  assert.throws(()=>applicationInput({contact_name:'Anna',email:'a@b.co'}),{code:'APPLICATION_COMPANY_REQUIRED'});
  assert.throws(()=>applicationInput({company_name:'A',email:'a@b.co'}),{code:'APPLICATION_CONTACT_REQUIRED'});
  assert.throws(()=>applicationInput({company_name:'A',contact_name:'B',email:'not-an-email'}),{code:'APPLICATION_EMAIL_INVALID'});
  assert.throws(()=>applicationInput({company_name:'A',contact_name:'B',email:'a@b.co',phone:'call me'}),{code:'APPLICATION_PHONE_INVALID'});
  assert.equal(looksAutomated({website_url2:'http://spam.example'}),true);assert.equal(looksAutomated({website_url2:''}),false);
});

test('payment input: positive amount, currency code, known method, covered date from today within five years',()=>{
  const now=new Date('2026-11-22T10:00:00Z');
  assert.deepEqual(paymentInput({amount:'1999.999',currency:'cny',method:'bank',paid_until:'2027-11-22',external_reference:' TX-1 '},now),
    {amount:2000,currency:'CNY',method:'BANK',paid_until:'2027-11-22T23:59:59.000Z',external_reference:'TX-1',note:null});
  assert.equal(paymentInput({amount:10,currency:'USD',paid_until:'2026-11-22'},now).method,'MANUAL','today is allowed; method defaults to manual');
  for(const [body,code] of [[{amount:0,currency:'USD',paid_until:'2027-01-01'},'PAYMENT_AMOUNT_INVALID'],[{amount:5,currency:'US',paid_until:'2027-01-01'},'PAYMENT_CURRENCY_INVALID'],
    [{amount:5,currency:'USD',method:'CHEQUE',paid_until:'2027-01-01'},'PAYMENT_METHOD_INVALID'],[{amount:5,currency:'USD',paid_until:'2026-11-21'},'PAYMENT_PAID_UNTIL_INVALID'],
    [{amount:5,currency:'USD',paid_until:'2035-01-01'},'PAYMENT_PAID_UNTIL_INVALID']])assert.throws(()=>paymentInput(body,now),{code});
});

test('online payment is not connected: no provider by default, a named one refuses until implemented',async()=>{
  assert.equal(paymentProviderFrom({}),null);assert.equal(paymentProviderFrom({PAYMENT_PROVIDER:'paypal'}),null);
  const stripe=paymentProviderFrom({PAYMENT_PROVIDER:'Stripe'});
  assert.ok(stripe instanceof PaymentProvider);assert.equal(stripe.name,'stripe');assert.equal(stripe.connected,false);
  await assert.rejects(stripe.createCheckout({}),{code:'PAYMENT_PROVIDER_NOT_CONNECTED'});
  await assert.rejects(stripe.verifyWebhook({}),{code:'PAYMENT_PROVIDER_NOT_CONNECTED'});
});

test('apply page: body, checks before sending, refusals in words; sign-in page links to it',async()=>{
  const form=Object.fromEntries(Object.entries({company_name:' Alpha ',contact_name:'Anna',email:'anna@alpha.example',phone:'',country:'China',referrer:'',message:'',website_url2:''}).map(([k,v])=>[k,{value:v}]));
  assert.deepEqual(applicationBody(form),{company_name:'Alpha',contact_name:'Anna',email:'anna@alpha.example',country:'China'});
  assert.equal(applicationProblem({company_name:'A',contact_name:'B',email:'x'})[0],'email');assert.equal(applicationProblem({company_name:'A',contact_name:'B',email:'a@b.co'}),null);
  assert.match(applicationErrorText(429)[0],/一小时/);
  const html=await readFile(new URL('../public/apply.html',import.meta.url),'utf8');
  assert.match(html,/name="website_url2"[^>]*tabindex="-1"/);assert.match(html,/已收到申请，我们会尽快联系您/);assert.match(html,/id="apply-submit"[^>]*data-tip=/);
  assert.match(await readFile(new URL('../public/login.html',import.meta.url),'utf8'),/href="\/apply\.html"[^>]*data-tip=/);
});

test('admin page: pending applications with both decisions, payment checks and history',()=>{
  const html=applicationsMarkup([{id:'a1',status:'PENDING',company_name:'Alpha',contact_name:'Anna',email:'anna@alpha.example',created_at:'2026-11-22T00:00:00Z',email_in_use:true},
    {id:'a2',status:'REJECTED',company_name:'Old',contact_name:'O',email:'o@o.example',created_at:'2026-11-01T00:00:00Z'}]);
  assert.match(html,/Alpha/);assert.doesNotMatch(html,/Old/);assert.match(html,/这个邮箱已有账号/);
  assert.match(html,/data-application-action="approve"[^>]*data-tip=/);assert.match(html,/data-application-action="reject"[^>]*data-tip=/);
  assert.match(applicationsMarkup([]),/没有待审核的试用申请/);
  const today=new Date('2026-11-22T10:00:00Z');
  assert.match(paymentProblem({amount:0,currency:'CNY',paid_until:'2027-01-01'},today)[0],/金额/);
  assert.match(paymentProblem({amount:5,currency:'CNY',paid_until:'2026-11-01'},today)[0],/早于今天/);
  assert.equal(paymentProblem({amount:5,currency:'CNY',paid_until:'2026-11-22'},today),null);
  assert.match(paymentHistoryMarkup([{paid_at:'2026-11-22',method:'ALIPAY',amount:1999,currency:'CNY',paid_until:'2027-11-22',external_reference:'TX-1'}]),/支付宝[\s\S]*TX-1[\s\S]*CNY 1,999/);
  assert.match(paymentHistoryMarkup([]),/还没有付款记录/);
});
