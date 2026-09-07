// Invalidation only: consumers reread authoritative projections. No optimistic
// mail state, approval, message content, persistence, or business mutation here.
export const COMMUNICATION_CHANGE_EVENT='crm:communication-change';
const REASONS=new Set(['UPDATED','DRAFT_SAVED','DRAFT_SUBMITTED','DRAFT_APPROVED','DRAFT_REJECTED',
  'MANAGEMENT_UPDATED','SEND_COMPLETED','SEND_RECONCILE','REPLY_UPDATED','SUPPRESSION_UPDATED']);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;
function safeDetail(value={}){
  if(!value||typeof value!=='object')value={};
  return Object.freeze({companyId:uuid(value.companyId),
    productProfile:['WOMENSWEAR','GENERAL_MERCHANDISE'].includes(value.productProfile)?value.productProfile:null,
    reason:REASONS.has(value.reason)?value.reason:'UPDATED'});
}
export function createCommunicationSync({target=null,channelFactory=null,eventFactory=null,idFactory=null}={}){
  const listeners=new Set(),seen=new Set();let sequence=0,closed=false,channel=null;
  const source=idFactory?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  function deliver(detail){
    for(const listener of listeners){try{Promise.resolve(listener(detail)).catch(()=>{});}catch{}}
    if(target&&eventFactory)target.dispatchEvent(eventFactory(COMMUNICATION_CHANGE_EVENT,detail));
  }
  function receive(event){
    const message=event?.data;
    if(closed||message?.type!==COMMUNICATION_CHANGE_EVENT||message.version!==1||
      typeof message.id!=='string'||message.id.length>160||message.source===source||seen.has(message.id))return;
    seen.add(message.id);if(seen.size>128)seen.delete(seen.values().next().value);
    deliver(safeDetail(message.detail)); // Never rebroadcast a received event.
  }
  try{channel=channelFactory?.('dpv-communication-v1')||null;channel?.addEventListener('message',receive);channel?.unref?.();}catch{channel=null;}
  return{
    publish(value){
      if(closed)return;
      const detail=safeDetail(value);deliver(detail);
      try{channel?.postMessage({type:COMMUNICATION_CHANGE_EVENT,version:1,source,id:`${source}:${++sequence}`,detail});}catch{}
      return detail;
    },
    subscribe(listener){if(typeof listener!=='function')throw new TypeError('A change listener is required');if(!closed)listeners.add(listener);return()=>listeners.delete(listener);},
    close(){closed=true;listeners.clear();seen.clear();channel?.removeEventListener('message',receive);channel?.close();}
  };
}
const sync=createCommunicationSync({
  target:typeof document==='undefined'?null:document,
  channelFactory:typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'?name=>new BroadcastChannel(name):null,
  eventFactory:typeof CustomEvent==='undefined'?null:(name,detail)=>new CustomEvent(name,{detail})
});
export const publishCommunicationChange=detail=>sync.publish(detail);
export const subscribeCommunicationChanges=listener=>sync.subscribe(listener);
