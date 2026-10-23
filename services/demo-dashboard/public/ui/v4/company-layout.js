// Company Detail layout (docs/ui/mockup-v4/company.html): identity head with actions, 基本信息 card,
// two columns (left: follow-up card + activity timeline, filled by followup-card.js; right: 评估依据),
// then the detailed record tabs. Phones: segmented 跟进记录 / 资料 / 评估依据 plus the fixed action bar.
import { bi, esc } from './crm.js';
import { tip } from './tooltips.js';

const BANDS = { PRECISION: ['精准', 'Precision', 'band-p'], RELEVANT: ['相关', 'Relevant', 'band-r'], GENERAL_RELEVANT: ['一般相关', 'General relevant', 'band-g'] };
export const bandPill = band => {
  const label = BANDS[String(band || '').toUpperCase()];
  return label ? `<span class="pill ${label[2]}">${bi(label[0], label[1])}</span>` : `<span class="meta">${bi('待评估', 'Not assessed')}</span>`;
};

export const SEGMENTS = Object.freeze([
  ['log', '跟进记录', 'Activity', '跟进卡片、快速记录和跟进时间线', 'Follow-up card, quick log and timeline'],
  ['info', '资料', 'Profile', '基本信息、联系方式与详细资料', 'Profile, contacts and detailed records'],
  ['why', '评估依据', 'Assessment', '商品类目评分与评估依据', 'Category score and assessment basis']
]);

const fact = (zh, en, value, cls = '') => `<div${cls ? ` class="${cls}"` : ''}><dt>${bi(zh, en)}</dt><dd>${value}</dd></div>`;

/** 基本信息 card. Values are pre-escaped markup supplied by the caller. */
export function basicInfoCard({ website = '', location = '', countryCode = '', email = '', emailState = '', band = '', categoryScore = null, sourceCount = 0 }) {
  const site = website ? `<a href="${esc(website)}" target="_blank" rel="noreferrer">${esc(website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '<span class="meta">—</span>';
  const score = categoryScore == null ? `<span class="meta">${bi('待评估', 'Not assessed')}</span>` : `<span class="score-big">${esc(Math.round(categoryScore))}<small>/100</small></span>`;
  const sources = sourceCount ? `<button type="button" class="lnk v4-link-btn" data-open-evidence-tab${tip('查看这家企业的资料来源页面', 'Open the source references')}>${bi(`${sourceCount} 条资料来源`, `${sourceCount} source references`)}</button>` : '<span class="meta">—</span>';
  return `<section class="card v4-basic-card" data-m-pane="info" aria-labelledby="detail-basic-title"><div class="ph"><div><h3 id="detail-basic-title">${bi('基本信息', 'Company profile')}</h3></div></div>
    <dl class="pb facts">${fact('官网', 'Website', site)}${fact('国家 / 城市', 'Country / City', `${location || '—'}${countryCode ? ` <span class="tag">${esc(countryCode)}</span>` : ''}`)}${fact('商务邮箱', 'Business email', `${email ? esc(email) : '<span class="meta">—</span>'}${email && emailState ? ` ${emailState}` : ''}`, 'wide-m')}${fact('机会等级', 'Band', bandPill(band))}${fact('商品类目评分', 'Product Category Score', score)}${fact('资料来源', 'Source references', sources)}</dl></section>`;
}

/** 评估依据 card: score chips (existing .crm-detail-score-set) and review rows [zh, en, valueMarkup]. */
export function evaluationCard({ metrics = '', rows = [] }) {
  const list = rows.filter(([, , value]) => value).map(([zh, en, value]) => `<li><span class="k">${esc(zh)}<small>${esc(en)}</small></span><span class="v">${value}</span></li>`).join('');
  return `<section class="card v4-eval-card" aria-labelledby="detail-eval-title"><div class="ph"><div><h3 id="detail-eval-title">${bi('评估依据', 'Prospect review')}</h3><p>${bi('为什么这家企业值得联系', 'Why this company is worth contacting')}</p></div></div>
    ${metrics ? `<div class="crm-detail-score-set v4-eval-scores" role="group" aria-label="企业评分 Company metrics">${metrics}</div>` : ''}
    ${list ? `<ul class="pb review-list">${list}</ul>` : `<div class="pb meta">${bi('评估依据待补充', 'Assessment pending')}</div>`}</section>`;
}

/** Phone segmented control (hidden on desktop). */
export const segmentsMarkup = () => `<div class="m-seg v4-phone-only" role="tablist" aria-label="企业详情 Company detail"><div class="m-seg-in">${SEGMENTS.map(([key, zh, en, tzh, ten], index) => `<button type="button" role="tab" id="detail-seg-${key}" data-detail-seg="${key}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"${tip(tzh, ten)}>${esc(zh)}<span class="sr-only"> ${esc(en)}</span></button>`).join('')}</div></div>`;

/** The layout shell around the existing detailed record tabs (moved, not re-rendered). */
export function companyLayout({ head, basic, evaluation, more }) {
  return `${head}${segmentsMarkup()}${basic}<div class="cols v4-company-cols"><div class="stack" data-followup-slot data-m-pane="log"></div><div class="stack" data-m-pane="why">${evaluation}</div></div><section class="v4-company-more" data-m-pane="info" aria-labelledby="detail-more-title"><h3 id="detail-more-title" class="v4-more-title">${bi('详细资料', 'Detailed records')}</h3>${more}</section>`;
}

/** Wire the phone segments and the head "记录跟进" button. */
export function wireCompanyLayout(detail) {
  const tabs = [...detail.querySelectorAll('[data-detail-seg]')];
  const select = (button, focus = false) => {
    detail.dataset.mSeg = button.dataset.detailSeg;
    tabs.forEach(tab => { const on = tab === button; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; });
    if (focus) button.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : -1;
      if (next >= 0) { event.preventDefault(); select(tabs[next], true); }
    });
  });
  if (tabs[0]) select(tabs[0]);
  detail.querySelector('[data-company-log]')?.addEventListener('click', () => {
    const quick = detail.querySelector('.v4-followup-card [data-log-type="NOTE"]');
    if (quick) quick.click();
    else detail.querySelector('.v4-followup-card')?.scrollIntoView({ block: 'center' });
  });
}
