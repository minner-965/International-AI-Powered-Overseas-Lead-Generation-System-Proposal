// 我的 / Me: every page of the workspace as a labelled menu (phones have no sidebar).
import { bi, esc } from './crm.js';

const groups = [
  ['获客', 'Prospecting', [['companies', '客户名录', 'Company Directory', 'building', 'b'], ['contact-ready', '待联系企业', 'Contact-ready', 'address-book', 'b'], ['opportunities', '销售机会', 'Opportunities', 'briefcase', 'b'], ['research', '研究任务', 'Research', 'list-search', 'g'], ['jobs', '任务列表', 'Research jobs', 'list-check', 'g']]],
  ['跟进', 'Follow-up', [['tasks', '我的任务', 'My tasks', 'square-check', 'a'], ['replies', '回复与跟进', 'Replies', 'message-2', 'b'], ['followups', '跟进邮件审批', 'Follow-up approval', 'mail', 'b'], ['contact-queue', '开发信审核', 'First-touch review', 'mail-check', 'b']]],
  ['数据与设置', 'Data & settings', [['data-import', '数据导入', 'Data import', 'file-import', 'a'], ['data-export', '数据导出', 'Data export', 'file-export', 'a'], ['settings', '系统设置', 'Settings', 'adjustments-horizontal', 'n'], ['categories', '品类范围', 'Category scope', 'category', 'n'], ['markets', '目标市场', 'Target markets', 'world', 'n'], ['customer-match', '客户画像', 'Customer profile', 'users-group', 'n'], ['evidence', '评估依据', 'Evidence', 'file-certificate', 'n']]]
];
const root = document.querySelector('#me-root');
if (root) {
  root.innerHTML = `<section class="m-me"><span class="avatar" aria-hidden="true">SIM</span><div><b>SIM外贸获客系统</b><p>${bi('工作区', 'Workspace')}</p></div></section>${groups.map(([zh, en, items]) => `<h3 class="m-gt">${bi(zh, en)}</h3><ul class="m-list m-group">${items.map(([view, izh, ien, icon, tone]) => `<li><a class="m-menu" href="#${view}" data-open-view="${view}"><span class="m-ico sm ${tone}"><i class="ti ti-${icon}" aria-hidden="true"></i></span><span class="t">${esc(izh)}<small>${esc(ien)}</small></span><span class="r"><i class="ti ti-chevron-right" aria-hidden="true"></i></span></a></li>`).join('')}</ul>`).join('')}`;
  root.querySelectorAll('[data-open-view]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); location.hash = `#${link.dataset.openView}`; }));
}
