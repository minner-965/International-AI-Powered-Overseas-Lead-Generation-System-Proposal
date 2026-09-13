// Staged recovery: retain stored automation intent without running its producers.
export function maintenanceReadOnly(env=process.env){
  const raw=String(env.DPV_MAINTENANCE_READ_ONLY||'false').toLowerCase();
  if(!['true','false','1','0'].includes(raw))throw new Error('Invalid DPV_MAINTENANCE_READ_ONLY');
  return raw==='true'||raw==='1';
}
export function maintenanceWriteGuard(enabled){
  // The batch preview only reads registries and computes a plan; it persists nothing.
  return (req,res,next)=>enabled&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!(req.method==='POST'&&req.path==='/api/research/batches/preview')
    ?res.status(503).json({code:'MAINTENANCE_READ_ONLY',error:'Maintenance in progress. Changes are temporarily paused.',retryable:true})
    :next();
}
