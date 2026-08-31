const text = value => String(value ?? '').trim().toUpperCase();

const states = Object.freeze({
  RECOMMENDED: ['建议联系', 'Recommended', 'is-recommended'],
  MANAGEMENT_APPROVED: ['已确认进入待联系', 'Management approved', 'is-approved'],
  EVIDENCE_REQUIRED: ['待补充资料', 'Evidence required', 'is-evidence'],
  HOLD: ['暂不联系', 'Hold', 'is-hold'],
  NOT_SUITABLE: ['当前不适合', 'Not suitable', 'is-unsuitable'],
  SUPPRESSED: ['暂停联系', 'Suppressed', 'is-suppressed'],
  READY: ['联系条件已满足', 'Contact ready', 'is-approved'],
  ACTIVE: ['当前有效', 'Active', 'is-approved'],
  VALID: ['有效', 'Valid', 'is-approved'],
});

export function phase8Status(value) {
  return states[text(value)] || ['待确认', 'To confirm', ''];
}

export function phase8StatusMarkup(value) {
  const [zh, en, tone] = phase8Status(value);
  return `<span class="p8-status ${tone}"><span class="bi"><span lang="zh-CN">${zh}</span><span lang="en">${en}</span></span></span>`;
}

export const phase8BlockerGroup = value => {
  const code = text(value);
  if (code.includes('EMAIL') || code.includes('MAILBOX')) return ['邮箱核验', 'Email verification'];
  if (code.includes('BUYER_ROLE') || code.includes('RESPONSIBILITY')) return ['采购职责', 'Buyer role'];
  if (code.includes('BUYER') || code.includes('CONTACT')) return ['采购联系人', 'Buyer contact'];
  if (code.includes('PRODUCT') || code.includes('CATEGORY')) return ['产品与品类', 'Product and category'];
  if (code.includes('IDENTITY') || code.includes('COMPANY')) return ['企业身份', 'Company identity'];
  if (code.includes('HISTORICAL') || code.includes('RELATIONSHIP')) return ['历史关系', 'Historical relationship'];
  return ['业务资料', 'Business evidence'];
};
