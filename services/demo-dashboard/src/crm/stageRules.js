// Stage-change rule shared by the CRM pipeline and manually added companies (migration 079).
const FORWARD=Object.freeze(['NEW','CONTACTED','REPLIED','QUOTED','SAMPLE','NEGOTIATING','WON']);
/** A move to LOST, back to an earlier stage, or out of WON/LOST needs a written reason. */
export function stageChangeNeedsReason(from,to){
  if(!from||from===to)return false;
  if(to==='LOST')return true;
  if(from==='WON'||from==='LOST')return true;
  return FORWARD.indexOf(to)<FORWARD.indexOf(from);
}
