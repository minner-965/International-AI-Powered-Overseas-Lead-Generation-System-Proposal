// 导入客户 / Import companies from a spreadsheet (migration 080): upload -> column mapping ->
// check (errors, duplicates in the file, companies already in the directory) -> import.
// Each row goes through ManualCompanyService.create, so the same rules apply as adding one by hand:
// ownership, the category check, no duplicate domain, and contact address rules. Reused: exceljs
// and csv-parse (already dependencies), the company and market helpers in common.js.
import {parse as parseCsv} from 'csv-parse/sync';
import {COMPANY_TYPES,emailDomain,fail,ownerOf,parseWebsite} from './common.js';

export const IMPORT_MAX_ROWS=500;
export const IMPORT_MAX_BYTES=2*1024*1024;
export const IMPORT_FIELDS=Object.freeze(['company_name','website','market','company_type','contact_email','contact_name','job_title','notes']);
// Column titles people use in their own sheets (English and Chinese), lower-cased.
const HEADER_HINTS=Object.freeze({
  company_name:['company','company name','companyname','customer','customer name','name','公司','公司名称','客户','客户名称','企业','企业名称'],
  website:['website','web','site','url','domain','homepage','网址','网站','官网','域名'],
  market:['country','market','country/region','region','nation','国家','国家/地区','地区','市场'],
  company_type:['type','company type','business type','category','客户类型','公司类型','类型','企业类型'],
  contact_email:['email','e-mail','mail','email address','contact email','邮箱','电子邮箱','邮件','联系邮箱'],
  contact_name:['contact','contact name','contact person','person','name of contact','联系人','联系人姓名','姓名'],
  job_title:['title','job title','position','role','职位','职务','头衔'],
  notes:['notes','note','remark','remarks','comment','comments','memo','备注','说明']
});
const TYPE_HINTS=Object.freeze({
  IMPORTER:['importer','import','进口商','进口'],WHOLESALER:['wholesaler','wholesale','批发商','批发'],
  DISTRIBUTOR:['distributor','distribution','分销商','经销商','代理商'],RETAIL_CHAIN:['retail chain','chain','chain store','连锁','连锁零售'],
  DEPARTMENT_STORE:['department store','百货','百货公司','商场'],RETAILER:['retailer','retail','shop','store','零售商','零售','门店'],
  ONLINE_RETAILER:['online retailer','e-commerce','ecommerce','online shop','online store','电商','网店','跨境电商'],
  BRAND:['brand','品牌','品牌商'],OTHER:['other','其他']
});
const idOf=created=>created?.company?.company_id||created?.company?.id||created?.company_id||null;
const norm=value=>String(value??'').replace(/\s+/g,' ').trim();
const key=value=>norm(value).toLowerCase();

/** Text of a CSV upload: UTF-8 when valid, otherwise the GBK encoding Chinese Excel saves. */
function decodeText(buffer){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
  catch{return new TextDecoder('gbk').decode(buffer);}
}
function cellText(cell){
  const value=cell?.value;
  if(value===null||value===undefined)return'';
  if(typeof value==='object'){
    if(value.text!==undefined)return norm(value.text);                       // hyperlink
    if(value.richText)return norm(value.richText.map(part=>part.text).join(''));
    if(value.result!==undefined)return norm(value.result);                   // formula
    if(value instanceof Date)return value.toISOString().slice(0,10);
  }
  return norm(cell.text??value);
}

/** Rows of the first sheet (xlsx) or of a CSV file; the first row holds the column titles. */
export async function readSpreadsheet({file_name,content_base64}){
  const name=norm(file_name).slice(0,255);
  const extension=(name.match(/\.([a-z0-9]+)$/i)?.[1]||'').toLowerCase();
  if(!['csv','xlsx'].includes(extension))throw fail('IMPORT_FILE_TYPE','Upload an Excel (.xlsx) or CSV file',422,{field:'file'});
  const buffer=Buffer.from(String(content_base64||''),'base64');
  if(!buffer.length)throw fail('IMPORT_FILE_EMPTY','The file is empty',422,{field:'file'});
  if(buffer.length>IMPORT_MAX_BYTES)throw fail('IMPORT_FILE_TOO_LARGE','The file is larger than 2 MB',422,{field:'file'});
  let table;
  if(extension==='csv'){
    table=parseCsv(decodeText(buffer),{bom:true,skip_empty_lines:true,relax_column_count:true,relax_quotes:true,trim:true});
  }else{
    const ExcelJS=(await import('exceljs')).default;
    const workbook=new ExcelJS.Workbook();
    try{await workbook.xlsx.load(buffer);}catch{throw fail('IMPORT_FILE_UNREADABLE','The Excel file cannot be read; save it again as .xlsx',422,{field:'file'});}
    const sheet=workbook.worksheets[0];
    if(!sheet)throw fail('IMPORT_FILE_EMPTY','The workbook has no sheet',422,{field:'file'});
    table=[];
    sheet.eachRow({includeEmpty:false},row=>{const cells=[];for(let i=1;i<=row.cellCount;i++)cells.push(cellText(row.getCell(i)));table.push(cells);});
  }
  const rows=table.filter(row=>row.some(cell=>norm(cell)));
  if(rows.length<2)throw fail('IMPORT_FILE_EMPTY','The file needs a title row and at least one company',422,{field:'file'});
  const headers=rows[0].map((cell,index)=>norm(cell)||`Column ${index+1}`);
  const data=rows.slice(1).map(row=>headers.map((_,index)=>norm(row[index])));
  if(data.length>IMPORT_MAX_ROWS)throw fail('IMPORT_TOO_MANY_ROWS',`Import at most ${IMPORT_MAX_ROWS} companies at a time`,422,{field:'file'});
  return{file_name:name,headers,rows:data};
}

