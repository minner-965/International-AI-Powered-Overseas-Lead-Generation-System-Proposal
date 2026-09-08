import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {classifySnapshot} from './lib/phase13-mc03-classifier.mjs';
import {classifyContactReadiness} from './lib/phase13-mc03-contact.mjs';

const input=resolve(process.argv[2]||'');
if(!input.startsWith(resolve('artifacts/phase13-mc03')+'/')&&!input.startsWith(resolve('artifacts/phase13-mc03')+'\\'))throw new Error('Use an ignored MC03 snapshot');
execFileSync('git',['check-ignore','--quiet',input]);
const raw=readFileSync(input),snapshot=JSON.parse(raw);
const verification=process.argv[3]?JSON.parse(readFileSync(process.argv[3],'utf8')):null;
if(verification&&(verification.before_observed_at!==snapshot.observed_at||verification.business_changes.length))throw new Error('Read-only evidence mismatch or changed business tables: investigate before reporting');
const companies=new Map(snapshot.tables.companies.map(c=>[c.id,c]));
const bands=['PRECISION','RELEVANT','GENERAL_RELEVANT','EXPLORATORY','NOT_SUITABLE'];
const rows=classifySnapshot(snapshot).map(r=>({...r,...classifyContactReadiness(companies.get(r.company_id),snapshot),would_enter_active_opportunity_pool:r.active_opportunity_pool}));
if(rows.length!==companies.size||new Set(rows.map(r=>r.company_id)).size!==companies.size)throw new Error('Company coverage mismatch');
const counts=Object.fromEntries(bands.map(b=>[b,rows.filter(r=>r.new_opportunity_pool_band===b).length]));
const oldStatuses=r=>r.old_decision_status?.length?[...new Set(r.old_decision_status)]:['NO_CURRENT_DECISION'];
const matrix={};for(const r of rows)for(const old of oldStatuses(r)){matrix[old]??=Object.fromEntries(bands.map(b=>[b,0]));matrix[old][r.new_opportunity_pool_band]++;}
const group=(select)=>{const out={};for(const r of rows)for(const key of new Set(select(r))){out[key]??=Object.fromEntries(bands.map(b=>[b,0]));out[key][r.new_opportunity_pool_band]++;}return out;};
const promotions=rows.filter(r=>oldStatuses(r).includes('NOT_SUITABLE')&&r.new_opportunity_pool_band!=='NOT_SUITABLE');
const missingRelevant=rows.filter(r=>!oldStatuses(r).includes('RECOMMENDED')&&['RELEVANT','GENERAL_RELEVANT'].includes(r.new_opportunity_pool_band));
const recommendedDowngrades=rows.filter(r=>oldStatuses(r).includes('RECOMMENDED')&&r.active_opportunity_pool!=='YES');
const blockers={};for(const r of rows)for(const reason of r.notes||[])blockers[reason]=(blockers[reason]||0)+1;
const oldBlockers={};for(const r of rows)for(const reason of new Set((r.old_blocker||[]).flatMap(b=>b.reason_codes||[])))oldBlockers[reason]=(oldBlockers[reason]||0)+1;
const profiles={};for(const r of rows)for(const p of r.profile_results||[]){profiles[p.product_profile]??=Object.fromEntries(bands.map(b=>[b,0]));profiles[p.product_profile][p.band]++;}
const contactCounts={};const emailCounts={};for(const r of rows){for(const label of r.contact_readiness||[])contactCounts[label]=(contactCounts[label]||0)+1;emailCounts[r.email_eligibility.status]=(emailCounts[r.email_eligibility.status]||0)+1;}
const summary={company_count:rows.length,band_counts:counts,active_pool:rows.filter(r=>r.active_opportunity_pool==='YES').length,non_excluded:rows.length-counts.NOT_SUITABLE,missed_relevant_general:missingRelevant.length,old_to_new:matrix,by_market:group(r=>[r.market||'UNKNOWN']),by_company_type:group(r=>[r.company_type_basis?.company_type||'UNKNOWN']),by_profile:group(r=>r.profile_results?.map(p=>p.product_profile)||['UNKNOWN']),notes_frequency:blockers,promoted_legacy_not_suitable:promotions.length,recommended_downgrades:recommendedDowngrades.length};
const result={schema_version:'MC03_DRY_RUN_V1',observed_at:snapshot.observed_at,snapshot_sha256:createHash('sha256').update(raw).digest('hex'),scope:'WP-MC03_ONLY',applied:false,task_effects:{provider_calls:0,email_sends:0,business_mutations:0},summary,companies:rows};
result.read_only_verification=verification;
summary.by_profile=profiles;summary.old_blocker_frequency=oldBlockers;summary.contact_readiness_counts=contactCounts;summary.email_eligibility_counts=emailCounts;
const output=join(dirname(input),'opportunity-pool-dry-run.json');
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
const esc=v=>String(typeof v==='object'?JSON.stringify(v):v??'—').replace(/\|/g,'／').replace(/[\r\n]+/g,' ');
const table=(headers,items)=>'| '+headers.join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |\n'+items.map(row=>'| '+row.map(esc).join(' | ')+' |').join('\n');
const matrixTable=obj=>table(['分组',...bands],Object.entries(obj).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,...bands.map(b=>v[b])]));
const sections=[`# MC03 机会池分层试算结果\n\n状态：DRY-RUN COMPLETE — 待审阅，未应用。\n\n数据库观察时间：${snapshot.observed_at}。覆盖 ${rows.length} 家公司，一家公司一条结果。MC00–02 未重做；本轮未调用搜索、邮箱验证或 SMTP，未修改业务数据库、页面和现有评分。`,
`## 只读验证\n\n事务：${snapshot.transaction_read_only} / ${snapshot.transaction_isolation}，连接强制 default_transaction_read_only=on。\n\n${verification?`${verification.business_tables_checked} 个业务表前后数量和内容哈希一致。${verification.runtime_tables_checked} 个运行表中变化项：${verification.runtime_changes.map(x=>x.table).join(', ')||'无'}；属于既有后台轮询，不是本轮业务写入。核对时段 ${verification.before_observed_at} 至 ${verification.after_observed_at}。`:'尚未附前后哈希比较。'}\n\n${table(['业务表','记录数'],['companies','sources','contacts','research_jobs','outbound_messages','outreach_drafts','outreach_approvals','inbound_messages','provider_usage_events'].map(t=>[t,snapshot.business_table_hashes[t].count]))}`,
`## 汇总\n\n${table(['分层','公司数'],bands.map(b=>[b,counts[b]]))}\n\n拟进入活跃机会池：${summary.active_pool} 家；非明确排除：${summary.non_excluded} 家。`,
`## 六项结论\n\n1. 非明确排除公司：${summary.non_excluded} 家；这包含资料不足的探索公司，不等于全部已核验。\n2. 规则试算拟进入活跃机会池：${summary.active_pool} 家；这不是已批准的名单，仍有下述归属/业务类型风险。\n3. 旧 RECOMMENDED 未覆盖的新 RELEVANT / GENERAL_RELEVANT：${summary.missed_relevant_general} 家（包含无旧投影公司；按旧显示状态比较，管理批准单列）。\n4. 旧原因中 CATEGORY_CONFIRMATION_REQUIRED 涉及 ${oldBlockers.CATEGORY_CONFIRMATION_REQUIRED||0} 家，联系门槛 CONTACT_ROUTE_REQUIRED 涉及 ${oldBlockers.CONTACT_ROUTE_REQUIRED||0} 家；全集还有 ${blockers.IDENTITY_VERIFICATION_INCOMPLETE||0} 家缺少完成的身份核验。旧阻断和新资料限制分开记录。\n5. 确有误归属风险，尚不足以把试算数量当成真实可联系买家数。独立复核检查全部初轮活跃公司和每档前20：博客/目录误归属过滤后有3家由泛相关转探索；剩余目录主体、制冷设备范围及制造/采购角色仍待校准。见[边界复核](PHASE13_MC03_BOUNDARY_REVIEW.md)。这不是已量化的全库误判率。\n6. Apply 前重点校准：企业主体与第三方文字归属；泛贸易与明确非目标行业的区分；制造与采购混合角色；旧 REJECTED 的底层证据缺口；历史观察时效。保留无联系方式不降业务分层的规则。`,
`## 旧状态 → 新分层\n\n${matrixTable(matrix)}\n\n公司有多个旧 profile 状态时，在各状态出现一次，因此矩阵合计可能超过公司数。无旧投影单列 NO_CURRENT_DECISION，不伪造旧结论。`,
`## 分组\n\n### 市场\n\n${matrixTable(summary.by_market)}\n\n数据库全部公司均纳入，包括已隐藏市场 BD 的历史记录；本轮不重新启用该市场。\n\n### 公司类型（数据库原值）\n\n${matrixTable(summary.by_company_type)}\n\n### 评估 profile\n\n${matrixTable(summary.by_profile)}\n\n每家公司分别评估两个批准 profile；此表按各 profile 自己的分层计数，不可将两个 profile 相加当作公司数。详见 JSON profile_results。`,
`## 联系方式与邮件资格（独立于业务分层）\n\n${table(['就绪状态','公司数'],Object.entries(contactCounts))}\n\n${table(['邮件评估','公司数'],Object.entries(emailCounts))}\n\n就绪状态可多选。NOT_EVALUATED_FOR_SEND 表示仍需执行原有发送门槛，不表示批准发送。本轮所有 send_authorized 均为 false。`,
`## 资料限制频次\n\n### 当前旧阻断（同公司同原因去重）\n\n${table(['原因','公司数'],Object.entries(oldBlockers).sort((a,b)=>b[1]-a[1]))}\n\n### 本次试算资料限制\n\n${table(['原因','公司数'],Object.entries(blockers).sort((a,b)=>b[1]-a[1]))}`];
for(const band of bands){const samples=rows.filter(r=>r.new_opportunity_pool_band===band).sort((a,b)=>a.company_name.localeCompare(b.company_name)||a.company_id.localeCompare(b.company_id)).slice(0,20);sections.push(`## ${band}：代表公司\n\n按公司名称、ID 稳定排序取前20，不足20则全部；不是业务评分排行。\n\n${table(['公司','市场','旧状态','类目依据','类型依据','备注'],samples.map(r=>[r.company_name,r.market,oldStatuses(r).join(', '),r.category_basis,r.company_type_basis?.company_type,r.notes]))}`);}
sections.push(`## 所有旧 NOT_SUITABLE 转为非排除\n\n共 ${promotions.length} 家，含 EXPLORATORY（不进入活跃池）。逐条保留旧阻断与新依据，不将“重新研究”描述为可发送。\n\n${table(['公司','新分层','旧阻断','旧排除','新依据','完整备注'],promotions.map(r=>[r.company_name,r.new_opportunity_pool_band,r.old_blocker,r.explicit_exclusion_reason,{category:r.category_basis,type:r.company_type_basis,evidence:r.evidence_references},r.notes]))}`);
sections.push(`## 原 RECOMMENDED 意外降档\n\n${recommendedDowngrades.length?table(['公司','新分层','原因'],recommendedDowngrades.map(r=>[r.company_name,r.new_opportunity_pool_band,r.notes])):'0 家降为非活跃分层。'}\n\n## 本地明细与重跑\n\n- JSON：${output.replaceAll('\\','/')}\n- 源快照 SHA-256：${result.snapshot_sha256}\n- JSON 含全部公司及证据索引，位于 Git 忽略目录；本报告不列私人邮箱、邮件正文或凭据。\n- 执行：先运行 scripts/phase13-mc03-snapshot.mjs，再以 snapshot.json 为参数运行 scripts/phase13-mc03-report.mjs。全部分类为离线纯计算。\n- 复用现有 pg、已批准类目及存量证据，无新增依赖或运行时路由。\n\n## STOP\n\n停在 MC03。用户审阅并明确批准后，才可执行 MC04；本轮未启用自动发信。`);
writeFileSync('docs/PHASE13_MC03_OPPORTUNITY_POOL_DRY_RUN_RESULT.md',sections.join('\n\n')+'\n');
console.log(JSON.stringify({output,summary},null,2));
