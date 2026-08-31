const storage = {
  get(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

const bilingual = document.querySelector('#bilingual-detail-mode');
const defaultView = document.querySelector('#default-opportunity-view');

function setBilingualDetail(value) {
  const mode = value === 'compact' ? 'compact' : 'standard';
  document.documentElement.dataset.bilingualDetail = mode;
  if (bilingual) bilingual.value = mode;
  storage.set('dpv-bilingual-detail', mode);
}

setBilingualDetail(storage.get('dpv-bilingual-detail', 'standard'));
bilingual?.addEventListener('change', event => setBilingualDetail(event.target.value));
if (defaultView) defaultView.value = 'RECOMMENDED';

document.documentElement.dataset.phase8Ui = 'active';