/** Best guess of which column feeds which field, from the column titles. */
export function suggestMapping(headers){
  const mapping={};const used=new Set();
  for(const field of IMPORT_FIELDS){
    const index=headers.findIndex((header,i)=>!used.has(i)&&HEADER_HINTS[field].includes(key(header)));
    const loose=index>=0?index:headers.findIndex((header,i)=>!used.has(i)&&HEADER_HINTS[field].some(hint=>hint.length>3&&key(header).includes(hint)));
    if(loose>=0){mapping[field]=loose;used.add(loose);}
  }
  return mapping;
}
export function companyTypeOf(value){
  const text=key(value);
  if(!text)return null;
  if(COMPANY_TYPES[text.toUpperCase().replace(/[\s-]+/g,'_')])return text.toUpperCase().replace(/[\s-]+/g,'_');
  for(const [type,hints] of Object.entries(TYPE_HINTS))if(hints.includes(text))return type;
  for(const [type,hints] of Object.entries(TYPE_HINTS))if(hints.some(hint=>hint.length>2&&text.includes(hint)))return type;
  return null;
}
// Short names people write instead of the official country name (only used for active markets).
const MARKET_ALIASES=Object.freeze({uae:'AE','u.a.e.':'AE','阿联酋':'AE','迪拜':'AE',dubai:'AE',usa:'US','u.s.a.':'US',us:'US',america:'US','美国':'US',
  uk:'GB','u.k.':'GB',britain:'GB','great britain':'GB',england:'GB','英国':'GB',ksa:'SA','沙特':'SA','沙特阿拉伯':'SA','韩国':'KR','south korea':'KR',
  '俄罗斯':'RU',russia:'RU','越南':'VN',vietnam:'VN','土耳其':'TR',turkey:'TR','türkiye':'TR','荷兰':'NL',holland:'NL','巴西':'BR','澳洲':'AU','澳大利亚':'AU','加拿大':'CA','新加坡':'SG'});
export function marketOf(value,markets){
  const text=key(value);
  if(!text)return null;
  const hit=markets.find(market=>[market.code,market.name_en,market.name_zh].filter(Boolean).some(name=>key(name)===text));
  if(hit)return hit.code;
  const alias=MARKET_ALIASES[text];
  return alias&&markets.some(market=>market.code===alias)?alias:null;
}

export class CompanyImportService{
  constructor({pool,companies}){Object.assign(this,{pool,companies});}

  async preview(body={},scope){
    const sheet=await readSpreadsheet(body);
    return{file_name:sheet.file_name,headers:sheet.headers,rows:sheet.rows,row_count:sheet.rows.length,
      suggested_mapping:suggestMapping(sheet.headers),fields:IMPORT_FIELDS,options:await this.companies.options(scope)};
  }

