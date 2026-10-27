#!/usr/bin/env node
// Read-only old/new opportunity-pool comparison (plan C2). Loads the same snapshot OpportunityPoolService uses,
// runs the live v1_MC04 classifier and the proposed (unwired) v2_MC08 classifier for every company, and writes
// docs/plan/2026-10_POOL_COMPARISON.md. It opens a READ ONLY transaction and never writes to the database.
//   node scripts/compare-opportunity-pool.mjs [--database-url <url>] [--out <file>]
// Default database: postgresql://postgres@127.0.0.1:55432/live_copy (restored copy of live data).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {readOpportunityPoolSnapshot} from '../src/opportunityPool/OpportunityPoolService.js';
import {classifySnapshot} from '../src/opportunityPool/classifier.js';
import {classifySnapshotV2,OPPORTUNITY_POOL_V2_VERSION} from '../src/opportunityPool/classifierV2.js';

const here=path.dirname(fileURLToPath(import.meta.url));
export const BANDS=['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE'];
export const BAND_ZH={PRECISION:'精准',RELEVANT:'相关',GENERAL_RELEVANT:'泛相关',EXPLORATORY:'待研究',NOT_SUITABLE:'不合适'};
const ACTIVE=new Set(BANDS.slice(0,3));
const regionNames=new Intl.DisplayNames(['zh-CN'],{type:'region'});
const country=company=>{const code=String(company.country_code||'').toUpperCase();try{if(/^[A-Z]{2}$/.test(code))return regionNames.of(code);}catch{}return company.country_name||code||'未知';};
const cell=value=>String(value??'').replace(/\s+/g,' ').replace(/\|/g,'/').trim();
const clip=(value,max=110)=>{const text=cell(value);return text.length>max?`${text.slice(0,max)}…`:text;};

/** One plain-Chinese sentence explaining why the band changed. */
export function explainChange(oldRow,newRow){
  const changes=newRow.v2_changes||[];const weak=(newRow.v2_evidence?.weak_operating_signals||[]).length>0;
  const up=BANDS.indexOf(newRow.new_opportunity_pool_band)<BANDS.indexOf(oldRow.new_opportunity_pool_band);
  if(up&&changes.includes('RETAIL_CHAIN_BUYER_TYPE_BY_STORE_NETWORK_AND_CATEGORY'))return '连锁零售/百货：有门店网络和已批准类目证据，新规则承认"零售连锁"是有效买家类型。';
  if(up&&changes.includes('GENERAL_MERCHANDISE_DESCRIPTION_SUPPORTS_BROAD_SCOPE'))return '官网明确写了综合百货/家居日用经营，按"泛相关"进池。';
  if(changes.includes('BROAD_SIGNAL_WEAK_NAVIGATION_TERM_ONLY'))return '唯一的经营证据是网页导航里的泛词（如"locations""shop online""inventario"）或只是在说它的客户是零售店，新规则不再算它自己的经营证据。';
  if(changes.includes('BROAD_SIGNAL_WITHOUT_CATEGORY_EVIDENCE'))return '只有泛泛的经营信号（批发、门店、仓储、综合贸易等），找不到任何已批准类目（连衣裙、上衣、家居日用等）的商品证据，降为待研究。';
  if(!up&&weak)return '原来的买家类型证据只有导航泛词（如"locations""shop online""inventario"）或"供货给零售店"这类描述客户的话，去掉后买家类型证据不足，档位下降。';
  if(newRow.new_opportunity_pool_band==='GENERAL_RELEVANT'&&oldRow.new_opportunity_pool_band!=='GENERAL_RELEVANT'&&!up)return '买家类型证据只剩泛词，但仍有已批准类目和综合经营证据，按泛相关保留。';
  return up?'新规则下证据组合满足更高档位。':'新规则下证据组合不再满足原档位。';
}

/** Short quote of the evidence most relevant to the change, looked up by evidence id. */
export function keyEvidence(newRow,oldRow,textById){
  const pick=[...(newRow.v2_changes?.some(change=>change.startsWith('RETAIL_CHAIN'))?newRow.v2_evidence.store_network:[]),
    ...(newRow.v2_changes?.includes('GENERAL_MERCHANDISE_DESCRIPTION_SUPPORTS_BROAD_SCOPE')?newRow.v2_evidence.general_merchandise_description:[]),
    ...(newRow.v2_evidence?.weak_operating_signals||[]),...(newRow.evidence_references||[]),...(oldRow.company_type_basis?.evidence_references||[]),...(oldRow.evidence_references||[])];
  for(const reference of pick){const text=textById.get(reference.id);if(text)return `${reference.evidence_type||''}：“${clip(text,100)}”`;}
  return '（无可引用的原文证据）';
}

