/** Presentational helpers only: no API calls, approvals, or persisted business state. */
export const componentStates = Object.freeze(['loading', 'empty', 'success', 'warning', 'error', 'disabled', 'stale', 'permission-denied', 'degraded']);
export function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function bilingual(zh, en) {
  return `<span class="bi"><span lang="zh-CN">${escapeText(zh)}</span><span lang="en">${escapeText(en)}</span></span>`;
}
export function stateMarkup(state, zh, en) {
  if (!componentStates.includes(state)) throw new TypeError('Unknown presentation state');
  return `<div class="dpv-state" data-state="${state}" role="${state === 'error' ? 'alert' : 'status'}" aria-live="${state === 'error' ? 'assertive' : 'polite'}"${state === 'loading' ? ' aria-busy="true"' : ''}>${bilingual(zh, en)}</div>`;
}

/** Tab boundary only. Native cancellation and each caller's dirty/focus restoration stay intact. */
export function bindDialogTabBoundary(ownerDocument = document) {
  const onKeydown = event => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const dialog = event.target?.closest?.('dialog[open]');
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex],[contenteditable="true"]')]
      .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length && !node.closest('[hidden],[inert]'));
    const active = ownerDocument.activeElement;
    if (!controls.length) {
      event.preventDefault();
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex','-1');
      dialog.focus({preventScroll:true});
      return;
    }
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (active === first || !controls.includes(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
      event.preventDefault(); first.focus();
    }
  };
  ownerDocument.addEventListener('keydown', onKeydown);
  return () => ownerDocument.removeEventListener('keydown', onKeydown);
}

/** Opt-in native dialog adapter. Existing application dialog handlers remain untouched.
 * Dirty state is owned by the caller, which supplies an explicit confirmation callback.
 */
export function bindDialog(dialog, { isDirty = () => false, confirmDiscard = () => false } = {}) {
  let opener = null;
  const requestClose = async () => {
    if (isDirty() && !(await confirmDiscard())) return false;
    dialog.close();
    return true;
  };
  const cancel = event => { event.preventDefault(); void requestClose(); };
  const click = event => {
    if (event.target.closest('[data-dpv-dialog-close]')) { event.preventDefault(); void requestClose(); }
  };
  const restore = () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('click', click);
  dialog.addEventListener('close', restore);
  return {
    open(trigger = dialog.ownerDocument.activeElement) { opener = trigger; if (!dialog.open) dialog.showModal(); },
    close: requestClose,
    dispose() { dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('click', click); dialog.removeEventListener('close', restore); }
  };
}