  /** Each row checked without writing anything: OK, a warning, or the reason it cannot be imported. */
  async check(body={},scope){
    const options=await this.companies.options(scope);
    const mapping=body.mapping||{};
    const rows=Array.isArray(body.rows)?body.rows.slice(0,IMPORT_MAX_ROWS):[];
    if(!rows.length)throw fail('IMPORT_NO_ROWS','There are no rows to import',422);
    for(const field of ['company_name','website'])if(!Number.isInteger(mapping[field]))throw fail('IMPORT_MAPPING_REQUIRED',`Choose the column for ${field}`,422,{field});
    const category=String(body.category_scope_id||'');
    if(!options.categories.some(item=>item.id===category))throw fail('IMPORT_CATEGORY_REQUIRED','Choose the product category for these companies',422,{field:'category_scope_id'});
    const defaultMarket=body.default_market_code?String(body.default_market_code).toUpperCase():null;
    const defaultType=body.default_company_type?String(body.default_company_type).toUpperCase():null;
    const cell=(row,field)=>Number.isInteger(mapping[field])?norm(row[mapping[field]]):'';
    const seenDomains=new Map(),seenEmails=new Map();
    const checked=rows.map((row,index)=>{
      const out={row:index+2,company_name:cell(row,'company_name'),status:'OK',reasons:[],warnings:[]};
      if(!out.company_name)out.reasons.push('COMPANY_NAME_MISSING');
      try{const site=parseWebsite(cell(row,'website'));out.website=site.website_url;out.domain=site.hostname;}catch{out.reasons.push('WEBSITE_INVALID');}
      out.market_code=marketOf(cell(row,'market'),options.markets)||(cell(row,'market')?null:defaultMarket);
      if(!out.market_code)out.reasons.push(cell(row,'market')?'MARKET_NOT_ACTIVE':'MARKET_MISSING');
      out.company_type=companyTypeOf(cell(row,'company_type'))||(cell(row,'company_type')?null:defaultType);
      if(!out.company_type)out.reasons.push(cell(row,'company_type')?'COMPANY_TYPE_UNKNOWN':'COMPANY_TYPE_MISSING');
      const email=cell(row,'contact_email').toLowerCase();
      if(email){
        if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))out.warnings.push('CONTACT_EMAIL_INVALID');
        // Only a mailbox on the company's own domain is added as a contact here; others are left out.
        else if(out.domain&&emailDomain(email)!==emailDomain(`x@${out.domain}`))out.warnings.push('CONTACT_NOT_ON_COMPANY_DOMAIN');
        else{out.contact={email,contact_kind:cell(row,'contact_name')?'PERSON':'GENERAL',person_name:cell(row,'contact_name')||null,job_title:cell(row,'job_title')||null};}
        if(seenEmails.has(email))out.warnings.push('EMAIL_REPEATED_IN_FILE');else seenEmails.set(email,out.row);
      }
      out.notes=cell(row,'notes').slice(0,2000)||null;
      if(out.domain){if(seenDomains.has(out.domain))out.reasons.push('DUPLICATE_IN_FILE');else seenDomains.set(out.domain,out.row);}
      return out;
    });
    const domains=checked.filter(row=>row.domain).map(row=>row.domain);
    const listed=new Set(domains.length?(await this.pool.query(`SELECT lower(normalized_domain) domain FROM leadgen.companies WHERE lower(normalized_domain)=ANY($1::text[])`,
      [[...domains,...domains.map(domain=>`www.${domain}`)]])).rows.map(row=>row.domain.replace(/^www\./,'')):[]);
    for(const row of checked){
      if(row.domain&&listed.has(row.domain))row.reasons.push('ALREADY_IN_DIRECTORY');
      row.status=row.reasons.length?(row.reasons.some(reason=>['DUPLICATE_IN_FILE','ALREADY_IN_DIRECTORY'].includes(reason))&&row.reasons.length===1?'DUPLICATE':'ERROR'):row.warnings.length?'WARNING':'OK';
    }
    const count=status=>checked.filter(row=>row.status===status).length;
    return{rows:checked,summary:{total:checked.length,ok:count('OK'),warning:count('WARNING'),duplicate:count('DUPLICATE'),error:count('ERROR'),
      importable:count('OK')+count('WARNING')},category_scope_id:category};
  }

  /** Imports the importable rows one by one and records the run. */
  async commit(body={},actor,scope){
    const checked=await this.check(body,scope);
    const results=[];let created=0,failed=0,skipped=0;
    for(const row of checked.rows){
      if(!['OK','WARNING'].includes(row.status)){skipped++;results.push({row:row.row,company_name:row.company_name,status:'SKIPPED',reason:row.reasons[0]});continue;}
      try{
        const company=await this.companies.create({company_name:row.company_name,website:row.website,market_code:row.market_code,company_type:row.company_type,
          category_scope_id:checked.category_scope_id,notes:row.notes,...(row.contact?{contact:row.contact}:{})},actor,scope);
        created++;results.push({row:row.row,company_name:row.company_name,status:'CREATED',company_id:idOf(company),warnings:row.warnings});
      }catch(error){
        // A contact the company rules refuse should not cost the company itself.
        if(row.contact&&/RECIPIENT|CONTACT|EMAIL|SOURCE_URL/.test(String(error.code))){
          try{
            const company=await this.companies.create({company_name:row.company_name,website:row.website,market_code:row.market_code,company_type:row.company_type,
              category_scope_id:checked.category_scope_id,notes:row.notes},actor,scope);
            created++;results.push({row:row.row,company_name:row.company_name,status:'CREATED',company_id:idOf(company),warnings:[...row.warnings,'CONTACT_NOT_ADDED']});
            continue;
          }catch(second){error=second;}
        }
        failed++;results.push({row:row.row,company_name:row.company_name,status:'FAILED',reason:String(error.code||'IMPORT_ROW_FAILED').slice(0,80)});
      }
    }
    const run=(await this.pool.query(`INSERT INTO leadgen.company_import_runs(merchant_id,file_name,row_count,created_count,skipped_count,failed_count,mapping,results,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING id,created_at`,
      [ownerOf(scope),norm(body.file_name||'import').slice(0,255)||'import',checked.rows.length,created,skipped,failed,
        JSON.stringify(body.mapping||{}),JSON.stringify(results),actor])).rows[0];
    return{run_id:run.id,created_at:run.created_at,summary:{total:checked.rows.length,created,skipped,failed},results};
  }

  async runs(scope){
    const owner=ownerOf(scope);
    return{items:(await this.pool.query(`SELECT id,file_name,row_count,created_count,skipped_count,failed_count,created_by,created_at
      FROM leadgen.company_import_runs WHERE merchant_id IS NOT DISTINCT FROM $1::uuid ORDER BY created_at DESC LIMIT 20`,[owner])).rows};
  }
}
