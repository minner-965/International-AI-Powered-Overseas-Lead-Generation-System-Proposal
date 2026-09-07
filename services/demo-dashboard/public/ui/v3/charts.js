// Thin native adapter: chart geometry never supplies missing business values.
export const finiteCount = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function marketSeries(markets, total) {
  if (total === null || total === undefined) return { state: 'error', rows: [] };
  if (!Array.isArray(markets) || finiteCount(total) === null || markets.some(row => !Array.isArray(row) || finiteCount(row[1]) === null)) return { state: 'error', rows: [] };
  const sum = markets.reduce((value, row) => value + Number(row[1]), 0);
  if (sum !== Number(total)) return { state: 'error', rows: [] };
  return { state: sum === 0 ? 'empty' : 'success', rows: markets.map(([label, count]) => ({ label, count: Number(count), share: Number(count) / sum * 100 })) };
}

// Defer only decorative geometry; the accessible text remains immediately available.
export function lazyChart(element, render, Observer = globalThis.IntersectionObserver) {
  if (!element) return () => {};
  if (!Observer) { render(); return () => {}; }
  const observer = new Observer(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); render(); }
  }, { rootMargin: '80px' });
  observer.observe(element);
  return () => observer.disconnect();
}