// Approved-category words (womenswear + general merchandise, EN/ES/PT/AR) used only to flag possibly recoverable downgrades.
export const APPROVED_CATEGORY_WORDS=/\b(?:women'?s (?:clothing|wear|fashion|apparel|wholesale)|ladies'? (?:wear|clothing|fashion)|womenswear|dresses|skirts?|blouses?|knitwear|outerwear|trousers|ropa de (?:mujer|dama)|vestidos|faldas|blusas|roupas? femininas?|vestidos|household (?:goods|products|items)|homewares?|home (?:&|and) living|kitchenware|art[ií]culos (?:para el|del) hogar|utilidades dom[eé]sticas)\b|ملابس نسائية|فساتين|أدوات منزلية/i;
const officialSource=new Set(['OFFICIAL','OFFICIAL_WEBSITE','OFFICIAL_DOCUMENT','OFFICIAL_CATALOG','OFFICIAL_STOREFRONT','REGISTRY']);
function categoryWordsInText(snapshot,companyId){
  return(snapshot.tables.company_verification_evidence||[]).find(row=>row.company_id===companyId&&officialSource.has(String(row.source_type||'').toUpperCase())&&APPROVED_CATEGORY_WORDS.test(row.evidence_text||''))||null;
}

export function buildComparison(snapshot){
  const companies=new Map((snapshot.tables.companies||[]).map(row=>[row.id,row]));
  const oldRows=new Map(classifySnapshot(snapshot).map(row=>[row.company_id,row]));
  const newRows=classifySnapshotV2(snapshot);
  const textById=new Map([...(snapshot.tables.prospect_category_observations||[]),...(snapshot.tables.company_verification_evidence||[])].map(row=>[row.id,row.evidence_text]));
  const counts={old:Object.fromEntries(BANDS.map(band=>[band,0])),new:Object.fromEntries(BANDS.map(band=>[band,0]))};
  const matrix=Object.fromEntries(BANDS.map(from=>[from,Object.fromEntries(BANDS.map(to=>[to,0]))]));
  const changed=[];
  for(const next of newRows){
    const prior=oldRows.get(next.company_id);const from=prior.new_opportunity_pool_band,to=next.new_opportunity_pool_band;
    counts.old[from]++;counts.new[to]++;matrix[from][to]++;
    if(from!==to){const company=companies.get(next.company_id);changed.push({company_id:next.company_id,company_name:company.company_name,country:country(company),from,to,
      reason:explainChange(prior,next),evidence:keyEvidence(next,prior,textById),codes:next.v2_changes,
      recoverable:BANDS.indexOf(to)>BANDS.indexOf(from)?categoryWordsInText(snapshot,next.company_id):null});}
  }
  changed.sort((a,b)=>BANDS.indexOf(a.from)-BANDS.indexOf(b.from)||BANDS.indexOf(a.to)-BANDS.indexOf(b.to)||String(a.company_name).localeCompare(String(b.company_name)));
  const retailBlocked=newRows.filter(row=>row.retail_chain_blocked_by_verification).map(row=>{const company=companies.get(row.company_id);
    return{company_name:company.company_name,country:country(company),verification_status:company.verification_status,band:row.new_opportunity_pool_band,
      evidence:keyEvidence({v2_changes:['RETAIL_CHAIN'],v2_evidence:row.v2_evidence},{},textById)};}).sort((a,b)=>String(a.company_name).localeCompare(String(b.company_name)));
  const withEvidence=new Set([...(snapshot.tables.prospect_category_observations||[]),...(snapshot.tables.company_verification_evidence||[])].map(row=>row.company_id));
  const unverified=[...companies.values()].filter(row=>String(row.verification_status||'').toUpperCase()==='REVIEW');
  const unverifiedNoEvidence=unverified.filter(row=>!withEvidence.has(row.id)).length;
  return{observed_at:snapshot.observed_at,total:newRows.length,counts,matrix,changed,retailBlocked,unverified:unverified.length,unverifiedNoEvidence,oldBandById:new Map([...oldRows].map(([id,row])=>[id,row.new_opportunity_pool_band]))};
}

