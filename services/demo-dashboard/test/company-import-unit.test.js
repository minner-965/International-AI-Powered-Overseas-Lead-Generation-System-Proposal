// Spreadsheet import of companies: reading files and matching columns and values. No database.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {companyNameKey,companyTypeOf,marketOf,readSpreadsheet,suggestMapping,IMPORT_MAX_ROWS} from '../src/companies/importWizard.js';

const b64=value=>Buffer.from(value).toString('base64');
const markets=[{code:'AE',name_en:'United Arab Emirates',name_zh:'阿拉伯联合酋长国'},{code:'MX',name_en:'Mexico',name_zh:'墨西哥'}];

test('column titles in English or Chinese map to the right fields',()=>{
  assert.deepEqual(suggestMapping(['公司名称','官网','国家','客户类型','邮箱','联系人','职位','备注']),
    {company_name:0,website:1,market:2,company_type:3,contact_email:4,contact_name:5,job_title:6,notes:7});
  assert.deepEqual(suggestMapping(['Company Name','Website','Country','Email address','Remarks']),{company_name:0,website:1,market:2,contact_email:3,notes:4});
  assert.deepEqual(suggestMapping(['Foo','Bar']),{});
});

test('company types and countries are matched in English, Chinese or as codes',()=>{
  assert.equal(companyTypeOf('Importer'),'IMPORTER');assert.equal(companyTypeOf('批发商'),'WHOLESALER');assert.equal(companyTypeOf('retail chain'),'RETAIL_CHAIN');
  assert.equal(companyTypeOf('跨境电商'),'ONLINE_RETAILER');assert.equal(companyTypeOf('ONLINE_RETAILER'),'ONLINE_RETAILER');assert.equal(companyTypeOf('banana'),null);
  assert.equal(marketOf('ae',markets),'AE');assert.equal(marketOf('墨西哥',markets),'MX');assert.equal(marketOf('united arab emirates',markets),'AE');assert.equal(marketOf('Peru',markets),null);
  assert.equal(marketOf('阿联酋',markets),'AE');assert.equal(marketOf('UAE',markets),'AE');assert.equal(marketOf('美国',markets),null,'an alias only counts for an active market');
});

test('CSV in UTF-8 (with BOM) and in GBK from Chinese Excel are both read',async()=>{
  const utf8=await readSpreadsheet({file_name:'list.csv',content_base64:b64('﻿Company,Website\nAl Noor LLC,alnoor.example\n,\n')});
  assert.deepEqual(utf8.headers,['Company','Website']);assert.deepEqual(utf8.rows,[['Al Noor LLC','alnoor.example']]);
  const gbk=Buffer.from('b9abcbbec3fbb3c62cb9d9cdf80a416c204e6f6f722c616c6e6f6f722e6578616d706c650a','hex'); // "公司名称,官网\nAl Noor,alnoor.example\n" in GBK
  const read=await readSpreadsheet({file_name:'客户.csv',content_base64:gbk.toString('base64')});
  assert.deepEqual(read.headers,['公司名称','官网']);assert.deepEqual(read.rows[0],['Al Noor','alnoor.example']);
});

test('the first sheet of an .xlsx file is read, links and formulas as text',async()=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('客户');
  sheet.addRow(['公司名称','官网','国家']);
  sheet.addRow(['Casa Moda SA',{text:'casamoda.example',hyperlink:'https://casamoda.example'},'墨西哥']);
  sheet.addRow(['Total',{formula:'1+1',result:2},'']);
  const buffer=await workbook.xlsx.writeBuffer();
  const read=await readSpreadsheet({file_name:'客户.xlsx',content_base64:Buffer.from(buffer).toString('base64')});
  assert.deepEqual(read.rows,[['Casa Moda SA','casamoda.example','墨西哥'],['Total','2','']]);
});

test('wrong type, empty file, too many rows and unreadable Excel are refused with a reason',async()=>{
  await assert.rejects(readSpreadsheet({file_name:'a.pdf',content_base64:b64('x')}),{code:'IMPORT_FILE_TYPE'});
  await assert.rejects(readSpreadsheet({file_name:'a.csv',content_base64:''}),{code:'IMPORT_FILE_EMPTY'});
  await assert.rejects(readSpreadsheet({file_name:'a.csv',content_base64:b64('Company\n')}),{code:'IMPORT_FILE_EMPTY'});
  const many='Company,Website\n'+Array.from({length:IMPORT_MAX_ROWS+1},(_,i)=>`C${i},c${i}.example`).join('\n');
  await assert.rejects(readSpreadsheet({file_name:'a.csv',content_base64:b64(many)}),{code:'IMPORT_TOO_MANY_ROWS'});
  await assert.rejects(readSpreadsheet({file_name:'a.xlsx',content_base64:b64('not a workbook')}),{code:'IMPORT_FILE_UNREADABLE'});
});

test('company names compare without case, punctuation, accents or legal suffixes',()=>{
  assert.equal(companyNameKey('Al Noor Trading LLC'),companyNameKey('AL-NOOR'));
  assert.equal(companyNameKey('Café Moda S.A.'),companyNameKey('cafe moda'));
  assert.equal(companyNameKey('Bella & Co. Ltd'),'bella');
  assert.notEqual(companyNameKey('Bella Donna'),companyNameKey('Bella'));
});
