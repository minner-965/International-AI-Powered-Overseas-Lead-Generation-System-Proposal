const count = value => Math.max(0,Number(value)||0);

function emptyProjection(researchJobId,companyId=null) {
  return {
    research_job_id:researchJobId,company_id:companyId,
    provider_call_count:0,provider_completed_count:0,provider_not_found_count:0,
    provider_temporary_error_count:0,provider_failed_count:0,
    reserved_units:0,used_units:0,released_units:0,
    last_provider_event_at:null,projection_updated_at:null
  };
}

export function aggregateProviderUsage(events,{byCompany=false}={}) {
  const projections=new Map();const fingerprints=new Set();
  for(const event of Array.isArray(events)?events:[]){
    const jobId=String(event.research_job_id||'');
    const companyId=event.company_id==null?null:String(event.company_id);
    if(!jobId||(byCompany&&!companyId))continue;
    const fingerprint=`${String(event.provider||'')}:${String(event.request_fingerprint||event.id||'')}`;
    if(fingerprints.has(fingerprint))continue;
    fingerprints.add(fingerprint);
    const key=byCompany?`${jobId}:${companyId}`:jobId;
    const row=projections.get(key)||emptyProjection(jobId,byCompany?companyId:null);
    const status=String(event.status||'').toUpperCase();
    if(status!=='SKIPPED')row.provider_call_count+=1;
    if(status==='COMPLETED')row.provider_completed_count+=1;
    if(status==='NOT_FOUND')row.provider_not_found_count+=1;
    if(status==='TEMPORARY_ERROR')row.provider_temporary_error_count+=1;
    if(status==='FAILED')row.provider_failed_count+=1;
    row.reserved_units+=count(event.reserved_units);
    row.used_units+=count(event.used_units);
    row.released_units+=count(event.released_units);
    const occurred=event.completed_at||event.created_at||null;
    if(occurred&&(!row.last_provider_event_at||String(occurred)>String(row.last_provider_event_at))){
      row.last_provider_event_at=occurred;row.projection_updated_at=occurred;
    }
    projections.set(key,row);
  }
  return [...projections.values()];
}
