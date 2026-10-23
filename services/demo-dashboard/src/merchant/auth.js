import {randomBytes} from 'node:crypto';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import {effectiveMerchantStatus,featuresOf} from './MerchantService.js';
import {scopeFromUser,companyVisible} from './scope.js';

const bool=(value,fallback)=>value===undefined||value===null||value===''?fallback:/^(1|true|yes|on)$/i.test(String(value));
export const authRequired=(env=process.env)=>bool(env.AUTH_REQUIRED,true);
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const deny=(res,status,code,message)=>res.status(status).json({error:message,code});

// Sessions: express-session with the connect-pg-simple PostgreSQL store (table
// leadgen.workspace_sessions from migration 066). Cookie is httpOnly + SameSite=Lax.
export function createSessionMiddleware({pool,env=process.env,store=null}={}){
  const PgStore=connectPgSimple(session);
  let secret=String(env.SESSION_SECRET||'').trim();
  if(!secret){
    secret=randomBytes(32).toString('hex');
    if(authRequired(env))console.warn(JSON.stringify({event:'SESSION_SECRET_MISSING',detail:'Sessions end when the service restarts; set SESSION_SECRET in .env'}));
  }
  const secure=String(env.SESSION_COOKIE_SECURE||'auto').toLowerCase();
  return session({
    name:'sim.sid',secret,resave:false,saveUninitialized:false,rolling:true,
    store:store||new PgStore({pool,schemaName:'leadgen',tableName:'workspace_sessions',createTableIfMissing:false,pruneSessionInterval:900}),
    cookie:{httpOnly:true,sameSite:'lax',secure:secure==='auto'?'auto':bool(secure,false),
      maxAge:Math.max(3600,Number(env.SESSION_MAX_AGE_HOURS||72)*3600)*1000}
  });
}

// Requests a merchant may make. Everything else under /api is SIM-only (403 ADMIN_REQUIRED).
const MERCHANT_ROUTES=[
  ['GET',`^/api/auth/me$`],['POST',`^/api/auth/(login|logout|password)$`],
  ['GET',`^/api/merchant/(onboarding|profile|mailbox|mailbox/presets|scope)$`],
  ['PATCH',`^/api/merchant/profile$`],['PUT',`^/api/merchant/(mailbox|scope)$`],['POST',`^/api/merchant/mailbox/(test-connection|test-email)$`],
  ['POST',`^/api/feedback$`],
  ['GET',`^/api/(opportunities|opportunity-pool/summary|metrics|leads|export/leads|markets|category-scopes/current)$`],
  ['GET',`^/api/opportunities/${UUID}/decision-history$`],
  ['GET',`^/api/leads/${UUID}(/(decision-makers|contact-routes))?$`],
  ['GET',`^/api/companies/${UUID}/(score|score-history|customer-match|customer-match-history|lifecycle-history|cooperation-feasibility|category-procurement-matches|buyer-business-model|commercial-product-fit|product-opportunities)$`],
  ['GET',`^/api/crm/(pipeline|tasks|followup-drafts)$`],['GET',`^/api/crm/companies/${UUID}/timeline$`],
  ['POST',`^/api/crm/opportunities/${UUID}/(stage|activities)$`],['POST',`^/api/crm/tasks$`],['PATCH',`^/api/crm/tasks/${UUID}$`],
  ['POST',`^/api/crm/replies/${UUID}/review$`],['POST',`^/api/crm/followup-drafts/${UUID}/decision$`],
  ['GET',`^/api/outreach/(inbox|operations-summary)$`],['GET',`^/api/outreach/threads/${UUID}$`],
  ['GET',`^/api/research/batches(/options|/${UUID})?$`],['POST',`^/api/research/batches(/preview)?$`],
  ['GET',`^/api/research/jobs(/${UUID}(/results)?)?$`]
].map(([method,pattern])=>[method,new RegExp(pattern,'i')]);
export const merchantRouteAllowed=(method,path)=>MERCHANT_ROUTES.some(([m,re])=>(m===method||(m==='GET'&&method==='HEAD'))&&re.test(path));

