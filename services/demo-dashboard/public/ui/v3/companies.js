import { bilingual as bi, escapeText as esc, stateMarkup } from './components.js';
import { isMarketVisible } from '../../market-visibility.js';
import { initialContactPending } from '../contact-progress.js';
import { hasOpportunityPool, isActiveBusinessOpportunity, opportunityDimensionsMarkup } from './opportunity-dimensions.js';

/** One set of original controls: compact disclosure on phone, open filter bar on desktop. */
export function mountCompanyFilters(root) {
  const filters = root?.querySelector('.filters');
  if (!filters || filters.closest('.v3-company-filter-disclosure')) return;
  const disclosure = root.ownerDocument.createElement('details');
  disclosure.className = 'v3-company-filter-disclosure';
  const summary = root.ownerDocument.createElement('summary');
  const label = () => {
    const count = [...filters.querySelectorAll('select')].filter(select=>select.id !== 'company-sort' && select.value).length;
    summary.innerHTML = bi(count ? `筛选 · ${count} 项` : '筛选与排序',count ? `Filters · ${count} active` : 'Filters & sort');
  };
  label();
  filters.before(disclosure);
  disclosure.append(summary,filters);
  const compact = window.matchMedia('(max-width: 767px)');
  const sync = () => {
    if (compact.matches && disclosure.contains(root.ownerDocument.activeElement)) summary.focus();
    disclosure.open = !compact.matches;
  };
  sync();
  compact.addEventListener('change',sync);
  filters.addEventListener('change',label);
}

export const companySections = Object.freeze([
  ['snapshot','摘要','Snapshot',['overview']],
  ['category-fit','类目适配','Category Fit',['product-match','feasibility','matching','scoring']],
  ['contacts','联系渠道','Contacts',['contacts','buying','social']],
  ['opportunity','合作机会','Opportunity',['outreach-readiness']],
  ['communication','往来邮件','Communication',['outreach-drafts','outreach-messages']],
  ['evidence','资料依据','Evidence',['evidence']],
  ['activity','跟进活动','Activity',['outreach-replies']],
  ['records','历史记录','Records',['data-history','history']]
]);

/** Move existing panels, never duplicate their identifiers, handlers or business data. */
export function upgradeCompanyDetail(detail) {
  const nav = detail.querySelector('#detail-section-nav');
  const workspace = detail.querySelector('.crm-detail-workspace');
  if (!nav || !workspace) return;
  detail.classList.add('v3-company-detail');
  const panels = new Map();
  const tabs = new Map();
  for (const [, , , keys] of companySections) for (const key of keys) {
    panels.set(key, detail.querySelector(`#detail-panel-${key}`));
    tabs.set(key, detail.querySelector(`#detail-tab-${key}`));
  }
  const fragment = detail.ownerDocument.createDocumentFragment();
  nav.className = 'v3-company-detail-nav';
  nav.innerHTML = companySections.map(([key,zh,en], i) => `<button type="button" role="tab" data-detail-section-tab="${key}" id="detail-section-tab-${key}" aria-controls="detail-section-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${bi(zh,en)}</button>`).join('');
  for (const [index, [key, zh, en, keys]] of companySections.entries()) {
    const section = detail.ownerDocument.createElement('section');
    section.id = `detail-section-${key}`;
    section.dataset.detailSection = key;
    section.setAttribute('role','tabpanel');
    section.setAttribute('aria-labelledby',`detail-section-tab-${key}`);
    section.hidden = index !== 0;
    const subnav = detail.ownerDocument.createElement('div');
    subnav.className = 'v3-company-subnav';
    subnav.setAttribute('role','tablist');
    subnav.setAttribute('aria-label',`${zh} ${en}`);
    for (const [i, panelKey] of keys.entries()) {
      const panel = panels.get(panelKey);
      const tab = tabs.get(panelKey);
      if (tab) {
        tab.setAttribute('aria-selected',String(i === 0));
        tab.tabIndex = i === 0 ? 0 : -1;
        subnav.append(tab);
      }
      if (panel) { panel.hidden = i !== 0; section.append(panel); }
    }
    // Keep even single lazy-load tabs: Phase 7 loads their content on click.
    if (subnav.children.length) section.prepend(subnav);
    fragment.append(section);
  }
  workspace.replaceChildren(fragment);
  panels.get('overview')?.setAttribute('aria-labelledby','detail-section-tab-snapshot');
  detail.querySelectorAll('[data-open-evidence-tab]').forEach(button=>button.addEventListener('click',()=>nav.querySelector('[data-detail-section-tab="evidence"]')?.click()));
}

