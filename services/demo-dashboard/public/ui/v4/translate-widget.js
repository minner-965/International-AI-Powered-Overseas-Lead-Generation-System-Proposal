// 翻译 / Translate widget (B7): pick a target language, translate the text of an editor field, edit the
// suggestion and put it back with “使用译文 Use translation”. Nothing is saved or sent by the widget;
// the editor's own Save / Approve buttons still decide. POST /api/translate does the work on the server.
//   attachTranslateWidget(host, { targets: [{ key, label: [zh, en], get: () => text, set: text => {} }] })
// Declarative use: <div data-translate-for="#textarea-id"></div> is wired automatically.
import { bi, esc } from './crm.js';
import { tip } from './tooltips.js';
import { managementRequest } from '../../phase7-ui.js';

export const TRANSLATE_LANGUAGES = Object.freeze([
  ['es', '西班牙语', 'Spanish'], ['pt', '葡萄牙语', 'Portuguese'], ['ar', '阿拉伯语', 'Arabic'], ['fr', '法语', 'French'],
  ['de', '德语', 'German'], ['it', '意大利语', 'Italian'], ['tr', '土耳其语', 'Turkish'], ['en', '英语', 'English'], ['zh', '中文', 'Chinese']
]);
export const MAX_CHARS = 5000;
const STORE_KEY = 'sim.translate.target';
let counter = 0;

/** Error code from POST /api/translate -> plain words. */
export function translateErrorText(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'TRANSLATE_UNAVAILABLE') return ['翻译服务暂未开通，请联系 SIM 管理员', 'Translation is not set up yet; contact the SIM administrator'];
  if (code === 'TRANSLATE_RATE_LIMITED' || error?.status === 429) return ['翻译太频繁，请一分钟后再试', 'Too many translations; try again in a minute'];
  if (code === 'TRANSLATE_TEXT_TOO_LONG' || error?.status === 413) return [`内容超过 ${MAX_CHARS} 字，请分段翻译`, `Longer than ${MAX_CHARS} characters; translate it in parts`];
  if (code === 'TRANSLATE_TEXT_REQUIRED') return ['没有可翻译的内容', 'There is no text to translate'];
  if (code === 'TRANSLATE_SAME_LANGUAGE') return ['原文已经是这种语言', 'The text is already in this language'];
  if (code === 'ADMIN_REQUIRED' || error?.status === 403) return ['当前账号不能使用翻译', 'Translation is not available for this account'];
  return ['翻译未完成，请重试', 'Could not translate; please retry'];
}

function rememberedTarget(fallback) {
  try { const value = globalThis.localStorage?.getItem(STORE_KEY); if (TRANSLATE_LANGUAGES.some(([key]) => key === value)) return value; } catch { /* storage blocked */ }
  return fallback;
}
function remember(value) { try { globalThis.localStorage?.setItem(STORE_KEY, value); } catch { /* storage blocked */ } }

export function widgetMarkup({ id, targets, target }) {
  const fieldChoice = targets.length > 1
    ? `<label class="field v4-translate-field" for="${id}-field"><span class="lbl">${bi('翻译内容', 'Text')}</span><select id="${id}-field" class="select" data-translate-field>${targets.map((item, i) => `<option value="${i}">${esc(item.label[0])} ${esc(item.label[1])}</option>`).join('')}</select></label>` : '';
  return `<div class="v4-translate-bar">${fieldChoice}<label class="field v4-translate-lang" for="${id}-lang"><span class="lbl">${bi('译成', 'Translate into')}</span><select id="${id}-lang" class="select" data-translate-lang>${TRANSLATE_LANGUAGES.map(([key, zh, en]) => `<option value="${key}"${key === target ? ' selected' : ''}>${esc(zh)} ${esc(en)}</option>`).join('')}</select></label>
    <button class="btn btn-outline-primary" type="button" data-translate-run${tip('把上面的内容翻译成所选语言；译文可以先修改，再决定是否使用', 'Translate the text above; edit the result before using it')}><i class="ti ti-language" aria-hidden="true"></i>${bi('翻译', 'Translate')}</button></div>
    <p class="v4-form-status" role="status" aria-live="polite" data-translate-status></p>
    <div class="v4-translate-result" data-translate-output hidden><label class="field" for="${id}-result"><span class="lbl">${bi('译文（可修改）', 'Translation (editable)')}</span><textarea id="${id}-result" rows="6" maxlength="${MAX_CHARS * 2}" data-translate-result></textarea></label>
    <div class="btns"><button class="btn btn-primary" type="button" data-translate-use${tip('用译文替换上面的内容；保存或批准前仍可修改', 'Replace the text above with the translation; you can still edit before saving')}><i class="ti ti-replace" aria-hidden="true"></i>${bi('使用译文', 'Use translation')}</button><button class="btn" type="button" data-translate-dismiss${tip('收起译文，不改动原文', 'Close the translation without changing the text')}>${bi('收起', 'Close')}</button></div></div>`;
}

