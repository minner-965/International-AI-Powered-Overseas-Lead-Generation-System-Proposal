// 导入客户 / Import companies from a spreadsheet (migration 080): upload -> column mapping ->
// check (errors, duplicates in the file, companies already in the directory) -> import.
// Each row goes through ManualCompanyService.create, so the same rules apply as adding one by hand:
// ownership, the category check, no duplicate domain, and contact address rules. Reused: exceljs
// and csv-parse (already dependencies), the company and market helpers in common.js.
// Round two (2026-11-22): a row that matches a company this account can see (by its 编号 / ID from the
// export, or by website) fills only that company's empty fields (ManualCompanyService.fillMissing);
// the export below writes the same column titles, so an exported sheet can be edited and imported again.
import {parse as parseCsv} from 'csv-parse/sync';
import {COMPANY_TYPES,UUID,emailDomain,fail,ownerOf,parseWebsite} from './common.js';
import {companyScopeSql} from '../merchant/scope.js';

export const IMPORT_MAX_ROWS=500;
export const IMPORT_MAX_BYTES=2*1024*1024;
export const IMPORT_FIELDS=Object.freeze(['company_id','company_name','website','market','company_type','city','contact_email','contact_name','job_title','deal_amount','deal_currency','customer_grade','notes']);
/** Export columns (key, title). Titles are recognised again on import. 阶段 / Stage is for reading only. */
export const EXPORT_COLUMNS=Object.freeze([['company_id','编号 ID'],['company_name','公司名称 Company'],['website','官网 Website'],['country','国家 Country'],
  ['company_type','类型 Type'],['city','城市 City'],['contact_email','邮箱 Email'],['contact_name','联系人 Contact'],['job_title','职位 Job title'],
  ['stage','阶段 Stage'],['deal_amount','预计金额 Amount'],['deal_currency','币种 Currency'],['customer_grade','分级 Grade'],['notes','备注 Notes']]);
