/* Isolated read-only reconstructed UI comparison. No production module is executed. */
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('C:/Users/ACER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const publicDir=path.join(root,'services/demo-dashboard/public');
const modules=path.join(root,'services/demo-dashboard/node_modules');
const commit='f3706d7765745fde02d7d77fe2d52eef60f87ba7';
const out=path.join(root,'artifacts/phase12-ui-baseline/browser-performance',new Date().toISOString().replace(/[:.]/g,'-'));
const frozen=new Map(),api=new Map(),apiMeta=[],blocked=[];
const prefix='services/demo-dashboard/public/';
for(const filename of execFileSync('git',['ls-tree','-r','--name-only',commit,prefix],{cwd:root,encoding:'utf8'}).trim().split('\n')){
  frozen.set('/'+filename.slice(prefix.length),execFileSync('git',['show',`${commit}:${filename}`],{cwd:root,maxBuffer:10e6}));
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png'};
const allowedApi=/^\/api\/(?:metrics|markets|opportunities|leads|icp\/profiles(?:\/[^/?]+)?|import-batches|crm-history(?:\/import-summary)?|enrichment\/jobs|research\/(?:jobs|provider-status|workbench-summary)|outreach\/(?:operations-summary|workbench|controlled-tests(?:\/runtime)?)|orchestrator\/status|auto-evidence\/(?:summary|tasks|exceptions)|category-scopes\/(?:current|candidates|revisions))(?:\?.*)?$/;
function makeServer(version,port){return new Promise(resolve=>{
 const server=http.createServer(async(req,res)=>{try{
  if(req.method!=='GET'){blocked.push({version,method:req.method,path:req.url});res.writeHead(405);return res.end();}
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   if(!allowedApi.test(req.url)){blocked.push({version,method:req.method,path:req.url});res.writeHead(403);return res.end('{}');}
   if(!api.has(req.url))api.set(req.url,(async()=>{const r=await fetch('http://127.0.0.1:3000'+req.url,{redirect:'error'});const body=Buffer.from(await r.arrayBuffer());apiMeta.push({path:req.url,status:r.status,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')});return{status:r.status,body,type:r.headers.get('content-type')||'application/json'};})());
   const value=await api.get(req.url);res.writeHead(value.status,{'Content-Type':value.type,'Cache-Control':'no-store'});return res.end(value.body);
  }
  const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  if(pathname.includes('..')){res.writeHead(403);return res.end();}
  let body;
  if(pathname.startsWith('/vendor/tabler/'))body=fs.readFileSync(path.join(modules,'@tabler/core/dist',pathname.slice('/vendor/tabler/'.length)));
  else if(pathname.startsWith('/vendor/tabler-icons/'))body=fs.readFileSync(path.join(modules,'@tabler/icons-webfont/dist',pathname.slice('/vendor/tabler-icons/'.length)));
  else body=version==='frozen'?frozen.get(pathname):fs.readFileSync(path.join(publicDir,pathname));
  if(!body){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':mime[path.extname(pathname)]||'application/octet-stream','Cache-Control':'public, max-age=3600','Content-Length':body.length,'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'"});res.end(body);
 }catch(error){res.writeHead(404);res.end();}});
 server.listen(port,'127.0.0.1',()=>resolve(server));
});}
async function pageRun(page,version,port,cache,iteration){
 const errors=[],responses=[],requestFailures=[];
 const onError=e=>errors.push(e.message);
 const onResponse=r=>{if(r.status()>=400)responses.push({path:new URL(r.url()).pathname,status:r.status()});};
 const onFailed=r=>requestFailures.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText});
 page.on('pageerror',onError);page.on('response',onResponse);page.on('requestfailed',onFailed);
 if(cache==='cold')await page.goto(`http://127.0.0.1:${port}/#overview`,{waitUntil:'load'});else await page.reload({waitUntil:'load'});
 await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});
 await page.waitForTimeout(300);
 const value=await page.evaluate(()=>{
  const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');
  return{dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,lcp:window.__perfLcp??null,
   resourceCount:r.length,apiCount:r.filter(x=>new URL(x.name).pathname.startsWith('/api/')).length,
   lastApiResponseEnd:Math.max(0,...r.filter(x=>new URL(x.name).pathname.startsWith('/api/')).map(x=>x.responseEnd)),
   transferBytes:n.transferSize+r.reduce((s,x)=>s+x.transferSize,0),encodedBytes:n.encodedBodySize+r.reduce((s,x)=>s+x.encodedBodySize,0),decodedBytes:n.decodedBodySize+r.reduce((s,x)=>s+x.decodedBodySize,0),
   metricsTextPresent:!!document.querySelector('#metrics')?.textContent?.trim(),
   resources:r.map(x=>({path:new URL(x.name).pathname,transfer:x.transferSize,decoded:x.decodedBodySize,duration:x.duration}))};
 });
 page.off('pageerror',onError);page.off('response',onResponse);page.off('requestfailed',onFailed);
 return{version,cache,iteration,...value,errors,failedResponses:responses,requestFailures};
}
function median(values){const a=values.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null;}
(async()=>{fs.mkdirSync(out,{recursive:true});const servers=await Promise.all([makeServer('frozen',3141),makeServer('current',3142)]);let browser;try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-proxy-server']});
 const runs=[];
 async function context(){const c=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});await c.addInitScript(()=>{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__perfLcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});document.addEventListener('securitypolicyviolation',e=>{console.warn('Blocked resource',e.blockedURI);});});return c;}
 // Prime the shared snapshot before measured navigations; genuine GET results stay in memory only.
 for(const [version,port] of [['frozen',3141],['current',3142]]){const c=await context();await pageRun(await c.newPage(),version,port,'cold',0);await c.close();}
 for(let i=1;i<=5;i++)for(const [version,port] of (i%2?[['frozen',3141],['current',3142]]:[['current',3142],['frozen',3141]])){
  const c=await context(),p=await c.newPage();runs.push(await pageRun(p,version,port,'cold',i));runs.push(await pageRun(p,version,port,'warm',i));await c.close();
 }
 const summaries=[];for(const cache of ['cold','warm'])for(const version of ['frozen','current']){const group=runs.filter(r=>r.cache===cache&&r.version===version);summaries.push({version,cache,...Object.fromEntries(['dcl','load','fcp','lcp','resourceCount','apiCount','transferBytes','decodedBytes'].map(k=>[k,median(group.map(r=>r[k]))]))});}
 const liveContext=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),liveBlocked=[],liveResponses=[],liveConsole=[];
 await liveContext.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!=='http://127.0.0.1:3000'||!['GET','HEAD'].includes(request.method())){liveBlocked.push({origin:url.origin,path:url.pathname,method:request.method()});return route.abort();}return route.continue();});
 const livePage=await liveContext.newPage();
 livePage.on('console',message=>{if(message.type()==='error')liveConsole.push(message.text());});
 livePage.on('response',response=>{const url=new URL(response.url()),headers=response.headers();liveResponses.push({path:url.pathname,status:response.status(),contentEncoding:headers['content-encoding']||'identity',contentType:headers['content-type']||'',contentLength:headers['content-length']||null});});
 const liveRuns=[];
 for(let i=1;i<=5;i++)liveRuns.push(await pageRun(livePage,'production',3000,'cold',i));
 const live=liveRuns[0];await liveContext.close();
 const liveMedians=Object.fromEntries(['dcl','load','fcp','lastApiResponseEnd','resourceCount','apiCount'].map(k=>[k,median(liveRuns.map(r=>r[k]))]));
 const result={generatedAt:new Date().toISOString(),commit,browser:browser.version(),viewport:{width:1440,height:900},method:'Reconstructed freeze and current static code; shared in-memory genuine GET snapshot; DB latency excluded; no compression; five alternating cold/warm pairs per version; isolated headless Chrome.',apiMeta,blocked,summaries,runs,live:{...live,method:'Single real production cold navigation; same-origin GET/HEAD route guard disables cache; actual API latency included; not comparable to replay timings.',blocked:liveBlocked,responses:liveResponses,consoleErrors:liveConsole}};
 result.liveRuns=liveRuns;result.liveMedians=liveMedians;
 result.live.method='Five real production navigations in one isolated context; same-origin GET/HEAD route guard disables HTTP cache; actual API latency included. Not fresh-process cold starts; lastApiResponseEnd is observed API completion, not semantic business readiness.';
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,generatedAt:result.generatedAt,summaries,liveMedians,errors:[...runs,...liveRuns].flatMap(r=>r.errors),failedResponses:[...runs,...liveRuns].flatMap(r=>r.failedResponses),requestFailures:[...runs,...liveRuns].flatMap(r=>r.requestFailures),blocked:[...blocked,...liveBlocked],consoleErrors:liveConsole},null,2));
 }finally{if(browser)await browser.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}})().catch(e=>{console.error(e);process.exitCode=1;});
