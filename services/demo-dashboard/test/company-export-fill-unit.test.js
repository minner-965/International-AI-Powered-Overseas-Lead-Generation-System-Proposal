// Export columns that import again, money / grade parsing, the fill-in screens and the stage gate
// fields of the manual-company stage dialog. No database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPORT_COLUMNS,IMPORT_FIELDS,moneyOf,suggestMapping} from '../src/companies/importWizard.js';
import {commitLabel,importPanelMarkup} from '../public/ui/v4/company-import.js';
import {stageGateFields,stageRequest} from '../public/ui/v4/manual-company.js';

test('an exported sheet maps back to the same fields, the ID column included',()=>{
  const mapping=suggestMapping(EXPORT_COLUMNS.map(([,title])=>title));
  const expected=Object.fromEntries(EXPORT_COLUMNS.map(([field],index)=>[field==='country'?'market':field,index]).filter(([field])=>IMPORT_FIELDS.includes(field)));
  assert.deepEqual(mapping,expected);
  assert.equal(mapping.stage,undefined,'the stage column is for reading only');
  assert.deepEqual(suggestMapping(['编号','公司名称','城市','金额','币种','客户分级']),{company_id:0,company_name:1,city:2,deal_amount:3,deal_currency:4,customer_grade:5});
});

test('amounts with currency codes, symbols and thousands separators',()=>{
  assert.deepEqual(moneyOf('USD 12,000'),{amount:12000,currency:'USD'});
  assert.deepEqual(moneyOf('$12,000.50'),{amount:12000.5,currency:'USD'});
  assert.deepEqual(moneyOf('€800'),{amount:800,currency:'EUR'});
  assert.deepEqual(moneyOf('¥ 5000'),{amount:5000,currency:'CNY'});
  assert.deepEqual(moneyOf('3000','aed'),{amount:3000,currency:'AED'});
  assert.deepEqual(moneyOf('3000','RMB'),{amount:3000,currency:'CNY'});
  assert.deepEqual(moneyOf('3000'),{amount:3000,currency:null});
  assert.deepEqual(moneyOf('about ten'),{amount:null,currency:null});
});

test('check and done screens show fill-ins in words and count them on the button',()=>{
  const check=importPanelMarkup({step:'check',check:{summary:{importable:1,update:2,duplicate:0,error:1},rows:[
    {row:2,company_name:'Al Noor',status:'UPDATE',reasons:[],warnings:[],fills:['city','contact','deal_amount']},
    {row:3,company_name:'',status:'ERROR',reasons:['COMPANY_ID_UNKNOWN'],warnings:[]},
    {row:4,company_name:'Casa',status:'DUPLICATE',reasons:['ALREADY_IN_DIRECTORY'],warnings:['DEAL_WON_NOT_CHANGED']}]}});
  assert.match(check,/补全 2 家/);assert.match(check,/补全：城市、联系人邮箱、预计金额/);assert.match(check,/编号对不上你的企业/);assert.match(check,/已成交的商机不改金额和分级/);
  assert.match(check,/data-import-commit(?![^>]*disabled)[^>]*>[\s\S]*导入 1 家 · 补全 2 家/);
  assert.match(commitLabel({importable:0,update:1}),/导入 0 家 · 补全 1 家/);
  assert.match(importPanelMarkup({step:'check',check:{summary:{importable:0,update:0,duplicate:1,error:0},rows:[]}}),/data-import-commit[^>]*disabled/);
  const done=importPanelMarkup({step:'done',result:{summary:{created:1,updated:1,skipped:0,failed:0},results:[{row:2,company_name:'Al Noor',status:'UPDATED',fills:['customer_grade'],warnings:[]}]}});
  assert.match(done,/已补全 1/);assert.match(done,/补全：客户分级/);
});

test('stage dialog: close date and customer confirmation are sent and checked like the server',()=>{
  const form=values=>({stage:{value:values.stage},lost_reason:{value:''},note:{value:''},revisit_date:{value:''},
    expected_close_date:{value:values.close||''},won_confirmation:{value:values.won||''},won_confirmation_note:{value:values.wonNote||''}});
  assert.equal(stageRequest(form({stage:'QUOTED'}),{stage:'REPLIED'}).problem,'CLOSE_DATE_REQUIRED');
  assert.equal(stageRequest(form({stage:'QUOTED'}),{stage:'REPLIED',deal_close_date:'2026-12-31'}).problem,null,'a saved close date is enough');
  const won=stageRequest(form({stage:'WON',won:'OTHER'}),{stage:'NEGOTIATING'});
  assert.equal(won.problem,'WON_CONFIRMATION_NOTE_REQUIRED');
  const ok=stageRequest(form({stage:'WON',won:'PO',close:'2026-12-01'}),{stage:'NEGOTIATING'});
  assert.equal(ok.problem,null);assert.equal(ok.body.won_confirmation,'PO');assert.equal(ok.body.expected_close_date,'2026-12-01');
  assert.equal(stageRequest(form({stage:'CONTACTED',won:'PO'}),{stage:'NEW'}).body.won_confirmation,undefined,'confirmation only goes with won');
  const html=stageGateFields({deal_close_date:'2026-12-31',won_confirmation:'DEPOSIT'});
  assert.match(html,/name="expected_close_date"[^>]*value="2026-12-31"/);assert.match(html,/value="DEPOSIT" selected/);assert.match(html,/data-tip=/);
});