/** Stored opportunity_pool_current band vs the v1 band recomputed now from the same snapshot. */
export function storedMismatch(result,storedRows){
  const mismatches=[];let missing=0;
  for(const [id,band] of result.oldBandById){const stored=storedRows.find(row=>row.company_id===id);if(!stored){missing++;continue;}if(stored.opportunity_pool_band!==band)mismatches.push({company_id:id,stored:stored.opportunity_pool_band,recomputed:band});}
  return{mismatches,missing};
}

export function renderMarkdown(result,{databaseLabel='live_copy',storedCounts=null,mismatch=null}={}){
  const active=side=>BANDS.filter(band=>ACTIVE.has(band)).reduce((sum,band)=>sum+result.counts[side][band],0);
  const lines=[];
  lines.push('# 机会池新旧规则对比（C2 收紧"泛相关"）','');
  lines.push(`生成时间：${result.observed_at}　数据：本机还原的线上数据副本（${databaseLabel}，只读）　企业数：${result.total}`,'');
  lines.push('> 这份对比只是"如果启用新规则会怎样"，**系统现在仍按旧规则运行**，没有改动任何企业的档位。你看完决定是否启用。','');
  lines.push('## 一、新规则改了什么','');
  lines.push('1. **"泛相关"必须有类目证据**：企业页面上至少有一条已批准类目（或它的上级类目）的商品证据，或者官网明确写了综合百货/家居日用经营。只有"批发""门店""仓储""综合贸易"这类泛泛经营信号的，降为"待研究"（不删除，补到类目证据后会自动回来）。');
  lines.push('2. **导航泛词不再算证据**：网页导航里常见的"locations / ubicaciones""shop online""inventario"单独出现时不再算经营证据，必须带数量（如"25 stores"）或明确上下文（如"our locations""nuestro inventario"）。');
  lines.push('3. **连锁零售、百货算有效买家**：有自营门店网络证据 + 已批准类目证据，就算有效买家类型（"供货给零售店"这种说的是客户，不算）。企业本身仍须先通过企业核验；因核验未通过而进不了池的零售连锁单独列在第五节，供决定 C1（核验加"零售连锁"类型）时参考。','');
  lines.push(`规则版本：旧 \`v1_MC04\` → 新 \`${OPPORTUNITY_POOL_V2_VERSION}\`（未启用）。`,'');
  lines.push('## 二、各档位数量','');
  lines.push('| 档位 | 旧规则 | 新规则 | 变化 |','|---|---:|---:|---:|');
  for(const band of BANDS){const delta=result.counts.new[band]-result.counts.old[band];lines.push(`| ${BAND_ZH[band]}（${band}） | ${result.counts.old[band]} | ${result.counts.new[band]} | ${delta>0?'+':''}${delta} |`);}
  const delta=active('new')-active('old');
  lines.push(`| **机会池合计（精准+相关+泛相关）** | **${active('old')}** | **${active('new')}** | **${delta>0?'+':''}${delta}** |`,'');
  if(storedCounts)lines.push(`参考：数据库里当前保存的机会池结果（上次刷新时写入）为 ${BANDS.map(band=>`${BAND_ZH[band]} ${storedCounts[band]||0}`).join('、')}。上表"旧规则"是用同一份数据现场重算的。`+(mismatch?`逐家核对：保存结果与现场重算不一致 ${mismatch.mismatches.length} 家${mismatch.missing?`，另有 ${mismatch.missing} 家还没有保存结果`:''}${mismatch.mismatches.length?'（上次刷新后证据又有更新，下次刷新会自动对齐）':'，说明旧规则结果可以复现'}。`:''),'');
  lines.push('## 三、档位流向（行 = 旧档位，列 = 新档位）','');
  lines.push(`| 旧 \\ 新 | ${BANDS.map(band=>BAND_ZH[band]).join(' | ')} |`,`|---|${BANDS.map(()=>'---:').join('|')}|`);
  for(const from of BANDS)lines.push(`| ${BAND_ZH[from]} | ${BANDS.map(to=>from===to?`${result.matrix[from][to]}`:result.matrix[from][to]?`**${result.matrix[from][to]}**`:'0').join(' | ')} |`);
  lines.push('','对角线是档位不变的企业，加粗的是会变化的企业。','');
  lines.push(`## 四、档位会变化的企业（共 ${result.changed.length} 家）`,'');
  if(!result.changed.length)lines.push('没有企业的档位发生变化。');
  else{lines.push('| # | 企业 | 国家 | 旧 → 新 | 原因 | 关键证据 | 可能补回 |','|---:|---|---|---|---|---|---|');
    result.changed.forEach((row,index)=>lines.push(`| ${index+1} | ${cell(row.company_name)} | ${cell(row.country)} | ${BAND_ZH[row.from]} → ${BAND_ZH[row.to]} | ${cell(row.reason)} | ${cell(row.evidence)} | ${row.recoverable?`是：官网写了“${clip(row.recoverable.evidence_text.match(APPROVED_CATEGORY_WORDS)?.[0],40)}”`:'—'} |`));}
  lines.push('');
  const recoverable=result.changed.filter(row=>row.recoverable);
  if(recoverable.length)lines.push(`"可能补回"＝官网文字里已经出现已批准类目的词（如女装、连衣裙、家居用品），但系统还没把它整理成类目证据。共 ${recoverable.length} 家：${recoverable.map(row=>cell(row.company_name)).join('、')}。这些更像"证据没整理好"而不是"不合适"，补齐类目证据（计划 C8 多语言类目词）后会自动回到机会池；如果你希望启用新规则前先补这一步，告诉我。`,'');
  lines.push(`## 五、零售连锁因企业核验未通过而未进池（共 ${result.retailBlocked.length} 家）`,'');
  if(!result.retailBlocked.length)lines.push(`这批数据里没有"有门店网络 + 已批准类目、但企业核验未通过"的零售连锁。原因是：${result.unverified} 家待核验企业里有 ${result.unverifiedNoEvidence} 家在系统里没有任何官网证据记录（核验没通过时，证据只记在研究候选上，没有挂到企业上），所以现在无法判断其中有多少是零售连锁。C1 把"零售连锁/百货"加进核验后，要等下一轮研究重新核验这些企业才能看到效果。`,'');
  else{lines.push('这些企业有自营门店网络和已批准类目证据，只因企业核验没有"零售连锁"这一类而停在待核验。C1 把"零售连锁/百货"加进核验后，它们重新核验通过就会进池。','','| # | 企业 | 国家 | 当前档位 | 门店网络证据 |','|---:|---|---|---|---|');
    result.retailBlocked.forEach((row,index)=>lines.push(`| ${index+1} | ${cell(row.company_name)} | ${cell(row.country)} | ${BAND_ZH[row.band]} | ${cell(row.evidence)} |`));lines.push('');}
  const down=result.changed.filter(row=>BANDS.indexOf(row.to)>BANDS.indexOf(row.from)).length;
  lines.push('## 六、需要你决定的','');
  lines.push(`- 新规则会让 ${down} 家企业降档、${result.changed.length-down} 家升档，机会池合计 ${active('old')} → ${active('new')} 家。`);
  lines.push('- 降为"待研究"的企业不会被删除，历史档位、证据、首封记录都保留；以后补到类目证据会自动回到机会池。');
  lines.push('- 同意启用后：规则版本升到 `v2_MC08`，机会池决策表照旧只追加新记录，旧记录不改。');
  lines.push('','---',`重新生成：\`cd services/demo-dashboard && node scripts/compare-opportunity-pool.mjs\`（只读）。`);
  return `${lines.join('\n')}\n`;
}