/**
 * Attach a widget inside `host`. targets: [{ label: [zh, en], get(), set(text) }]. Returns the element.
 * request(body) defaults to POST /api/translate; tests pass their own.
 */
export function attachTranslateWidget(host, { targets, defaultTarget = 'es', readOnly = false, request = null } = {}) {
  if (!host || !targets?.length) return null;
  const send = request || (body => managementRequest('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const id = `v4-translate-${++counter}`;
  const box = document.createElement('section');
  box.className = 'v4-translate';
  box.setAttribute('aria-label', '翻译 Translate');
  box.innerHTML = widgetMarkup({ id, targets, target: rememberedTarget(defaultTarget) });
  host.replaceChildren(box);
  const $ = selector => box.querySelector(selector);
  const status = $('[data-translate-status]'); const output = $('[data-translate-output]'); const result = $('[data-translate-result]');
  const run = $('[data-translate-run]'); const use = $('[data-translate-use]');
  const current = () => targets[Number($('[data-translate-field]')?.value || 0)] || targets[0];
  if (readOnly) { use.disabled = true; use.hidden = true; }
  $('[data-translate-lang]').addEventListener('change', event => remember(event.target.value));
  run.addEventListener('click', async () => {
    const text = String(current().get() || '');
    const target = $('[data-translate-lang]').value;
    if (!text.trim()) { status.innerHTML = bi(...translateErrorText({ code: 'TRANSLATE_TEXT_REQUIRED' })); return; }
    if (text.length > MAX_CHARS) { status.innerHTML = bi(...translateErrorText({ code: 'TRANSLATE_TEXT_TOO_LONG' })); return; }
    run.disabled = true; status.innerHTML = bi('正在翻译', 'Translating');
    try {
      const payload = await send({ text, source: 'auto', target });
      result.value = payload?.text || '';
      result.dir = target === 'ar' ? 'rtl' : 'auto';
      result.lang = target;
      output.hidden = false; status.textContent = '';
      result.focus();
    } catch (error) { status.innerHTML = bi(...translateErrorText(error)); }
    finally { run.disabled = false; }
  });
  use.addEventListener('click', () => {
    if (!result.value.trim()) return;
    current().set(result.value);
    output.hidden = true; status.innerHTML = bi('已使用译文，请检查后保存或批准', 'Translation applied; review it before saving or approving');
    run.focus();
  });
  $('[data-translate-dismiss]').addEventListener('click', () => { output.hidden = true; status.textContent = ''; run.focus(); });
  return box;
}

/** Wire a plain input/textarea: setting the value also fires `input` so editors notice the change. */
export function fieldTarget(input, label) {
  return { label, get: () => input.value, set: text => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); } };
}

/** Declarative hosts: <div data-translate-for="#body"></div> (optional data-translate-label="正文|Body"). */
export function autoAttach(root = document) {
  root.querySelectorAll?.('[data-translate-for]:not([data-translate-ready])').forEach(host => {
    const input = document.querySelector(host.dataset.translateFor);
    if (!input) return;
    host.dataset.translateReady = 'true';
    const [zh = '正文', en = 'Text'] = String(host.dataset.translateLabel || '').split('|').filter(Boolean);
    attachTranslateWidget(host, { targets: [fieldTarget(input, [zh, en])], readOnly: input.readOnly || input.disabled });
  });
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const start = () => { autoAttach(); new MutationObserver(() => autoAttach()).observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}
