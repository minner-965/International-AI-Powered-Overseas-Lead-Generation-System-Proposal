import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parse} from 'csv-parse/sync';
import {OUTREACH_EXPORT_LABELS} from '../src/dataExchange/exportPolicy.js';

// Creates export jobs only. Never creates drafts, approvals, messages or provider calls.
const base=process.env.DPV_ACCEPTANCE_BASE_URL||'http://localhost:3000';
const workbench=await fetch(`${base}/api/outreach/workbench`).then(r=>r.json());
const sent=workbench.items.find(row=>row.sent_at);
assert.ok(sent,'A persisted prospect send is required for this export check');
const results=[];
for(const format of ['CSV','XLSX']){
  const response=await fetch(`${base}/api/data-exports`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    export_type:'SALES_OPPORTUNITY',format,mode:'SELECTED_ROWS',selected_entity_ids:[sent.company_id],columns:Object.keys(OUTREACH_EXPORT_LABELS)
  })});
  assert.equal(response.status,202);
  const created=await response.json();
  let job=created.job;
  for(let poll=0;poll<40&&job.export_status==='PROCESSING';poll++){
    await new Promise(resolve=>setTimeout(resolve,500));
    job=await fetch(`${base}/api/data-exports/${job.id}`).then(r=>r.json());
  }
  assert.equal(job.export_status,'READY');
  const download=await fetch(`${base}/api/data-exports/${job.id}/download?token=${encodeURIComponent(created.download_token)}`);
  assert.equal(download.status,200);
  const bytes=Buffer.from(await download.arrayBuffer());
  let table;
  if(format==='CSV')table=parse(bytes.toString('utf8'),{bom:true});
  else{
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
    table=[];workbook.worksheets[0].eachRow(row=>table.push(row.values.slice(1)));
  }
  assert.deepEqual(table[0],Object.values(OUTREACH_EXPORT_LABELS));
  assert.equal(table.length,2);assert.equal(table[1].length,18);
  assert.match(String(table[1][9]),/已发送，未回复/);
  assert.match(String(table[1][10]),/Mail server accepted/);
  assert.match(String(table[1][11]),/Receipt not confirmed/);
  assert.doesNotMatch(JSON.stringify(table),/qq\.com|raw MIME|SMTP_PASSWORD|IMAP_PASSWORD|Authorization/i);
  results.push({format,export_id:job.id,status:job.export_status,rows:job.row_count,columns:18,bytes:bytes.length});
}
console.log(JSON.stringify({status:'PASS',results},null,2));