async function main(){
  const args=process.argv.slice(2);const arg=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:null;};
  const connectionString=arg('--database-url')||process.env.POOL_COMPARE_DATABASE_URL||'postgresql://postgres@127.0.0.1:55432/live_copy';
  const out=path.resolve(arg('--out')||path.join(here,'..','..','..','docs','plan','2026-10_POOL_COMPARISON.md'));
  // Forced read-only session: every statement in this connection is read-only even outside the explicit transaction.
  const client=new pg.Client({connectionString,options:'-c default_transaction_read_only=on'});await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const snapshot=await readOpportunityPoolSnapshot(client);
    const stored=(await client.query('SELECT company_id,opportunity_pool_band FROM leadgen.opportunity_pool_current')).rows;
    await client.query('ROLLBACK');
    const result=buildComparison(snapshot);
    const databaseLabel=new URL(connectionString).pathname.replace(/^\//,'')||'postgres';
    fs.mkdirSync(path.dirname(out),{recursive:true});
    const storedCounts={};for(const row of stored)storedCounts[row.opportunity_pool_band]=(storedCounts[row.opportunity_pool_band]||0)+1;
    const mismatch=storedMismatch(result,stored);
    fs.writeFileSync(out,renderMarkdown(result,{databaseLabel,storedCounts,mismatch}));
    console.log(JSON.stringify({out,total:result.total,old:result.counts.old,new:result.counts.new,changed:result.changed.length,retail_blocked:result.retailBlocked.length,stored_mismatch:mismatch.mismatches.length,stored_missing:mismatch.missing},null,1));
  }finally{await client.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