const array = payload => Array.isArray(payload) ? payload : payload?.items || payload?.opportunities || payload?.routes || payload?.contacts || [];
const idFor = item => String(item.company_id || item.companyId || '');
const eligibleStatus = item => ['RECOMMENDED','MANAGEMENT_APPROVED'].includes(String(item.display_opportunity_status || item.displayOpportunityStatus || item.opportunity_status || item.opportunityStatus || item.system_recommendation_status || item.systemRecommendationStatus || '').toUpperCase());
const category = item => String(item.product_profile || item.product_profile_label || '');
const typePair = type => ({ EMAIL:['商务邮箱','Business email'], PHONE:['电话','Phone'], WHATSAPP:['WhatsApp','WhatsApp'], CONTACT_FORM:['联系表单','Contact form'], SUPPLIER_PORTAL:['供应商入口','Supplier portal'], VENDOR_REGISTRATION:['供应商登记','Vendor registration'], LINKEDIN:['LinkedIn','LinkedIn'] })[type] || ['联系渠道','Contact channel'];
const profilePair = value => ({ WOMENSWEAR:['女装','Womenswear'], GENERAL_MERCHANDISE:['日用百货','General merchandise'] })[value] || [value || '类目待确认',value || 'Category to confirm'];

export function groupContactCompanies(opportunities) {
  const groups = new Map();
  for (const item of array(opportunities)) {
    const id = idFor(item);
    if (!id || !(hasOpportunityPool(item) ? isActiveBusinessOpportunity(item) : eligibleStatus(item)) || !initialContactPending(item) || !isMarketVisible(item.country_code)) continue;
    if (!groups.has(id)) groups.set(id,{ companyId:id, name:item.company_name || item.resolved_company_name || '—', market:item.country_code || '—', categories:[], opportunities:[] });
    const group = groups.get(id);
    if (category(item) && !group.categories.includes(category(item))) group.categories.push(category(item));
    group.opportunities.push(item);
  }
  return [...groups.values()];
}

export function distinctContactChannels(routes) {
  const channels = new Map();
  for (const route of array(routes)) {
    const sourceType = String(route.contact_type || '').toUpperCase();
    const type = ({GENERIC_BUSINESS_EMAIL:'EMAIL',DEPARTMENT_EMAIL:'EMAIL',PERSONAL_BUSINESS_EMAIL:'EMAIL',BUSINESS_EMAIL:'EMAIL',BUSINESS_PHONE:'PHONE',BUSINESS_WHATSAPP:'WHATSAPP'})[sourceType] || sourceType;
    const value = String(route.value || route.contact_value_raw || route.contact_value || '').trim();
    if (!type || !value) continue;
    const key = `${type}:${type === 'EMAIL' ? value.toLowerCase() : value}`;
    const previous = channels.get(key);
    const timestamp = Date.parse(route.last_verified_at || '') || 0;
    const previousTimestamp = Date.parse(previous?.last_verified_at || '') || 0;
    if (!previous || timestamp > previousTimestamp) channels.set(key,{...route, type, value});
  }
  return [...channels.values()];
}

function channelMarkup(route) {
  const status = String(route.verification_status || '').toUpperCase();
  const label = ({ VALID:['有效','Valid'], ACCEPT_ALL:['全域接收','Accept-all'], INVALID:['无效','Invalid'], INVALID_FORMAT:['格式无效','Invalid format'], PUBLICLY_OBSERVED:['企业页面已登记','Published by business'], BUSINESS_WHATSAPP_OBSERVED:['企业页面已登记','Published by business'], FORMAT_VALID:['格式有效','Format valid'], TEMPORARY_ERROR:['核验暂未完成','Verification incomplete'], DOMAIN_MX_VERIFIED:['邮件域有效','Mail domain valid'] })[status] || ['待确认','To confirm'];
  const external = /^(https?):\/\//i.test(route.value) ? route.value : null;
  // No mailto and no send control; addresses remain subject to the existing review flow.
  const verifiedDate = route.last_verified_at && !Number.isNaN(Date.parse(route.last_verified_at)) ? `<time datetime="${esc(route.last_verified_at)}">${esc(new Date(route.last_verified_at).toLocaleDateString())}</time>` : '';
  return `<li><div>${bi(...typePair(route.type))}${external ? `<a href="${esc(external)}" target="_blank" rel="noopener noreferrer">${esc(route.value)}</a>` : `<span class="v3-channel-value">${esc(route.value)}</span>`}</div><small>${bi(...label)}${verifiedDate}</small></li>`;
}

