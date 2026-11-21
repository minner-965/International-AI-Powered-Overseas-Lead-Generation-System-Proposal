// Screens for deals, key customers, reports, reminder rules, task priority and the spreadsheet import.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dealMeta,keyCustomersMarkup,moneyText,priorityPill,reportMarkup,rulesMarkup} from '../public/ui/v4/sales-reports.js';
import {dealBody,dealCardMarkup,dealProblem} from '../public/ui/v4/deal-card.js';
import {importPanelMarkup} from '../public/ui/v4/company-import.js';
import {stageNeedsReason} from '../public/ui/v4/crm.js';
import {stageChangeNeedsReason} from '../src/crm/stageRules.js';

const STAGES=['NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON','LOST'];

test('the page asks for a stage reason exactly when the server requires one',()=>{
  for(const from of STAGES)for(const to of STAGES)assert.equal(stageNeedsReason(from,to),stageChangeNeedsReason(from,to),`${from}->${to}`);
});

test('report: totals, funnel with conversion, countries; merchant ranking only when present',()=>{
  const report={currency:'USD',totals:{customers:4,active:3,won:1,lost:0,pipeline_amount:15000,weighted_amount:6300,won_amount:5000},
    funnel:[{stage:'NEW',count:0,amount:0,reached:4,conversion:null},{stage:'QUOTED',count:1,amount:12000,reached:3,conversion:75}],
    lost_reasons:[{reason:'OPTED_OUT',count:2}],countries:[{country_code:'AE',customers:2,active:2,won:0,amount:12000}],
    follow_up:{open_tasks:4,overdue_tasks:1,overdue_rate:25,avg_response_hours:5.5,replies_90d:3,quoted_no_reply:1,no_follow_up:1}};
  const html=reportMarkup(report);
  assert.match(html,/USD 15,000/);assert.match(html,/按赢率估算 USD 6,300/);assert.match(html,/1 \/ 4/);assert.match(html,/转化 75%/);
  assert.match(html,/对方退订/);assert.match(html,/平均 5\.5 小时（3 次回复）/);assert.doesNotMatch(html,/商家近 30 天/);
  assert.match(reportMarkup({...report,merchants:[{company_name:'Alpha',new_customers:2,follow_ups:5,emails_sent:9,won:1}]}),/商家近 30 天[\s\S]*Alpha/);
  assert.equal(moneyText(null,'USD'),'—');assert.equal(moneyText(1234.6,'EUR'),'EUR 1,235');
});

test('reminder rules form and key-customer card carry every button tooltip',()=>{
  const rules=rulesMarkup({enabled:true,no_follow_up_days:7,quoted_no_reply_days:3,sample_no_confirm_days:7});
  assert.match(rules,/name="no_follow_up_days"[^>]*value="7"/);assert.match(rules,/type="submit"[^>]*data-tip=/);
  const card=keyCustomersMarkup({counts:{high_intent:2,no_follow_up:1,quoted_no_reply:1,sample_no_confirm:0},
    items:[{company_id:'c1',company_name:'Al Noor',country_code:'AE',pipeline_stage:'QUOTED',customer_grade:'A',deal_amount:12000,deal_currency:'USD',flags:['HIGH_INTENT','QUOTED_NO_REPLY']}]});
  assert.match(card,/报价未回复 1/);assert.match(card,/Al Noor/);assert.match(card,/USD 12,000/);assert.match(card,/data-key-company="c1"[^>]*data-tip=/);
  assert.match(keyCustomersMarkup({counts:{},items:[]}),/目前没有需要特别关注的客户/);
});

