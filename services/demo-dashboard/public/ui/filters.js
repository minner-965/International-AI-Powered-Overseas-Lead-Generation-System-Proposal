const form = document.querySelector('#opportunity-filters');
const statusSelect = document.querySelector('#opportunity-status');
const tabs = [...document.querySelectorAll('#opportunity-status-tabs [data-opportunity-status]')];
const drawer = document.querySelector('#opportunity-advanced-filter-drawer');
const openButton = document.querySelector('#opportunity-advanced-filter-open');
const closeButtons = [...(drawer?.querySelectorAll('[data-filter-drawer-close]') || [])];
const chips = document.querySelector('#opportunity-active-filters');
const advancedCount = document.querySelector('#opportunity-advanced-filter-count');
const search = document.querySelector('#opportunity-search');
const primaryHost = document.querySelector('#opportunity-primary-filters');
const advancedHost = document.querySelector('#opportunity-advanced-filter-fields');
const advancedActions = document.querySelector('#opportunity-advanced-filter-actions');
let opener = null;

const primaryNames = new Set(['status', 'country', 'product_profile', 'sort']);
const ignoredDefaults = new Map([['status', 'RECOMMENDED'], ['sort', 'category_procurement_desc']]);

const groups = Object.freeze([
  ['Buyer', ['buyer_business_model', 'buyer_subtype', 'decision_maker_status', 'normalized_role']],
  ['Product & Access', ['category_procurement_match_band', 'category_procurement_match_status', 'feasibility_band', 'cooperation_matrix', 'product_access_matrix']],
  ['Contact', ['readiness', 'contact_type', 'contact_verification']],
  ['History & Reference', ['historical_crm_status', 'management_match_band', 'historical_match_band', 'tier']],
]);

function arrangeFilters() {
  if (!form || !primaryHost || !advancedHost) return;
  for (const name of ['country', 'product_profile', 'sort']) {
    const control = form.elements.namedItem(name);
    if (control?.closest('label')) primaryHost.insertBefore(control.closest('label'), openButton);
  }
  for (const [title, names] of groups) {
    const section = document.createElement('section');
    section.className = 'crm-filter-group';
    section.innerHTML = `<h4>${title}</h4><div class="crm-filter-group-grid"></div>`;
    const grid = section.querySelector('.crm-filter-group-grid');
    for (const name of names) {
      const control = form.elements.namedItem(name);
      if (control?.closest('label')) grid.append(control.closest('label'));
    }
    advancedHost.append(section);
  }
  const clear = document.querySelector('#opportunity-clear-filters');
  if (clear && advancedActions) advancedActions.prepend(clear);
}

function labelFor(control) {
  const label = control.closest('label')?.querySelector('.bi');
  const zh = label?.querySelector('[lang="zh-CN"]')?.textContent?.trim();
  const en = label?.querySelector('[lang="en"]')?.textContent?.trim();
  const option = control.selectedOptions?.[0]?.textContent?.trim();
  return { zh: zh || control.name, en: en || control.name, option: option || control.value };
}

function activeControls() {
  if (!form) return [];
  return [...form.elements].filter(control => control.name && String(control.value || '').trim()
    && ignoredDefaults.get(control.name) !== String(control.value || '').trim());
}

function syncTabs() {
  const value = statusSelect?.value || 'RECOMMENDED';
  tabs.forEach(tab => {
    const active = tab.dataset.opportunityStatus === value;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
}

function syncChips() {
  const active = activeControls();
  const advanced = active.filter(control => !primaryNames.has(control.name));
  if (advancedCount) advancedCount.textContent = String(advanced.length);
  if (!chips) return;
  chips.innerHTML = active.length ? active.map(control => {
    const label = labelFor(control);
    return `<button class="crm-filter-chip" type="button" data-remove-filter="${control.name}" aria-label="移除 ${label.zh} 筛选 Remove ${label.en} filter"><span>${label.option}</span><i class="ti ti-x" aria-hidden="true"></i></button>`;
  }).join('') : '';
  chips.querySelectorAll('[data-remove-filter]').forEach(button => button.addEventListener('click', () => {
    const control = form.elements.namedItem(button.dataset.removeFilter);
    if (!control) return;
    control.value = ignoredDefaults.get(control.name) || '';
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }));
}

function sync() { syncTabs(); syncChips(); }

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    if (!statusSelect) return;
    statusSelect.value = tab.dataset.opportunityStatus;
    statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  });
});

openButton?.addEventListener('click', () => {
  opener = openButton;
  drawer?.showModal();
  requestAnimationFrame(() => drawer?.querySelector('select,button')?.focus({ preventScroll: true }));
});
closeButtons.forEach(button => button.addEventListener('click', () => drawer?.close()));
drawer?.addEventListener('cancel', event => { event.preventDefault(); drawer.close(); });
drawer?.addEventListener('click', event => {
  if (event.target !== drawer) return;
  const bounds = drawer.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) drawer.close();
});
drawer?.addEventListener('close', () => opener?.focus({ preventScroll: true }));
form?.addEventListener('change', sync);

let searchTimer = 0;
search?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => document.dispatchEvent(new CustomEvent('p8:opportunity-search', { detail: { query: search.value.trim() } })), 120);
});

arrangeFilters();
sync();

export const opportunitySearchValue = () => search?.value.trim() || '';
