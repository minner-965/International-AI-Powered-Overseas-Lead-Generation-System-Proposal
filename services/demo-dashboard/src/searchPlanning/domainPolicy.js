const matches=(host,domain)=>host===domain||host.endsWith(`.${domain}`);
export function evaluateDomainPolicy(value,{config,verifiedOfficialDomain=null,pageRole=null,sourceKind=null}={}){
  const policy=config?.domainPolicy||config;
  if(!policy?.version)throw new Error('DOMAIN_POLICY_CONFIG_REQUIRED');
  let host;
  try{
    const url=new URL(String(value).includes('://')?String(value):`https://${value}`);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid URL');
    host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(!host||!host.includes('.'))throw new Error('Invalid host');
  }catch{return {action:'BLOCK',keep:false,reason:'INVALID_WEB_DOMAIN',domain:null,policy_version:policy.version,identity_evidence:false,hint_only:true};}
  const blocked=(policy.block_domains||[]).find(domain=>matches(host,domain));
  const deprived=(policy.deprioritize_domains||[]).find(domain=>matches(host,domain));
  const official=String(verifiedOfficialDomain||'').trim().toLowerCase().replace(/\.$/,'');
  const knownOfficial=official&&matches(host,official);
  const classifiedKind=String(sourceKind||'').toUpperCase();
  const blockedKind=(policy.block_source_kinds||[]).includes(classifiedKind);
  const thirdParty=(policy.deprioritize_source_kinds||[]).includes(classifiedKind);
  const action=blocked||blockedKind?'BLOCK':deprived||thirdParty?'DEPRIORITIZE':knownOfficial?'PRIORITIZE':policy.default_action;
  return {action,keep:action!=='BLOCK',domain:host,policy_version:policy.version,
    reason:blocked?'BLOCKED_PLATFORM':blockedKind?'CLASSIFIED_AGGREGATOR_SPAM':deprived||thirdParty?'THIRD_PARTY_DISCOVERY_HINT':knownOfficial?
      (policy.priority_page_roles?.includes(String(pageRole||'').toUpperCase())?'OFFICIAL_COMPANY_PAGE':'OFFICIAL_DOMAIN'):
      policy.default_reason,
    matched_rule:blocked||deprived||null,identity_evidence:false,hint_only:!knownOfficial};
}