export function renderContactCompanies(groups) {
  if (!groups.length) return stateMarkup('empty','暂无待联系公司','No contact-ready companies');
  const headings = [['公司 / 市场','Company / Market'],['合作类目','Categories'],['联系人 / 部门','Contact / Department'],['商务邮箱','Business email'],['其他渠道','Other channels'],['联系状态','Contact status'],['操作','Action']];
  const channelList = channels => `<ul class="v3-contact-channels">${channels.map(channelMarkup).join('')}</ul>`;
  return `<div class="v3-contact-table-wrap"><table class="v3-contact-table"><thead><tr>${headings.map(pair=>`<th>${bi(...pair)}</th>`).join('')}</tr></thead><tbody>${groups.map(group=>{
    const emails = (group.channels || []).filter(channel=>channel.type === 'EMAIL');
    const others = (group.channels || []).filter(channel=>channel.type !== 'EMAIL');
    const names = [...new Set((group.opportunities || []).map(item=>item.buyer_name || item.buyer_department).filter(Boolean))];
    const cells = [
      `<button type="button" data-contact-company="${esc(group.companyId)}" class="v3-contact-company-name">${esc(group.name)}</button><small>${esc(group.market)}</small>`,
      group.categories.map(value=>bi(...profilePair(value))).join(''),
      names.length ? names.map(esc).join('<br>') : bi('未登记','Not listed'),
      emails.length ? channelList(emails.slice(0,1))+(emails.length>1?`<details><summary>${bi(`另外 ${emails.length-1} 个邮箱`,`${emails.length-1} more mailboxes`)}</summary>${channelList(emails.slice(1))}</details>`:'') : bi('未登记邮箱','No mailbox listed'),
      others.length ? `<details><summary>${bi(`${others.length} 个商务渠道`,`${others.length} business channels`)}</summary>${channelList(others)}</details>` : bi('未登记','Not listed'),
      opportunityDimensionsMarkup(group.opportunities?.find(hasOpportunityPool)) || (group.error ? stateMarkup('degraded','渠道读取待重试','Retry contact channels') : !group.channels?.length ? stateMarkup('warning','联系渠道待补充','Contact channels required') : bi('联系前审核','Review before contact')),
      emails.length ? `<button type="button" class="btn btn-primary" data-contact-review="${esc(group.companyId)}">${bi('审核邮件','Review email')}</button>` : `<button type="button" class="btn btn-outline-secondary" data-contact-company="${esc(group.companyId)}">${bi('查看详情','View details')}</button>`
    ];
    return `<tr>${cells.map((cell,index)=>`<td data-label="${esc(headings[index].join(' / '))}">${cell}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

/** Read-only company-level composition. API gates stay in the email review workbench. */
export function mountContactReady(host, { request, openCompany, openReview } = {}) {
  if (!host || !request) return null;
  host.innerHTML = `<header class="v3-company-page-header"><div><h2>${bi('待联系公司','Contact-ready')}</h2><p>${bi('合作类目与联系渠道','Cooperation categories and contact channels')}</p></div><button type="button" class="btn btn-outline-secondary" data-contact-refresh>${bi('刷新','Refresh')}</button></header><div data-contact-ready-status></div><div data-contact-ready-content></div>`;
  const content = host.querySelector('[data-contact-ready-content]');
  const status = host.querySelector('[data-contact-ready-status]');
  let generation = 0;
  async function refresh() {
    const current = ++generation;
    content.innerHTML = stateMarkup('loading','正在读取待联系公司','Loading contact-ready companies');
    status.innerHTML = '';
    try {
      const payload = await request('/api/opportunities?status=ALL&limit=500');
      const groups = groupContactCompanies(payload);
      // Bounded concurrency; never repeat the route request for each category.
      let cursor = 0;
      await Promise.all(Array.from({length:Math.min(4,groups.length)},async()=>{
        while (cursor < groups.length) {
          const group = groups[cursor++];
          try { group.channels = distinctContactChannels(await request(`/api/leads/${encodeURIComponent(group.companyId)}/contact-routes`)); }
          catch { group.error = true; }
        }
      }));
      if (current !== generation) return;
      content.innerHTML = renderContactCompanies(groups);
      status.innerHTML = `<p class="v3-contact-count">${bi(`${groups.length} 家公司`,`${groups.length} companies`)}</p>`;
    } catch {
      if (current === generation) content.innerHTML = stateMarkup('error','待联系公司读取失败，请刷新重试','Could not load companies; refresh to retry');
    }
  }
  host.addEventListener('click',event=>{
    const company = event.target.closest('[data-contact-company]');
    const review = event.target.closest('[data-contact-review]');
    if (company) openCompany?.(company.dataset.contactCompany,company);
    if (review) openReview?.(review.dataset.contactReview,review);
    if (event.target.closest('[data-contact-refresh]')) void refresh();
  });
  return { refresh };
}
