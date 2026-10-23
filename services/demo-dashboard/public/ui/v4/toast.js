// Short confirmation / warning message at the bottom of the screen (above the phone tab bar).
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let host = null;
function ensureHost() {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.className = 'v4-toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  return host;
}

/** toast('已提交', 'Sent', { tone: 'ok'|'warn'|'bad', action: { zh, en, href } }) */
export function toast(zh, en, { tone = 'ok', action = null, duration = 5000 } = {}) {
  if (typeof document === 'undefined') return;
  const box = ensureHost();
  // Inside an open modal dialog the message must sit in the dialog to be visible.
  const dialog = document.querySelector('dialog[open]');
  if (dialog && box.parentNode !== dialog) dialog.append(box); else if (!dialog && box.parentNode !== document.body) document.body.append(box);
  if ([...box.children].some(node => node.dataset.key === `${zh}|${en}`)) return;
  const item = document.createElement('div');
  item.dataset.key = `${zh}|${en}`;
  item.className = `v4-toast ${tone}`;
  const icon = tone === 'ok' ? 'circle-check' : tone === 'bad' ? 'alert-circle' : 'info-circle';
  item.innerHTML = `<i class="ti ti-${icon}" aria-hidden="true"></i><span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>${action ? `<a href="${esc(action.href)}" data-tip="${esc(action.zh)}|${esc(action.en)}">${esc(action.zh)}</a>` : ''}`;
  box.append(item);
  setTimeout(() => item.remove(), duration);
}
