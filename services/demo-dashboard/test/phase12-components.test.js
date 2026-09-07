import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { componentStates, bilingual, stateMarkup, bindDialog } from '../public/ui/v3/components.js';

test('V3 bilingual labels escape all source text equally', () => {
  const html = bilingual('<客户>', 'A & B');
  assert.match(html, /lang="zh-CN">&lt;客户&gt;/);
  assert.match(html, /lang="en">A &amp; B/);
});
test('V3 nine states have explicit accessible presentation without fabricated values', () => {
  assert.equal(componentStates.length, 9);
  for (const state of componentStates) assert.match(stateMarkup(state, '状态', 'State'), new RegExp(`data-state="${state}"`));
  assert.match(stateMarkup('loading', '更新中', 'Updating'), /aria-busy="true"/);
  assert.match(stateMarkup('error', '稍后重试', 'Try again'), /role="alert"/);
  assert.throws(() => stateMarkup('SENT', '', ''), TypeError);
});
test('V3 dialog preserves dirty content and restores exact opener after clean close', async () => {
  let dirty = true; let focused = 0; let closed = 0;
  const handlers = new Map();
  const dialog = { open: false, ownerDocument: {}, addEventListener: (key, cb) => handlers.set(key, cb), removeEventListener: key => handlers.delete(key), showModal() { this.open = true; }, close() { this.open = false; closed++; handlers.get('close')(); } };
  const adapter = bindDialog(dialog, { isDirty: () => dirty });
  adapter.open({ isConnected: true, focus: () => focused++ });
  assert.equal(dialog.open, true);
  assert.equal(await adapter.close(), false);
  assert.equal(closed, 0);
  dirty = false;
  assert.equal(await adapter.close(), true);
  assert.equal(focused, 1);
  adapter.dispose(); assert.equal(handlers.size, 0);
});
test('V3 tokens resolve all aliases and preserve control/contrast pairs', () => {
  const css = readFileSync(new URL('../public/ui/v3/tokens.css', import.meta.url), 'utf8');
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  for (const [, variable] of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(definitions.has(variable), `Undefined ${variable}`);
  assert.match(css, /--dpv-primary: #2563eb/);
  assert.match(css, /--dpv-control-height: 44px/);
  assert.doesNotMatch(css, /#(?:5146e5|4f46e5|817bf6)/i);
});
test('V3 light and dark semantic text pairs meet contrast and controls remain visible', () => {
  const css = readFileSync(new URL('../public/ui/v3/tokens.css', import.meta.url), 'utf8');
  const sections = css.split('[data-bs-theme="dark"]');
  const colors = section => Object.fromEntries([...section.matchAll(/--dpv-([\w-]+): (#[\da-f]{6});/g)].map(m => [m[1], m[2]]));
  const light = colors(sections[0]); const dark = { ...light, ...colors(sections[1]) };
  const luminance = hex => {
    const values = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return values[0]*.2126 + values[1]*.7152 + values[2]*.0722;
  };
  const contrast = (a,b) => { const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  for (const palette of [light,dark]) {
    for (const [fg,bg] of [['ink','surface'],['muted','surface'],['muted','surface-subtle'],['primary','on-primary'],['success','success-soft'],['warning','warning-soft'],['danger','danger-soft'],['info','info-soft']]) assert.ok(contrast(palette[fg],palette[bg]) >= 4.5, `${fg}/${bg}`);
    assert.ok(contrast(palette['border-strong'],palette.surface) >= 3);
  }
});
