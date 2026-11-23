// Email results warnings, exchange-rate validation and conversion, and their screens. No database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mailboxWarnings,EMAIL_WARNING_THRESHOLDS} from '../src/crm/emailStats.js';
import {convertTotals,exchangeRateInput} from '../src/crm/exchangeRates.js';
import {emailStatsMarkup} from '../public/ui/v4/email-stats.js';
import {convertedMarkup,ratesBody,ratesMarkup} from '../public/ui/v4/exchange-rates.js';

test('mailbox notes: high at 5% bounces, watch at 2%, few replies after 50 sent, or 40+ in one day',()=>{
  assert.deepEqual(EMAIL_WARNING_THRESHOLDS,{bounceHigh:5,bounceWatch:2,lowReplySent:50,lowReplyRate:1,dailyVolume:40});
  assert.deepEqual(mailboxWarnings({sent:100,bounced:5,replied:3}),{level:'HIGH',reasons:['BOUNCE_HIGH'],bounce_rate:5,reply_rate:3,max_daily_sent:0});
  assert.equal(mailboxWarnings({sent:100,bounced:2,replied:3}).level,'WATCH');
  assert.deepEqual(mailboxWarnings({sent:100,bounced:1,replied:0}).reasons,['LOW_REPLIES']);
  assert.deepEqual(mailboxWarnings({sent:49,bounced:0,replied:0}).reasons,[],'under 50 sent: too early to judge replies');
  assert.deepEqual(mailboxWarnings({sent:45,replied:5},[{sent:40}]).reasons,['DAILY_VOLUME']);
  assert.deepEqual(mailboxWarnings({sent:45,replied:5,max_daily_sent:41}).reasons,['DAILY_VOLUME'],'12-month view uses the busiest day');
  assert.deepEqual(mailboxWarnings({sent:0}),{level:'OK',reasons:[],bounce_rate:null,reply_rate:null,max_daily_sent:0});
  assert.deepEqual(mailboxWarnings({sent:10,replied:1,complained:1}).reasons,['COMPLAINTS']);
});

test('exchange rates: codes, positive rates, not the base currency, each once',()=>{
  assert.deepEqual(exchangeRateInput({base_currency:'usd',rates:[{currency:'eur',rate:'1.08'},{currency:'AED',rate:0.2723}]}),
    {base_currency:'USD',rates:[{currency:'AED',rate:0.2723},{currency:'EUR',rate:1.08}]});
  assert.deepEqual(exchangeRateInput({}),{base_currency:'USD',rates:[]});
  assert.throws(()=>exchangeRateInput({rates:[{currency:'EURO',rate:1}]}),{code:'CRM_VALUE_INVALID'});
  assert.throws(()=>exchangeRateInput({rates:[{currency:'EUR',rate:0}]}),{code:'CRM_VALUE_INVALID'});
  assert.throws(()=>exchangeRateInput({rates:[{currency:'USD',rate:1}]}),{code:'CRM_RATE_SAME_AS_BASE'});
  assert.throws(()=>exchangeRateInput({rates:[{currency:'EUR',rate:1},{currency:'eur',rate:2}]}),{code:'CRM_RATE_DUPLICATE'});
  assert.throws(()=>exchangeRateInput({rates:Array.from({length:31},(_,i)=>({currency:`A${String.fromCharCode(65+i%26)}${String.fromCharCode(65+Math.floor(i/26))}`,rate:1}))}),{code:'CRM_VALUE_INVALID'});
});

test('converted totals only when every currency has a rate',()=>{
  const currencies=[{currency:'USD',pipeline_amount:1000,weighted_amount:400,won_amount:0},{currency:'EUR',pipeline_amount:2000,weighted_amount:200,won_amount:100}];
  assert.deepEqual(convertTotals(currencies,{base_currency:'USD',rates:[{currency:'EUR',rate:1.08}]}).total,{pipeline_amount:3160,weighted_amount:616,won_amount:108});
  assert.deepEqual(convertTotals(currencies,{base_currency:'USD',rates:[]}),{base:'USD',total:null,missing:['EUR'],currencies:['USD','EUR']});
  assert.deepEqual(convertTotals(currencies,{base_currency:'EUR',rates:[{currency:'USD',rate:0.9}]}).total,{pipeline_amount:2900,weighted_amount:560,won_amount:100});
  assert.equal(convertTotals([],{}).total,null);
});

test('screens: email results card, rates card and the converted line',()=>{
  const data={range:'30d',rows:[{period:'2026-11-21',sent:4,replied:1,bounced:0,complained:0},{period:'2026-11-22',sent:0,replied:0,bounced:0,complained:0}],
    totals:{sent:4,replied:1,bounced:0,complained:0,reply_rate:25,bounce_rate:0},
    mailboxes:[{sender_key:'SIM',label:'SIM',totals:{sent:4},level:'OK',reasons:[],reply_rate:25,bounce_rate:0},
      {sender_key:'m1',label:'sales@alpha.example',merchant_name:'Alpha',totals:{sent:60},level:'HIGH',reasons:['BOUNCE_HIGH'],reply_rate:0,bounce_rate:6}]};
  const html=emailStatsMarkup(data);
  assert.match(html,/发信效果/);assert.match(html,/回复率[\s\S]*25%/);assert.match(html,/11-21/);assert.match(html,/Alpha · sales@alpha\.example/);
  assert.match(html,/退信率 5% 以上/);assert.match(html,/data-email-range="30d" aria-pressed="true"[^>]*data-tip=/);
  assert.match(emailStatsMarkup({...data,rows:[],totals:{sent:0}}),/这段时间还没有发出的邮件/);
  const rates=ratesMarkup({base_currency:'USD',rates:[{currency:'EUR',rate:1.08}]});
  assert.match(rates,/name="currency"[^>]*value="EUR"/);assert.match(rates,/data-rate-add[^>]*data-tip=/);assert.match(rates,/type="submit"[^>]*data-tip=/);
  assert.match(ratesMarkup({base_currency:'USD',rates:[]},{folded:true}),/<details data-rates-details>/);
  assert.deepEqual(ratesBody('USD',[{currency:'eur',rate:'1.1'},{currency:'',rate:''}]),{body:{base_currency:'USD',rates:[{currency:'EUR',rate:1.1}]}});
  assert.match(ratesBody('USD',[{currency:'USD',rate:'1'}]).problem[0],/基准币种/);
  assert.match(ratesBody('USD',[{currency:'EUR',rate:'-1'}]).problem[0],/大于 0/);
  assert.equal(convertedMarkup({converted:{base:'USD',total:null,missing:[],currencies:['USD']}}),'','one currency: nothing to add up');
  assert.match(convertedMarkup({converted:{base:'USD',total:null,missing:['EUR'],currencies:['USD','EUR']}}),/EUR 未设汇率，未计入合计[\s\S]*data-rates-open/);
  assert.match(convertedMarkup({converted:{base:'USD',total:{pipeline_amount:3160,weighted_amount:616,won_amount:108},missing:[],currencies:['USD','EUR']}}),/折合 USD 约：在谈 USD 3,160/);
});

test('the reports page and settings have the new places',async()=>{
  const {readFile}=await import('node:fs/promises');
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['email-stats-root','report-converted-root','report-rates-root','exchange-rates-root'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/src="\/ui\/v4\/email-stats\.js"/);assert.match(html,/src="\/ui\/v4\/exchange-rates\.js"/);
});
