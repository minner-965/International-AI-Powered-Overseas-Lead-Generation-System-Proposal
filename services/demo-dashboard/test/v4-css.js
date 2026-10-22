// Shared readers for the single V4 stylesheet. Sections keep the component ownership
// that the earlier per-file stylesheets had, so contract tests stay component-scoped.
import { readFileSync } from 'node:fs';

export const appCssUrl = new URL('../public/ui/v4/app.css', import.meta.url);
export const appCss = () => readFileSync(appCssUrl, 'utf8');
const TOKENS_START = '/* ==== V4 design tokens';
const TOKENS_END = '[data-density="compact"] { --dpv-page-gap';

/** Design-token block (light :root and [data-bs-theme="dark"]). */
export function tokenCss(css = appCss()) {
  return css.slice(css.indexOf(TOKENS_START), css.indexOf(TOKENS_END) + TOKENS_END.length + 40);
}

/** Every rule outside the token block: components must reference tokens, not raw colours. */
export function componentCss(css = appCss()) {
  return css.slice(0, css.indexOf(TOKENS_START)) + css.slice(css.indexOf(TOKENS_END));
}

/** One named section, e.g. cssSection('outreach'), delimited by "/* ==== section: NAME ==== *\/". */
export function cssSection(name, css = appCss()) {
  const marker = `/* ==== section: ${name} ==== */`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS section ${name}`);
  const next = css.indexOf('/* ==== ', start + marker.length);
  return css.slice(start, next < 0 ? undefined : next);
}
