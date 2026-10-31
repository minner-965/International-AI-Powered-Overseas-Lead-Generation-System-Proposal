// Text handed to the model is data, never instructions, and never carries personal data or secrets
// (standard sections 3.7, 7; evaluation guardrails 8 and 9).
//  - maskPii: emails, phone numbers, given personal names -> [EMAIL] / [PHONE] / [NAME].
//  - maskSecrets: API-key-like tokens, bearer tokens, passwords in URLs -> [SECRET].
//  - neutralizeDelimiters: a page cannot close the data block early by writing <<<END_PAGE_TEXT>>>.
//  - htmlToText: visible page text (scripts, styles and hidden elements removed), length-capped.
import * as cheerio from 'cheerio';

const EMAIL=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
// International / local phone shapes with at least 7 digits; dates like 2026-10-27 are left alone.
const PHONE=/(?<![\w/])(?:\+|00)?\d[\d\s().-]{6,}\d(?![\w/])/g;
const SECRET_PATTERNS=[
  /\b(?:sk|pk|rk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:tvly|exa|hunter|xai|gsk|AIza)[-_]?[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*\S{6,}/gi,
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g
];
const DATE_LIKE=/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/;

export function maskSecrets(text){
  let out=String(text??'');
  for(const pattern of SECRET_PATTERNS)out=out.replace(pattern,'[SECRET]');
  return out;
}

export function maskPii(text,{names=[]}={}){
  let out=maskSecrets(text).replace(EMAIL,'[EMAIL]');
  out=out.replace(PHONE,match=>{
    const trimmed=match.trim();
    const digits=trimmed.replace(/\D/g,'');
    if(digits.length<7||digits.length>15||DATE_LIKE.test(trimmed))return match;
    return match.replace(trimmed,'[PHONE]');
  });
  for(const name of names.map(item=>String(item||'').trim()).filter(item=>item.length>=3).sort((a,b)=>b.length-a.length)){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    out=out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'giu'),'[NAME]');
  }
  return out;
}

const ALL_MARKERS=/<<<\s*(?:END_)?(?:PAGE|REPLY|EVIDENCE)_TEXT\s*>>>/gi;
/** Replace any delimiter-looking marker inside data so the data block cannot be closed early. */
export function neutralizeDelimiters(text){
  return String(text??'').replace(ALL_MARKERS,match=>match.replace(/</g,'‹').replace(/>/g,'›'));
}

/** Wrap data in the fixed delimiters after neutralising markers inside it. */
export function wrapData(text,[open,close]){
  return`${open}\n${neutralizeDelimiters(text)}\n${close}`;
}

/** Remove control characters (keeps newlines and tabs) and collapse runs of blank space. */
export function cleanText(text,maxChars=40_000){
  return String(text??'')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ')
    .replace(/[ \t ]+/g,' ')
    .replace(/\s*\n\s*/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim()
    .slice(0,maxChars);
}

/** Visible text of an HTML page, capped at maxWords words (evaluation: <= 6000 words). */
export function htmlToText(html,{maxWords=6000}={}){
  const $=cheerio.load(String(html??''));
  $('script,style,noscript,template,svg,iframe,object,embed,head,[hidden],[aria-hidden="true"]').remove();
  $('[style]').each((_index,element)=>{if(/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr('style')||''))$(element).remove();});
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article,header,footer,nav,td,th').each((_index,element)=>{$(element).append('\n');});
  const text=cleanText($.root().text(),200_000);
  const words=text.split(/(?<=\s)/);
  return words.length>maxWords?words.slice(0,maxWords).join('').trim():text;
}
