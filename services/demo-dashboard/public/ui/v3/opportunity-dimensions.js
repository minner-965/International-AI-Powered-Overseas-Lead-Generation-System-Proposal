import { bilingual as bi, escapeText as esc } from './components.js';

export const poolLabels = Object.freeze({
  PRECISION:['精准匹配','Precision match'], RELEVANT:['相关匹配','Relevant match'],
  GENERAL_RELEVANT:['泛相关','Broadly relevant'], EXPLORATORY:['待研究','Exploratory'],
  NOT_SUITABLE:['不适合','Not suitable'],
});
const contactLabels = { NAMED_BUYER_READY:['采购联系人就绪','Buyer contact ready'], EMAIL_READY:['邮箱就绪','Email ready'],
  PHONE_READY:['电话就绪','Phone ready'], WHATSAPP_READY:['WhatsApp 就绪','WhatsApp ready'], FORM_READY:['表单就绪','Form ready'],
  CONTACT_RESEARCHING:['联系资料研究中','Contact research'], NO_CONTACT_FOUND:['暂无联系渠道','No contact found'] };
const emailLabels = { ELIGIBLE:['邮件条件通过','Email eligible'], READY_TO_SEND:['待发送','Ready to send'],
  BLOCKED:['资格待完善','Not eligible'], NOT_EVALUATED_FOR_SEND:['资格待检查','Not assessed'],
  NOT_EVALUATED:['资格待检查','Not assessed'], INELIGIBLE:['资格未通过','Not eligible'] };
const reviewLabels = { BROAD_SCOPE_CATEGORY_REVIEW:['经营范围较广','Broad category scope'], BUSINESS_SCOPE_REVIEW:['经营范围资料有差异','Business scope evidence differs'],
  BUSINESS_ATTRIBUTION_REVIEW:['资料主体需留意','Check evidence attribution'], MIXED_MANUFACTURING_BUYER_ROLE_REVIEW:['兼有生产与采购业务','Manufacturing and buying activities'] };
export const hasOpportunityPool = row => Object.hasOwn(poolLabels,row?.opportunity_pool_band || '');
export const isActiveBusinessOpportunity = row => hasOpportunityPool(row)
  ? row.is_active_business_opportunity === true || row.active_opportunity_pool === true : false;
const badge = (pair, tone) => `<span class="data-state-badge state-${tone}">${bi(...pair)}</span>`;
export function businessOpportunityMarkup(row) {
  if (!hasOpportunityPool(row)) return '';
  return `<span data-business-opportunity>${badge(poolLabels[row.opportunity_pool_band],isActiveBusinessOpportunity(row)?'success':row.opportunity_pool_band==='NOT_SUITABLE'?'danger':'warning')}</span>`;
}
export function contactReadinessMarkup(row) {
  const values = Array.isArray(row?.contact_readiness_labels) ? row.contact_readiness_labels.filter(value=>typeof value==='string') : [];
  const unique=[...new Set(values)].sort((a,b)=>(a==='EMAIL_READY'?-1:b==='EMAIL_READY'?1:0));
  const render=value=>badge(contactLabels[value] || ['待检查','Pending review'],value.endsWith('_READY')?'info':'warning');
  return `<span data-contact-readiness>${unique.length ? render(unique[0])+(unique.length>1?`<details class="v3-contact-readiness-more"><summary>${bi(`另 ${unique.length-1} 项`,`${unique.length-1} more`)}</summary>${unique.slice(1).map(render).join('')}</details>`:'') : bi('待检查','Pending review')}</span>`;
}
export function emailEligibilityMarkup(row) {
  const record = row?.email_send_eligibility || row?.email_eligibility;
  const status = typeof record === 'string' ? record : record?.status;
  return `<span data-email-eligibility>${badge(emailLabels[status] || ['发送资格待检查','Send eligibility pending'],['ELIGIBLE','READY_TO_SEND'].includes(status)?'info':'warning')}</span>`;
}
export function opportunityDimensionsMarkup(row) {
  if (!hasOpportunityPool(row)) return '';
  const flags = [...new Set([...(Array.isArray(row.review_flags)?row.review_flags:[]),...(Array.isArray(row.data_quality_flags)?row.data_quality_flags:[])])];
  return `<dl class="v3-opportunity-dimensions"><div><dt>${bi('业务机会','Business opportunity')}</dt><dd>${businessOpportunityMarkup(row)}</dd></div><div><dt>${bi('联系准备','Contact readiness')}</dt><dd>${contactReadinessMarkup(row)}</dd></div><div><dt>${bi('邮件资格','Email eligibility')}</dt><dd>${emailEligibilityMarkup(row)}</dd></div></dl>${flags.length || row.review_warning ? `<details class="v3-opportunity-review-note"><summary>${bi('资料提示','Evidence note')} <span>${esc(flags.length || 1)}</span></summary>${(flags.length?flags:['UNKNOWN']).map(flag=>`<p>${bi(...(reviewLabels[flag]||['资料存在待核对项','Evidence contains review notes']))}</p>`).join('')}</details>`:''}`;
}

export function opportunityPoolSummaryMarkup(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const pairs = [['active','业务机会','Business opportunities'],['contact_ready','联系准备就绪','Contact ready'],['email_eligible','邮件资格通过','Email eligible']];
  return `<dl class="v3-opportunity-dimensions" data-opportunity-pool-summary>${pairs.map(([key,zh,en])=>`<div><dt>${bi(zh,en)}</dt><dd><strong>${Number.isFinite(Number(summary[key])) && summary[key] != null ? esc(summary[key]) : '—'}</strong></dd></div>`).join('')}</dl>`;
}
