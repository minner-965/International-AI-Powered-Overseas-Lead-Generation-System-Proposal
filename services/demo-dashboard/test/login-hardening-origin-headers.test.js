import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createOriginGuard,createSecurityHeaders} from '../src/merchant/originGuard.js';

// No database and no sockets to external services: a local express app exercises the
// cross-site write guard and the security-header middleware over loopback.
async function withApp(build,run){
  const app=express();app.use(express.json());build(app);
  app.all('/api/merchant/profile',(_req,res)=>res.json({ok:true}));
  app.all('/api/health',(_req,res)=>res.json({ok:true}));
  app.get('/',(_req,res)=>res.send('<!doctype html><title>x</title>'));
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{return await run(base);}finally{server.close();}
}
const req=(base,path,{method='POST',headers={}}={})=>fetch(base+path,{method,headers});

test('origin guard: foreign Origin on a write is blocked; same-origin and no-context writes pass',async()=>{
  await withApp(app=>app.use(createOriginGuard({env:{AUTH_REQUIRED:'true',ALLOWED_ORIGINS:'tunnel.example.com'}})),async base=>{
    const host=new URL(base).host;
    // Foreign Origin with a session cookie in play -> 403.
    const foreign=await req(base,'/api/merchant/profile',{headers:{origin:'https://evil.example.com',cookie:'sim.sid=abc'}});
    assert.equal(foreign.status,403);assert.equal((await foreign.json()).code,'CROSS_ORIGIN_BLOCKED');
    // Same Origin (request's own host) -> allowed.
    const same=await req(base,'/api/merchant/profile',{headers:{origin:`http://${host}`,cookie:'sim.sid=abc'}});
    assert.equal(same.status,200);
    // A configured allowlist host -> allowed.
    const allowed=await req(base,'/api/merchant/profile',{headers:{origin:'https://tunnel.example.com',cookie:'sim.sid=abc'}});
    assert.equal(allowed.status,200);
    // No Origin/Referer and no session cookie (server-to-server / plain supertest) -> allowed.
    const bare=await req(base,'/api/merchant/profile');
    assert.equal(bare.status,200);
    // The health path is never guarded even with a foreign Origin.
    assert.equal((await req(base,'/api/health',{headers:{origin:'https://evil.example.com',cookie:'sim.sid=abc'}})).status,200);
  });
});

test('origin guard: disabled entirely when AUTH_REQUIRED is false',async()=>{
  await withApp(app=>app.use(createOriginGuard({env:{AUTH_REQUIRED:'false'}})),async base=>{
    const foreign=await req(base,'/api/merchant/profile',{headers:{origin:'https://evil.example.com',cookie:'sim.sid=abc'}});
    assert.equal(foreign.status,200);
  });
});

test('security headers: conservative headers present on every response; no HSTS over plain HTTP',async()=>{
  await withApp(app=>app.use(createSecurityHeaders({env:{}})),async base=>{
    const res=await fetch(base+'/');
    assert.equal(res.headers.get('x-content-type-options'),'nosniff');
    assert.equal(res.headers.get('x-frame-options'),'DENY');
    assert.equal(res.headers.get('referrer-policy'),'same-origin');
    assert.match(res.headers.get('permissions-policy'),/camera=\(\)/);
    const csp=res.headers.get('content-security-policy');
    assert.match(csp,/default-src 'self'/);assert.match(csp,/frame-ancestors 'none'/);assert.match(csp,/script-src 'self' 'unsafe-inline'/);
    assert.equal(res.headers.get('strict-transport-security'),null);
  });
});

test('security headers: HSTS is set when a trusted proxy reports HTTPS',async()=>{
  await withApp(app=>app.use(createSecurityHeaders({env:{TRUST_PROXY:'1'}})),async base=>{
    const res=await fetch(base+'/',{headers:{'x-forwarded-proto':'https'}});
    assert.match(res.headers.get('strict-transport-security'),/max-age=15552000; includeSubDomains/);
  });
});