const EXPORT_TITLE=Object.fromEntries(EXPORT_COLUMNS.map(([field,title])=>[field==='country'?'market':field,title.toLowerCase()]));
// Column titles people use in their own sheets (English and Chinese), lower-cased.
const HEADER_HINTS=Object.freeze({
  company_id:['id','编号','企业编号','客户编号','company id','编号 id'],
  city:['city','town','城市'],
  deal_amount:['amount','deal amount','value','deal value','预计金额','金额','商机金额'],
  deal_currency:['currency','币种','货币'],
  customer_grade:['grade','level','customer grade','分级','客户分级','等级','客户等级'],
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
    const hints=[...HEADER_HINTS[field],...(EXPORT_TITLE[field]?[EXPORT_TITLE[field]]:[])];
    const index=headers.findIndex((header,i)=>!used.has(i)&&hints.includes(key(header)));
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

const CURRENCY_SIGNS=Object.freeze({'$':'USD','US$':'USD','€':'EUR','£':'GBP','¥':'CNY','￥':'CNY','RMB':'CNY'});
/** "USD 12,000", "$12,000.50", "12000" → {amount, currency}; amount null when not a number. */
export function moneyOf(amountText,currencyText=''){
  const raw=norm(amountText);
  let currency=norm(currencyText).toUpperCase();
  const upper=raw.toUpperCase();
  const code=upper.match(/^([A-Z]{3})\s*[\d.,]+$/)?.[1]||upper.match(/^[\d.,]+\s*([A-Z]{3})$/)?.[1];
  const sign=Object.keys(CURRENCY_SIGNS).sort((a,b)=>b.length-a.length).find(mark=>raw.toUpperCase().includes(mark));
  if(!currency)currency=code||(sign?CURRENCY_SIGNS[sign]:'');
  if(CURRENCY_SIGNS[currency])currency=CURRENCY_SIGNS[currency];
  const number=raw.replace(/[A-Za-z$€£¥￥\s,]/g,'');
  const amount=number&&/^\d+(\.\d+)?$/.test(number)?Number(number):null;
  return{amount,currency:/^[A-Z]{3}$/.test(currency)?currency:null};
}
const gradeOf=value=>{const text=norm(value).toUpperCase().replace(/级$|\s*LEVEL$/,'').trim();return['A','B','C','D'].includes(text)?text:null;};

const LEGAL_SUFFIXES=/\b(l\.?l\.?c|ltd|limited|inc|corp|corporation|co|company|gmbh|s\.?a|s\.?a\.?s|s\.?l|s\.?r\.?l|s\.?p\.?a|b\.?v|fze|fzco|fz|llp|plc|pty|pte|trading|est|group)\b\.?/g;
const namePrefix=name=>String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'').slice(0,3);
/** Company name compared without case, punctuation or legal suffixes ("Al Noor Trading LLC" = "AL-NOOR"). */
export function companyNameKey(name){
  return String(name||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' ')
    .replace(/[^\p{L}\p{N}\s.]/gu,' ').replace(LEGAL_SUFFIXES,' ').replace(/[.\s]+/g,'');
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
    // New companies need a name and a website; a sheet with the 编号 / ID column may only fill in existing ones.
    if(!Number.isInteger(mapping.company_id))for(const field of ['company_name','website'])if(!Number.isInteger(mapping[field]))throw fail('IMPORT_MAPPING_REQUIRED',`Choose the column for ${field}`,422,{field});
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
      out.company_ref=cell(row,'company_id')||null;
      out.city=cell(row,'city').slice(0,120)||null;
      if(cell(row,'deal_amount')){
        const money=moneyOf(cell(row,'deal_amount'),cell(row,'deal_currency'));
        if(money.amount===null||!money.currency)out.warnings.push(money.amount===null?'AMOUNT_INVALID':'CURRENCY_MISSING');
        else{out.deal_amount=money.amount;out.deal_currency=money.currency;}
      }
      if(cell(row,'customer_grade')){out.customer_grade=gradeOf(cell(row,'customer_grade'));if(!out.customer_grade)out.warnings.push('GRADE_INVALID');}
      if(out.domain){if(seenDomains.has(out.domain))out.reasons.push('DUPLICATE_IN_FILE');else seenDomains.set(out.domain,out.row);}
      return out;
    });
    const domains=checked.filter(row=>row.domain).map(row=>row.domain);
    const listed=new Set(domains.length?(await this.pool.query(`SELECT lower(normalized_domain) domain FROM leadgen.companies WHERE lower(normalized_domain)=ANY($1::text[])`,
      [[...domains,...domains.map(domain=>`www.${domain}`)]])).rows.map(row=>row.domain.replace(/^www\./,'')):[]);
    // Same company name (legal suffixes and punctuation ignored) in the same country under another website: a warning, not a block.
    const named=checked.filter(row=>row.company_name&&row.market_code&&companyNameKey(row.company_name).length>=3);
    const similar=new Set(named.length?(await this.pool.query(`SELECT company_name,country_code FROM leadgen.companies
        WHERE country_code=ANY($1::text[]) AND left(regexp_replace(lower(company_name),'[^a-z0-9]','','g'),3)=ANY($2::text[]) AND NOT(lower(coalesce(normalized_domain,''))=ANY($3::text[]))`,
      [[...new Set(named.map(row=>row.market_code))],[...new Set(named.map(row=>namePrefix(row.company_name)))],domains])).rows
      .map(row=>`${row.country_code}|${companyNameKey(row.company_name)}`):[]);
    const matches=await this.matchExisting(checked,scope);
    for(const row of checked){
      const match=matches.get(row.row);
      if(match){this.fillPlan(row,match);continue;}
      if(row.company_ref){row.reasons=['COMPANY_ID_UNKNOWN'];row.status='ERROR';continue;}
      if(row.domain&&listed.has(row.domain))row.reasons.push('ALREADY_IN_DIRECTORY');
      else if(row.market_code&&similar.has(`${row.market_code}|${companyNameKey(row.company_name)}`))row.warnings.push('SIMILAR_NAME_IN_DIRECTORY');
      row.status=row.reasons.length?(row.reasons.some(reason=>['DUPLICATE_IN_FILE','ALREADY_IN_DIRECTORY'].includes(reason))&&row.reasons.length===1?'DUPLICATE':'ERROR'):row.warnings.length?'WARNING':'OK';
    }
    const count=status=>checked.filter(row=>row.status===status).length;
    return{rows:checked,summary:{total:checked.length,ok:count('OK'),warning:count('WARNING'),duplicate:count('DUPLICATE'),error:count('ERROR'),
      update:count('UPDATE'),importable:count('OK')+count('WARNING')},category_scope_id:category};
  }

  /**
   * Existing companies this account can see, matched by 编号 / ID (wins) or by website. A merchant only ever
   * matches its own companies, so nothing about another owner's records is revealed.
   * Returns Map(row number -> {id, normalized_domain, city, company_type, emails:Set, deal_amount, customer_grade, won}).
   */
  async matchExisting(rows,scope){
    const ids=[...new Set(rows.map(row=>row.company_ref).filter(ref=>UUID.test(ref||'')))];
    const domains=[...new Set(rows.filter(row=>!row.company_ref&&row.domain).map(row=>row.domain))];
    if(!ids.length&&!domains.length)return new Map();
    const owner=ownerOf(scope);
    const params=[ids,[...domains,...domains.map(domain=>`www.${domain}`)],owner];
    const visible=companyScopeSql(scope,'c',params);
    const found=(await this.pool.query(`SELECT c.id::text id,lower(c.normalized_domain) domain,c.normalized_domain,c.city,c.company_type,
        coalesce((SELECT array_agg(lower(dc.contact_value_normalized)) FROM leadgen.decision_maker_contacts dc WHERE dc.company_id=c.id),'{}') emails,
        d.deal_amount,d.customer_grade,
        coalesce((SELECT st.stage FROM leadgen.manual_company_stage_events st WHERE st.company_id=c.id AND st.merchant_id IS NOT DISTINCT FROM $3::uuid ORDER BY st.changed_at DESC,st.id DESC LIMIT 1)='WON',false)
          OR EXISTS(SELECT 1 FROM leadgen.opportunity_crm_states o WHERE o.company_id=c.id AND o.merchant_id IS NOT DISTINCT FROM $3::uuid AND o.pipeline_stage='WON') won
      FROM leadgen.companies c
      LEFT JOIN leadgen.crm_deal_profiles d ON d.company_id=c.id AND d.merchant_id IS NOT DISTINCT FROM $3::uuid
      WHERE (c.id=ANY($1::uuid[]) OR lower(c.normalized_domain)=ANY($2::text[])) AND ${visible}`,params)).rows;
    const byId=new Map(found.map(row=>[row.id,row]));
    const byDomain=new Map(found.map(row=>[String(row.domain||'').replace(/^www\./,''),row]));
    const out=new Map();
    for(const row of rows){
      const hit=row.company_ref?byId.get(String(row.company_ref).toLowerCase()):row.domain?byDomain.get(row.domain):null;
      if(hit)out.set(row.row,{...hit,emails:new Set(hit.emails||[])});
    }
    return out;
  }

  /** Which empty fields this row would fill; UPDATE when any, otherwise a duplicate. */
  fillPlan(row,match){
    row.company_id=match.id;
    // Creation checks do not apply to an existing company; a repeat of the same company in the file still does.
    const repeated=row.reasons.includes('DUPLICATE_IN_FILE');
    row.reasons=[];
    const fills=[];
    if(row.city&&!match.city)fills.push('city');
    if(row.company_type&&!match.company_type)fills.push('company_type');
    if(row.contact){
      if(match.normalized_domain&&emailDomain(row.contact.email)!==emailDomain(`x@${match.normalized_domain}`)){row.warnings.push('CONTACT_NOT_ON_COMPANY_DOMAIN');delete row.contact;}
      else if(!match.emails.has(row.contact.email))fills.push('contact');
    }
    const dealWanted=row.deal_amount!==undefined||row.customer_grade;
    if(dealWanted&&match.won)row.warnings.push('DEAL_WON_NOT_CHANGED');
    else{
      if(row.deal_amount!==undefined&&(match.deal_amount===null||match.deal_amount===undefined))fills.push('deal_amount');
      if(row.customer_grade&&!match.customer_grade)fills.push('customer_grade');
    }
    row.fills=fills;
    row.warnings=row.warnings.filter(code=>code!=='SIMILAR_NAME_IN_DIRECTORY');
    if(repeated){row.reasons=['DUPLICATE_IN_FILE'];row.status='DUPLICATE';return;}
    if(fills.length){row.status='UPDATE';return;}
    row.reasons=['ALREADY_IN_DIRECTORY'];row.status='DUPLICATE';
  }

  /** Imports the importable rows one by one and records the run. */
  async commit(body={},actor,scope){
    const checked=await this.check(body,scope);
    const results=[];let created=0,failed=0,skipped=0,updated=0;
    const extras=row=>({city:row.city||undefined,deal_amount:row.deal_amount,deal_currency:row.deal_currency,customer_grade:row.customer_grade||undefined});
    for(const row of checked.rows){
      if(row.status==='UPDATE'){
        try{
          const fill=await this.companies.fillMissing(row.company_id,{...extras(row),company_type:row.company_type||undefined,contact:row.fills.includes('contact')?row.contact:undefined},actor,scope);
          if(fill.filled.length){updated++;results.push({row:row.row,company_name:row.company_name,status:'UPDATED',company_id:row.company_id,fills:fill.filled,warnings:[...row.warnings,...fill.skipped.map(item=>item.reason)]});}
          else{skipped++;results.push({row:row.row,company_name:row.company_name,status:'SKIPPED',reason:'NOTHING_TO_FILL'});}
        }catch(error){failed++;results.push({row:row.row,company_name:row.company_name,status:'FAILED',reason:String(error.code||'IMPORT_ROW_FAILED').slice(0,80)});}
        continue;
      }
      if(!['OK','WARNING'].includes(row.status)){skipped++;results.push({row:row.row,company_name:row.company_name,status:'SKIPPED',reason:row.reasons[0]});continue;}
      try{
        const company=await this.companies.create({company_name:row.company_name,website:row.website,market_code:row.market_code,company_type:row.company_type,
          category_scope_id:checked.category_scope_id,notes:row.notes,...(row.contact?{contact:row.contact}:{})},actor,scope);
        created++;results.push({row:row.row,company_name:row.company_name,status:'CREATED',company_id:idOf(company),warnings:row.warnings,fills:await this.newCompanyExtras(idOf(company),extras(row),actor,scope)});
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
    return{run_id:run.id,created_at:run.created_at,summary:{total:checked.rows.length,created,updated,skipped,failed},results};
  }

  /** City, deal amount and grade from the sheet for a company just created (same fill rules). */
  async newCompanyExtras(companyId,extras,actor,scope){
    if(!companyId||!Object.values(extras).some(value=>value!==undefined&&value!==null))return[];
    try{return(await this.companies.fillMissing(companyId,extras,actor,scope)).filled;}catch{return[];}
  }

  /** The export as an .xlsx buffer: every manual company this account can see, in EXPORT_COLUMNS order. */
  async exportWorkbook(scope,today=new Date()){
    const rows=await this.companies.exportRows(scope);
    const ExcelJS=(await import('exceljs')).default;
    const workbook=new ExcelJS.Workbook();
    workbook.creator='SIM Overseas Prospecting';workbook.created=today;
    const sheet=workbook.addWorksheet('客户 Companies');
    sheet.columns=EXPORT_COLUMNS.map(([field,title])=>({header:title,key:field,width:field==='company_id'?38:field==='notes'?40:18}));
    for(const row of rows)sheet.addRow(row);
    sheet.getRow(1).font={bold:true};
    sheet.views=[{state:'frozen',ySplit:1}];
    const date=today.toISOString().slice(0,10);
    return{buffer:Buffer.from(await workbook.xlsx.writeBuffer()),file_name:`companies-${date}.xlsx`,count:rows.length};
  }

  async runs(scope){
    const owner=ownerOf(scope);
    return{items:(await this.pool.query(`SELECT id,file_name,row_count,created_count,skipped_count,failed_count,created_by,created_at
      FROM leadgen.company_import_runs WHERE merchant_id IS NOT DISTINCT FROM $1::uuid ORDER BY created_at DESC LIMIT 20`,[owner])).rows};
  }
}
