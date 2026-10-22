// Reply review: a person confirms the reading of a customer reply or corrects its intent.
// A correction is appended as a new reading; tasks follow the corrected intent (server side).
import { crm, REPLY_INTENTS, bi, esc, notifyCrmChange, errorText } from './crm.js';

const reviewed = status => ['CONFIRMED', 'APPROVED', 'CORRECTED'].includes(String(status || '').toUpperCase());
function controls(article) {
  if (article.querySelector('.v4-reply-review')) return;
  const intent = article.dataset.intent;
  const box = document.createElement('form');
  box.className = 'v4-reply-review';
  box.noValidate = true;
  box.innerHTML = reviewed(article.dataset.reviewStatus)
    ? `<span class="pill ok">${bi('已复核', 'Reviewed')}</span>`
    : `<span class="v4-reply-review-label">${bi('回复判断', 'Reply reading')}</span><button class="btn btn-sm btn-primary" type="button" data-reply-confirm>${bi('确认', 'Confirm')}</button><label class="sr-only" for="intent-${esc(article.dataset.classificationId)}">更正为 Correct to</label><select id="intent-${esc(article.dataset.classificationId)}" class="select" name="intent">${Object.entries(REPLY_INTENTS).map(([key, [zh, en]]) => `<option value="${key}"${key === intent ? ' selected' : ''}>${esc(zh)} ${esc(en)}</option>`).join('')}</select><button class="btn btn-sm" type="button" data-reply-correct>${bi('纠正', 'Correct')}</button><span class="v4-form-status" role="status" aria-live="polite"></span>`;
  article.append(box);
  const status = box.querySelector('.v4-form-status');
  const submit = async (body, button) => {
    box.querySelectorAll('button,select').forEach(item => { item.disabled = true; });
    try { await crm.reviewReply(article.dataset.classificationId, body); box.innerHTML = `<span class="pill ok">${bi('已复核', 'Reviewed')}</span>`; notifyCrmChange({ type: 'reply' }); }
    catch (error) { status.innerHTML = bi(...errorText(error)); box.querySelectorAll('button,select').forEach(item => { item.disabled = false; }); button.focus(); }
  };
  box.querySelector('[data-reply-confirm]')?.addEventListener('click', event => submit({ decision: 'CONFIRM' }, event.currentTarget));
  box.querySelector('[data-reply-correct]')?.addEventListener('click', event => {
    const value = box.intent.value;
    if (value === intent) { status.innerHTML = bi('请选择不同的判断', 'Choose a different reading'); return; }
    void submit({ decision: 'CORRECT', intent: value }, event.currentTarget);
  });
}
const host = typeof document !== 'undefined' ? document.querySelector('#view-replies') : null;
if (host) {
  const scan = () => host.querySelectorAll('.v3-inbox-message[data-classification-id]').forEach(controls);
  new MutationObserver(scan).observe(host, { childList: true, subtree: true });
  scan();
}
