const MARKET_DETAILS = Object.freeze({
  AE: Object.freeze({ visible:true, zh:'阿联酋', en:'UAE' }),
  MX: Object.freeze({ visible:true, zh:'墨西哥', en:'Mexico' }),
  BD: Object.freeze({ visible:false, zh:'孟加拉国', en:'Bangladesh' })
});

export const MARKET_VISIBILITY = Object.freeze(
  Object.fromEntries(Object.entries(MARKET_DETAILS).map(([code,details])=>[code,details.visible]))
);

export const visibleMarketCodes = () => Object.entries(MARKET_DETAILS)
  .filter(([,details])=>details.visible)
  .map(([code])=>code);

export const hiddenMarketCodes = () => Object.entries(MARKET_DETAILS)
  .filter(([,details])=>!details.visible)
  .map(([code])=>code);

export const isMarketVisible = value => {
  const code = String(value || '').trim().toUpperCase();
  return !code || MARKET_VISIBILITY[code] !== false;
};

export const filterVisibleMarkets = values => (Array.isArray(values) ? values : [values])
  .map(value=>String(value || '').trim().toUpperCase())
  .filter(value=>value && isMarketVisible(value));

export function applyMarketVisibility(root = document) {
  root.querySelectorAll('#research-country option[data-country-code]').forEach(option=>{
    const visible = MARKET_VISIBILITY[String(option.dataset.countryCode || '').toUpperCase()] !== false;
    option.hidden = !visible;
    option.disabled = !visible;
  });

  const codes = visibleMarketCodes();
  const summary = root.querySelector('#market-visibility-summary');
  if (!summary) return;
  const zh = codes.map(code=>MARKET_DETAILS[code].zh).join('、');
  const en = codes.map(code=>MARKET_DETAILS[code].en).join(' and ');
  const codeHost = summary.querySelector('.market-code');
  const zhHost = summary.querySelector('[lang="zh-CN"]');
  const enHost = summary.querySelector('[lang="en"]');
  if (codeHost) codeHost.textContent = codes.join(' / ');
  if (zhHost) zhHost.textContent = zh;
  if (enHost) enHost.textContent = en;
}
