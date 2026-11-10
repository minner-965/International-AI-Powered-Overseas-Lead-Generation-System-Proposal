// Batch 4 sending-health screens: merchant mailbox page card and SIM administrator card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adminSenderHealthMarkup,deliverabilityMarkup,dnsHints,dnsRows,pacingText,pauseText} from '../public/ui/v4/sender-health.js';
import {FALLBACK_PRESETS,autoSendModel,testResultText} from '../public/ui/v4/mailbox.js';

const health={sender:'MERCHANT',healthy:true,metrics:{sent:40,hard_bounces:1,complaints:0,bounce_rate:0.025},paused:null,
  pacing:{warmup_enabled:true,warmup_cap_today:10,sent_today:4,min_interval_minutes:15,next_allowed_at:null}};
const dnsOk={domain:'alpha.example',status:'OK',spf:{status:'FOUND',record:'v=spf1 ~all'},dkim:{status:'FOUND',selector:'s1'},dmarc:{status:'FOUND',policy:'none'}};

test('pause reasons and pace read as plain business sentences',()=>{
  assert.match(pauseText('BOUNCE_RATE_HIGH',{sent:50,hard_bounces:3,bounce_rate:0.06})[0],/最近 50 封中有 3 封退信（6\.0%）/);
  assert.match(pauseText('COMPLAINT_RECEIVED')[0],/投诉/);
  assert.match(pacingText(health.pacing)[0],/今天最多自动发 10 封，已发 4 封；两封至少间隔 15 分钟/);
  assert.doesNotMatch(pacingText({warmup_enabled:false,min_interval_minutes:15})[0],/最多/);
});

test('DNS rows: found records are green; missing ones explain what to add',()=>{
  assert.deepEqual(dnsRows(dnsOk).map(row=>row[2]),[true,true,true]);
  const missing=dnsRows({domain:'beta.example',status:'NEEDS_ATTENTION',spf:{status:'MISSING'},dkim:{status:'NOT_FOUND_COMMON_SELECTORS'},dmarc:{status:'LOOKUP_FAILED',code:'ETIMEOUT'}});
  assert.deepEqual(missing.map(row=>row[2]),[false,false,false]);
  assert.equal(missing[0][3],'未设置');assert.match(missing[1][3],/常用选择器/);assert.match(missing[2][3],/稍后再查/);
  const hints=dnsHints(missing);assert.deepEqual(hints.map(row=>row[0]),['SPF 发信授权','DKIM 签名'],'no setup steps for a lookup that only failed');
  assert.match(hints[0][2],/v=spf1/);assert.deepEqual(dnsHints(dnsRows(dnsOk)),[]);
  assert.deepEqual(dnsRows(null),[]);assert.deepEqual(dnsRows({status:'INVALID_DOMAIN'}),[]);
});

test('card: no pause banner while healthy; a deliverability hold shows the reason and a resume button with a tooltip',()=>{
  const healthy=deliverabilityMarkup({health,dns:dnsOk,hold:null},{resume:'own'});
  assert.doesNotMatch(healthy,/data-sender-paused/);assert.match(healthy,/data-dns-list/);assert.doesNotMatch(healthy,/data-dns-hints/);assert.match(healthy,/alpha\.example/);
  const held=deliverabilityMarkup({health:{...health,paused:{reason:'BOUNCE_RATE_HIGH',metrics:{sent:50,hard_bounces:3,bounce_rate:0.06}}},dns:dnsOk,hold:{reason:'BOUNCE_RATE_HIGH'}},{resume:'own'});
  assert.match(held,/data-sender-paused/);assert.match(held,/data-sender-resume="own"[^>]*data-tip=/);
  assert.doesNotMatch(deliverabilityMarkup({health,dns:dnsOk,hold:{reason:'BOUNCE_RATE_HIGH'}},{resume:null}),/data-sender-resume/,'read-only accounts see no button');
  assert.doesNotMatch(deliverabilityMarkup({health,dns:dnsOk,hold:{reason:'SMTP_SEND_INTERRUPTED'}},{resume:'own'}),/data-sender-paused/,'a stalled-send hold is not a deliverability pause');
});

test('admin card lists only merchant mailboxes with a problem, each with its own resume button',()=>{
  const markup=adminSenderHealthMarkup({sim:{...health,sender:'SIM',sender_email:'simon@sim.example',dns:dnsOk},merchants:[
    {merchant_id:'m-ok',company_name:'Fine Co',from_email:'a@fine.example',hold:null,health},
    {merchant_id:'m-bad',company_name:'Bounce Co',from_email:'b@bounce.example',hold:{reason:'COMPLAINT_RECEIVED'},health:{...health,healthy:false}}]});
  assert.match(markup,/simon@sim\.example/);assert.match(markup,/Bounce Co/);assert.doesNotMatch(markup,/Fine Co/);
  assert.match(markup,/data-sender-resume="m-bad"/);
  assert.match(adminSenderHealthMarkup({sim:{...health,dns:null},merchants:[]}),/0 个商家邮箱都正常/);
  const paused=adminSenderHealthMarkup({sim:{...health,paused:{reason:'COMPLAINT_RECEIVED',metrics:{}}},merchants:[]});
  assert.match(paused,/重新打开“自动发送开发信”/);
});

test('mailbox page: deliverability pause note, 465 presets for Chinese business mail, 465 in the TLS hint',()=>{
  const model=autoSendModel({verified_at:'2026-11-01',auto_first_touch:{enabled:true},sending_hold:{reason:'COMPLAINT_RECEIVED'}});
  assert.equal(model.active,false);assert.match(model.note[0],/恢复发信/);
  assert.match(autoSendModel({verified_at:'2026-11-01',auto_first_touch:{enabled:true},sending_hold:{reason:'SMTP_SEND_INTERRUPTED'}}).note[0],/测试连接/);
  for(const key of ['aliyun','tencent','netease'])assert.equal(FALLBACK_PRESETS.find(item=>item.key===key).smtp_port,465);
  assert.match(testResultText({ok:false,code:'TLS_ERROR'})[0],/587 或 465/);
});

test('settings page mounts the sending health card and loads its module',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/<div id="sender-health-root"><\/div>/);assert.match(html,/src="\/ui\/v4\/sender-health\.js"/);
});
