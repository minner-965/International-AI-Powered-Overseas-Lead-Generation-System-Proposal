const viewIcons = Object.freeze({
  overview: 'ti-layout-dashboard',
  companies: 'ti-building-store',
  'contact-queue': 'ti-address-book',
  'customer-match': 'ti-adjustments-check',
  evidence: 'ti-file-search',
  jobs: 'ti-list-check',
  'data-import': 'ti-file-import',
  'data-export': 'ti-file-export',
  settings: 'ti-settings'
});

function decoratePageHeader(view) {
  const head = view.querySelector(':scope > .crm-command-bar, :scope > .crm-section-head, :scope > .p9-jobs-header');
  if (!head) return;
  head.classList.add('ws-page-head');
  if (head.querySelector(':scope > .ws-page-icon')) return;
  const icon = document.createElement('span');
  icon.className = 'ws-page-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<i class="ti ${viewIcons[view.dataset.appView] || 'ti-layout-grid'}"></i>`;
  head.prepend(icon);
}

document.documentElement.dataset.workspaceUi = 'unified';
document.querySelectorAll('[data-app-view]').forEach(decoratePageHeader);
