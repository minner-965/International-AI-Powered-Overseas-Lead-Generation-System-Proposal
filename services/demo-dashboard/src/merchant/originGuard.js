import {authRequired} from './auth.js';

// Cross-site write protection and baseline security headers. Both are defensive;
// all real authorization stays in the workspace gate and the business services.

const WRITE=new Set(['POST','PUT','PATCH','DELETE']);
// Never guarded: health probe, provider webhooks and internal-token jobs.
const SKIP=/^\/api\/(health$|webhooks\/|internal\/)/;
const hostOf=value=>{try{return new URL(String(value)).host.toLowerCase();}catch{return '';}};
const hosts=value=>String(value||'').split(',').map(part=>part.trim().toLowerCase()).filter(Boolean);
const hasSessionCookie=req=>/(?:^|;\s*)sim\.sid=/.test(req.headers?.cookie||'');

// Reject state-changing /api requests whose Origin (or Referer) host is not the request's
// own host or a configured ALLOWED_ORIGINS host. Skips when AUTH_REQUIRED is off and when a
// request carries no browser context at all (no Origin/Referer and no session cookie), so
// server-to-server callers are unaffected.
export function createOriginGuard({env=process.env}={}){
  const required=authRequired(env);
  const allowlist=hosts(env.ALLOWED_ORIGINS);
  return function originGuard(req,res,next){
    if(!required||!req.path.startsWith('/api/'))return next();
    if(!WRITE.has(req.method.toUpperCase())||SKIP.test(req.path))return next();
    const origin=req.get('origin'),referer=req.get('referer');
    if(!origin&&!referer&&!hasSessionCookie(req))return next();
    const source=hostOf(origin)||hostOf(referer);
    const allowed=new Set([String(req.get('host')||'').toLowerCase(),String(req.get('x-forwarded-host')||'').toLowerCase(),...allowlist].filter(Boolean));
    if(source&&allowed.has(source))return next();
    return res.status(403).json({error:'This request was blocked for security reasons',code:'CROSS_ORIGIN_BLOCKED'});
  };
}

// Conservative headers on every response (API and static pages). The CSP allows the app's
// own inline <script>/<style> (index.html uses an inline bootstrap script) via 'unsafe-inline';
// everything else is same-origin. HSTS is sent only over TLS.
export function createSecurityHeaders({env=process.env}={}){
  const csp=["default-src 'self'","script-src 'self' 'unsafe-inline'","style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:","font-src 'self' data:","connect-src 'self'","frame-ancestors 'none'",
    "base-uri 'self'","form-action 'self'"].join('; ');
  return function securityHeaders(req,res,next){
    res.set('X-Content-Type-Options','nosniff');
    res.set('X-Frame-Options','DENY');
    res.set('Referrer-Policy','same-origin');
    res.set('Permissions-Policy','geolocation=(), microphone=(), camera=()');
    res.set('Content-Security-Policy',csp);
    if(req.secure||(env.TRUST_PROXY&&String(req.get('x-forwarded-proto')||'').toLowerCase()==='https'))
      res.set('Strict-Transport-Security','max-age=15552000; includeSubDomains');
    next();
  };
}