test('deal card: stage default shown as the probability placeholder; empty fields clear values; checks before sending',()=>{
  const html=dealCardMarkup({company_id:'c1',deal_amount:null,deal_currency:null,expected_close_date:null,win_probability:null,default_win_probability:40,
    customer_grade:'B',health:{score:62,level:'FAIR',parts:{profile:20,timely:20,moving:20,answered:2}},flags:['QUOTED_NO_REPLY'],version:2});
  assert.match(html,/placeholder="40"/);assert.match(html,/一般 62/);assert.match(html,/报价未回复/);assert.match(html,/value="B" checked/);
  const form={deal_amount:{value:''},deal_currency:{value:''},expected_close_date:{value:'2026-12-31'},win_probability:{value:''},querySelector:()=>({value:'A'})};
  assert.deepEqual(dealBody(form),{deal_amount:null,deal_currency:null,expected_close_date:'2026-12-31',win_probability:null,customer_grade:'A'});
  assert.match(dealProblem({deal_amount:100,deal_currency:null,win_probability:null})[0],/币种/);
  assert.match(dealProblem({deal_amount:null,deal_currency:null,win_probability:120})[0],/0 到 100/);
  assert.equal(dealProblem({deal_amount:100,deal_currency:'USD',win_probability:50}),null);
});

test('pipeline rows show grade and amount; tasks show high and low priority only',()=>{
  assert.match(dealMeta({customer_grade:'A',deal_amount:12000,deal_currency:'USD'}),/A 级 · USD 12,000/);
  assert.equal(dealMeta({}),'');
  assert.match(priorityPill('HIGH'),/高优先/);assert.equal(priorityPill('NORMAL'),'');assert.match(priorityPill('LOW'),/低优先/);
});

test('import panel walks file -> columns -> check -> done with the reasons in words',()=>{
  assert.match(importPanelMarkup({step:'file'}),/id="import-file"[^>]*accept="\.xlsx,\.csv"/);
  const preview={file_name:'a.csv',row_count:2,headers:['公司名称','官网'],rows:[['Al Noor','alnoor.example']],options:{categories:[{id:'cat1',name_zh:'连衣裙',name_en:'Dresses'}],markets:[{code:'AE',name_zh:'阿拉伯联合酋长国',name_en:'United Arab Emirates'}],company_types:['IMPORTER']}};
  const map=importPanelMarkup({step:'map',preview,mapping:{company_name:0,website:1},category:'cat1'});
  assert.match(map,/name="map_company_name"[\s\S]*?<option value="0" selected>/);assert.match(map,/value="cat1" selected/);assert.match(map,/data-import-check[^>]*data-tip=/);
  const check=importPanelMarkup({step:'check',preview,check:{summary:{importable:1,duplicate:1,error:0},rows:[{row:2,company_name:'Al Noor',status:'WARNING',reasons:[],warnings:['CONTACT_NOT_ON_COMPANY_DOMAIN']},{row:3,company_name:'X',status:'DUPLICATE',reasons:['ALREADY_IN_DIRECTORY'],warnings:[]}]}});
  assert.match(check,/邮箱不是公司域名，联系人不导入/);assert.match(check,/客户名录里已有/);assert.match(check,/导入 1 家/);
  assert.match(importPanelMarkup({step:'done',result:{summary:{created:1,skipped:1,failed:0},results:[{row:2,company_name:'Al Noor',status:'CREATED',warnings:[]}]}}),/已导入 1/);
});

test('the workbench, reports page, import button and deal card are wired into the app',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/data-app-nav="sales-reports"[^>]*>|data-tip="[^"]*"[^>]*data-app-nav="sales-reports"/);assert.match(html,/id="sales-reports-root"/);
  assert.match(html,/src="\/ui\/v4\/sales-reports\.js"/);assert.match(html,/src="\/ui\/v4\/company-import\.js"/);
  const manual=await readFile(new URL('../public/ui/v4/manual-company.js',import.meta.url),'utf8');assert.match(manual,/data-import-open\$\{tip\(/);
  const followup=await readFile(new URL('../public/ui/v4/followup-card.js',import.meta.url),'utf8');assert.match(followup,/mountDealCard\(/);assert.match(followup,/name="stage_note"/);
});