// Paths that never need a session: health, login, provider webhooks and internal-token jobs.
const PUBLIC=/^\/api\/(health$|auth\/(login|logout|me)$|webhooks\/|internal\/)/;
// Writes an expired (read-only) merchant may still make.
const READ_ONLY_EXEMPT=/^\/api\/(auth\/(logout|password)|feedback)$/;
const PASSWORD_CHANGE_EXEMPT=/^\/api\/auth\/(me|logout|password)$/;

// Gate for /api. Attaches req.workspaceUser / req.workspaceScope / req.managementUser.
// With AUTH_REQUIRED=false (tests, local development) the previous behaviour stays:
// DPV_WORKSPACE_ACTOR is the identity and every request has SIM (admin) scope.
export function createWorkspaceGate({merchants,env=process.env,pool}){
  const required=authRequired(env);
  return async function workspaceGate(req,res,next){
    if(!req.path.startsWith('/api/'))return next();
    try{
      const userId=req.session?.userId;
      let user=userId?await merchants.findUserById(userId):null;
      if(user?.disabled_at)user=null;
      let merchant=null;
      if(user?.merchant_id){
        merchant=await merchants.getMerchant(user.merchant_id);
        if(effectiveMerchantStatus(merchant)==='DISABLED'){
          req.session?.destroy?.(()=>{});
          if(PUBLIC.test(req.path))return next();
          return deny(res,401,'AUTH_REQUIRED','Sign in required');
        }
      }
      if(user){
        req.workspaceUser=user;req.workspaceMerchant=merchant;
        req.workspaceScope=scopeFromUser(user,req.query);
        // Business services keep their existing role checks: signed-in users act as management
        // inside their own scope; SIM-only routes are blocked below for merchants.
        req.managementUser=Object.freeze({identity:user.email,role:'MANAGEMENT',workspace_role:user.role,merchant_id:user.merchant_id||null});
      }
      if(PUBLIC.test(req.path))return next();
      if(!user){
        if(!required)return next();
        return deny(res,401,'AUTH_REQUIRED','Sign in required');
      }
      if(user.must_change_password&&!PASSWORD_CHANGE_EXEMPT.test(req.path))return deny(res,403,'PASSWORD_CHANGE_REQUIRED','Change the temporary password first');
      if(user.role!=='MERCHANT')return next();
      const method=req.method.toUpperCase();
      if(!merchantRouteAllowed(method,req.path))return deny(res,403,'ADMIN_REQUIRED','This function is available to the SIM administrator only');
      const status=effectiveMerchantStatus(merchant);
      if(method!=='GET'&&method!=='HEAD'&&status==='EXPIRED'&&!READ_ONLY_EXEMPT.test(req.path))
        return deny(res,403,'MERCHANT_READ_ONLY','The trial has ended; contact SIM to continue');
      const features=featuresOf(merchant);
      if(method==='POST'&&/^\/api\/research\/batches/.test(req.path)&&!features.research)
        return deny(res,403,'MERCHANT_FEATURE_DISABLED','Customer search is not enabled for this account');
      if(method==='POST'&&/^\/api\/(crm\/followup-drafts\/[^/]+\/decision|merchant\/mailbox\/test-email)$/.test(req.path)&&!features.email)
        return deny(res,403,'MERCHANT_FEATURE_DISABLED','Email sending is not enabled for this account');
      // Company detail routes: the id must be one of the merchant's companies.
      const company=req.path.match(new RegExp(`^/api/(?:leads|companies)/(${UUID})`,'i'))?.[1];
      if(company&&!await companyVisible(pool,req.workspaceScope,company))return deny(res,404,'COMPANY_NOT_FOUND','Company not found');
      const snapshot=req.path.match(new RegExp(`^/api/opportunities/(${UUID})/`,'i'))?.[1];
      if(snapshot){
        const row=(await pool.query('SELECT company_id FROM leadgen.business_opportunity_decision_snapshots WHERE id=$1',[snapshot])).rows[0];
        if(!row||!await companyVisible(pool,req.workspaceScope,row.company_id))return deny(res,404,'OPPORTUNITY_NOT_FOUND','Opportunity not found');
      }
      return next();
    }catch(error){return next(error);}
  };
}

export const requireAdmin=(req,res,next)=>{
  if(req.workspaceUser&&req.workspaceUser.role!=='ADMIN')return deny(res,403,'ADMIN_REQUIRED','This function is available to the SIM administrator only');
  next();
};
