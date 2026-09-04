import {createHash} from 'node:crypto';

const upper=value=>String(value??'').trim().toUpperCase();
const clean=value=>String(value??'').replace(/\s+/g,' ').trim().slice(0,390);
const quote=value=>`"${String(value??'').replaceAll('"','').trim()}"`;
const sha=value=>createHash('sha256').update(String(value)).digest('hex');

export const MEXICO_BUYER_ROLE_TERMS=Object.freeze([
  'Comprador','Compradora','Gerente de Compras','Director de Compras','Jefe de Compras',
  'Abastecimiento','Gerente de Categoría','Importaciones','Sourcing'
]);

export const AUTO_EVIDENCE_STRATEGIES=Object.freeze([
  {code:'S01_OFFICIAL_CATEGORY',version:'phase10-wp09-v1',source_class:'OFFICIAL_SITE',target:'CATEGORY',
    blockers:['CATEGORY_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S02_OFFICIAL_ASSORTMENT',version:'phase10-wp09-v1',source_class:'OFFICIAL_SITE',target:'CATEGORY',
    blockers:['CATEGORY_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S03_OFFICIAL_SUPPLIER_ROUTE',version:'phase10-wp09-v1',source_class:'OFFICIAL_SITE',target:'ADAPTIVE',
    blockers:['BUYER_MODEL_EVIDENCE','NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','DECISION_REFRESH','EVIDENCE_REQUIRED']},
  {code:'S04_OFFICIAL_LEADERSHIP',version:'phase10-wp09-v1',source_class:'OFFICIAL_SITE',target:'CONTACT',
    blockers:['NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S05_OFFICIAL_PRESS_PDF',version:'phase10-wp09-v1',source_class:'OFFICIAL_DOCUMENT',target:'ADAPTIVE',
    blockers:['CATEGORY_EVIDENCE','BUYER_MODEL_EVIDENCE','NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S06_LOCAL_LANGUAGE_ROLES',version:'phase10-wp09-v1',source_class:'PUBLIC_WEB',target:'CONTACT',
    blockers:['NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S07_INDUSTRY_DIRECTORY',version:'phase10-wp09-v1',source_class:'PUBLIC_DIRECTORY',target:'ADAPTIVE',
    blockers:['BUYER_MODEL_EVIDENCE','NAMED_BUYER_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S08_PUBLIC_PRO_REFERENCE',version:'phase10-wp09-v1',source_class:'PUBLIC_PRO_REFERENCE',target:'CONTACT',
    blockers:['NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S09_PERSON_CORROBORATION',version:'phase10-wp09-v1',source_class:'PUBLIC_CORROBORATION',target:'CONTACT',requires_candidate:true,
    blockers:['NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','EVIDENCE_REQUIRED']},
  {code:'S10_ALTERNATIVE_OFFICIAL_ROUTE',version:'phase10-wp09-v1',source_class:'OFFICIAL_SITE',target:'CONTACT',
    blockers:['NAMED_BUYER_EVIDENCE','VERIFIED_EMAIL_EVIDENCE','DECISION_REFRESH','EVIDENCE_REQUIRED']}
]);

const byCode=new Map(AUTO_EVIDENCE_STRATEGIES.map(item=>[item.code,item]));

export function eligibleStrategies(task={}){
  const blocker=upper(task.business_blocker||'EVIDENCE_REQUIRED');
  const hasCandidate=Number(task.named_buyer_candidate_count||0)>0;
  return AUTO_EVIDENCE_STRATEGIES.filter(item=>item.blockers.includes(blocker)&&(!item.requires_candidate||hasCandidate));
}

export function strategyStartStage(strategy,task={}){
  const row=typeof strategy==='string'?byCode.get(strategy):strategy;
  if(!row)return null;
  if(row.target==='CATEGORY')return'DISCOVERING_SOURCES';
  if(row.target==='ADAPTIVE'&&['CATEGORY_EVIDENCE','BUYER_MODEL_EVIDENCE'].includes(upper(task.business_blocker)))return'DISCOVERING_SOURCES';
  return'FINDING_BUYER';
}

export function strategyNextStage(strategyCode,stage,task={}){
  const start=strategyStartStage(strategyCode,task);
  const category={DISCOVERING_SOURCES:'NORMALIZING_CATEGORY',NORMALIZING_CATEGORY:'VALIDATING_EVIDENCE',VALIDATING_EVIDENCE:'REFRESHING_DECISION',REFRESHING_DECISION:null};
  const contact={FINDING_BUYER:'VERIFYING_EMAIL',VERIFYING_EMAIL:'REFRESHING_DECISION',REFRESHING_DECISION:null};
  return(start==='DISCOVERING_SOURCES'?category:contact)[stage]??null;
}

export function buildStrategyQuery(strategyCode,task={}){
  const strategy=byCode.get(upper(strategyCode));
  if(!strategy)return null;
  const name=clean(task.company_name||'');
  const domain=clean(task.official_root_domain||task.normalized_domain||'').toLowerCase();
  const country=upper(task.country_code||task.market);
  const category=upper(task.target_category_code||task.target_category
    ||String(task.target_category_scope_key||'').replace(/^CATEGORY:/i,'')
    ||task.product_profile).replaceAll('_',' ').toLowerCase();
  const subject=domain?`site:${domain}`:quote(name);
  const mxRoles=MEXICO_BUYER_ROLE_TERMS.map(quote).join(' OR ');
  const aeRoles=['buyer','procurement manager','purchasing manager','category manager','sourcing manager','مدير المشتريات','مسؤول المشتريات'].map(quote).join(' OR ');
  const roles=country==='MX'?mxRoles:aeRoles;
  const locale=country==='MX'?'es-MX':country==='AE'?'en-ar-AE':'en';
  const candidate=clean(task.candidate_buyer_name||'');
  const queryByCode={
    S01_OFFICIAL_CATEGORY:`${subject} (${quote(category)} OR category OR products OR marcas)`,
    S02_OFFICIAL_ASSORTMENT:`${subject} (collection OR assortment OR department OR catalog OR catálogo) ${quote(category)}`,
    S03_OFFICIAL_SUPPLIER_ROUTE:`${subject} (supplier OR vendor OR procurement OR tender OR registration OR proveedores OR compras)`,
    S04_OFFICIAL_LEADERSHIP:`${subject} (team OR leadership OR management OR equipo OR dirección) (${roles})`,
    S05_OFFICIAL_PRESS_PDF:`${subject} (press OR news OR annual report OR informe OR filetype:pdf) (${quote('procurement')} OR ${quote('compras')} OR ${quote(category)})`,
    S06_LOCAL_LANGUAGE_ROLES:`${quote(name)} (${roles})`,
    S07_INDUSTRY_DIRECTORY:`${quote(name)} (${quote('industry directory')} OR association OR exhibitor OR exposición OR directorio) ${quote(category)}`,
    S08_PUBLIC_PRO_REFERENCE:`site:linkedin.com/in ${quote(name)} (${roles})`,
    S09_PERSON_CORROBORATION:`${quote(candidate)} ${quote(name)} (${roles})`,
    S10_ALTERNATIVE_OFFICIAL_ROUTE:`${subject} (${quote('buying department')} OR ${quote('department email')} OR contact OR supplier portal OR teléfono OR formulario)`
  };
  const queryText=clean(queryByCode[strategy.code]);
  if(!category||!queryText||queryText.includes('""')||(strategy.requires_candidate&&!candidate))return null;
  return Object.freeze({...strategy,locale,query_text:queryText,query_type:`auto_${strategy.code.toLowerCase()}`,
    query_fingerprint:sha(queryText.toLowerCase())});
}

export function selectNextUnusedStrategy(task={},usedCodes=[],usedFingerprints=[]){
  const codes=new Set((usedCodes||[]).map(upper));
  const fingerprints=new Set((usedFingerprints||[]).map(value=>String(value||'').toLowerCase()));
  let duplicate_prevented_count=0;
  for(const strategy of eligibleStrategies(task)){
    if(codes.has(strategy.code))continue;
    const query=buildStrategyQuery(strategy.code,task);
    if(query&&fingerprints.has(query.query_fingerprint)){duplicate_prevented_count+=1;continue;}
    if(query)return {strategy:query,duplicate_prevented_count};
  }
  return {strategy:null,duplicate_prevented_count};
}

export function nextUnusedStrategy(task={},usedCodes=[],usedFingerprints=[]){
  return selectNextUnusedStrategy(task,usedCodes,usedFingerprints).strategy;
}
